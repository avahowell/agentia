import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TauriMcpTransport } from "./tauri_mcp_transport";
import { Tool } from "@anthropic-ai/sdk/resources/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { Tool };

export interface ModelToolHandle {
  client: any;
  getAnthropicTools: () => Promise<Tool[]>;
  executeAnthropicTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<any>;
}

export interface CompositeModelTools {
  getTools: () => Promise<Tool[]>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
  addTool: (id: string, handle: ModelToolHandle) => Promise<void>;
  removeTool: (id: string) => void;
  isToolEnabled: (id: string) => boolean;
  getEnabledToolIds: () => string[];
  getToolHandle: (id: string) => ModelToolHandle | undefined;
}

class CompositeModelToolsImpl implements CompositeModelTools {
  private enabledTools: Map<string, ModelToolHandle> = new Map();
  private toolCache: Map<string, Tool[]> = new Map();

  async addTool(id: string, handle: ModelToolHandle) {
    this.enabledTools.set(id, handle);
    // Cache the tools when adding a new handle
    const tools = await handle.getAnthropicTools();
    this.toolCache.set(id, tools);
  }

  removeTool(id: string) {
    this.enabledTools.delete(id);
    this.toolCache.delete(id);
  }

  isToolEnabled(id: string): boolean {
    return this.enabledTools.has(id);
  }

  getEnabledToolIds(): string[] {
    return Array.from(this.enabledTools.keys());
  }

  getToolHandle(id: string): ModelToolHandle | undefined {
    return this.enabledTools.get(id);
  }

  async getTools(): Promise<Tool[]> {
    // Return all cached tools
    return Array.from(this.toolCache.values()).flat();
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    // Try each handler until we find one that can execute the tool
    console.log("executeTool", name, args);
    console.log("enabledTools", this.enabledTools);
    for (const [id, handle] of this.enabledTools.entries()) {
      try {
        const tools = this.toolCache.get(id) || [];
        if (tools.some((tool) => tool.name === name)) {
          console.log("EXECUTING TOOL", name, args);
          return await handle.executeAnthropicTool(name, args);
        }
      } catch (error) {
        throw error;
      }
    }
    throw new Error(`No enabled tool handler found for tool: ${name}`);
  }
}

export const createCompositeModelTools = (): CompositeModelTools => {
  return new CompositeModelToolsImpl();
};

// given the server's name in terms of an npm package, run the server and return
// its MCP handle.
export const runNpxMcpServer = async (
  command: string,
  envVars: Record<string, string>,
) => {
  const transport = new TauriMcpTransport({
    serverId: Math.random().toString(36).substring(2, 15),
    command: command,
    envVars: Object.entries(envVars).map(([key, value]) => ({ key, value })),
  });

  const client = new Client(
    {
      name: "tauri-mcp-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  await client.connect(transport);

  return {
    client,
    getAnthropicTools: async (): Promise<Tool[]> => {
      const { tools } = await client.listTools();
      return tools.map(({ inputSchema, description, name }) => ({
        name,
        description,
        input_schema: inputSchema,
      }));
    },
    executeAnthropicTool: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<CallToolResult> => {
      console.log("executeAnthropicTool", name, args);
      const result = (await client.callTool({
        name,
        arguments: args,
      })) as CallToolResult;
      console.log("executeAnthropicTool result", result);
      return result;
    },
  };
};
