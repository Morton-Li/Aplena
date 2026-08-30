use pfcm_domain::DomainError;
use sqlx::migrate::MigrateError;
use std::io;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("database migration failed")]
    Migration(#[from] MigrateError),
    #[error("persisted domain value is invalid")]
    Domain(#[from] DomainError),
    #[error("persisted UUID is invalid")]
    InvalidUuid,
    #[error("database schema is newer than this application")]
    FutureSchema,
    #[error("database storage permissions could not be secured")]
    StoragePermissions(#[source] io::Error),
}
