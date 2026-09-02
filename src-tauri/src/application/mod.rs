mod analytics;
mod commands;
mod dto;
mod error;
mod service;

#[cfg(test)]
mod persistence_tests;

pub use commands::{
    calculate_budget_projection, create_actual_entry, create_manual_monthly_item, create_plan_item,
    delete_actual_entry, delete_exchange_rate, delete_manual_monthly_item, delete_plan_item,
    ensure_actual_only_monthly_item, ensure_default_settings, get_budget_projection,
    get_domain_contract, get_history_analytics, get_month_analytics,
    get_month_initialization_status, get_settings, get_startup_status, import_reference_rates,
    initialize_month, list_actual_entries, list_exchange_rates, list_existing_months,
    list_monthly_items, list_plan_items, preview_month, preview_plan_item, save_settings,
    stop_plan_item, update_actual_entry, update_monthly_note, update_plan_item,
    upsert_exchange_rate,
};
pub use service::FinanceService;
