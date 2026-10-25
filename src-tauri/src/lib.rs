mod application;
mod application_updates;
mod infrastructure;

use application::{
    FinanceService, archive_special_project, calculate_budget_projection, check_automatic_entries,
    create_actual_entry, create_loan, create_manual_monthly_item, create_plan_item,
    create_special_actual_entry, delete_actual_entry, delete_exchange_rate, delete_loan_payment,
    delete_manual_monthly_item, delete_plan_item, delete_special_allocation,
    ensure_actual_only_monthly_item, ensure_default_settings, get_budget_projection,
    get_domain_contract, get_history_analytics, get_loan, get_loan_month_summary,
    get_month_analytics, get_month_initialization_status, get_settings, get_special_project,
    get_startup_status, import_reference_rates, initialize_month, list_actual_entries,
    list_automatic_entry_policies, list_automatic_occurrences, list_exchange_rates,
    list_existing_months, list_loans, list_monthly_items, list_plan_items, list_special_projects,
    preview_loan_payment, preview_loan_schedule, preview_month, preview_plan_item,
    resolve_automatic_entry_conflict, save_automatic_entry_policy, save_loan_payment,
    save_loan_schedule, save_settings, save_special_allocation, save_special_project,
    stop_plan_item, update_actual_entry, update_loan_metadata, update_monthly_note,
    update_plan_item, upsert_exchange_rate,
};
use application_updates::{
    SoftwareUpdateService, cancel_software_update, check_software_update,
    cleanup_stale_update_backups, download_and_install_software_update,
    get_software_update_preferences, get_software_update_status, restart_after_software_update,
    set_software_update_auto_check, updater_public_key,
};
use infrastructure::open_database;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SMOKE_DATA_DIR_ENV: &str = "APLENA_SMOKE_DATA_DIR";

fn validate_smoke_data_dir(requested: &Path, temp_root: &Path) -> std::io::Result<PathBuf> {
    let requested = requested.canonicalize().map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "smoke data directory must already exist",
        )
    })?;
    let temp_root = temp_root.canonicalize().map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "system temporary directory is unavailable",
        )
    })?;

    if requested == temp_root || !requested.starts_with(&temp_root) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "smoke data directory must be an existing child of the system temporary directory",
        ));
    }

    Ok(requested)
}

fn isolated_data_dir(
    identifier: &str,
    runtime: Option<std::ffi::OsString>,
    compiled: Option<&str>,
    temp_root: &Path,
) -> std::io::Result<Option<PathBuf>> {
    // Launch Services does not inherit shell environment variables. Smoke
    // builds must fail closed instead of ever opening a default account.
    if let Some(path) = compiled {
        if !identifier.ends_with(".smoke") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "compiled smoke data requires a separate .smoke bundle identity",
            ));
        }
        return validate_smoke_data_dir(Path::new(path), temp_root).map(Some);
    }
    match runtime {
        Some(path) => validate_smoke_data_dir(Path::new(&path), temp_root).map(Some),
        None if identifier.ends_with(".smoke") => Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "smoke builds require an explicit isolated data directory",
        )),
        None => Ok(None),
    }
}

fn app_data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let compiled = option_env!("APLENA_COMPILED_SMOKE_DATA_DIR");
    #[cfg(not(debug_assertions))]
    let compiled = None;
    match isolated_data_dir(
        &app.config().identifier,
        std::env::var_os(SMOKE_DATA_DIR_ENV),
        compiled,
        &std::env::temp_dir(),
    )? {
        Some(path) => Ok(path),
        None => Ok(app.path().app_data_dir()?),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(updater_public_key())
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app_data_dir(app)?;
            std::fs::create_dir_all(&app_data_dir)?;
            let store = tauri::async_runtime::block_on(open_database(
                &app_data_dir.join("aplena.sqlite3"),
            ))?;
            let update_service = SoftwareUpdateService::new(store.clone());
            let service = FinanceService::new(store)?;
            tauri::async_runtime::block_on(service.initialize_on_startup());
            app.manage(service);
            app.manage(update_service);
            tauri::async_runtime::spawn_blocking(cleanup_stale_update_backups);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_loan,
            list_loans,
            get_loan,
            update_loan_metadata,
            preview_loan_schedule,
            save_loan_schedule,
            preview_loan_payment,
            save_loan_payment,
            delete_loan_payment,
            get_loan_month_summary,
            get_domain_contract,
            preview_plan_item,
            calculate_budget_projection,
            get_startup_status,
            get_settings,
            ensure_default_settings,
            save_settings,
            list_exchange_rates,
            upsert_exchange_rate,
            import_reference_rates,
            delete_exchange_rate,
            list_plan_items,
            create_plan_item,
            update_plan_item,
            stop_plan_item,
            delete_plan_item,
            list_automatic_entry_policies,
            save_automatic_entry_policy,
            check_automatic_entries,
            list_automatic_occurrences,
            resolve_automatic_entry_conflict,
            list_special_projects,
            save_special_project,
            archive_special_project,
            get_special_project,
            save_special_allocation,
            delete_special_allocation,
            create_special_actual_entry,
            list_monthly_items,
            ensure_actual_only_monthly_item,
            create_manual_monthly_item,
            delete_manual_monthly_item,
            list_actual_entries,
            create_actual_entry,
            update_actual_entry,
            delete_actual_entry,
            update_monthly_note,
            list_existing_months,
            get_month_initialization_status,
            preview_month,
            initialize_month,
            get_month_analytics,
            get_history_analytics,
            get_budget_projection,
            get_software_update_preferences,
            set_software_update_auto_check,
            get_software_update_status,
            check_software_update,
            download_and_install_software_update,
            cancel_software_update,
            restart_after_software_update
        ])
        // Keep the compiled application context colocated with the startup pipeline so release
        // builds always embed the matching hashed frontend assets.
        .run(tauri::generate_context!())
        .expect("failed to run Aplena");
}

#[cfg(test)]
mod tests {
    use super::{isolated_data_dir, validate_smoke_data_dir};

    #[test]
    fn smoke_identity_cannot_fall_back_to_a_default_account_directory() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let isolated = root.join("isolated");
        std::fs::create_dir(&isolated).unwrap();
        let compiled = isolated.to_str();
        assert!(isolated_data_dir("li.morton.aplena.smoke", None, None, root).is_err());
        assert!(isolated_data_dir("li.morton.aplena", None, compiled, root).is_err());
        assert_eq!(
            isolated_data_dir("li.morton.aplena.smoke", None, compiled, root).unwrap(),
            Some(isolated.canonicalize().unwrap())
        );
        assert_eq!(
            isolated_data_dir("li.morton.aplena", None, None, root).unwrap(),
            None
        );
        assert!(
            isolated_data_dir(
                "li.morton.aplena.smoke",
                Some(root.as_os_str().to_owned()),
                None,
                root
            )
            .is_err()
        );
    }

    #[test]
    fn smoke_data_directory_must_be_an_existing_child_of_the_temp_root() {
        let fixture = tempfile::tempdir().expect("fixture");
        let temp_root = fixture.path().join("system-temp");
        let isolated = temp_root.join("aplena-smoke");
        let outside = fixture.path().join("outside");
        std::fs::create_dir_all(&isolated).expect("isolated directory");
        std::fs::create_dir_all(&outside).expect("outside directory");

        assert_eq!(
            validate_smoke_data_dir(&isolated, &temp_root).expect("valid smoke directory"),
            isolated
                .canonicalize()
                .expect("canonical isolated directory")
        );
        assert!(validate_smoke_data_dir(&temp_root, &temp_root).is_err());
        assert!(validate_smoke_data_dir(&outside, &temp_root).is_err());
        assert!(validate_smoke_data_dir(&temp_root.join("missing"), &temp_root).is_err());
    }
}
