use pfcm_domain::DomainError;
use sqlx::migrate::MigrateError;
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
}
