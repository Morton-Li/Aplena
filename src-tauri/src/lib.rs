mod application;
mod infrastructure;

use application::{
    FinanceService, calculate_capacity, confirm_monthly_actuals, confirm_monthly_item,
    create_actual_entry, create_manual_monthly_item, create_plan_item, delete_actual_entry,
    delete_exchange_rate, delete_plan_item, ensure_actual_only_monthly_item,
    ensure_default_settings, get_domain_contract, get_financial_capacity, get_history_analytics,
    get_month_analytics, get_month_initialization_status, get_next_month_goal, get_settings,
    get_startup_status, initialize_month, list_actual_entries, list_exchange_rates,
    list_existing_months, list_monthly_items, list_plan_items, preview_month, preview_plan_item,
    save_next_month_goal, save_settings, stop_plan_item, update_actual_entry, update_monthly_note,
    update_plan_item, upsert_exchange_rate,
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

fn app_data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    match std::env::var_os(SMOKE_DATA_DIR_ENV) {
        Some(requested) => Ok(validate_smoke_data_dir(
            Path::new(&requested),
            &std::env::temp_dir(),
        )?),
        None => Ok(app.path().app_data_dir()?),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app_data_dir(app)?;
            std::fs::create_dir_all(&app_data_dir)?;
            let store = tauri::async_runtime::block_on(open_database(
                &app_data_dir.join("aplena.sqlite3"),
            ))?;
            let service = FinanceService::new(store)?;
            tauri::async_runtime::block_on(service.initialize_on_startup());
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_domain_contract,
            preview_plan_item,
            calculate_capacity,
            get_startup_status,
            get_settings,
            ensure_default_settings,
            save_settings,
            get_next_month_goal,
            save_next_month_goal,
            list_exchange_rates,
            upsert_exchange_rate,
            delete_exchange_rate,
            list_plan_items,
            create_plan_item,
            update_plan_item,
            stop_plan_item,
            delete_plan_item,
            list_monthly_items,
            ensure_actual_only_monthly_item,
            create_manual_monthly_item,
            list_actual_entries,
            create_actual_entry,
            update_actual_entry,
            delete_actual_entry,
            confirm_monthly_item,
            update_monthly_note,
            confirm_monthly_actuals,
            list_existing_months,
            get_month_initialization_status,
            preview_month,
            initialize_month,
            get_month_analytics,
            get_history_analytics,
            get_financial_capacity
        ])
        // Keep the compiled application context colocated with the startup pipeline so release
        // builds always embed the matching hashed frontend assets.
        .run(tauri::generate_context!())
        .expect("failed to run Aplena");
}

#[cfg(test)]
mod tests {
    use super::validate_smoke_data_dir;

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
