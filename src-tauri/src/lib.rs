mod application;
mod infrastructure;

use application::{
    FinanceService, calculate_capacity, confirm_monthly_actuals, create_plan_item,
    delete_exchange_rate, delete_plan_item, get_domain_contract, get_month_initialization_status,
    get_settings, get_startup_status, initialize_month, list_exchange_rates, list_existing_months,
    list_monthly_items, list_plan_items, preview_month, preview_plan_item, save_settings,
    stop_plan_item, update_monthly_actual, update_monthly_note, update_plan_item,
    upsert_exchange_rate,
};
use infrastructure::open_database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
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
            save_settings,
            list_exchange_rates,
            upsert_exchange_rate,
            delete_exchange_rate,
            list_plan_items,
            create_plan_item,
            update_plan_item,
            stop_plan_item,
            delete_plan_item,
            list_monthly_items,
            update_monthly_actual,
            update_monthly_note,
            confirm_monthly_actuals,
            list_existing_months,
            get_month_initialization_status,
            preview_month,
            initialize_month
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aplena");
}
