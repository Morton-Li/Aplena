use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Write},
    path::Path,
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tempfile::NamedTempFile;
use thiserror::Error;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use super::{Store, StoreError};

pub const BACKUP_FORMAT: &str = "APLENA_BACKUP";
pub const BACKUP_FORMAT_VERSION: u32 = 2;
const MANIFEST_NAME: &str = "manifest.json";
const DATABASE_NAME: &str = "database.sqlite3";
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_DATABASE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const MAX_EXCHANGE_RATE_RECORDS: u64 = 512;
const MAX_PLAN_ITEM_RECORDS: u64 = 50_000;
const MAX_MONTHLY_ITEM_RECORDS: u64 = 1_000_000;
const MAX_ACTUAL_ENTRY_RECORDS: u64 = 10_000_000;

#[derive(Debug, Error)]
pub enum ProtectionError {
    #[error("backup input or output could not be accessed")]
    Io(#[from] io::Error),
    #[error("database protection operation failed")]
    Store(#[from] StoreError),
    #[error("database protection query failed")]
    Database(#[from] sqlx::Error),
    #[error("backup archive could not be read")]
    Archive(#[from] zip::result::ZipError),
    #[error("backup manifest is invalid")]
    Manifest(#[from] serde_json::Error),
    #[error("CSV export failed")]
    Csv(#[from] csv::Error),
    #[error("the selected file is not a supported Aplena backup")]
    InvalidArchive,
    #[error("the backup format version is newer than this application supports")]
    FutureFormat,
    #[error("the database schema is newer than this application supports")]
    FutureSchema,
    #[error("the backup checksum does not match its manifest")]
    ChecksumMismatch,
    #[error("the backup database failed SQLite integrity validation")]
    IntegrityFailed,
    #[error("the backup database violates Aplena domain invariants")]
    InvariantFailed,
    #[error("the selected backup is too large")]
    SizeLimitExceeded,
    #[error("the destination already exists")]
    DestinationExists,
    #[error("the operation requires a file-backed database")]
    FileDatabaseRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub backup_format: String,
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub database_file: String,
    pub database_size_bytes: u64,
    pub database_sha256: String,
    pub summary: DatabaseSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DatabaseSummary {
    pub settings: Option<SettingsSummary>,
    pub record_counts: BTreeMap<String, u64>,
    pub first_month: Option<String>,
    pub last_month: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsSummary {
    pub target_month: String,
    pub base_currency: String,
    pub minimum_savings_rate_basis_points: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedArtifact {
    pub display_name: String,
    pub created_at: String,
    pub summary: DatabaseSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedCsvArtifact {
    pub folder_name: String,
    pub created_at: String,
    pub file_count: u8,
}

pub fn latest_schema_version() -> i64 {
    super::database::latest_schema_version()
}

pub async fn applied_schema_version(pool: &SqlitePool) -> Result<i64, ProtectionError> {
    let migration_table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?;
    if migration_table_exists == 0 {
        return Ok(0);
    }
    let version = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?
    .unwrap_or(0);
    Ok(version)
}

pub async fn database_summary(pool: &SqlitePool) -> Result<DatabaseSummary, ProtectionError> {
    let settings_row = sqlx::query(
        "SELECT target_month, base_currency_code, minimum_savings_rate_bp FROM settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(StoreError::from)?;
    let settings = settings_row
        .map(|row| -> Result<SettingsSummary, ProtectionError> {
            Ok(SettingsSummary {
                target_month: anchor_to_month(row.try_get::<String, _>("target_month")?)?,
                base_currency: row.try_get("base_currency_code")?,
                minimum_savings_rate_basis_points: u16::try_from(
                    row.try_get::<i64, _>("minimum_savings_rate_bp")?,
                )
                .map_err(|_| ProtectionError::InvariantFailed)?,
            })
        })
        .transpose()?;

    let mut record_counts = BTreeMap::new();
    for (table, query) in [
        ("settings", "SELECT COUNT(*) FROM settings"),
        ("exchange_rates", "SELECT COUNT(*) FROM exchange_rates"),
        ("plan_items", "SELECT COUNT(*) FROM plan_items"),
        ("monthly_items", "SELECT COUNT(*) FROM monthly_items"),
        ("actual_entries", "SELECT COUNT(*) FROM actual_entries"),
    ] {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(pool)
        .await
        .map_err(StoreError::from)?;
        if exists == 0 {
            continue;
        }
        let count: i64 = sqlx::query_scalar(query)
            .fetch_one(pool)
            .await
            .map_err(StoreError::from)?;
        record_counts.insert(
            table.to_owned(),
            u64::try_from(count).map_err(|_| ProtectionError::InvariantFailed)?,
        );
    }
    validate_record_counts(&record_counts)?;
    let month_range = sqlx::query(
        "SELECT MIN(month) AS first_month, MAX(month) AS last_month FROM monthly_items",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?;
    let first_month = month_range
        .try_get::<Option<String>, _>("first_month")?
        .map(anchor_to_month)
        .transpose()?;
    let last_month = month_range
        .try_get::<Option<String>, _>("last_month")?
        .map(anchor_to_month)
        .transpose()?;

    Ok(DatabaseSummary {
        settings,
        record_counts,
        first_month,
        last_month,
    })
}

pub async fn validate_database(pool: &SqlitePool) -> Result<(), ProtectionError> {
    let version = applied_schema_version(pool).await?;
    if version > latest_schema_version() {
        return Err(ProtectionError::FutureSchema);
    }

    let table_names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(StoreError::from)?;
    let actual = table_names.into_iter().collect::<BTreeSet<_>>();
    let required = [
        "_sqlx_migrations",
        "actual_entries",
        "exchange_rates",
        "monthly_items",
        "plan_items",
        "settings",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<BTreeSet<_>>();
    if actual != required {
        return Err(ProtectionError::InvariantFailed);
    }

    let quick_check: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_all(pool)
        .await
        .map_err(StoreError::from)?;
    if quick_check.as_slice() != ["ok"] {
        return Err(ProtectionError::IntegrityFailed);
    }
    let integrity_check: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(pool)
        .await
        .map_err(StoreError::from)?;
    if integrity_check.as_slice() != ["ok"] {
        return Err(ProtectionError::IntegrityFailed);
    }
    let foreign_key_failures = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .map_err(StoreError::from)?;
    if !foreign_key_failures.is_empty() {
        return Err(ProtectionError::InvariantFailed);
    }

    let invariant_failures: i64 = sqlx::query_scalar(
        "SELECT \
          (SELECT COUNT(*) FROM settings WHERE id != 1 OR minimum_savings_rate_bp NOT BETWEEN 0 AND 10000) + \
          (SELECT COUNT(*) FROM exchange_rates WHERE length(currency_code) != 3 OR rate_scaled <= 0) + \
          (SELECT COUNT(*) FROM plan_items WHERE planned_amount_scaled < 0 OR period_months <= 0 OR end_date < start_date OR date(start_date) != start_date OR (end_date IS NOT NULL AND date(end_date) != end_date)) + \
          (SELECT COUNT(*) FROM monthly_items WHERE planned_amount_scaled < 0 OR \
            (category IN ('FIXED_INCOME', 'VARIABLE_INCOME')) != (flow_type = 'INCOME') OR \
            (item_origin = 'MANUAL' AND (source_plan_item_id IS NOT NULL OR item_source != 'ACTUAL_ONLY')) OR \
            (item_source = 'ACTUAL_ONLY' AND (planned_amount_scaled != 0 OR scheduled_date IS NOT NULL)) OR \
            (item_source = 'PLANNED' AND recognition_mode = 'PAYMENT' AND scheduled_date IS NULL) OR \
            (item_source = 'PLANNED' AND recognition_mode = 'AMORTIZED' AND scheduled_date IS NOT NULL)) + \
          (SELECT COUNT(*) FROM actual_entries e JOIN monthly_items m ON m.id = e.monthly_item_id \
            WHERE e.amount_scaled <= 0 OR date(e.occurred_on) != e.occurred_on OR \
              substr(e.occurred_on, 1, 7) != substr(m.month, 1, 7))",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?;
    let invalid_base_rate: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM settings s LEFT JOIN exchange_rates r ON r.currency_code = s.base_currency_code \
         WHERE r.rate_scaled IS NULL OR r.rate_scaled != 100000000",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?;
    if invariant_failures != 0 || invalid_base_rate != 0 {
        return Err(ProtectionError::InvariantFailed);
    }
    validate_derived_aggregates(pool).await?;
    let required_objects: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE name IN (\
          'settings_base_rate_insert', 'settings_base_rate_update', 'settings_base_currency_lock',\
          'exchange_rate_base_lock', 'monthly_item_currency_matches_settings',\
          'actual_entry_month_insert', 'actual_entry_month_update', 'actual_entry_reopens_insert',\
          'actual_entry_reopens_update', 'actual_entry_reopens_delete',\
          'monthly_item_manual_origin_insert', 'monthly_item_manual_origin_update',\
          'idx_plan_items_active_dates', 'idx_monthly_items_month_category_flow',\
          'idx_monthly_items_source_plan', 'idx_actual_entries_monthly_item',\
          'idx_actual_entries_occurred_on')",
    )
    .fetch_one(pool)
    .await
    .map_err(StoreError::from)?;
    if required_objects != 17 {
        return Err(ProtectionError::InvariantFailed);
    }
    Ok(())
}

async fn validate_derived_aggregates(pool: &SqlitePool) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT m.month, m.category, m.flow_type, SUM(m.planned_amount_scaled) AS planned_total, \
                SUM(CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END) AS actual_total \
         FROM monthly_items m LEFT JOIN actual_entries e ON e.monthly_item_id = m.id \
         GROUP BY m.month, m.category, m.flow_type",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| ProtectionError::InvariantFailed)?;
    for row in rows {
        anchor_to_month(row.try_get("month")?)?;
        let category: String = row.try_get("category")?;
        let flow_type: String = row.try_get("flow_type")?;
        let (expected_flow, _) = flow_for_category(&category)?;
        let planned_total: i64 = row.try_get("planned_total")?;
        let _actual_total: Option<i64> = row.try_get("actual_total")?;
        if flow_type != expected_flow || planned_total < 0 {
            return Err(ProtectionError::InvariantFailed);
        }
    }
    Ok(())
}

fn validate_record_counts(counts: &BTreeMap<String, u64>) -> Result<(), ProtectionError> {
    // Version 1 manifests legitimately omit actual_entries; absent optional
    // table counts are treated as zero and full v2 equality is checked later.
    let count = |table: &str| counts.get(table).copied().unwrap_or(0);
    if count("settings") > 1
        || count("exchange_rates") > MAX_EXCHANGE_RATE_RECORDS
        || count("plan_items") > MAX_PLAN_ITEM_RECORDS
        || count("monthly_items") > MAX_MONTHLY_ITEM_RECORDS
        || count("actual_entries") > MAX_ACTUAL_ENTRY_RECORDS
    {
        return Err(ProtectionError::SizeLimitExceeded);
    }
    Ok(())
}

pub async fn validate_database_file_integrity(pool: &SqlitePool) -> Result<(), ProtectionError> {
    let quick_check: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_all(pool)
        .await?;
    let integrity_check: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(pool)
        .await?;
    let foreign_key_failures = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await?;
    if quick_check.as_slice() != ["ok"]
        || integrity_check.as_slice() != ["ok"]
        || !foreign_key_failures.is_empty()
    {
        return Err(ProtectionError::IntegrityFailed);
    }
    Ok(())
}

pub async fn create_consistent_snapshot(
    store: &Store,
    destination: &Path,
) -> Result<(), ProtectionError> {
    if destination.exists() {
        return Err(ProtectionError::DestinationExists);
    }
    let destination = destination
        .to_str()
        .ok_or(ProtectionError::InvalidArchive)?;
    sqlx::query("VACUUM main INTO ?")
        .bind(destination)
        .execute(store.pool())
        .await
        .map_err(StoreError::from)?;
    Ok(())
}

pub async fn create_backup_archive(
    store: &Store,
    destination: &Path,
    work_directory: &Path,
) -> Result<CreatedArtifact, ProtectionError> {
    create_backup_archive_impl(store, destination, work_directory, true).await
}

pub(crate) async fn create_migration_restore_point(
    store: &Store,
    destination: &Path,
    work_directory: &Path,
) -> Result<CreatedArtifact, ProtectionError> {
    create_backup_archive_impl(store, destination, work_directory, false).await
}

async fn create_backup_archive_impl(
    store: &Store,
    destination: &Path,
    work_directory: &Path,
    require_current_schema: bool,
) -> Result<CreatedArtifact, ProtectionError> {
    fs::create_dir_all(work_directory)?;
    set_private_directory_permissions(work_directory)?;
    let work = tempfile::Builder::new()
        .prefix("backup-")
        .tempdir_in(work_directory)?;
    let snapshot_path = work.path().join(DATABASE_NAME);
    create_consistent_snapshot(store, &snapshot_path).await?;
    let snapshot_store = super::database::open_database_without_migrations(&snapshot_path).await?;
    if require_current_schema {
        validate_database(snapshot_store.pool()).await?;
    } else {
        validate_database_file_integrity(snapshot_store.pool()).await?;
    }
    let summary = database_summary(snapshot_store.pool()).await?;
    let schema_version = applied_schema_version(snapshot_store.pool()).await?;
    snapshot_store.close().await;
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let database_size_bytes = fs::metadata(&snapshot_path)?.len();
    if database_size_bytes > MAX_DATABASE_BYTES {
        return Err(ProtectionError::SizeLimitExceeded);
    }
    let database_sha256 = sha256_file(&snapshot_path)?;
    let manifest = BackupManifest {
        backup_format: BACKUP_FORMAT.to_owned(),
        format_version: BACKUP_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        schema_version,
        created_at: created_at.clone(),
        database_file: DATABASE_NAME.to_owned(),
        database_size_bytes,
        database_sha256,
        summary: summary.clone(),
    };
    write_archive_atomic(destination, &manifest, &snapshot_path)?;
    Ok(CreatedArtifact {
        display_name: file_display_name(destination),
        created_at,
        summary,
    })
}

pub fn extract_and_verify_archive(
    archive_path: &Path,
    destination_database: &Path,
) -> Result<BackupManifest, ProtectionError> {
    let metadata = fs::symlink_metadata(archive_path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ProtectionError::InvalidArchive);
    }
    if metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(ProtectionError::SizeLimitExceeded);
    }
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;
    if archive.len() != 2 {
        return Err(ProtectionError::InvalidArchive);
    }
    let mut names = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name().to_owned();
        if !names.insert(name.clone())
            || entry.enclosed_name().as_deref() != Some(Path::new(&name))
            || entry.is_dir()
            || entry.is_symlink()
            || !matches!(name.as_str(), MANIFEST_NAME | DATABASE_NAME)
        {
            return Err(ProtectionError::InvalidArchive);
        }
        let limit = if name == MANIFEST_NAME {
            MAX_MANIFEST_BYTES
        } else {
            MAX_DATABASE_BYTES
        };
        if entry.size() > limit
            || (entry.size() > 1024 * 1024
                && entry.compressed_size() > 0
                && entry.size() / entry.compressed_size() > MAX_COMPRESSION_RATIO)
        {
            return Err(ProtectionError::SizeLimitExceeded);
        }
    }
    if names
        != [MANIFEST_NAME.to_owned(), DATABASE_NAME.to_owned()]
            .into_iter()
            .collect()
    {
        return Err(ProtectionError::InvalidArchive);
    }

    let manifest = {
        let mut entry = archive.by_name(MANIFEST_NAME)?;
        let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
        entry
            .by_ref()
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_MANIFEST_BYTES {
            return Err(ProtectionError::SizeLimitExceeded);
        }
        serde_json::from_slice::<BackupManifest>(&bytes)?
    };
    validate_manifest_header(&manifest)?;

    let mut entry = archive.by_name(DATABASE_NAME)?;
    if entry.size() != manifest.database_size_bytes {
        return Err(ProtectionError::ChecksumMismatch);
    }
    let output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination_database)?;
    set_private_file_permissions(destination_database)?;
    let mut writer = BufWriter::new(output);
    let copied = io::copy(
        &mut entry.by_ref().take(MAX_DATABASE_BYTES + 1),
        &mut writer,
    )?;
    writer.flush()?;
    if copied != manifest.database_size_bytes || copied > MAX_DATABASE_BYTES {
        return Err(ProtectionError::SizeLimitExceeded);
    }
    if sha256_file(destination_database)? != manifest.database_sha256 {
        return Err(ProtectionError::ChecksumMismatch);
    }
    validate_sqlite_header(destination_database)?;
    Ok(manifest)
}

pub async fn verify_manifest_summary(
    manifest: &BackupManifest,
    pool: &SqlitePool,
) -> Result<DatabaseSummary, ProtectionError> {
    let actual_schema = applied_schema_version(pool).await?;
    if actual_schema > latest_schema_version() {
        return Err(ProtectionError::FutureSchema);
    }
    if actual_schema < manifest.schema_version {
        return Err(ProtectionError::InvariantFailed);
    }
    validate_database(pool).await?;
    let summary = database_summary(pool).await?;
    let summary_matches = if manifest.format_version == 1 {
        legacy_summary_matches(&manifest.summary, &summary)
    } else {
        summary == manifest.summary
    };
    if !summary_matches {
        return Err(ProtectionError::InvariantFailed);
    }
    Ok(summary)
}

fn validate_manifest_header(manifest: &BackupManifest) -> Result<(), ProtectionError> {
    if manifest.backup_format != BACKUP_FORMAT
        || manifest.database_file != DATABASE_NAME
        || manifest.database_sha256.len() != 64
    {
        return Err(ProtectionError::InvalidArchive);
    }
    if manifest.format_version > BACKUP_FORMAT_VERSION {
        return Err(ProtectionError::FutureFormat);
    }
    if manifest.format_version == 0 {
        return Err(ProtectionError::InvalidArchive);
    }
    if manifest.schema_version > latest_schema_version() {
        return Err(ProtectionError::FutureSchema);
    }
    Ok(())
}

fn legacy_summary_matches(legacy: &DatabaseSummary, migrated: &DatabaseSummary) -> bool {
    legacy.settings == migrated.settings
        && legacy.first_month == migrated.first_month
        && legacy.last_month == migrated.last_month
        && ["settings", "exchange_rates", "plan_items", "monthly_items"]
            .into_iter()
            .all(|table| legacy.record_counts.get(table) == migrated.record_counts.get(table))
}

fn write_archive_atomic(
    destination: &Path,
    manifest: &BackupManifest,
    database_path: &Path,
) -> Result<(), ProtectionError> {
    if destination.exists() {
        return Err(ProtectionError::DestinationExists);
    }
    let parent = destination
        .parent()
        .ok_or(ProtectionError::InvalidArchive)?;
    let temporary = NamedTempFile::new_in(parent)?;
    set_private_file_permissions(temporary.path())?;
    let file = temporary.reopen()?;
    let writer = BufWriter::new(file);
    let mut zip = ZipWriter::new(writer);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    zip.start_file(MANIFEST_NAME, options)?;
    serde_json::to_writer_pretty(&mut zip, manifest)?;
    zip.start_file(DATABASE_NAME, options)?;
    io::copy(&mut BufReader::new(File::open(database_path)?), &mut zip)?;
    let mut writer = zip.finish()?;
    writer.flush()?;
    writer.get_ref().sync_all()?;
    temporary
        .persist_noclobber(destination)
        .map_err(|error| ProtectionError::Io(error.error))?;
    sync_parent_directory(parent)?;
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String, ProtectionError> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn validate_sqlite_header(path: &Path) -> Result<(), ProtectionError> {
    let mut file = File::open(path)?;
    let mut header = [0_u8; 16];
    file.read_exact(&mut header)
        .map_err(|_| ProtectionError::InvalidArchive)?;
    if &header != b"SQLite format 3\0" {
        return Err(ProtectionError::InvalidArchive);
    }
    Ok(())
}

pub async fn export_csv_directory(
    store: &Store,
    selected_parent: &Path,
) -> Result<CreatedCsvArtifact, ProtectionError> {
    let metadata = fs::symlink_metadata(selected_parent)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ProtectionError::InvalidArchive);
    }
    let staging = tempfile::Builder::new()
        .prefix(".aplena-csv-")
        .tempdir_in(selected_parent)?;
    set_private_directory_permissions(staging.path())?;
    write_settings_csv(store.pool(), &staging.path().join("settings.csv")).await?;
    write_exchange_rates_csv(store.pool(), &staging.path().join("exchange_rates.csv")).await?;
    write_plan_items_csv(store.pool(), &staging.path().join("plan_items.csv")).await?;
    write_monthly_items_csv(store.pool(), &staging.path().join("monthly_items.csv")).await?;
    write_actual_entries_csv(store.pool(), &staging.path().join("actual_entries.csv")).await?;
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let folder_name = format!(
        "Aplena-CSV-{}-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    );
    let destination = selected_parent.join(&folder_name);
    if destination.exists() {
        return Err(ProtectionError::DestinationExists);
    }
    fs::rename(staging.path(), &destination)?;
    sync_parent_directory(selected_parent)?;
    Ok(CreatedCsvArtifact {
        folder_name,
        created_at,
        file_count: 5,
    })
}

async fn write_settings_csv(pool: &SqlitePool, path: &Path) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT target_month, base_currency_code, minimum_savings_rate_bp, created_at, updated_at \
         FROM settings ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    let mut writer = csv_writer(path)?;
    writer.write_record([
        "target_month",
        "base_currency_code",
        "minimum_savings_rate_basis_points",
        "created_at",
        "updated_at",
    ])?;
    for row in rows {
        writer.write_record([
            anchor_to_month(row.try_get("target_month")?)?,
            row.try_get("base_currency_code")?,
            row.try_get::<i64, _>("minimum_savings_rate_bp")?
                .to_string(),
            row.try_get("created_at")?,
            row.try_get("updated_at")?,
        ])?;
    }
    finish_csv(writer)
}

async fn write_exchange_rates_csv(pool: &SqlitePool, path: &Path) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT r.currency_code, r.rate_scaled, \
           CASE WHEN r.currency_code = s.base_currency_code THEN 1 ELSE 0 END AS is_base_currency, \
           r.updated_at \
         FROM exchange_rates r LEFT JOIN settings s ON s.id = 1 ORDER BY r.currency_code",
    )
    .fetch_all(pool)
    .await?;
    let mut writer = csv_writer(path)?;
    writer.write_record(["currency_code", "rate", "is_base_currency", "updated_at"])?;
    for row in rows {
        writer.write_record([
            row.try_get("currency_code")?,
            scaled_decimal(row.try_get("rate_scaled")?, 8)?,
            if row.try_get::<i64, _>("is_base_currency")? == 1 {
                "true".to_owned()
            } else {
                "false".to_owned()
            },
            row.try_get("updated_at")?,
        ])?;
    }
    finish_csv(writer)
}

async fn write_plan_items_csv(pool: &SqlitePool, path: &Path) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT id, name, category, planned_amount_scaled, currency_code, period_months, \
                recognition_mode, start_date, end_date, note, created_at, updated_at \
         FROM plan_items ORDER BY name, id",
    )
    .fetch_all(pool)
    .await?;
    let mut writer = csv_writer(path)?;
    writer.write_record([
        "id",
        "name",
        "category_code",
        "category_label_zh",
        "flow_type_code",
        "flow_type_label_zh",
        "planned_amount",
        "currency_code",
        "period_months",
        "recognition_mode_code",
        "recognition_mode_label_zh",
        "start_date",
        "end_date",
        "note",
        "created_at",
        "updated_at",
    ])?;
    for row in rows {
        let category: String = row.try_get("category")?;
        let recognition_mode: String = row.try_get("recognition_mode")?;
        let (flow_code, flow_label) = flow_for_category(&category)?;
        writer.write_record([
            csv_text(row.try_get::<String, _>("id")?),
            csv_text(row.try_get::<String, _>("name")?),
            category.clone(),
            category_label(&category)?.to_owned(),
            flow_code.to_owned(),
            flow_label.to_owned(),
            scaled_decimal(row.try_get("planned_amount_scaled")?, 2)?,
            row.try_get("currency_code")?,
            row.try_get::<i64, _>("period_months")?.to_string(),
            recognition_mode.clone(),
            recognition_label(&recognition_mode)?.to_owned(),
            row.try_get("start_date")?,
            row.try_get::<Option<String>, _>("end_date")?
                .unwrap_or_default(),
            row.try_get::<Option<String>, _>("note")?
                .map(csv_text)
                .unwrap_or_default(),
            row.try_get("created_at")?,
            row.try_get("updated_at")?,
        ])?;
    }
    finish_csv(writer)
}

async fn write_monthly_items_csv(pool: &SqlitePool, path: &Path) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT m.id, m.source_plan_item_id, m.snapshot_name, m.month, m.category, m.flow_type, \
                m.recognition_mode, m.item_source, m.item_origin, m.scheduled_date, m.planned_amount_scaled, \
                CASE WHEN COUNT(e.id) > 0 OR m.actual_confirmed_at IS NOT NULL \
                  THEN COALESCE(SUM(CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END), 0) \
                  ELSE NULL END AS derived_actual_amount_scaled, COUNT(e.id) AS actual_entry_count, \
                m.actual_confirmed_at, m.currency_code, m.note, m.created_at, m.updated_at \
         FROM monthly_items m LEFT JOIN actual_entries e ON e.monthly_item_id = m.id \
         GROUP BY m.id ORDER BY m.month, m.snapshot_name, m.id",
    )
    .fetch_all(pool)
    .await?;
    let mut writer = csv_writer(path)?;
    writer.write_record([
        "id",
        "source_plan_item_id",
        "item_name",
        "month",
        "category_code",
        "category_label_zh",
        "flow_type_code",
        "flow_type_label_zh",
        "recognition_mode_code",
        "recognition_mode_label_zh",
        "item_source_code",
        "item_origin_code",
        "scheduled_date",
        "planned_amount",
        "derived_actual_amount",
        "actual_entry_count",
        "actual_confirmed_at",
        "actual_status_code",
        "currency_code",
        "note",
        "created_at",
        "updated_at",
    ])?;
    for row in rows {
        let category: String = row.try_get("category")?;
        let flow_type: String = row.try_get("flow_type")?;
        let recognition_mode: String = row.try_get("recognition_mode")?;
        let actual: Option<i64> = row.try_get("derived_actual_amount_scaled")?;
        let entry_count: i64 = row.try_get("actual_entry_count")?;
        let confirmed_at: Option<String> = row.try_get("actual_confirmed_at")?;
        let actual_status = match (entry_count, confirmed_at.is_some()) {
            (0, false) => "MISSING",
            (_, false) => "IN_PROGRESS",
            (0, true) => "CONFIRMED_ZERO",
            (_, true) => "FINAL",
        };
        writer.write_record([
            csv_text(row.try_get::<String, _>("id")?),
            row.try_get::<Option<String>, _>("source_plan_item_id")?
                .map(csv_text)
                .unwrap_or_default(),
            csv_text(row.try_get::<String, _>("snapshot_name")?),
            anchor_to_month(row.try_get("month")?)?,
            category.clone(),
            category_label(&category)?.to_owned(),
            flow_type.clone(),
            flow_label(&flow_type)?.to_owned(),
            recognition_mode.clone(),
            recognition_label(&recognition_mode)?.to_owned(),
            row.try_get("item_source")?,
            row.try_get("item_origin")?,
            row.try_get::<Option<String>, _>("scheduled_date")?
                .unwrap_or_default(),
            scaled_decimal(row.try_get("planned_amount_scaled")?, 2)?,
            actual
                .map(|value| scaled_decimal(value, 2))
                .transpose()?
                .unwrap_or_default(),
            entry_count.to_string(),
            confirmed_at.unwrap_or_default(),
            actual_status.to_owned(),
            row.try_get("currency_code")?,
            row.try_get::<Option<String>, _>("note")?
                .map(csv_text)
                .unwrap_or_default(),
            row.try_get("created_at")?,
            row.try_get("updated_at")?,
        ])?;
    }
    finish_csv(writer)
}

async fn write_actual_entries_csv(pool: &SqlitePool, path: &Path) -> Result<(), ProtectionError> {
    let rows = sqlx::query(
        "SELECT id, monthly_item_id, occurred_on, effect, amount_scaled, origin, note, \
                created_at, updated_at FROM actual_entries \
         ORDER BY occurred_on, monthly_item_id, created_at, id",
    )
    .fetch_all(pool)
    .await?;
    let mut writer = csv_writer(path)?;
    writer.write_record([
        "id",
        "monthly_item_id",
        "occurred_on",
        "effect",
        "amount",
        "origin",
        "note",
        "created_at",
        "updated_at",
    ])?;
    for row in rows {
        writer.write_record([
            csv_text(row.try_get("id")?),
            csv_text(row.try_get("monthly_item_id")?),
            row.try_get("occurred_on")?,
            row.try_get("effect")?,
            scaled_decimal(row.try_get("amount_scaled")?, 2)?,
            row.try_get("origin")?,
            row.try_get::<Option<String>, _>("note")?
                .map(csv_text)
                .unwrap_or_default(),
            row.try_get("created_at")?,
            row.try_get("updated_at")?,
        ])?;
    }
    finish_csv(writer)
}

fn csv_writer(path: &Path) -> Result<csv::Writer<BufWriter<File>>, ProtectionError> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    set_private_file_permissions(path)?;
    Ok(csv::WriterBuilder::new()
        .terminator(csv::Terminator::CRLF)
        .from_writer(BufWriter::new(file)))
}

fn finish_csv(mut writer: csv::Writer<BufWriter<File>>) -> Result<(), ProtectionError> {
    writer.flush()?;
    writer.get_ref().get_ref().sync_all()?;
    Ok(())
}

fn csv_text(value: String) -> String {
    let first = value
        .trim_start_matches([' ', '\t', '\r', '\n'])
        .chars()
        .next();
    if matches!(first, Some('=' | '+' | '-' | '@')) {
        format!("'{value}")
    } else {
        value
    }
}

fn scaled_decimal(value: i64, scale: u32) -> Result<String, ProtectionError> {
    if scale > 18 {
        return Err(ProtectionError::InvariantFailed);
    }
    let factor = 10_u64
        .checked_pow(scale)
        .ok_or(ProtectionError::InvariantFailed)?;
    let absolute = value.unsigned_abs();
    let sign = if value < 0 { "-" } else { "" };
    Ok(format!(
        "{sign}{}.{:0width$}",
        absolute / factor,
        absolute % factor,
        width = usize::try_from(scale).map_err(|_| ProtectionError::InvariantFailed)?
    ))
}

fn category_label(code: &str) -> Result<&'static str, ProtectionError> {
    match code {
        "FIXED_INCOME" => Ok("固定收入"),
        "VARIABLE_INCOME" => Ok("浮动收入"),
        "ESSENTIAL_EXPENSE" => Ok("必要支出"),
        "FIXED_COMMITMENT_EXPENSE" => Ok("固定承诺支出"),
        "DISCRETIONARY_BUDGET" => Ok("自主性预算"),
        _ => Err(ProtectionError::InvariantFailed),
    }
}

fn flow_for_category(code: &str) -> Result<(&'static str, &'static str), ProtectionError> {
    match code {
        "FIXED_INCOME" | "VARIABLE_INCOME" => Ok(("INCOME", "收入")),
        "ESSENTIAL_EXPENSE" | "FIXED_COMMITMENT_EXPENSE" | "DISCRETIONARY_BUDGET" => {
            Ok(("EXPENSE", "支出"))
        }
        _ => Err(ProtectionError::InvariantFailed),
    }
}

fn flow_label(code: &str) -> Result<&'static str, ProtectionError> {
    match code {
        "INCOME" => Ok("收入"),
        "EXPENSE" => Ok("支出"),
        _ => Err(ProtectionError::InvariantFailed),
    }
}

fn recognition_label(code: &str) -> Result<&'static str, ProtectionError> {
    match code {
        "AMORTIZED" => Ok("按月均摊"),
        "PAYMENT" => Ok("按支付月份确认"),
        _ => Err(ProtectionError::InvariantFailed),
    }
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), ProtectionError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), ProtectionError> {
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), ProtectionError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), ProtectionError> {
    Ok(())
}

fn anchor_to_month(anchor: String) -> Result<String, ProtectionError> {
    if anchor.len() == 10 && anchor.ends_with("-01") {
        Ok(anchor[..7].to_owned())
    } else {
        Err(ProtectionError::InvariantFailed)
    }
}

pub fn file_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Aplena 数据文件")
        .to_owned()
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), ProtectionError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), ProtectionError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MAX_MONTHLY_ITEM_RECORDS, ProtectionError, csv_text, validate_record_counts};
    use std::collections::BTreeMap;

    #[test]
    fn record_count_limits_reject_unreasonable_archives() {
        let mut counts = BTreeMap::from([
            ("settings".to_owned(), 1),
            ("exchange_rates".to_owned(), 1),
            ("plan_items".to_owned(), 1),
            ("monthly_items".to_owned(), MAX_MONTHLY_ITEM_RECORDS),
        ]);
        assert!(validate_record_counts(&counts).is_ok());
        counts.insert("monthly_items".to_owned(), MAX_MONTHLY_ITEM_RECORDS + 1);
        assert!(matches!(
            validate_record_counts(&counts),
            Err(ProtectionError::SizeLimitExceeded)
        ));
    }

    #[test]
    fn formula_guard_looks_through_leading_line_breaks_and_whitespace() {
        assert_eq!(csv_text("\n \t=SUM(1,2)".to_owned()), "'\n \t=SUM(1,2)");
    }
}
