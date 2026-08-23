use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    str::FromStr,
    time::Duration,
};

use chrono::Utc;
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use uuid::Uuid;

use super::{Store, StoreError, protection};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub(crate) fn latest_schema_version() -> i64 {
    MIGRATOR
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or(0)
}

pub async fn open_database(path: &Path) -> Result<Store, StoreError> {
    let pool = open_pool(path, true).await?;
    let applied_version = protection::applied_schema_version(&pool)
        .await
        .map_err(|_| StoreError::MigrationProtection)?;
    let latest_version = latest_schema_version();
    if applied_version > latest_version {
        pool.close().await;
        return Err(StoreError::FutureSchema);
    }

    let has_existing_data: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN \
         ('settings', 'exchange_rates', 'plan_items', 'monthly_items')",
    )
    .fetch_one(&pool)
    .await?;
    if has_existing_data > 0 && applied_version < latest_version {
        let parent = path.parent().ok_or(StoreError::MigrationProtection)?;
        let recovery_directory = parent.join("recovery");
        let work_directory = parent.join("protection-work");
        std::fs::create_dir_all(&recovery_directory)
            .map_err(|_| StoreError::MigrationProtection)?;
        set_private_directory_permissions(&recovery_directory)
            .map_err(|_| StoreError::MigrationProtection)?;
        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
        let destination = recovery_directory.join(format!(
            "migration-{timestamp}-schema-v{applied_version}-{}.aplena",
            Uuid::new_v4()
        ));
        let store = Store::new(pool.clone(), Some(path.to_path_buf()));
        if protection::create_migration_restore_point(&store, &destination, &work_directory)
            .await
            .is_err()
        {
            pool.close().await;
            return Err(StoreError::MigrationProtection);
        }
    }

    if let Err(error) = MIGRATOR.run(&pool).await {
        pool.close().await;
        return Err(StoreError::Migration(error));
    }
    Ok(Store::new(pool, Some(path.to_path_buf())))
}

pub(crate) async fn open_database_without_migrations(path: &Path) -> Result<Store, StoreError> {
    let pool = open_pool(path, false).await?;
    Ok(Store::new(pool, Some(path.to_path_buf())))
}

pub(crate) async fn open_database_candidate(path: &Path) -> Result<Store, StoreError> {
    let pool = open_pool(path, false).await?;
    let applied = protection::applied_schema_version(&pool)
        .await
        .map_err(|_| StoreError::MigrationProtection)?;
    if applied > latest_schema_version() {
        pool.close().await;
        return Err(StoreError::FutureSchema);
    }
    if let Err(error) = MIGRATOR.run(&pool).await {
        pool.close().await;
        return Err(StoreError::Migration(error));
    }
    Ok(Store::new(pool, Some(path.to_path_buf())))
}

async fn open_pool(path: &Path, create_if_missing: bool) -> Result<sqlx::SqlitePool, StoreError> {
    if let Some(parent) = path.parent() {
        set_private_directory_permissions(parent).map_err(StoreError::StoragePermissions)?;
    }
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
        .create_if_missing(create_if_missing)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    set_private_database_permissions(path).map_err(StoreError::StoragePermissions)?;
    Ok(pool)
}

#[cfg(test)]
pub async fn open_memory_database() -> Result<Store, StoreError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool: sqlx::SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(Store::new(pool, None))
}

#[cfg(test)]
pub(crate) async fn create_version_one_fixture(path: &Path) -> Result<(), StoreError> {
    let pool = open_pool(path, true).await?;
    MIGRATOR.run_to(1, &pool).await?;
    pool.close().await;
    Ok(())
}

#[cfg(test)]
pub(crate) async fn create_version_two_fixture(path: &Path) -> Result<(), StoreError> {
    let pool = open_pool(path, true).await?;
    MIGRATOR.run_to(2, &pool).await?;
    pool.close().await;
    Ok(())
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_database_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    for candidate in [
        path.to_path_buf(),
        sqlite_sidecar_path(path, "-wal"),
        sqlite_sidecar_path(path, "-shm"),
    ] {
        if candidate.try_exists()? {
            std::fs::set_permissions(candidate, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_private_database_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(suffix);
    value.into()
}

#[cfg(all(test, unix))]
mod tests {
    use super::{open_database, sqlite_sidecar_path};
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn database_and_wal_sidecars_are_private() {
        let fixture = tempfile::tempdir().expect("fixture");
        let database = fixture.path().join("aplena.sqlite3");
        let store = open_database(&database).await.expect("database");

        for path in [
            database.clone(),
            sqlite_sidecar_path(&database, "-wal"),
            sqlite_sidecar_path(&database, "-shm"),
        ] {
            let mode = std::fs::metadata(path)
                .expect("database file")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        store.close().await;
    }
}
