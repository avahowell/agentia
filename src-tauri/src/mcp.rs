use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use tauri::State;

#[derive(Debug)]
pub struct McpServer {
    process: Child,
    stdin: std::process::ChildStdin,
    stdout_rx: mpsc::Receiver<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<serde_json::Value>,
    jsonrpc: String,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

impl McpServer {
    fn new(
        process: Child,
        stdin: std::process::ChildStdin,
        stdout_rx: mpsc::Receiver<String>,
    ) -> Self {
        Self {
            process,
            stdin,
            stdout_rx,
        }
    }

    fn send_command(&mut self, command: &str) -> Result<String, String> {
        // Parse the command to check if it's a notification
        let message: JsonRpcMessage = serde_json::from_str(command)
            .map_err(|e| format!("Failed to parse JSON-RPC message: {}", e))?;

        // Send the command
        self.stdin
            .write_all(format!("{}\n", command).as_bytes())
            .map_err(|e| format!("Failed to send command: {}", e))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;

        // If this is a notification (no id), don't wait for a response
        if message.id.is_none() {
            return Ok("".to_string());
        }

        // For requests, wait for and collect the next line of output
        match self
            .stdout_rx
            .recv_timeout(std::time::Duration::from_secs(5))
        {
            Ok(output) => {
                // log output
                println!("output: {}", output);
                Ok(output)
            }
            Err(_) => Err("Timeout waiting for command output".to_string()),
        }
    }
}

pub struct McpState(pub Arc<Mutex<HashMap<String, McpServer>>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvVar {
    key: String,
    value: String,
}

#[tauri::command]
pub async fn start_mcp_server(
    server_id: String,
    command: String,
    env_vars: Vec<EnvVar>,
    state: State<'_, McpState>,
) -> Result<String, String> {
    let mut servers = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if servers.contains_key(&server_id) {
        return Err("Server with this ID already exists".to_string());
    }

    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let shell_arg = if cfg!(target_os = "windows") {
        "/C"
    } else {
        "-c"
    };

    let mut cmd = Command::new(shell);
    cmd.arg(shell_arg)
        .arg(&command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Add environment variables
    for env_var in env_vars {
        cmd.env(env_var.key, env_var.value);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start process: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture stdin".to_string())?;

    // Set up stdout channel
    let (stdout_tx, stdout_rx) = mpsc::channel();

    // Set up stdout reading in a separate thread
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let tx = stdout_tx.clone();
        std::thread::spawn(move || {
            for line in reader.lines() {
                if let Ok(line) = line {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            }
        });
    }

    // Set up stderr reading in a separate thread
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        std::thread::spawn(move || {
            for line in reader.lines() {
                if let Ok(line) = line {
                    eprintln!("Process error: {}", line);
                }
            }
        });
    }

    let server = McpServer::new(child, stdin, stdout_rx);
    servers.insert(server_id.clone(), server);

    Ok(format!("Process {} started successfully", server_id))
}

#[tauri::command]
pub async fn send_mcp_command(
    server_id: String,
    command: String,
    state: State<'_, McpState>,
) -> Result<String, String> {
    // log
    println!("sending command: {}", command);
    let mut servers = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    let server = servers
        .get_mut(&server_id)
        .ok_or_else(|| "Server not found".to_string())?;

    server.send_command(&command)
}
