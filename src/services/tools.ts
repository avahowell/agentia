import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TauriMcpTransport } from "./tauri_mcp_transport";

export interface ModelToolHandle {
    client: any;
    getAnthropicTools: () => Promise<any[]>;
    executeAnthropicTool: (name: string, args: Record<string, unknown>) => Promise<any>;
}

export interface CompositeModelTools {
    getTools: () => Promise<any[]>;
    executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
    addTool: (id: string, handle: ModelToolHandle) => void;
    removeTool: (id: string) => void;
    isToolEnabled: (id: string) => boolean;
    getEnabledToolIds: () => string[];
}

class CompositeModelToolsImpl implements CompositeModelTools {
    private enabledTools: Map<string, ModelToolHandle> = new Map();

    addTool(id: string, handle: ModelToolHandle) {
        this.enabledTools.set(id, handle);
    }

    removeTool(id: string) {
        this.enabledTools.delete(id);
    }

    isToolEnabled(id: string): boolean {
        return this.enabledTools.has(id);
    }

    getEnabledToolIds(): string[] {
        return Array.from(this.enabledTools.keys());
    }

    async getTools(): Promise<any[]> {
        // Fetch and combine tools from all enabled handlers
        const allTools = await Promise.all(
            Array.from(this.enabledTools.values()).map(handle => handle.getAnthropicTools())
        );
        return allTools.flat();
    }

    async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
        // Try each handler until we find one that can execute the tool
        for (const handle of this.enabledTools.values()) {
            try {
                const tools = await handle.getAnthropicTools();
                if (tools.some(tool => tool.name === name)) {
                    return await handle.executeAnthropicTool(name, args);
                }
            } catch (error) {
                console.warn('Error checking tool handle:', error);
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
    envVars: Record<string, string>
) => {
    const transport = new TauriMcpTransport({
        serverId: Math.random().toString(36).substring(2, 15),
        command: command,
        envVars: Object.entries(envVars).map(([key, value]) => ({ key, value }))
    });

    const client = new Client(
        {
            name: "tauri-mcp-client",
            version: "1.0.0",
        },
        {
            capabilities: {
                sampling: {},
            }
        }
    );

    await client.connect(transport);

    return {
        client,
        getAnthropicTools: async () => {
            const { tools } = await client.listTools();
            return tools;
        },
        executeAnthropicTool: async (name: string, args: Record<string, unknown>) => {
            const result = await client.callTool({
                name,
                arguments: args
            });
            return result.result;
        }
    };
};