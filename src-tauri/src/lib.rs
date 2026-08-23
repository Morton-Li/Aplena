mod application;

use application::{calculate_capacity, get_domain_contract, preview_plan_item};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_domain_contract,
            preview_plan_item,
            calculate_capacity
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aplena");
}
