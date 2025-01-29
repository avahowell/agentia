import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { deserializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";

interface TauriMcpConfig {
  serverId: string;
  command: string;
  envVars?: Array<{ key: string; value: string }>;
}

export class TauriMcpTransport implements Transport {
  private _started = false;
  private _config: TauriMcpConfig;
  private _messageQueue: JSONRPCMessage[] = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(config: TauriMcpConfig) {
    this._config = config;
  }

  async start(): Promise<void> {
    if (this._started) {
      throw new Error("TauriMcpTransport already started!");
    }

    try {
      // Start the MCP server process via Tauri
      await invoke('start_mcp_server', {
        serverId: this._config.serverId,
        command: this._config.command,
        envVars: this._config.envVars || []
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
      // If it doesn't have an 'id', it's a notification and doesn't expect a response
      const isRequest = 'id' in message;
      
      if (!isRequest) {
        // For notifications, just send and don't wait for response
        await invoke('send_mcp_command', {
          serverId: this._config.serverId,
          command: JSON.stringify(message)
        });
        return;
      }

      // For requests, wait for and process the response
      const response = await invoke('send_mcp_command', {
        serverId: this._config.serverId,
        command: JSON.stringify(message)
      }) as string;
      console.log("response: ", response);

      try {
        const responseMessage = deserializeMessage(response);
        console.log("parsed message: ", responseMessage);
        this.onmessage?.(responseMessage);
      } catch (parseError) {
        console.error("Failed to parse response as JSON-RPC message:", parseError);
        this.onerror?.(parseError as Error);
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

    this._started = false;
    this._messageQueue = [];
    this.onclose?.();
  }
}