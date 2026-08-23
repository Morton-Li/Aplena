use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use chrono::{SecondsFormat, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::infrastructure::{
    Store, open_database, open_database_candidate,
    protection::{self, DatabaseSummary, ProtectionError},
};

use super::{
    dto::{
        BackupResultDto, CsvExportResultDto, DataSettingsSummaryDto, DataSummaryDto,
        RestoreBackupInputDto, RestoreInspectionDto, RestoreResultDto,
    },
    error::AppError,
    service::FinanceService,
};

const RESTORE_TOKEN_LIFETIME: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Default)]
pub(crate) struct DataProtectionState {
    pending_restores: Mutex<HashMap<String, PendingRestore>>,
}

#[derive(Debug, Clone)]
struct PendingRestore {
    archive_path: PathBuf,
    archive_sha256: String,
    inspected_at: Instant,
}

impl FinanceService {
    pub(crate) async fn export_csv_to(
        &self,
        selected_parent: PathBuf,
    ) -> Result<CsvExportResultDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let artifact = protection::export_csv_directory(&store, &selected_parent)
            .await
            .map_err(AppError::from_protection)?;
        Ok(CsvExportResultDto {
            status: "CREATED".to_owned(),
            folder_name: Some(artifact.folder_name),
            created_at: Some(artifact.created_at),
            file_count: artifact.file_count,
        })
    }

    pub(crate) async fn create_backup_to(
        &self,
        destination: PathBuf,
    ) -> Result<BackupResultDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let paths = protection_paths(&store)?;
        let artifact = protection::create_backup_archive(&store, &destination, &paths.work)
            .await
            .map_err(AppError::from_protection)?;
        Ok(BackupResultDto {
            status: "CREATED".to_owned(),
            file_name: Some(artifact.display_name),
            created_at: Some(artifact.created_at),
            summary: Some(summary_dto(artifact.summary)),
        })
    }

    pub(crate) async fn inspect_backup_at(
        &self,
        archive_path: PathBuf,
    ) -> Result<RestoreInspectionDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let paths = protection_paths(&store)?;
        let current_summary = protection::database_summary(store.pool())
            .await
            .map_err(AppError::from_protection)?;
        fs::create_dir_all(&paths.work).map_err(protection_error)?;
        let temporary = tempfile::Builder::new()
            .prefix("inspect-")
            .tempdir_in(&paths.work)
            .map_err(protection_error)?;
        let candidate_path = temporary.path().join("candidate.sqlite3");
        let manifest = protection::extract_and_verify_archive(&archive_path, &candidate_path)
            .map_err(AppError::from_protection)?;
        let original_schema_version = manifest.schema_version;
        let candidate = open_database_candidate(&candidate_path)
            .await
            .map_err(AppError::from_store)?;
        let summary = protection::verify_manifest_summary(&manifest, candidate.pool())
            .await
            .map_err(AppError::from_protection)?;
        candidate.close().await;
        let archive_sha256 =
            protection::sha256_file(&archive_path).map_err(AppError::from_protection)?;
        let token = Uuid::new_v4().to_string();
        let mut pending = self.data_protection.pending_restores.lock().await;
        pending.retain(|_, value| value.inspected_at.elapsed() <= RESTORE_TOKEN_LIFETIME);
        pending.insert(
            token.clone(),
            PendingRestore {
                archive_path: archive_path.clone(),
                archive_sha256,
                inspected_at: Instant::now(),
            },
        );
        Ok(RestoreInspectionDto {
            status: "READY".to_owned(),
            token: Some(token),
            file_name: Some(protection::file_display_name(&archive_path)),
            backup_created_at: Some(manifest.created_at),
            backup_app_version: Some(manifest.app_version),
            schema_version: Some(original_schema_version),
            migrations_applied: original_schema_version < protection::latest_schema_version(),
            summary: Some(summary_dto(summary)),
            current_summary: Some(summary_dto(current_summary)),
        })
    }

    pub(crate) async fn restore_inspected_backup(
        &self,
        input: RestoreBackupInputDto,
    ) -> Result<RestoreResultDto, AppError> {
        if !input.confirmed || input.confirmation_phrase.trim() != "恢复" {
            return Err(AppError::business(
                "RESTORE_CONFIRMATION_REQUIRED",
                "error.restore_confirmation_required",
            ));
        }
        let pending = self
            .data_protection
            .pending_restores
            .lock()
            .await
            .remove(&input.token)
            .filter(|value| value.inspected_at.elapsed() <= RESTORE_TOKEN_LIFETIME)
            .ok_or_else(|| {
                AppError::business("RESTORE_TOKEN_EXPIRED", "error.restore_token_expired")
            })?;
        let current_archive_sha256 =
            protection::sha256_file(&pending.archive_path).map_err(AppError::from_protection)?;
        if current_archive_sha256 != pending.archive_sha256 {
            return Err(AppError::business(
                "BACKUP_CHANGED_AFTER_INSPECTION",
                "error.backup_changed_after_inspection",
            ));
        }

        let _operation = self.operation_gate.write().await;
        let mut current_store = self.store.write().await;
        let paths = protection_paths(&current_store)?;
        fs::create_dir_all(&paths.work).map_err(protection_error)?;
        fs::create_dir_all(&paths.recovery).map_err(protection_error)?;
        set_private_directory_permissions(&paths.work).map_err(protection_error)?;
        set_private_directory_permissions(&paths.recovery).map_err(protection_error)?;
        let temporary = tempfile::Builder::new()
            .prefix("restore-")
            .tempdir_in(&paths.work)
            .map_err(protection_error)?;
        let extracted_path = temporary.path().join("extracted.sqlite3");
        let manifest =
            protection::extract_and_verify_archive(&pending.archive_path, &extracted_path)
                .map_err(AppError::from_protection)?;
        if protection::sha256_file(&pending.archive_path).map_err(AppError::from_protection)?
            != pending.archive_sha256
        {
            return Err(AppError::business(
                "BACKUP_CHANGED_AFTER_INSPECTION",
                "error.backup_changed_after_inspection",
            ));
        }
        let candidate = open_database_candidate(&extracted_path)
            .await
            .map_err(AppError::from_store)?;
        let summary = protection::verify_manifest_summary(&manifest, candidate.pool())
            .await
            .map_err(AppError::from_protection)?;
        let staged_path = temporary.path().join("replacement.sqlite3");
        protection::create_consistent_snapshot(&candidate, &staged_path)
            .await
            .map_err(AppError::from_protection)?;
        candidate.close().await;
        let staged = open_database_candidate(&staged_path)
            .await
            .map_err(AppError::from_store)?;
        protection::validate_database(staged.pool())
            .await
            .map_err(AppError::from_protection)?;
        staged.close().await;

        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
        let recovery_path = paths.recovery.join(format!(
            "before-restore-{timestamp}-{}.aplena",
            Uuid::new_v4()
        ));
        let recovery =
            protection::create_backup_archive(&current_store, &recovery_path, &paths.work)
                .await
                .map_err(AppError::from_protection)?;
        checkpoint_database(&current_store).await?;
        current_store.close().await;

        let rollback_path = paths
            .parent
            .join(format!(".aplena-rollback-{}.sqlite3", Uuid::new_v4()));
        let swap_result =
            swap_database_files(&paths.database, &staged_path, &rollback_path, &paths.parent);
        if let Err(error) = swap_result {
            let reopened = open_database(&paths.database)
                .await
                .map_err(AppError::from_store)?;
            *current_store = reopened;
            return Err(AppError::from_protection(error));
        }

        match reopen_and_validate(&paths.database).await {
            Ok(reopened) => {
                *current_store = reopened;
                let _ = fs::remove_file(&rollback_path);
                remove_sqlite_sidecars(&rollback_path);
            }
            Err(restore_error) => {
                restore_rollback_file(&paths.database, &rollback_path, &paths.parent)
                    .map_err(AppError::from_protection)?;
                let reopened = reopen_and_validate(&paths.database).await.map_err(|_| {
                    AppError::business("RESTORE_ROLLBACK_FAILED", "error.restore_rollback_failed")
                })?;
                *current_store = reopened;
                return Err(AppError::from_protection(restore_error));
            }
        }

        let restored_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let mut startup = self.startup_status.write().await;
        startup.initialization = None;
        startup.error = None;
        Ok(RestoreResultDto {
            restored: true,
            recovery_point_name: recovery.display_name,
            restored_at,
            summary: summary_dto(summary),
        })
    }
}

#[derive(Debug)]
struct ProtectionPaths {
    database: PathBuf,
    parent: PathBuf,
    work: PathBuf,
    recovery: PathBuf,
}

fn protection_paths(store: &Store) -> Result<ProtectionPaths, AppError> {
    let database = store
        .database_path()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::from_protection(ProtectionError::FileDatabaseRequired))?;
    let parent = database
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::from_protection(ProtectionError::FileDatabaseRequired))?;
    Ok(ProtectionPaths {
        database,
        work: parent.join("protection-work"),
        recovery: parent.join("recovery"),
        parent,
    })
}

async fn checkpoint_database(store: &Store) -> Result<(), AppError> {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(store.pool())
        .await
        .map_err(|_| {
            AppError::business(
                "DATABASE_CHECKPOINT_FAILED",
                "error.database_checkpoint_failed",
            )
        })?;
    Ok(())
}

async fn reopen_and_validate(path: &Path) -> Result<Store, ProtectionError> {
    let store = open_database(path).await.map_err(ProtectionError::Store)?;
    if let Err(error) = protection::validate_database(store.pool()).await {
        store.close().await;
        return Err(error);
    }
    Ok(store)
}

fn swap_database_files(
    current: &Path,
    staged: &Path,
    rollback: &Path,
    parent: &Path,
) -> Result<(), ProtectionError> {
    remove_sqlite_sidecars(current);
    fs::rename(current, rollback)?;
    if let Err(error) = fs::rename(staged, current) {
        fs::rename(rollback, current)?;
        sync_directory(parent)?;
        return Err(ProtectionError::Io(error));
    }
    if let Err(error) = sync_directory(parent) {
        restore_rollback_file(current, rollback, parent)?;
        return Err(error);
    }
    Ok(())
}

fn restore_rollback_file(
    current: &Path,
    rollback: &Path,
    parent: &Path,
) -> Result<(), ProtectionError> {
    remove_sqlite_sidecars(current);
    let failed = parent.join(format!(".aplena-failed-{}.sqlite3", Uuid::new_v4()));
    if current.exists() {
        fs::rename(current, &failed)?;
    }
    fs::rename(rollback, current)?;
    sync_directory(parent)?;
    let _ = fs::remove_file(failed);
    Ok(())
}

fn remove_sqlite_sidecars(database: &Path) {
    for suffix in ["-wal", "-shm"] {
        let mut sidecar: OsString = database.as_os_str().to_owned();
        sidecar.push(suffix);
        let _ = fs::remove_file(PathBuf::from(sidecar));
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ProtectionError> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ProtectionError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn protection_error(error: std::io::Error) -> AppError {
    AppError::from_protection(ProtectionError::Io(error))
}

fn summary_dto(summary: DatabaseSummary) -> DataSummaryDto {
    let count = |name: &str| summary.record_counts.get(name).copied().unwrap_or(0);
    DataSummaryDto {
        settings: summary.settings.map(|settings| DataSettingsSummaryDto {
            target_month: settings.target_month,
            base_currency: settings.base_currency,
            minimum_savings_rate_basis_points: settings.minimum_savings_rate_basis_points,
        }),
        settings_count: count("settings"),
        exchange_rate_count: count("exchange_rates"),
        plan_item_count: count("plan_items"),
        monthly_item_count: count("monthly_items"),
        first_month: summary.first_month,
        last_month: summary.last_month,
    }
}
