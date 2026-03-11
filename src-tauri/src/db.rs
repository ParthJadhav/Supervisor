use rusqlite::{Connection, Result};
use std::path::PathBuf;

/// Returns the path to the Supervisor data directory.
/// Creates it if it doesn't exist.
fn data_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".supervisor");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Initialize the SQLite database with WAL mode and full schema.
pub fn init_database() -> Result<Connection, Box<dyn std::error::Error>> {
    let db_path = data_dir()?.join("supervisor.db");
    let conn = Connection::open(db_path)?;

    // Enable WAL mode for concurrent reads
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    run_migrations(&conn)?;

    // Reset stale running agents from previous app run
    // Keep conversation_id so agents can resume their Claude sessions
    conn.execute(
        "UPDATE agents SET status = CASE WHEN conversation_id IS NOT NULL THEN 'stopped' ELSE 'created' END, session_id = NULL WHERE status = 'running'",
        [],
    )?;

    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        );",
    )?;

    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )?;

    if version < 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V1)?;
        tx.execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
        tx.commit()?;
    }

    if version < 2 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE agents ADD COLUMN conversation_id TEXT;",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (2)", [])?;
        tx.commit()?;
    }

    if version < 3 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE projects ADD COLUMN color TEXT;
             ALTER TABLE projects ADD COLUMN icon TEXT;",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (3)", [])?;
        tx.commit()?;
    }

    if version < 4 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS canvas_positions (
                node_id TEXT PRIMARY KEY,
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                width REAL,
                height REAL
            );",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (4)", [])?;
        tx.commit()?;
    }

    if version < 5 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                agent_id TEXT,
                agent_name TEXT,
                read INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_notification_log_read ON notification_log(read);
            CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (5)", [])?;
        tx.commit()?;
    }

    if version < 6 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE canvas_positions ADD COLUMN tier TEXT DEFAULT 'small';",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (6)", [])?;
        tx.commit()?;
    }

    if version < 7 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE agents ADD COLUMN dangerously_skip_permissions BOOLEAN DEFAULT 0;",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (7)", [])?;
        tx.commit()?;
    }

    if version < 8 {
        let tx = conn.unchecked_transaction()?;
        // Change default tier from 'small' to 'collapsed' and update existing rows
        tx.execute_batch(
            "UPDATE canvas_positions SET tier = 'collapsed' WHERE tier = 'small';",
        )?;
        tx.execute("INSERT INTO schema_version (version) VALUES (8)", [])?;
        tx.commit()?;
    }

    Ok(())
}

const MIGRATION_V1: &str = "
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        workspace_id TEXT,
        config_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT,
        model TEXT DEFAULT 'sonnet',
        status TEXT DEFAULT 'created',
        project_id TEXT REFERENCES projects(id),
        config_json TEXT,
        session_id TEXT,
        persona_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'planned',
        priority INTEGER DEFAULT 3,
        agent_id TEXT REFERENCES agents(id),
        project_id TEXT REFERENCES projects(id),
        parent_task_id TEXT REFERENCES tasks(id),
        pipeline_id TEXT,
        pipeline_step INTEGER,
        result_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id),
        from_agent_id TEXT REFERENCES agents(id),
        to_agent_id TEXT REFERENCES agents(id),
        summary TEXT,
        context_json TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,
        agent_id TEXT,
        task_id TEXT,
        data_json TEXT,
        severity TEXT DEFAULT 'info'
    );

    CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id),
        project_id TEXT REFERENCES projects(id),
        task_id TEXT,
        first_message TEXT,
        started_at TEXT,
        ended_at TEXT,
        outcome TEXT
    );

    CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        definition_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_prefs (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        enabled INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_agent ON event_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_index_agent ON session_index(agent_id);
";
