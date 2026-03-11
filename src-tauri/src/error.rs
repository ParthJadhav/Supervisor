use serde::Serialize;

/// Application-level error type used across commands, socket server, and process management.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Mutex poisoned: {0}")]
    MutexPoisoned(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Return a machine-readable error code string.
    fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Serialization(_) => "SERIALIZATION_ERROR",
            AppError::MutexPoisoned(_) => "MUTEX_POISONED",
            AppError::Io(_) => "IO_ERROR",
            AppError::Other(_) => "GENERAL_ERROR",
        }
    }
}

// Tauri commands require errors to be Serialize.
// Returns structured JSON: {"code": "...", "message": "..."} instead of plain strings.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Convert a poisoned mutex error into AppError.
impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(e: std::sync::PoisonError<T>) -> Self {
        AppError::MutexPoisoned(e.to_string())
    }
}
