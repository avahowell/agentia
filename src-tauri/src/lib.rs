// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use chrono::{DateTime, Utc};
use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{path::PathResolver, Manager, State};
use ts_rs::TS;
use uuid::Uuid;

mod commands;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct FileAttachment {
    pub name: String,
    pub content: String, // Base64 encoded content
    pub r#type: String,
    pub size: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub content: String,
    pub role: String,
    pub created_at: String,
    pub attachments: Option<Vec<FileAttachment>>,
}

pub struct DbConnection(Mutex<Connection>);

pub fn init_db(app: &tauri::App) -> Result<Connection> {
    println!("🗄️ Initializing database...");

    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");

    let db_path = app_dir.join("chats.db");
    println!("📁 Database path: {:?}", db_path);

    let conn = Connection::open(db_path)?;

    // Enable foreign keys and WAL mode
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;

    println!("📊 Creating tables...");

    // Create chats table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Create messages table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            content TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
            created_at TEXT NOT NULL,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create attachments table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            type TEXT NOT NULL,
            size INTEGER NOT NULL,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create api_keys table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS api_keys (
            key_type TEXT PRIMARY KEY,
            key_value TEXT NOT NULL
        )",
        [],
    )?;

    // Print table schemas for debugging
    let schemas: Vec<String> = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type='table'")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    println!("📋 Table schemas:");
    for schema in schemas {
        println!("{}", schema);
    }

    println!("✅ Database initialization complete");
    Ok(conn)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let conn = init_db(app).expect("Database initialization failed");
            app.manage(DbConnection(Mutex::new(conn)));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_chat,
            commands::add_message,
            commands::get_chats,
            commands::get_messages,
            commands::save_api_key,
            commands::get_api_keys,
            commands::update_chat_title,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::WindowEvent {
                label: _, event, ..
            } => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    app_handle.hide().unwrap();
                }
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            _ => {}
        });
}
