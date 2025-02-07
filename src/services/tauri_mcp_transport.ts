import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { deserializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { listen } from "@tauri-apps/api/event";

interface TauriMcpConfig {
  serverId: string;
  command: string;
  envVars?: Array<{ key: string; value: string }>;
}

export class TauriMcpTransport implements Transport {
  private _started = false;
  private _config: TauriMcpConfig;
  private _messageQueue: JSONRPCMessage[] = [];
  private _unlisten: Array<() => void> = [];
  private _pendingRequests = new Map<
    string | number,
    (message: JSONRPCMessage) => void
  >();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onstdout?: (line: string) => void;
  onstderr?: (line: string) => void;

  constructor(config: TauriMcpConfig) {
    this._config = config;
  }

  async start(): Promise<void> {
    if (this._started) {
      throw new Error("TauriMcpTransport already started!");
    }

    try {
      // Listen for stdout events
      const unlistenStdout = await listen(
        `mcp://stdout/${this._config.serverId}`,
        (event) => {
          const line = event.payload as string;
          this.onstdout?.(line);

          // Try to parse as JSON-RPC message
          try {
            const message = deserializeMessage(line);
            // If it has an ID, it might be a response to a pending request
            if ("id" in message) {
              const resolver = this._pendingRequests.get(message.id);
              if (resolver) {
                resolver(message);
                this._pendingRequests.delete(message.id);
              }
            }
            // Always emit the message regardless
            this.onmessage?.(message);
          } catch (error) {
            // Not a valid JSON-RPC message, that's okay
          }
        },
      );
      this._unlisten.push(unlistenStdout);

      // Listen for stderr events
      const unlistenStderr = await listen(
        `mcp://stderr/${this._config.serverId}`,
        (event) => {
          this.onstderr?.(event.payload as string);
        },
      );
      this._unlisten.push(unlistenStderr);

      // Start the MCP server process via Tauri
      await invoke("start_mcp_server", {
        serverId: this._config.serverId,
        command: this._config.command,
        envVars: this._config.envVars || [],
      });

      this._started = true;

      // Process any messages that were queued before start
      while (this._messageQueue.length > 0) {
        const message = this._messageQueue.shift();
        if (message) {
          await this.send(message);
        }
      }
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    console.log("sending message: ", message);
    if (!this._started) {
      // Queue messages if not started yet
      this._messageQueue.push(message);
      return;
    }

    try {
      // If the message has an 'id', it's a request that expects a response
      const isRequest = "id" in message;

      if (isRequest) {
        // Set up promise for the response
        const responsePromise = new Promise<JSONRPCMessage>(
          (resolve, reject) => {
            // Set a timeout to clean up if we don't get a response
            const timeoutId = setTimeout(() => {
              this._pendingRequests.delete(message.id);
              reject(new Error("Timeout waiting for response"));
            }, 50000);

            this._pendingRequests.set(message.id, (response) => {
              clearTimeout(timeoutId);
              resolve(response);
            });
          },
        );

        // Send the command
        await invoke("send_mcp_command", {
          serverId: this._config.serverId,
          command: JSON.stringify(message),
        });

        // Wait for the response
        const response = await responsePromise;
        this.onmessage?.(response);
      } else {
        // For notifications, just send and don't wait for response
        await invoke("send_mcp_command", {
          serverId: this._config.serverId,
          command: JSON.stringify(message),
        });
      }
    } catch (error) {
      console.log("error: ", error);
      this.onerror?.(error as Error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this._started) {
      return;
    }

    // Clean up event listeners
    for (const unlisten of this._unlisten) {
      unlisten();
    }
    this._unlisten = [];

    // Clean up any pending requests
    for (const [id, resolver] of this._pendingRequests.entries()) {
      resolver({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32099,
          message: "Connection closed",
        },
      });
    }
    this._pendingRequests.clear();

    this._started = false;
    this._messageQueue = [];
    this.onclose?.();
  }
}
