use pfcm_domain::YearMonth;

use super::{
    service::FinanceService,
    specials::{
        ArchiveSpecialProjectInputDto, SpecialActualEntryInputDto, SpecialAllocationInputDto,
        SpecialProjectDto, SpecialProjectInputDto,
    },
};

use crate::{
    application::dto::{ActualEntryInputDto, ExchangeRateUpsertDto, SettingsInputDto},
    infrastructure::open_memory_database,
};

async fn service() -> FinanceService {
    let service = FinanceService::new(open_memory_database().await.unwrap()).unwrap();
    service
        .save_settings(SettingsInputDto {
            base_currency: "CNY".to_owned(),
            auto_update_exchange_rates: false,
        })
        .await
        .unwrap();
    service
}

fn month(value: &str) -> YearMonth {
    value.parse().unwrap()
}

async fn project(service: &FinanceService, budget: &str) -> SpecialProjectDto {
    service
        .save_special_project(SpecialProjectInputDto {
            id: None,
            name: "旅行".to_owned(),
            total_budget: budget.to_owned(),
            note: None,
        })
        .await
        .unwrap()
}

fn allocation(
    project: &SpecialProjectDto,
    month: &str,
    category: &str,
    amount: &str,
) -> SpecialAllocationInputDto {
    SpecialAllocationInputDto {
        id: None,
        project_id: project.id.clone(),
        month: month.to_owned(),
        category: category.to_owned(),
        amount: amount.to_owned(),
    }
}

fn actual(
    project: &SpecialProjectDto,
    month: &str,
    category: &str,
    effect: &str,
    amount: &str,
    group: Option<&str>,
) -> SpecialActualEntryInputDto {
    SpecialActualEntryInputDto {
        project_id: project.id.clone(),
        month: month.to_owned(),
        category: category.to_owned(),
        occurred_on: format!("{month}-10"),
        effect: effect.to_owned(),
        amount: amount.to_owned(),
        currency: "CNY".to_owned(),
        exchange_rate: "1.00000000".to_owned(),
        exchange_rate_source: "BASE_CURRENCY".to_owned(),
        exchange_rate_observed_on: format!("{month}-10"),
        note: None,
        detail_group: group.map(str::to_owned),
    }
}

#[tokio::test]
async fn distinguishes_absent_actual_from_a_recorded_zero_net_and_unallocated_budget() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    assert_eq!(project.allocated_budget, "0.00");
    assert_eq!(project.unallocated_budget, "1000.00");
    assert_eq!(project.actual_net_amount, None);
    assert_eq!(project.remaining_budget, "1000.00");

    for effect in ["INCREASE", "DECREASE"] {
        service
            .create_special_actual_entry(actual(
                &project,
                "2026-06",
                "ESSENTIAL_EXPENSE",
                effect,
                "50.00",
                Some("  房屋  "),
            ))
            .await
            .unwrap();
    }
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.actual_net_amount.as_deref(), Some("0.00"));
    assert_eq!(detail.project.unallocated_budget, "1000.00");
    assert_eq!(detail.project.remaining_budget, "1000.00");
    assert_eq!(detail.entries.len(), 2);
    assert_eq!(
        detail.detail_group_totals[0].detail_group.as_deref(),
        Some("房屋")
    );
    assert_eq!(detail.detail_group_totals[0].actual_net_amount, "0.00");
    assert_eq!(detail.detail_group_totals[0].entry_count, 2);
    let monthly = service
        .list_monthly_items("2026-06".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly.len(), 1);
    assert_eq!(monthly[0].item_origin, "SPECIAL_PROJECT");
    assert_eq!(monthly[0].item_source, "ACTUAL_ONLY");
    assert_eq!(monthly[0].actual_amount.as_deref(), Some("0.00"));
    assert_eq!(monthly[0].actual_entry_count, 2);
    assert_eq!(monthly[0].variance_amount, None);
}

#[tokio::test]
async fn promotes_the_canonical_container_without_copying_actuals_or_plan_amounts() {
    let service = service().await;
    let project = project(&service, "3000.00").await;
    let entry = service
        .create_special_actual_entry(actual(
            &project,
            "2026-06",
            "ESSENTIAL_EXPENSE",
            "INCREASE",
            "600.00",
            Some("住宿"),
        ))
        .await
        .unwrap();
    let input = allocation(&project, "2026-06", "ESSENTIAL_EXPENSE", "1000.00");
    let saved = service
        .save_special_allocation_unlocked(input.clone(), month("2026-06"))
        .await
        .unwrap();
    assert!(saved.frozen);
    assert_eq!(
        saved.monthly_item_id.as_deref(),
        Some(entry.monthly_item_id.as_str())
    );
    let repeated = service
        .save_special_allocation_unlocked(input, month("2026-06"))
        .await
        .unwrap();
    assert_eq!(repeated, saved);
    assert_eq!(
        service
            .initialize_special_month_unlocked(month("2026-06"))
            .await
            .unwrap(),
        0
    );

    service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-06", "DISCRETIONARY_BUDGET", "1000.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    service
        .create_special_actual_entry(actual(
            &project,
            "2026-06",
            "DISCRETIONARY_BUDGET",
            "INCREASE",
            "800.00",
            Some("交通"),
        ))
        .await
        .unwrap();

    let monthly = service
        .list_monthly_items("2026-06".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly.len(), 2);
    let promoted = monthly
        .iter()
        .find(|item| item.id == entry.monthly_item_id)
        .unwrap();
    assert_eq!(promoted.item_source, "PLANNED");
    assert_eq!(promoted.source_plan_item_id, None);
    assert_eq!(
        promoted.source_special_project_id.as_deref(),
        Some(project.id.as_str())
    );
    assert_eq!(
        promoted.source_special_allocation_id.as_deref(),
        Some(saved.id.as_str())
    );
    assert_eq!(promoted.planned_amount, "1000.00");
    assert_eq!(promoted.actual_amount.as_deref(), Some("600.00"));
    assert_eq!(promoted.actual_entry_count, 1);

    let analytics = service.month_analytics("2026-06".to_owned()).await.unwrap();
    assert_eq!(analytics.expense.planned, "2000.00");
    assert_eq!(analytics.expense.actual_to_date.as_deref(), Some("1400.00"));
    assert_eq!(analytics.planned_item_count, 2);
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.allocated_budget, "2000.00");
    assert_eq!(detail.project.unallocated_budget, "1000.00");
    assert_eq!(detail.project.remaining_budget, "1600.00");
    assert_eq!(detail.entries.len(), 2);
    assert_eq!(detail.monthly_totals[0].planned_amount, "2000.00");
    assert_eq!(
        detail.monthly_totals[0].actual_net_amount.as_deref(),
        Some("1400.00")
    );
    let totals = service
        .special_month_projection_unlocked(month("2026-06"))
        .await
        .unwrap();
    assert_eq!(totals[0].1.decimal_string(), "1000.00");
    assert_eq!(totals[1].1.decimal_string(), "0.00");
    assert_eq!(totals[2].1.decimal_string(), "1000.00");
}

#[tokio::test]
async fn only_unmaterialized_future_allocations_can_change_or_be_deleted() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    let mut input = allocation(&project, "2026-07", "ESSENTIAL_EXPENSE", "700.00");
    let saved = service
        .save_special_allocation_unlocked(input.clone(), month("2026-06"))
        .await
        .unwrap();
    assert!(!saved.frozen);
    assert_eq!(saved.monthly_item_id, None);
    input.id = Some(saved.id.clone());
    input.amount = "600.00".to_owned();
    let changed = service
        .save_special_allocation_unlocked(input.clone(), month("2026-06"))
        .await
        .unwrap();
    assert_eq!(changed.id, saved.id);
    assert_eq!(changed.amount, "600.00");
    assert_eq!(
        service
            .initialize_special_month_unlocked(month("2026-07"))
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        service
            .initialize_special_month_unlocked(month("2026-07"))
            .await
            .unwrap(),
        0
    );
    input.amount = "500.00".to_owned();
    let error = service
        .save_special_allocation_unlocked(input, month("2026-06"))
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "SPECIAL_ALLOCATION_FROZEN");
    let error = service
        .delete_special_allocation_unlocked(saved.id.clone(), month("2026-06"))
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "SPECIAL_ALLOCATION_FROZEN");

    let deletable = service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-08", "DISCRETIONARY_BUDGET", "100.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    service
        .delete_special_allocation_unlocked(deletable.id, month("2026-06"))
        .await
        .unwrap();
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.allocations.len(), 1);
    assert_eq!(detail.project.allocated_budget, "600.00");
    let monthly = service
        .list_monthly_items("2026-07".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly[0].planned_amount, "600.00");
}

#[tokio::test]
async fn validates_cap_categories_history_and_allocation_ownership_before_writing() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    let saved = service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-07", "ESSENTIAL_EXPENSE", "700.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    let error = service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-07", "DISCRETIONARY_BUDGET", "400.00"),
            month("2026-06"),
        )
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "SPECIAL_BUDGET_EXCEEDED_BY_ALLOCATIONS");
    let error = service
        .save_special_project(SpecialProjectInputDto {
            id: Some(project.id.clone()),
            name: project.name.clone(),
            total_budget: "500.00".to_owned(),
            note: None,
        })
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "SPECIAL_BUDGET_EXCEEDED_BY_ALLOCATIONS");

    let other = service
        .save_special_project(SpecialProjectInputDto {
            id: None,
            name: "装修".to_owned(),
            total_budget: "1000.00".to_owned(),
            note: None,
        })
        .await
        .unwrap();
    let mut reparent = allocation(&other, "2026-07", "ESSENTIAL_EXPENSE", "700.00");
    reparent.id = Some(saved.id);
    assert_eq!(
        service
            .save_special_allocation_unlocked(reparent, month("2026-06"))
            .await
            .unwrap_err()
            .error_code,
        "SPECIAL_ALLOCATION_REPARENT_FORBIDDEN"
    );
    for category in ["FIXED_INCOME", "VARIABLE_INCOME"] {
        let error = service
            .save_special_allocation_unlocked(
                allocation(&project, "2026-08", category, "100.00"),
                month("2026-06"),
            )
            .await
            .unwrap_err();
        assert_eq!(error.error_code, "SPECIAL_EXPENSE_CATEGORY_REQUIRED");
    }
    assert_eq!(
        service
            .save_special_allocation_unlocked(
                allocation(&project, "2026-05", "ESSENTIAL_EXPENSE", "100.00"),
                month("2026-06"),
            )
            .await
            .unwrap_err()
            .error_code,
        "HISTORICAL_SPECIAL_ALLOCATION_FORBIDDEN"
    );
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.total_budget, "1000.00");
    assert_eq!(detail.project.allocated_budget, "700.00");
    assert_eq!(detail.allocations.len(), 1);
}

#[tokio::test]
async fn explicit_late_refunds_are_allowed_after_archive_without_releasing_allocations() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-06", "ESSENTIAL_EXPENSE", "800.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-08", "DISCRETIONARY_BUDGET", "100.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    service
        .create_special_actual_entry(actual(
            &project,
            "2026-06",
            "ESSENTIAL_EXPENSE",
            "INCREASE",
            "1200.00",
            Some("住宿"),
        ))
        .await
        .unwrap();
    let overrun = service
        .get_special_project(project.id.clone())
        .await
        .unwrap();
    assert_eq!(overrun.project.remaining_budget, "-200.00");
    service
        .archive_special_project(ArchiveSpecialProjectInputDto {
            id: project.id.clone(),
            archived: true,
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .save_special_allocation_unlocked(
                allocation(&project, "2026-09", "ESSENTIAL_EXPENSE", "50.00"),
                month("2026-06"),
            )
            .await
            .unwrap_err()
            .error_code,
        "SPECIAL_PROJECT_ARCHIVED"
    );
    let refund = service
        .create_special_actual_entry(actual(
            &project,
            "2026-07",
            "ESSENTIAL_EXPENSE",
            "DECREASE",
            "300.00",
            Some("住宿"),
        ))
        .await
        .unwrap();
    let detail = service
        .get_special_project(project.id.clone())
        .await
        .unwrap();
    assert!(detail.project.archived);
    assert_eq!(detail.project.actual_net_amount.as_deref(), Some("900.00"));
    assert_eq!(detail.project.allocated_budget, "900.00");
    assert_eq!(detail.project.unallocated_budget, "100.00");
    assert_eq!(detail.project.remaining_budget, "100.00");
    let june = service.month_analytics("2026-06".to_owned()).await.unwrap();
    let july = service.month_analytics("2026-07".to_owned()).await.unwrap();
    assert_eq!(june.expense.actual_to_date.as_deref(), Some("1200.00"));
    assert_eq!(july.expense.actual_to_date.as_deref(), Some("-300.00"));
    assert_eq!(july.expense.planned, "0.00");
    let july_item = service
        .list_monthly_items("2026-07".to_owned())
        .await
        .unwrap();
    assert_eq!(july_item[0].id, refund.monthly_item_id);
    assert_eq!(july_item[0].item_source, "ACTUAL_ONLY");
    assert_eq!(detail.monthly_totals[2].month, "2026-08");
    assert_eq!(detail.monthly_totals[2].actual_net_amount, None);
    assert_eq!(
        service
            .special_month_projection_unlocked(month("2026-08"))
            .await
            .unwrap()[2]
            .1
            .decimal_string(),
        "100.00"
    );
    assert_eq!(service.list_special_projects().await.unwrap().len(), 1);
}

#[tokio::test]
async fn failed_actual_creation_rolls_back_the_new_container_and_does_not_poison_the_pool() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    let mut invalid = actual(
        &project,
        "2026-06",
        "ESSENTIAL_EXPENSE",
        "INCREASE",
        "10.00",
        None,
    );
    invalid.occurred_on = "2026-07-10".to_owned();
    let error = service
        .create_special_actual_entry(invalid)
        .await
        .unwrap_err();
    assert_eq!(error.error_code, "ACTUAL_ENTRY_DATE_OUTSIDE_MONTH");
    assert!(
        service
            .list_monthly_items("2026-06".to_owned())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        service
            .get_special_project(project.id.clone())
            .await
            .unwrap()
            .entries
            .is_empty()
    );
    let valid = service
        .create_special_actual_entry(actual(
            &project,
            "2026-06",
            "ESSENTIAL_EXPENSE",
            "INCREASE",
            "10.00",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(valid.amount, "10.00");
    assert_eq!(
        service
            .list_monthly_items("2026-06".to_owned())
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn concurrent_writes_share_one_container_and_cannot_overallocate_the_cap() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    let (left, right) = tokio::join!(
        service.create_special_actual_entry(actual(
            &project,
            "2026-06",
            "ESSENTIAL_EXPENSE",
            "INCREASE",
            "20.00",
            None,
        )),
        service.create_special_actual_entry(actual(
            &project,
            "2026-06",
            "ESSENTIAL_EXPENSE",
            "INCREASE",
            "30.00",
            None,
        )),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_ne!(left.id, right.id);
    assert_eq!(left.monthly_item_id, right.monthly_item_id);
    let monthly = service
        .list_monthly_items("2026-06".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly.len(), 1);
    assert_eq!(monthly[0].actual_entry_count, 2);
    assert_eq!(monthly[0].actual_amount.as_deref(), Some("50.00"));

    let (left, right) = tokio::join!(
        service.save_special_allocation_unlocked(
            allocation(&project, "2026-07", "ESSENTIAL_EXPENSE", "700.00"),
            month("2026-06"),
        ),
        service.save_special_allocation_unlocked(
            allocation(&project, "2026-07", "DISCRETIONARY_BUDGET", "700.00"),
            month("2026-06"),
        ),
    );
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);
    let error = left.err().or_else(|| right.err()).unwrap();
    assert_eq!(error.error_code, "SPECIAL_BUDGET_EXCEEDED_BY_ALLOCATIONS");
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.allocated_budget, "700.00");
    assert_eq!(detail.project.unallocated_budget, "300.00");
    assert_eq!(detail.allocations.len(), 1);
}

#[tokio::test]
async fn preserves_foreign_exchange_snapshots_and_allows_group_edits_without_reparenting() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "7.00".to_owned(),
        })
        .await
        .unwrap();
    let mut input = actual(
        &project,
        "2026-06",
        "ESSENTIAL_EXPENSE",
        "INCREASE",
        "100.00",
        Some("酒店"),
    );
    input.currency = "USD".to_owned();
    input.exchange_rate = "7.00000000".to_owned();
    input.exchange_rate_source = "MANUAL".to_owned();
    let entry = service.create_special_actual_entry(input).await.unwrap();
    assert_eq!(entry.amount, "700.00");
    assert_eq!(entry.source_amount, "100.00");
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "8.00".to_owned(),
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .get_special_project(project.id.clone())
            .await
            .unwrap()
            .project
            .actual_net_amount
            .as_deref(),
        Some("700.00")
    );
    let updated = service
        .update_actual_entry(ActualEntryInputDto {
            id: Some(entry.id.clone()),
            monthly_item_id: entry.monthly_item_id.clone(),
            occurred_on: "2026-06-11".to_owned(),
            effect: "INCREASE".to_owned(),
            amount: "50.00".to_owned(),
            currency: "EUR".to_owned(),
            exchange_rate: "99.00".to_owned(),
            exchange_rate_source: "MANUAL".to_owned(),
            exchange_rate_observed_on: "2026-06-11".to_owned(),
            note: Some("修正金额".to_owned()),
            detail_group: Some("住宿".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(updated.amount, "350.00");
    assert_eq!(updated.source_currency, "USD");
    assert_eq!(updated.exchange_rate, "7.00000000");
    assert_eq!(updated.exchange_rate_observed_on, "2026-06-10");
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.actual_net_amount.as_deref(), Some("350.00"));
    assert_eq!(
        detail.detail_group_totals[0].detail_group.as_deref(),
        Some("住宿")
    );
    let json = serde_json::to_value(detail).unwrap();
    assert_eq!(json["entries"][0]["detail_group"], "住宿");
    assert_eq!(json["entries"][0]["month"], "2026-06");
    service.delete_actual_entry(entry.id).await.unwrap();
}

#[tokio::test]
async fn locks_the_project_currency_before_any_monthly_fact_and_keeps_snapshot_names_frozen() {
    let service = service().await;
    let project = project(&service, "1000.00").await;
    service
        .upsert_exchange_rate(ExchangeRateUpsertDto {
            currency: "USD".to_owned(),
            rate: "1.00".to_owned(),
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .save_settings(SettingsInputDto {
                base_currency: "USD".to_owned(),
                auto_update_exchange_rates: false
            })
            .await
            .unwrap_err()
            .error_code,
        "BASE_CURRENCY_LOCKED"
    );
    service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-08", "DISCRETIONARY_BUDGET", "700.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    service
        .initialize_special_month_unlocked(month("2026-08"))
        .await
        .unwrap();
    service
        .save_special_project(SpecialProjectInputDto {
            id: Some(project.id.clone()),
            name: "更名旅行".to_owned(),
            total_budget: "1200.00".to_owned(),
            note: Some("新备注".to_owned()),
        })
        .await
        .unwrap();
    let monthly = service
        .list_monthly_items("2026-08".to_owned())
        .await
        .unwrap();
    assert_eq!(monthly[0].item_name, "旅行");
    assert_eq!(monthly[0].planned_amount, "700.00");
    assert_eq!(monthly[0].category, "DISCRETIONARY_BUDGET");
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.name, "更名旅行");
    assert_eq!(detail.project.unallocated_budget, "500.00");
    assert_eq!(detail.allocations[0].category, "DISCRETIONARY_BUDGET");
}

#[tokio::test]
async fn zero_allocation_is_a_real_baseline_and_does_not_create_actual_facts() {
    let service = service().await;
    let project = project(&service, "0.00").await;
    let saved = service
        .save_special_allocation_unlocked(
            allocation(&project, "2026-06", "FIXED_COMMITMENT_EXPENSE", "0.00"),
            month("2026-06"),
        )
        .await
        .unwrap();
    assert!(saved.frozen);
    let report = service.month_analytics("2026-06".to_owned()).await.unwrap();
    assert_eq!(report.planned_item_count, 1);
    assert_eq!(report.expense.planned, "0.00");
    assert_eq!(report.expense.actual_to_date, None);
    let detail = service.get_special_project(project.id).await.unwrap();
    assert_eq!(detail.project.actual_net_amount, None);
    assert!(detail.entries.is_empty());
}
