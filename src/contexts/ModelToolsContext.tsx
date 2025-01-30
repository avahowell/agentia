import React, { createContext, useContext, useState, useEffect } from "react";
import {
  CompositeModelTools,
  createCompositeModelTools,
  runNpxMcpServer,
} from "../services/tools";

interface ModelToolsContextType {
  modelTools: CompositeModelTools;
  enableTool: (
    toolId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => Promise<void>;
  disableTool: (toolId: string) => Promise<void>;
  getToolSettings: (toolId: string) => ToolSetting | undefined;
  updateToolSettings: (
    toolId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => void;
}

interface ToolSetting {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface SavedToolSettings {
  tools: ToolSetting[];
}

const ModelToolsContext = createContext<ModelToolsContextType | undefined>(
  undefined,
);

export const ModelToolsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [modelTools] = useState(() => createCompositeModelTools());
  const [isInitializing, setIsInitializing] = useState(true);
  const [toolsVersion, setToolsVersion] = useState(0);
  const initializedRef = React.useRef(new Set<string>());
  const initializationPromiseRef = React.useRef<Promise<void>>();
  const toolSettingsRef = React.useRef<Map<string, ToolSetting>>(new Map());

  // Initialize tools and settings on app start
  useEffect(() => {
    console.log("🔄 ModelToolsProvider effect running");

    const initializeTools = async () => {
      if (initializationPromiseRef.current) {
        console.log("⏳ Waiting for existing initialization to complete");
        await initializationPromiseRef.current;
        return;
      }

      console.log("🚀 Starting tool initialization");
      const savedSettings = localStorage.getItem("toolSettings");
      if (!savedSettings) {
        console.log("ℹ️ No saved settings found");
        setIsInitializing(false);
        return;
      }

      const settings: SavedToolSettings = JSON.parse(savedSettings);
      console.log("📝 Loaded settings:", settings);

      // Launch all enabled tools
      for (const tool of settings.tools) {
        console.log(`🔧 Initializing tool ${tool.id}`);
        try {
          if (initializedRef.current.has(tool.id)) {
            console.log(`⏭️ Tool ${tool.id} already initialized, skipping`);
            continue;
          }

          console.log(
            `📡 Starting ${tool.id} server with command: ${tool.command} ${tool.args.join(" ")}`,
          );
          const handle = await runNpxMcpServer(
            `${tool.command} ${tool.args.join(" ")}`,
            tool.env,
          );
          await modelTools.addTool(tool.id, handle);
          initializedRef.current.add(tool.id);
          toolSettingsRef.current.set(tool.id, tool);
          console.log(`✅ ${tool.id} tool initialized`);
        } catch (error) {
          console.error(`❌ Failed to initialize tool ${tool.id}:`, error);
        }
      }
      console.log("🏁 Tool initialization complete");
      setIsInitializing(false);
    };

    initializationPromiseRef.current = initializeTools();

    return () => {
      console.log("🧹 ModelToolsProvider cleanup running");
    };
  }, []);

  useEffect(() => {
    if (isInitializing) return;

    const settings: SavedToolSettings = {
      tools: Array.from(toolSettingsRef.current.values()),
    };
    localStorage.setItem("toolSettings", JSON.stringify(settings));
  }, [isInitializing, toolsVersion]);

  const enableTool = async (
    toolId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => {
    try {
      if (initializedRef.current.has(toolId)) {
        return;
      }

      toolSettingsRef.current.set(toolId, { id: toolId, command, args, env });

      console.log(
        `📡 Starting ${toolId} server with command: ${command} ${args.join(" ")}`,
      );
      const handle = await runNpxMcpServer(`${command} ${args.join(" ")}`, env);
      await modelTools.addTool(toolId, handle);
      initializedRef.current.add(toolId);
      setToolsVersion((v) => v + 1);
    } catch (error) {
      toolSettingsRef.current.delete(toolId);
      console.error(`Failed to enable tool ${toolId}:`, error);
      throw error;
    }
  };

  const disableTool = async (toolId: string) => {
    try {
      modelTools.removeTool(toolId);
      initializedRef.current.delete(toolId);
      toolSettingsRef.current.delete(toolId);
      setToolsVersion((v) => v + 1);
    } catch (error) {
      console.error(`Failed to disable tool ${toolId}:`, error);
      throw error;
    }
  };

  const getToolSettings = (toolId: string) => {
    return toolSettingsRef.current.get(toolId);
  };

  const updateToolSettings = (
    toolId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => {
    toolSettingsRef.current.set(toolId, { id: toolId, command, args, env });
    setToolsVersion((v) => v + 1); // Trigger save to localStorage
  };

  return (
    <ModelToolsContext.Provider
      value={{
        modelTools,
        enableTool,
        disableTool,
        getToolSettings,
        updateToolSettings,
      }}
    >
      {children}
    </ModelToolsContext.Provider>
  );
};

export const useModelTools = () => {
  const context = useContext(ModelToolsContext);
  if (!context) {
    throw new Error("useModelTools must be used within a ModelToolsProvider");
  }
  return context;
};
