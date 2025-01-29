use crate::DbConnection;
use crate::{Chat, FileAttachment, Message};
use chrono::Utc;
use rusqlite::Connection;
use rusqlite::{params, OptionalExtension, Transaction};
use std::collections::HashMap;
use tauri::{Manager, State};
use uuid::Uuid;

#[tauri::command]
pub async fn create_chat(conn: State<'_, DbConnection>, title: String) -> Result<Chat, String> {
    println!("📝 create_chat called with title: {}", title);

    let conn = conn.0.lock().unwrap();
    let now = Utc::now();
    let chat = Chat {
        id: Uuid::new_v4().to_string(),
        title,
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
    };

    conn.execute(
        "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        [&chat.id, &chat.title, &chat.created_at, &chat.updated_at],
    )
    .map_err(|e| e.to_string())?;

    println!("✅ create_chat returned: {:?}", chat);
    Ok(chat)
}

#[tauri::command]
pub async fn add_message(
    conn: State<'_, DbConnection>,
    chat_id: String,
    content: String,
    role: String,
    attachments: Option<Vec<FileAttachment>>,
) -> Result<Message, String> {
    println!(
        "💬 add_message called with chat_id: {}, content: {}, role: {}",
        chat_id, content, role
    );

    let mut conn = conn.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let message = Message {
        id: Uuid::new_v4().to_string(),
        chat_id,
        content,
        role,
        created_at: Utc::now().to_rfc3339(),
        attachments: attachments.clone(),
    };

    // Insert message
    tx.execute(
        "INSERT INTO messages (id, chat_id, content, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            &message.id,
            &message.chat_id,
            &message.content,
            &message.role,
            &message.created_at,
        ],
    )
    .map_err(|e| {
        println!("❌ Message insert error: {}", e);
        e.to_string()
    })?;

    // Insert attachments if any
    if let Some(attachments) = attachments {
        for attachment in attachments {
            tx.execute(
                "INSERT INTO attachments (id, message_id, name, content, type, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    &message.id,
                    &attachment.name,
                    &attachment.content,
                    &attachment.r#type,
                    &attachment.size,
                ],
            ).map_err(|e| {
                println!("❌ Attachment insert error: {}", e);
                e.to_string()
            })?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    println!("✅ Message and attachments inserted successfully");
    Ok(message)
}

#[tauri::command]
pub async fn get_chats(conn: State<'_, DbConnection>) -> Result<Vec<Chat>, String> {
    println!("📋 get_chats called");

    let conn = conn.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM chats ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let chats = stmt
        .query_map([], |row| {
            Ok(Chat {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    println!("✅ get_chats returned {} chats", chats.len());
    Ok(chats)
}

#[tauri::command]
pub async fn get_messages(
    conn: State<'_, DbConnection>,
    chat_id: String,
) -> Result<Vec<Message>, String> {
    println!("📨 get_messages called for chat_id: {}", chat_id);

    let conn = conn.0.lock().unwrap();

    // First, verify the chat exists
    let chat_exists: bool = conn
        .query_row("SELECT 1 FROM chats WHERE id = ?1", [&chat_id], |_| {
            Ok(true)
        })
        .unwrap_or(false);

    println!("📊 Chat exists: {}", chat_exists);

    // Get messages with their attachments
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.chat_id, m.content, m.role, m.created_at,
                COALESCE(a.id, '') as attachment_id, 
                COALESCE(a.name, '') as name, 
                COALESCE(a.content, '') as attachment_content,
                COALESCE(a.type, '') as type,
                COALESCE(a.size, 0) as size
         FROM messages m
         LEFT JOIN attachments a ON m.id = a.message_id
         WHERE m.chat_id = ?1 
         ORDER BY m.created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut messages = HashMap::new();

    stmt.query_map([chat_id], |row| {
        let msg_id: String = row.get(0)?;
        let chat_id: String = row.get(1)?;
        let content: String = row.get(2)?;
        let role: String = row.get(3)?;
        let created_at: String = row.get(4)?;

        // Get attachment data if it exists
        let attachment_id: String = row.get(5)?;

        let message = messages.entry(msg_id.clone()).or_insert_with(|| Message {
            id: msg_id,
            chat_id: chat_id.clone(),
            content: content.clone(),
            role: role.clone(),
            created_at: created_at.clone(),
            attachments: None,
        });

        if !attachment_id.is_empty() {
            if message.attachments.is_none() {
                message.attachments = Some(Vec::new());
            }
            if let Some(attachments) = &mut message.attachments {
                attachments.push(FileAttachment {
                    name: row.get(6)?,
                    content: row.get(7)?,
                    r#type: row.get(8)?,
                    size: row.get(9)?,
                });
            }
        }

        Ok(())
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    let mut result: Vec<Message> = messages.into_values().collect();
    result.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    println!("✅ get_messages returned {} messages", result.len());
    Ok(result)
}

#[tauri::command]
pub async fn save_api_key(
    key_type: String,
    key_value: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = Connection::open(app.path().app_data_dir().unwrap().join("chats.db"))
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO api_keys (key_type, key_value) VALUES (?1, ?2)",
        params![key_type, key_value],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_api_keys(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let conn = Connection::open(app.path().app_data_dir().unwrap().join("chats.db"))
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT key_type, key_value FROM api_keys")
        .map_err(|e| e.to_string())?;

    let keys = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<HashMap<String, String>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(keys)
}

#[tauri::command]
pub async fn update_chat_title(
    chat_id: String,
    title: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn =
        db.0.lock()
            .map_err(|_| "Failed to lock database connection")?;
    conn.execute(
        "UPDATE chats SET title = ?1 WHERE id = ?2",
        [&title, &chat_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
