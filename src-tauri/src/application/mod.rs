mod analytics;
mod commands;
mod data_protection;
mod dto;
mod error;
mod service;

#[cfg(test)]
mod data_protection_tests;
#[cfg(test)]
mod persistence_tests;

pub use commands::{
    calculate_capacity, confirm_monthly_actuals, create_backup, create_plan_item,
    delete_exchange_rate, delete_plan_item, export_csv, get_domain_contract,
    get_financial_capacity, get_history_analytics, get_month_analytics,
    get_month_initialization_status, get_settings, get_startup_status, initialize_month,
    inspect_backup, list_exchange_rates, list_existing_months, list_monthly_items, list_plan_items,
    preview_month, preview_plan_item, restore_backup, save_settings, stop_plan_item,
    update_monthly_actual, update_monthly_note, update_plan_item, upsert_exchange_rate,
};
pub use service::FinanceService;
