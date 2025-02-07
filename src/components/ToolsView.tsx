import React, { useState, useEffect, useMemo } from "react";
import { useModelTools } from "../contexts/ModelToolsContext";
import { open } from "@tauri-apps/plugin-dialog";
import { getApiKeys } from "../services/chat";

interface Tool {
  id: string;
  name: string;
  icon: JSX.Element;
  command: string;
  getArgs: () => string[];
  getEnv: () => Record<string, string>;
}

export function ToolsView() {
  const {
    modelTools,
    enableTool,
    disableTool,
    getToolSettings,
    updateToolSettings,
  } = useModelTools();
  const [filesystemPaths, setFilesystemPaths] = useState<string[]>([]);
  const [exaApiKey, setExaApiKey] = useState<string | undefined>();
  const [openaiApiKey, setOpenaiApiKey] = useState<string | undefined>();

  useEffect(() => {
    const loadApiKeys = async () => {
      const keys = await getApiKeys();
      console.log("API KEYS:", keys);
      setExaApiKey(keys.exa);
      setOpenaiApiKey(keys.openai);
    };
    loadApiKeys();
  }, []);

  // Tools definition using useMemo to update when exaApiKey changes
  const tools = useMemo<Tool[]>(
    () => [
      {
        id: "memory",
        name: "Memory",
        command: "npx",
        getArgs: () => ["-y", "@modelcontextprotocol/server-memory"],
        getEnv: () => ({}),
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        ),
      },
      {
        id: "filesystem",
        name: "Filesystem",
        command: "npx",
        getArgs: () => ["-y", "@modelcontextprotocol/server-filesystem"],
        getEnv: () => ({}),
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3h18v18H3z" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
        ),
      },
      {
        id: "database",
        name: "Database",
        command: "npx",
        getArgs: () => ["-y", "@modelcontextprotocol/server-memory"], // TODO: change to sqlite mcp
        getEnv: () => ({}),
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        ),
      },
      {
        id: "web",
        name: "Web Browsing",
        command: "npx",
        getArgs: () => ["-y", "@modelcontextprotocol/server-puppeteer"],
        getEnv: () => ({}),
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        ),
      },
      {
        id: "search",
        name: "Search",
        command: "npx",
        getArgs: () => ["-y", "exa-mcp-server"],
        getEnv: () => ({
          EXA_API_KEY: exaApiKey || "",
        }),
        icon: (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        ),
      },
    ],
    [exaApiKey, openaiApiKey],
  ); // Add exaApiKey and openaiApiKey as dependencies

  // Get the final args for a tool, including any dynamic configuration
  const getToolArgs = (tool: Tool) => {
    const baseArgs = tool.getArgs();
    if (tool.id === "filesystem") {
      return [...baseArgs, ...filesystemPaths].filter(Boolean);
    }
    return baseArgs;
  };

  const handleAddDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Directory for Filesystem Access",
      });

      if (selected && typeof selected === "string") {
        const newPaths = [...filesystemPaths, selected];
        setFilesystemPaths(newPaths);

        // Update settings without affecting tool state
        const filesystemTool = tools.find((t) => t.id === "filesystem");
        if (filesystemTool) {
          const args = [...filesystemTool.getArgs(), ...newPaths];
          updateToolSettings(
            filesystemTool.id,
            filesystemTool.command,
            args,
            filesystemTool.getEnv(),
          );

          // If tool is enabled, update it with new paths
          if (modelTools.isToolEnabled("filesystem")) {
            await disableTool("filesystem");
            await enableTool(
              filesystemTool.id,
              filesystemTool.command,
              args,
              filesystemTool.getEnv(),
            );
          }
        }
      }
    } catch (error) {
      console.error("Failed to open directory picker:", error);
      if (
        error instanceof Error &&
        error.message !== "User cancelled the selection"
      ) {
        alert("Failed to open directory picker. Please try again.");
      }
    }
  };

  const handleRemovePath = async (pathToRemove: string) => {
    const newPaths = filesystemPaths.filter((path) => path !== pathToRemove);
    setFilesystemPaths(newPaths);

    // Update settings without affecting tool state
    const filesystemTool = tools.find((t) => t.id === "filesystem");
    if (filesystemTool) {
      const args = [...filesystemTool.getArgs(), ...newPaths];
      updateToolSettings(
        filesystemTool.id,
        filesystemTool.command,
        args,
        filesystemTool.getEnv(),
      );

      // If tool is enabled, update it with new paths
      if (modelTools.isToolEnabled("filesystem")) {
        await disableTool("filesystem");
        await enableTool(
          filesystemTool.id,
          filesystemTool.command,
          args,
          filesystemTool.getEnv(),
        );
      }
    }
  };

  const toggleTool = async (tool: Tool) => {
    try {
      const isEnabled = modelTools.isToolEnabled(tool.id);
      if (!isEnabled) {
        // If trying to enable filesystem without any paths, show error
        if (tool.id === "filesystem" && filesystemPaths.length === 0) {
          alert(
            "You must add at least one allowed directory before enabling filesystem access.",
          );
          return;
        }

        await enableTool(
          tool.id,
          tool.command,
          getToolArgs(tool),
          tool.getEnv(),
        );
      } else {
        await disableTool(tool.id);
      }
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      }
    }
  };

  // Load filesystem paths from tool settings, regardless of enabled state
  useEffect(() => {
    const settings = getToolSettings("filesystem");
    if (settings) {
      // Get paths from args (skip the first two args which are -y and the package name)
      const paths = settings.args.slice(2);
      setFilesystemPaths(paths);
    } else {
      setFilesystemPaths([]);
    }
  }, [getToolSettings]);

  return (
    <div className="tools-view">
      <h2>Tool Configuration</h2>
      <div className="tools-grid">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`tool-config-button ${modelTools.isToolEnabled(tool.id) ? "enabled" : ""}`}
            onClick={() => toggleTool(tool)}
          >
            <div className="tool-icon">{tool.icon}</div>
            <span className="tool-name">{tool.name}</span>
            <div
              className={`tool-status ${modelTools.isToolEnabled(tool.id) ? "enabled" : ""}`}
            >
              <div className="tool-status-indicator" />
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "1.5rem",
          backgroundColor: "var(--color-background-light)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            Filesystem Configuration
          </h3>
          <div
            style={{
              height: "8px",
              width: "8px",
              borderRadius: "50%",
              backgroundColor: modelTools.isToolEnabled("filesystem")
                ? "var(--color-success)"
                : "var(--color-text-secondary)",
              transition: "background-color 0.2s ease",
            }}
          />
        </div>

        <p
          style={{
            fontSize: "0.9rem",
            color: "var(--color-text-secondary)",
            marginBottom: "1rem",
            lineHeight: "1.4",
          }}
        >
          Select directories that the AI assistant will be allowed to access.
          For security, the assistant will only be able to read and write files
          within these directories.
        </p>

        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          {filesystemPaths.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {filesystemPaths.map((path, index) => (
                <div
                  key={path}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    padding: "0.5rem",
                    backgroundColor: "var(--color-background-default)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "4px",
                  }}
                >
                  <input
                    type="text"
                    value={path}
                    readOnly
                    style={{
                      flex: 1,
                      border: "none",
                      backgroundColor: "transparent",
                      color: "var(--color-text-primary)",
                      fontSize: "0.9rem",
                    }}
                  />
                  <button
                    onClick={() => handleRemovePath(path)}
                    style={{
                      padding: "0.4rem 0.6rem",
                      backgroundColor: "transparent",
                      border: "1px solid var(--color-border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      color: "var(--color-text-danger)",
                      fontSize: "0.8rem",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        "var(--color-background-light)";
                      e.currentTarget.style.borderColor =
                        "var(--color-text-danger)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.borderColor = "var(--color-border)";
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: "1rem",
                backgroundColor: "var(--color-background-default)",
                border: "1px dashed var(--color-border)",
                borderRadius: "4px",
                color: "var(--color-text-secondary)",
                fontSize: "0.9rem",
                textAlign: "center",
              }}
            >
              No directories configured. Add a directory to enable filesystem
              access.
            </div>
          )}

          <button
            onClick={handleAddDirectory}
            style={{
              padding: "0.6rem 1rem",
              backgroundColor: "var(--color-background-default)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              cursor: "pointer",
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "var(--color-text-primary)",
              fontSize: "0.9rem",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                "var(--color-background-light)";
              e.currentTarget.style.borderColor = "var(--color-text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                "var(--color-background-default)";
              e.currentTarget.style.borderColor = "var(--color-border)";
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Directory
          </button>
        </div>
      </div>
    </div>
  );
}
