use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

use crate::models::{AuditEvent, SessionSummary, TranscriptItem};

const DB_KEY_SERVICE: &str = "meetingmind";
const DB_KEY_ENTRY: &str = "mm.db.key";
const MAX_BUSY_RETRIES: u32 = 5;

pub struct Database {
    connection: Connection,
    cipher_key: [u8; 32],
}

/// Retry a rusqlite operation when the database is busy. Uses exponential backoff up to ~1.5s.
fn with_busy_retry<T, F>(mut f: F) -> rusqlite::Result<T>
where
    F: FnMut() -> rusqlite::Result<T>,
{
    let mut attempts: u32 = 0;
    loop {
        match f() {
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::DatabaseBusy && attempts < MAX_BUSY_RETRIES =>
            {
                std::thread::sleep(std::time::Duration::from_millis(50 * (1u64 << attempts)));
                attempts += 1;
            }
            other => return other,
        }
    }
}

/// Map rusqlite error to String, but surface SQLITE_FULL as the sentinel "DISK_FULL"
/// so callers can emit a dedicated event.
fn map_sqlite_error(err: rusqlite::Error) -> String {
    if let rusqlite::Error::SqliteFailure(sf, _) = &err {
        if sf.code == rusqlite::ErrorCode::DiskFull {
            return "DISK_FULL".to_string();
        }
    }
    err.to_string()
}

/// Fetch the 32-byte DB encryption key from the OS keychain, or generate+store one on first run.
fn get_or_create_db_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(DB_KEY_SERVICE, DB_KEY_ENTRY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(hex_key) => {
            let bytes = hex::decode(&hex_key).map_err(|e| format!("bad db key hex: {e}"))?;
            if bytes.len() != 32 {
                return Err(format!("db key length {} != 32", bytes.len()));
            }
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            Ok(arr)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let hex_key = hex::encode(key);
            entry.set_password(&hex_key).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Encrypt a plaintext field. Returns base64(nonce || ciphertext).
fn encrypt_field(plain: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("encrypt failed: {e}"))?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(BASE64.encode(&out))
}

/// Decrypt a base64(nonce || ciphertext) field. If the stored value isn't valid
/// encrypted data (e.g. legacy plaintext row), return it verbatim so migrations
/// from unencrypted DBs degrade gracefully rather than failing the query.
fn decrypt_field(stored: &str, key: &[u8; 32]) -> String {
    let bytes = match BASE64.decode(stored.as_bytes()) {
        Ok(b) if b.len() > 12 => b,
        _ => return stored.to_string(),
    };
    let (nonce_bytes, ct) = bytes.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    match cipher.decrypt(nonce, ct) {
        Ok(pt) => String::from_utf8(pt).unwrap_or_else(|_| stored.to_string()),
        Err(_) => stored.to_string(),
    }
}

fn apply_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS session_summaries (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            title TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            summary TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transcript_items (
            session_id TEXT NOT NULL,
            id TEXT NOT NULL,
            speaker TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            PRIMARY KEY (session_id, id)
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            details_json TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| error.to_string())
}

/// Open a connection and tune it for concurrent writes. WAL + busy_timeout make
/// most short contention transparent to callers even before with_busy_retry kicks in.
fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    conn.busy_timeout(std::time::Duration::from_millis(500))
        .map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

impl Database {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;

        std::fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;

        let db_path = database_path(app_dir);
        let cipher_key = get_or_create_db_key()?;

        let mut connection = open_connection(&db_path)?;

        // Integrity check. If the DB is corrupt, rename it aside and start fresh
        // so the user can still use the app while the corrupt file is preserved
        // for forensics / manual recovery.
        let integrity: Result<String, _> =
            connection.query_row("PRAGMA integrity_check", [], |r| r.get(0));
        let healthy = matches!(&integrity, Ok(s) if s == "ok");
        if !healthy {
            // Drop the old handle before renaming the file on Windows.
            drop(connection);
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let corrupt_path = db_path.with_extension(format!("corrupted-{ts}.db"));
            let _ = std::fs::rename(&db_path, &corrupt_path);
            // Best-effort cleanup of sidecar files so the fresh DB has a clean slate.
            let _ = std::fs::remove_file(db_path.with_extension("sqlite-wal"));
            let _ = std::fs::remove_file(db_path.with_extension("sqlite-shm"));
            connection = open_connection(&db_path)?;
        }

        apply_schema(&connection)?;

        Ok(Self {
            connection,
            cipher_key,
        })
    }

    pub fn upsert_session_summary(&self, session: &SessionSummary) -> Result<(), String> {
        self.connection
            .execute(
                r#"
                INSERT INTO session_summaries (id, customer_name, title, duration_minutes, summary)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(id) DO UPDATE SET
                    customer_name = excluded.customer_name,
                    title = excluded.title,
                    duration_minutes = excluded.duration_minutes,
                    summary = excluded.summary
                "#,
                params![
                    session.id,
                    session.customer_name,
                    session.title,
                    session.duration_minutes,
                    session.summary
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, customer_name, title, duration_minutes, summary FROM session_summaries ORDER BY rowid DESC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    customer_name: row.get(1)?,
                    title: row.get(2)?,
                    duration_minutes: row.get(3)?,
                    summary: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn upsert_transcript_item(
        &self,
        session_id: &str,
        item: &TranscriptItem,
    ) -> Result<(), String> {
        let enc_text = encrypt_field(&item.text, &self.cipher_key)?;
        with_busy_retry(|| {
            self.connection.execute(
                r#"
                INSERT INTO transcript_items (session_id, id, speaker, text, timestamp)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(session_id, id) DO UPDATE SET
                    speaker = excluded.speaker,
                    text = excluded.text,
                    timestamp = excluded.timestamp
                "#,
                params![
                    session_id,
                    &item.id,
                    &item.speaker,
                    &enc_text,
                    item.timestamp
                ],
            )
        })
        .map(|_| ())
        .map_err(map_sqlite_error)
    }

    pub fn upsert_transcript_items(
        &mut self,
        session_id: &str,
        items: &[TranscriptItem],
    ) -> Result<(), String> {
        // Pre-encrypt outside the transaction so a cipher failure doesn't leave
        // a dangling transaction; if any encrypt fails we bail before touching the DB.
        let encrypted: Vec<String> = items
            .iter()
            .map(|it| encrypt_field(&it.text, &self.cipher_key))
            .collect::<Result<Vec<_>, _>>()?;

        with_busy_retry(|| {
            let tx = self.connection.transaction()?;
            {
                let mut stmt = tx.prepare(
                    r#"
                    INSERT INTO transcript_items (session_id, id, speaker, text, timestamp)
                    VALUES (?1, ?2, ?3, ?4, ?5)
                    ON CONFLICT(session_id, id) DO UPDATE SET
                        speaker = excluded.speaker,
                        text = excluded.text,
                        timestamp = excluded.timestamp
                    "#,
                )?;
                for (item, enc_text) in items.iter().zip(encrypted.iter()) {
                    stmt.execute(params![
                        session_id,
                        &item.id,
                        &item.speaker,
                        enc_text,
                        item.timestamp
                    ])?;
                }
            }
            tx.commit()
        })
        .map_err(map_sqlite_error)
    }

    pub fn list_transcript_items(&self, session_id: &str) -> Result<Vec<TranscriptItem>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, speaker, text, timestamp FROM transcript_items WHERE session_id = ?1 ORDER BY timestamp ASC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![session_id], |row| {
                let stored_text: String = row.get(2)?;
                Ok(TranscriptItem {
                    id: row.get(0)?,
                    speaker: row.get(1)?,
                    text: decrypt_field(&stored_text, &self.cipher_key),
                    timestamp: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn append_audit_event(&self, event: &AuditEvent) -> Result<(), String> {
        let details_json =
            serde_json::to_string(&event.details).map_err(|error| error.to_string())?;
        let enc_details = encrypt_field(&details_json, &self.cipher_key)?;

        with_busy_retry(|| {
            self.connection.execute(
                r#"
                INSERT INTO audit_events (id, event_type, timestamp, details_json)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(id) DO UPDATE SET
                    event_type = excluded.event_type,
                    timestamp = excluded.timestamp,
                    details_json = excluded.details_json
                "#,
                params![&event.id, &event.r#type, &event.timestamp, enc_details],
            )
        })
        .map(|_| ())
        .map_err(map_sqlite_error)
    }

    /// Batch append of audit events in a single transaction (used by Phase 2G flush path).
    pub fn append_audit_events(&mut self, events: &[AuditEvent]) -> Result<(), String> {
        // Pre-serialize + encrypt all details outside the transaction.
        let mut enc_details: Vec<String> = Vec::with_capacity(events.len());
        for ev in events {
            let json = serde_json::to_string(&ev.details).map_err(|e| e.to_string())?;
            enc_details.push(encrypt_field(&json, &self.cipher_key)?);
        }

        with_busy_retry(|| {
            let tx = self.connection.transaction()?;
            {
                let mut stmt = tx.prepare(
                    r#"
                    INSERT INTO audit_events (id, event_type, timestamp, details_json)
                    VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(id) DO UPDATE SET
                        event_type = excluded.event_type,
                        timestamp = excluded.timestamp,
                        details_json = excluded.details_json
                    "#,
                )?;
                for (ev, enc) in events.iter().zip(enc_details.iter()) {
                    stmt.execute(params![&ev.id, &ev.r#type, &ev.timestamp, enc])?;
                }
            }
            tx.commit()
        })
        .map_err(map_sqlite_error)
    }

    pub fn list_audit_events(&self) -> Result<Vec<AuditEvent>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT id, event_type, timestamp, details_json FROM audit_events ORDER BY rowid ASC")
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let stored_details: String = row.get(3)?;
                let details_json = decrypt_field(&stored_details, &self.cipher_key);
                let details = serde_json::from_str(&details_json)
                    .unwrap_or(serde_json::Value::Object(Default::default()));

                Ok(AuditEvent {
                    id: row.get(0)?,
                    r#type: row.get(1)?,
                    timestamp: row.get(2)?,
                    details,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn clear_audit_events(&self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM audit_events", [])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

fn database_path(app_dir: PathBuf) -> PathBuf {
    app_dir.join("meetingmind.sqlite")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        k
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = test_key();
        let ct = encrypt_field("hello world", &key).unwrap();
        assert_ne!(ct, "hello world");
        let pt = decrypt_field(&ct, &key);
        assert_eq!(pt, "hello world");
    }

    #[test]
    fn decrypt_legacy_plaintext_passthrough() {
        // Legacy rows written before encryption was introduced should read back as-is
        // rather than error out (graceful migration).
        let key = test_key();
        let out = decrypt_field("legacy raw text", &key);
        assert_eq!(out, "legacy raw text");
    }

    #[test]
    fn decrypt_wrong_key_returns_stored() {
        let key = test_key();
        let mut other = test_key();
        other[0] ^= 0xFF;
        let ct = encrypt_field("secret", &key).unwrap();
        let out = decrypt_field(&ct, &other);
        // Wrong key => decrypt fails => we return the stored ciphertext verbatim.
        assert_eq!(out, ct);
    }

    #[test]
    fn encrypt_produces_distinct_ciphertexts() {
        let key = test_key();
        let a = encrypt_field("same", &key).unwrap();
        let b = encrypt_field("same", &key).unwrap();
        assert_ne!(a, b, "nonce must randomize ciphertext");
    }
}
