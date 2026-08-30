use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};

use chrono::{Datelike, Local};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::infrastructure::{
    StoreError, create_version_one_fixture, create_version_two_fixture, open_database,
    protection::{
        self, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BackupManifest, ProtectionError,
        extract_and_verify_archive,
    },
};

use super::{
    dto::{
        ActualEntryInputDto, ConfirmMonthlyItemInputDto, ExchangeRateUpsertDto, PlanItemInputDto,
        RestoreBackupInputDto, SettingsInputDto,
    },
    service::FinanceService,
};

async fn file_service(root: &Path) -> FinanceService {
    let store = open_database(&root.join("aplena.sqlite3")).await.unwrap();
    let service = FinanceService::new(store).unwrap();
    service
        .save_settings(SettingsInputDto {
            target_month: current_month(),
            base_currency: "CNY".to_owned(),
            minimum_savings_rate_basis_points: 2000,
        })
        .await
        .unwrap();
    service
}

fn current_month() -> String {
    let now = Local::now();
    format!("{:04}-{:02}", now.year(), now.month())
}

fn plan(name: &str, amount: &str, note: Option<&str>) -> PlanItemInputDto {
    PlanItemInputDto {
        id: None,
        name: name.to_owned(),
        category: "ESSENTIAL_EXPENSE".to_owned(),
        planned_amount: amount.to_owned(),
        currency: "CNY".to_owned(),
        period_months: 1,
        start_date: format!("{}-01", current_month()),
        end_date: None,
        recognition_mode: "AMORTIZED".to_owned(),
        note: note.map(str::to_owned),
    }
}

fn entry_input(monthly_item_id: &str, amount: &str, note: Option<&str>) -> ActualEntryInputDto {
    ActualEntryInputDto {
        id: None,
        monthly_item_id: monthly_item_id.to_owned(),
        occurred_on: format!("{}-01", current_month()),
        effect: "INCREASE".to_owned(),
        amount: amount.to_owned(),
        note: note.map(str::to_owned),
    }
}

async fn populated_service(root: &Path) -> FinanceService {
    let service = file_service(root).await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "7.25000000".to_owned(),
        })
        .await
        .unwrap();
    service
        .create_plan_item(plan("房租", "5000", None))
        .await
        .unwrap();
    let detachable = service
        .create_plan_item(plan("旧订阅", "20", Some("历史必须保留")))
        .await
        .unwrap();
    let items = service.list_monthly_items(current_month()).await.unwrap();
    let rent = items.iter().find(|item| item.item_name == "房租").unwrap();
    service
        .confirm_monthly_item(ConfirmMonthlyItemInputDto {
            id: rent.id.clone(),
        })
        .await
        .unwrap();
    service
        .delete_plan_item(detachable.plan_item.id)
        .await
        .unwrap();
    service
}

#[tokio::test]
async fn full_backup_round_trip_restores_all_tables_orphans_null_zero_and_analytics() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let before_settings = service.get_settings().await.unwrap();
    let before_rates = service.list_exchange_rates().await.unwrap();
    let before_plans = service.list_plan_items().await.unwrap();
    let before_items = service.list_monthly_items(current_month()).await.unwrap();
    let before_analytics = service.month_analytics(current_month()).await.unwrap();
    assert!(
        before_items
            .iter()
            .any(|item| item.source_plan_item_id.is_none())
    );
    assert!(before_items.iter().any(|item| item.actual_amount.is_none()));
    assert!(
        before_items
            .iter()
            .any(|item| item.actual_amount.as_deref() == Some("0.00"))
    );

    let backup = root.path().join("round-trip.aplena");
    service.create_backup_to(backup.clone()).await.unwrap();
    let changed_item = before_items
        .iter()
        .find(|item| item.item_name == "房租")
        .unwrap();
    service
        .create_actual_entry(entry_input(&changed_item.id, "9999", None))
        .await
        .unwrap();
    service
        .create_plan_item(plan("恢复后不应存在", "1", None))
        .await
        .unwrap();

    let inspection = service.inspect_backup_at(backup).await.unwrap();
    assert_eq!(inspection.status, "READY");
    assert_eq!(inspection.summary.as_ref().unwrap().plan_item_count, 1);
    let restored = service
        .restore_inspected_backup(RestoreBackupInputDto {
            token: inspection.token.unwrap(),
            confirmed: true,
            confirmation_phrase: "恢复".to_owned(),
        })
        .await
        .unwrap();
    assert!(restored.restored);
    assert!(
        root.path()
            .join("recovery")
            .join(restored.recovery_point_name)
            .is_file()
    );
    assert_eq!(service.get_settings().await.unwrap(), before_settings);
    assert_eq!(service.list_exchange_rates().await.unwrap(), before_rates);
    assert_eq!(service.list_plan_items().await.unwrap(), before_plans);
    assert_eq!(
        service.list_monthly_items(current_month()).await.unwrap(),
        before_items
    );
    assert_eq!(
        service.month_analytics(current_month()).await.unwrap(),
        before_analytics
    );
    assert_eq!(
        fs::read_dir(root.path().join("protection-work"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn version_one_backup_is_inspected_forward_migrated_and_restored() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let old_database = root.path().join("version-one.sqlite3");
    create_version_two_fixture(&old_database).await.unwrap();
    let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}", old_database.display()))
        .await
        .unwrap();
    sqlx::query("INSERT INTO exchange_rates VALUES ('CNY', 100000000, 't')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings VALUES (1, '2026-01-01', 'CNY', 2000, 't', 't')")
        .execute(&pool)
        .await
        .unwrap();
    let summary = protection::database_summary(&pool).await.unwrap();
    pool.close().await;
    let database = fs::read(&old_database).unwrap();
    let manifest = BackupManifest {
        backup_format: BACKUP_FORMAT.to_owned(),
        format_version: 1,
        app_version: "0.1.0".to_owned(),
        schema_version: 2,
        created_at: "2026-01-01T00:00:00Z".to_owned(),
        database_file: "database.sqlite3".to_owned(),
        database_size_bytes: u64::try_from(database.len()).unwrap(),
        database_sha256: protection::sha256_file(&old_database).unwrap(),
        summary,
    };
    let archive = root.path().join("version-one.aplena");
    write_backup(&archive, &manifest, &database);
    let inspection = service.inspect_backup_at(archive).await.unwrap();
    assert!(inspection.migrations_applied);
    assert_eq!(inspection.schema_version, Some(2));
    assert_eq!(inspection.summary.as_ref().unwrap().actual_entry_count, 0);
    let result = service
        .restore_inspected_backup(RestoreBackupInputDto {
            token: inspection.token.unwrap(),
            confirmed: true,
            confirmation_phrase: "恢复".to_owned(),
        })
        .await
        .unwrap();
    assert_eq!(result.summary.actual_entry_count, 0);
    assert_eq!(
        service.get_settings().await.unwrap().unwrap().target_month,
        "2026-01"
    );
}

#[tokio::test]
async fn inspected_backup_is_one_time_confirmation_bound_and_change_detected_without_data_loss() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let backup = root.path().join("bound.aplena");
    service.create_backup_to(backup.clone()).await.unwrap();
    let inspection = service.inspect_backup_at(backup.clone()).await.unwrap();
    let token = inspection.token.unwrap();
    let before = service.list_monthly_items(current_month()).await.unwrap();

    let unconfirmed = service
        .restore_inspected_backup(RestoreBackupInputDto {
            token: token.clone(),
            confirmed: false,
            confirmation_phrase: "恢复".to_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(unconfirmed.error_code, "RESTORE_CONFIRMATION_REQUIRED");

    File::options()
        .append(true)
        .open(&backup)
        .unwrap()
        .write_all(b"changed")
        .unwrap();
    let changed = service
        .restore_inspected_backup(RestoreBackupInputDto {
            token,
            confirmed: true,
            confirmation_phrase: "恢复".to_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(changed.error_code, "BACKUP_CHANGED_AFTER_INSPECTION");
    assert_eq!(
        service.list_monthly_items(current_month()).await.unwrap(),
        before
    );
}

#[tokio::test]
async fn csv_export_is_deterministic_rfc_quoted_formula_safe_and_preserves_null_vs_zero() {
    let root = tempfile::tempdir().unwrap();
    let service = file_service(root.path()).await;
    service
        .create_plan_item(plan("=SUM(1,2)\n项目", "12.5", Some("@危险,备注\n第二行")))
        .await
        .unwrap();
    let item = service
        .list_monthly_items(current_month())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(item.actual_amount, None);

    let export_one = service
        .export_csv_to(root.path().to_path_buf())
        .await
        .unwrap();
    let export_two = service
        .export_csv_to(root.path().to_path_buf())
        .await
        .unwrap();
    let first = root.path().join(export_one.folder_name.unwrap());
    let second = root.path().join(export_two.folder_name.unwrap());
    for name in [
        "settings.csv",
        "exchange_rates.csv",
        "plan_items.csv",
        "monthly_items.csv",
        "actual_entries.csv",
    ] {
        assert_eq!(
            fs::read(first.join(name)).unwrap(),
            fs::read(second.join(name)).unwrap()
        );
    }

    let mut plans = csv::Reader::from_path(first.join("plan_items.csv")).unwrap();
    let plan_row = plans.records().next().unwrap().unwrap();
    assert_eq!(&plan_row[1], "'=SUM(1,2)\n项目");
    assert_eq!(&plan_row[3], "必要支出");
    assert_eq!(&plan_row[13], "'@危险,备注\n第二行");
    let mut monthly = csv::Reader::from_path(first.join("monthly_items.csv")).unwrap();
    let monthly_row = monthly.records().next().unwrap().unwrap();
    assert_eq!(&monthly_row[13], "12.50");
    assert_eq!(&monthly_row[14], "");
    assert_eq!(&monthly_row[17], "MISSING");
}

#[tokio::test]
async fn wal_backup_remains_valid_during_concurrent_actual_updates_and_repeated_backups() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let item = service
        .list_monthly_items(current_month())
        .await
        .unwrap()
        .into_iter()
        .find(|item| item.item_name == "房租")
        .unwrap();
    let writer_service = service.clone();
    let writer = tokio::spawn(async move {
        for value in 1..=20 {
            writer_service
                .create_actual_entry(entry_input(&item.id, &value.to_string(), None))
                .await
                .unwrap();
        }
    });
    let left = root.path().join("left.aplena");
    let right = root.path().join("right.aplena");
    let (left_result, right_result) = tokio::join!(
        service.create_backup_to(left.clone()),
        service.create_backup_to(right.clone())
    );
    left_result.unwrap();
    right_result.unwrap();
    writer.await.unwrap();
    assert_eq!(
        service.inspect_backup_at(left).await.unwrap().status,
        "READY"
    );
    assert_eq!(
        service.inspect_backup_at(right).await.unwrap().status,
        "READY"
    );
}

#[tokio::test]
async fn restore_serializes_concurrent_requests_and_consumes_the_token_once() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let backup = root.path().join("concurrent-restore.aplena");
    service.create_backup_to(backup.clone()).await.unwrap();
    let inspection = service.inspect_backup_at(backup).await.unwrap();
    let token = inspection.token.unwrap();
    let item = service
        .list_monthly_items(current_month())
        .await
        .unwrap()
        .into_iter()
        .find(|item| item.item_name == "房租")
        .unwrap();
    let update_service = service.clone();
    let restore_service = service.clone();
    let update = tokio::spawn(async move {
        update_service
            .create_actual_entry(entry_input(&item.id, "88", None))
            .await
    });
    let restore_token = token.clone();
    let restore = tokio::spawn(async move {
        restore_service
            .restore_inspected_backup(RestoreBackupInputDto {
                token: restore_token,
                confirmed: true,
                confirmation_phrase: "恢复".to_owned(),
            })
            .await
    });
    update.await.unwrap().unwrap();
    restore.await.unwrap().unwrap();
    let restored_store = service.test_store().await;
    protection::validate_database(restored_store.pool())
        .await
        .unwrap();
    let repeated = service
        .restore_inspected_backup(RestoreBackupInputDto {
            token,
            confirmed: true,
            confirmation_phrase: "恢复".to_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(repeated.error_code, "RESTORE_TOKEN_EXPIRED");
}

#[tokio::test]
async fn archive_rejects_checksum_future_versions_paths_symlinks_duplicates_and_bombs() {
    let root = tempfile::tempdir().unwrap();
    let service = populated_service(root.path()).await;
    let valid = root.path().join("valid.aplena");
    service.create_backup_to(valid.clone()).await.unwrap();
    let (manifest, database) = read_backup(&valid);

    let bad_checksum = root.path().join("bad-checksum.aplena");
    let mut checksum_manifest = manifest.clone();
    checksum_manifest.database_sha256 = "0".repeat(64);
    write_backup(&bad_checksum, &checksum_manifest, &database);
    let destination = root.path().join("checksum.sqlite3");
    assert!(matches!(
        extract_and_verify_archive(&bad_checksum, &destination),
        Err(ProtectionError::ChecksumMismatch)
    ));

    let future_format = root.path().join("future-format.aplena");
    let mut future_manifest = manifest.clone();
    future_manifest.format_version = BACKUP_FORMAT_VERSION + 1;
    write_backup(&future_format, &future_manifest, &database);
    assert!(matches!(
        extract_and_verify_archive(&future_format, &root.path().join("future.sqlite3")),
        Err(ProtectionError::FutureFormat)
    ));

    let future_schema = root.path().join("future-schema.aplena");
    let mut schema_manifest = manifest.clone();
    schema_manifest.schema_version = protection::latest_schema_version() + 1;
    write_backup(&future_schema, &schema_manifest, &database);
    assert!(matches!(
        extract_and_verify_archive(&future_schema, &root.path().join("schema.sqlite3")),
        Err(ProtectionError::FutureSchema)
    ));

    let traversal = root.path().join("traversal.aplena");
    write_raw_archive(
        &traversal,
        &[("manifest.json", b"{}"), ("../database.sqlite3", b"x")],
        None,
    );
    assert!(matches!(
        extract_and_verify_archive(&traversal, &root.path().join("traversal.sqlite3")),
        Err(ProtectionError::InvalidArchive)
    ));

    let duplicate = root.path().join("duplicate.aplena");
    write_raw_archive(
        &duplicate,
        &[("manifest.json", b"{}"), ("manifesz.json", b"{}")],
        None,
    );
    let mut duplicate_bytes = fs::read(&duplicate).unwrap();
    for index in 0..duplicate_bytes.len().saturating_sub(b"manifesz.json".len()) {
        if &duplicate_bytes[index..index + b"manifesz.json".len()] == b"manifesz.json" {
            duplicate_bytes[index..index + b"manifest.json".len()]
                .copy_from_slice(b"manifest.json");
        }
    }
    fs::write(&duplicate, duplicate_bytes).unwrap();
    assert!(matches!(
        extract_and_verify_archive(&duplicate, &root.path().join("duplicate.sqlite3")),
        Err(ProtectionError::InvalidArchive)
    ));

    let symlink = root.path().join("symlink.aplena");
    write_raw_archive(
        &symlink,
        &[("manifest.json", b"{}"), ("database.sqlite3", b"target")],
        Some("database.sqlite3"),
    );
    assert!(matches!(
        extract_and_verify_archive(&symlink, &root.path().join("symlink.sqlite3")),
        Err(ProtectionError::InvalidArchive)
    ));

    let bomb = root.path().join("bomb.aplena");
    let zeros = vec![0_u8; 5 * 1024 * 1024];
    write_raw_archive(
        &bomb,
        &[("manifest.json", b"{}"), ("database.sqlite3", &zeros)],
        None,
    );
    assert!(matches!(
        extract_and_verify_archive(&bomb, &root.path().join("bomb.sqlite3")),
        Err(ProtectionError::SizeLimitExceeded)
    ));

    let oversized = root.path().join("oversized.aplena");
    File::create(&oversized)
        .unwrap()
        .set_len(257 * 1024 * 1024)
        .unwrap();
    assert!(matches!(
        extract_and_verify_archive(&oversized, &root.path().join("oversized.sqlite3")),
        Err(ProtectionError::SizeLimitExceeded)
    ));
}

#[tokio::test]
async fn migration_creates_restore_point_only_when_pending_and_fails_closed_on_checksum_error() {
    let root = tempfile::tempdir().unwrap();
    let old_path = root.path().join("old.sqlite3");
    create_version_one_fixture(&old_path).await.unwrap();
    let migrated = open_database(&old_path).await.unwrap();
    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(migrated.pool())
        .await
        .unwrap();
    assert_eq!(version, protection::latest_schema_version());
    migrated.close().await;
    let recovery = root.path().join("recovery");
    let after_migration = fs::read_dir(&recovery).unwrap().count();
    assert_eq!(after_migration, 1);
    let reopened = open_database(&old_path).await.unwrap();
    reopened.close().await;
    assert_eq!(fs::read_dir(&recovery).unwrap().count(), after_migration);

    let fresh_root = tempfile::tempdir().unwrap();
    let fresh = open_database(&fresh_root.path().join("fresh.sqlite3"))
        .await
        .unwrap();
    fresh.close().await;
    assert!(!fresh_root.path().join("recovery").exists());

    let failed_root = tempfile::tempdir().unwrap();
    let failed_path = failed_root.path().join("failed.sqlite3");
    create_version_one_fixture(&failed_path).await.unwrap();
    let url = format!("sqlite://{}", failed_path.display());
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum = X'00' WHERE version = 1")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    assert!(matches!(
        open_database(&failed_path).await,
        Err(StoreError::Migration(_))
    ));
    assert_eq!(
        fs::read_dir(failed_root.path().join("recovery"))
            .unwrap()
            .count(),
        1
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let index_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name = 'idx_monthly_items_source_plan'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(index_exists, 0);
}

fn read_backup(path: &Path) -> (BackupManifest, Vec<u8>) {
    let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
    let manifest = {
        let mut file = archive.by_name("manifest.json").unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    };
    let database = {
        let mut file = archive.by_name("database.sqlite3").unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        bytes
    };
    (manifest, database)
}

fn write_backup(path: &Path, manifest: &BackupManifest, database: &[u8]) {
    let manifest = serde_json::to_vec(manifest).unwrap();
    write_raw_archive(
        path,
        &[("manifest.json", &manifest), ("database.sqlite3", database)],
        None,
    );
}

fn write_raw_archive(path: &Path, entries: &[(&str, &[u8])], symlink: Option<&str>) {
    let mut writer = ZipWriter::new(File::create(path).unwrap());
    for (name, contents) in entries {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        if symlink == Some(*name) {
            writer.add_symlink(*name, "target", options).unwrap();
            continue;
        }
        writer.start_file(*name, options).unwrap();
        writer.write_all(contents).unwrap();
    }
    writer.finish().unwrap();
}
