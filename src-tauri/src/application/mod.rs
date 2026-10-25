mod analytics;
mod automatic;
mod commands;
mod dto;
mod error;
mod loans;
#[cfg(test)]
mod loans_tests;
mod service;
mod specials;

pub use loans::{
    create_loan, delete_loan_payment, get_loan, get_loan_month_summary, list_loans,
    preview_loan_payment, preview_loan_schedule, save_loan_payment, save_loan_schedule,
    update_loan_metadata,
};

#[cfg(test)]
mod automatic_tests;

#[cfg(test)]
mod specials_tests;

#[cfg(test)]
mod persistence_tests;

pub use commands::{
    archive_special_project, check_automatic_entries, create_special_actual_entry,
    delete_special_allocation, get_special_project, list_automatic_entry_policies,
    list_automatic_occurrences, list_special_projects, resolve_automatic_entry_conflict,
    save_automatic_entry_policy, save_special_allocation, save_special_project,
};
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
