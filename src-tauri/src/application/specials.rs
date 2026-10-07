use std::{collections::BTreeMap, str::FromStr};

use pfcm_domain::{
    Amount, Category, CurrencyCode, FlowType, MonthlyItem, MonthlyItemSource, YearMonth,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqliteConnection};
use uuid::Uuid;

use crate::infrastructure::{Store, StoreError, StoredMonthlyItem};

use super::{
    dto::{ActualEntryDto, ActualEntryInputDto},
    error::AppError,
    service::{
        FinanceService, actual_entry_dto, current_natural_month, parse_actual_entry, parse_month,
        parse_uuid, timestamp,
    },
};

const EXPENSE_CATEGORIES: [Category; 3] = [
    Category::EssentialExpense,
    Category::FixedCommitmentExpense,
    Category::DiscretionaryBudget,
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialProjectInputDto {
    pub id: Option<String>,
    pub name: String,
    pub total_budget: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSpecialProjectInputDto {
    pub id: String,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialProjectDto {
    pub id: String,
    pub name: String,
    pub total_budget: String,
    pub allocated_budget: String,
    pub unallocated_budget: String,
    pub actual_net_amount: Option<String>,
    pub remaining_budget: String,
    pub currency: String,
    pub archived: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAllocationInputDto {
    pub id: Option<String>,
    pub project_id: String,
    pub month: String,
    pub category: String,
    pub amount: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialAllocationDto {
    pub id: String,
    pub project_id: String,
    pub month: String,
    pub category: String,
    pub amount: String,
    pub frozen: bool,
    pub monthly_item_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialActualEntryInputDto {
    pub project_id: String,
    pub month: String,
    pub category: String,
    pub occurred_on: String,
    pub effect: String,
    pub amount: String,
    pub currency: String,
    pub exchange_rate: String,
    pub exchange_rate_source: String,
    pub exchange_rate_observed_on: String,
    pub note: Option<String>,
    pub detail_group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialActualEntryDto {
    #[serde(flatten)]
    pub entry: ActualEntryDto,
    pub month: String,
    pub category: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialMonthTotalDto {
    pub month: String,
    pub planned_amount: String,
    pub actual_net_amount: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialDetailGroupTotalDto {
    pub detail_group: Option<String>,
    pub actual_net_amount: String,
    pub entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpecialProjectDetailDto {
    pub project: SpecialProjectDto,
    pub allocations: Vec<SpecialAllocationDto>,
    pub entries: Vec<SpecialActualEntryDto>,
    pub monthly_totals: Vec<SpecialMonthTotalDto>,
    pub detail_group_totals: Vec<SpecialDetailGroupTotalDto>,
}

#[derive(Debug)]
struct ProjectRecord {
    id: Uuid,
    name: String,
    total_budget: Amount,
    currency: CurrencyCode,
    archived: bool,
    note: Option<String>,
    created_at: String,
    updated_at: String,
}

impl FinanceService {
    pub async fn list_special_projects(&self) -> Result<Vec<SpecialProjectDto>, AppError> {
        let _operation = self.operation_gate.read().await;
        let store = self.current_store().await;
        let mut transaction = store.pool().begin().await.map_err(database_error)?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM special_projects ORDER BY archived, updated_at DESC, id",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let mut projects = Vec::with_capacity(ids.len());
        for id in ids {
            projects.push(project_dto_on(&mut transaction, persisted_uuid(&id)?).await?);
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(projects)
    }

    pub async fn save_special_project(
        &self,
        input: SpecialProjectInputDto,
    ) -> Result<SpecialProjectDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let name = input.name.trim().to_owned();
        if name.is_empty() {
            return Err(AppError::validation(
                "EMPTY_SPECIAL_PROJECT_NAME",
                "name",
                "error.empty_special_project_name",
            ));
        }
        let total_budget = parse_amount(&input.total_budget, "totalBudget")?;
        let note = normalized_optional(input.note);
        let supplied_id = input
            .id
            .as_deref()
            .map(|id| parse_uuid(id, "id"))
            .transpose()?;
        let id = supplied_id.unwrap_or_else(Uuid::new_v4);
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let settings = Store::get_settings_on(&mut transaction)
            .await
            .map_err(AppError::from)?
            .ok_or_else(setup_required)?;
        let now = timestamp();
        if supplied_id.is_some() {
            let existing = project_record_on(&mut transaction, id).await?;
            require_project_currency(&existing, settings.value.base_currency())?;
            let allocated = allocated_amount_on(&mut transaction, id, None).await?;
            require_budget_capacity(total_budget, allocated)?;
            sqlx::query(
                "UPDATE special_projects SET name = ?, total_budget_scaled = ?, note = ?, \
                 updated_at = ? WHERE id = ?",
            )
            .bind(name)
            .bind(total_budget.scaled_i64())
            .bind(note)
            .bind(now)
            .bind(id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        } else {
            sqlx::query(
                "INSERT INTO special_projects \
                 (id, name, total_budget_scaled, currency_code, archived, note, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
            )
            .bind(id.to_string())
            .bind(name)
            .bind(total_budget.scaled_i64())
            .bind(settings.value.base_currency().as_str())
            .bind(note)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        let result = project_dto_on(&mut transaction, id).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn archive_special_project(
        &self,
        input: ArchiveSpecialProjectInputDto,
    ) -> Result<SpecialProjectDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let id = parse_uuid(&input.id, "id")?;
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        project_record_on(&mut transaction, id).await?;
        sqlx::query("UPDATE special_projects SET archived = ?, updated_at = ? WHERE id = ?")
            .bind(i64::from(input.archived))
            .bind(timestamp())
            .bind(id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        let result = project_dto_on(&mut transaction, id).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn get_special_project(
        &self,
        id: String,
    ) -> Result<SpecialProjectDetailDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let id = parse_uuid(&id, "id")?;
        let store = self.current_store().await;
        let mut transaction = store.pool().begin().await.map_err(database_error)?;
        let project = project_dto_on(&mut transaction, id).await?;
        let allocations = list_allocations_on(&mut transaction, id).await?;
        let entry_rows = sqlx::query(
            "SELECT e.id, m.month, m.category FROM actual_entries e \
             JOIN monthly_items m ON m.id = e.monthly_item_id \
             WHERE m.source_special_project_id = ? ORDER BY e.occurred_on, e.created_at, e.id",
        )
        .bind(id.to_string())
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let mut entries = Vec::with_capacity(entry_rows.len());
        for row in entry_rows {
            let entry_id =
                persisted_uuid(&row.try_get::<String, _>("id").map_err(database_error)?)?;
            let entry = Store::get_actual_entry_on(&mut transaction, entry_id)
                .await
                .map_err(AppError::from)?;
            entries.push(SpecialActualEntryDto {
                entry: actual_entry_dto(entry),
                month: persisted_month(
                    &row.try_get::<String, _>("month").map_err(database_error)?,
                )?
                .to_string(),
                category: row.try_get("category").map_err(database_error)?,
            });
        }
        let (monthly_totals, detail_group_totals) = detail_totals(&allocations, &entries)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(SpecialProjectDetailDto {
            project,
            allocations,
            entries,
            monthly_totals,
            detail_group_totals,
        })
    }

    pub async fn save_special_allocation(
        &self,
        input: SpecialAllocationInputDto,
    ) -> Result<SpecialAllocationDto, AppError> {
        let _operation = self.operation_gate.read().await;
        self.save_special_allocation_unlocked(input, current_natural_month()?)
            .await
    }

    pub(crate) async fn save_special_allocation_unlocked(
        &self,
        input: SpecialAllocationInputDto,
        current_month: YearMonth,
    ) -> Result<SpecialAllocationDto, AppError> {
        let project_id = parse_uuid(&input.project_id, "projectId")?;
        let month = parse_month(&input.month, "month")?;
        let category = parse_expense_category(&input.category)?;
        let amount = parse_amount(&input.amount, "amount")?;
        let supplied_id = input
            .id
            .as_deref()
            .map(|id| parse_uuid(id, "id"))
            .transpose()?;
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let project = project_record_on(&mut transaction, project_id).await?;
        require_open_project(&project)?;
        let existing = if let Some(id) = supplied_id {
            Some(allocation_on(&mut transaction, id).await?)
        } else {
            allocation_by_key_on(&mut transaction, project_id, month, category).await?
        };
        if let Some(existing) = &existing {
            if existing.project_id != project_id.to_string() {
                return Err(AppError::validation(
                    "SPECIAL_ALLOCATION_REPARENT_FORBIDDEN",
                    "projectId",
                    "error.special_allocation_reparent_forbidden",
                ));
            }
            let unchanged = existing.month == month.to_string()
                && existing.category == category.code()
                && existing.amount == amount.decimal_string();
            if unchanged {
                transaction.commit().await.map_err(database_error)?;
                return Ok(existing.clone());
            }
            if existing.frozen {
                return Err(frozen_allocation());
            }
            if parse_month(&existing.month, "month")? <= current_month {
                return Err(frozen_allocation());
            }
        }
        if month < current_month {
            return Err(AppError::validation(
                "HISTORICAL_SPECIAL_ALLOCATION_FORBIDDEN",
                "month",
                "error.historical_special_allocation_forbidden",
            ));
        }
        if let Some(target) =
            allocation_by_key_on(&mut transaction, project_id, month, category).await?
            && existing
                .as_ref()
                .is_none_or(|existing| existing.id != target.id)
        {
            return Err(AppError::business(
                "SPECIAL_ALLOCATION_ALREADY_EXISTS",
                "error.special_allocation_already_exists",
            ));
        }
        let id = existing
            .as_ref()
            .map(|existing| persisted_uuid(&existing.id))
            .transpose()?
            .unwrap_or_else(Uuid::new_v4);
        let allocated_elsewhere =
            allocated_amount_on(&mut transaction, project_id, Some(id)).await?;
        let allocated = checked_add(allocated_elsewhere, amount.as_decimal())?;
        require_budget_capacity(project.total_budget, allocated)?;
        let now = timestamp();
        if existing.is_some() {
            sqlx::query(
                "UPDATE special_allocations SET month = ?, category = ?, amount_scaled = ?, \
                 updated_at = ? WHERE id = ?",
            )
            .bind(month.database_anchor())
            .bind(category.code())
            .bind(amount.scaled_i64())
            .bind(&now)
            .bind(id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        } else {
            sqlx::query(
                "INSERT INTO special_allocations \
                 (id, project_id, month, category, amount_scaled, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id.to_string())
            .bind(project_id.to_string())
            .bind(month.database_anchor())
            .bind(category.code())
            .bind(amount.scaled_i64())
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        }
        if month == current_month {
            ensure_special_container_on(
                &mut transaction,
                &project,
                month,
                category,
                Some((id, amount)),
                &now,
            )
            .await?;
        }
        let result = allocation_on(&mut transaction, id).await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn delete_special_allocation(&self, id: String) -> Result<(), AppError> {
        let _operation = self.operation_gate.read().await;
        self.delete_special_allocation_unlocked(id, current_natural_month()?)
            .await
    }

    pub(crate) async fn delete_special_allocation_unlocked(
        &self,
        id: String,
        current_month: YearMonth,
    ) -> Result<(), AppError> {
        let id = parse_uuid(&id, "id")?;
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let allocation = allocation_on(&mut transaction, id).await?;
        let project =
            project_record_on(&mut transaction, persisted_uuid(&allocation.project_id)?).await?;
        require_open_project(&project)?;
        if allocation.frozen || parse_month(&allocation.month, "month")? <= current_month {
            return Err(frozen_allocation());
        }
        sqlx::query("DELETE FROM special_allocations WHERE id = ?")
            .bind(id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn create_special_actual_entry(
        &self,
        input: SpecialActualEntryInputDto,
    ) -> Result<ActualEntryDto, AppError> {
        let _operation = self.operation_gate.read().await;
        let project_id = parse_uuid(&input.project_id, "projectId")?;
        let month = parse_month(&input.month, "month")?;
        let category = parse_expense_category(&input.category)?;
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let project = project_record_on(&mut transaction, project_id).await?;
        // Archiving organizes projects; it must not prevent explicit late financial facts.
        let allocation = allocation_by_key_on(&mut transaction, project_id, month, category)
            .await?
            .map(|allocation| {
                Ok::<_, AppError>((
                    persisted_uuid(&allocation.id)?,
                    parse_amount(&allocation.amount, "amount")?,
                ))
            })
            .transpose()?;
        let now = timestamp();
        let monthly = ensure_special_container_on(
            &mut transaction,
            &project,
            month,
            category,
            allocation,
            &now,
        )
        .await?;
        let (entry, exchange_snapshot) = parse_actual_entry(
            ActualEntryInputDto {
                id: None,
                monthly_item_id: monthly.value.id().to_string(),
                occurred_on: input.occurred_on,
                effect: input.effect,
                amount: input.amount,
                currency: input.currency,
                exchange_rate: input.exchange_rate,
                exchange_rate_source: input.exchange_rate_source,
                exchange_rate_observed_on: input.exchange_rate_observed_on,
                note: input.note,
                detail_group: normalized_optional(input.detail_group),
            },
            Uuid::new_v4(),
            monthly.value.month(),
            monthly.value.currency(),
        )?;
        Store::insert_actual_entry_on(&mut transaction, &entry, &exchange_snapshot, &now)
            .await
            .map_err(AppError::from)?;
        let stored = Store::get_actual_entry_on(&mut transaction, entry.id())
            .await
            .map_err(AppError::from)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(actual_entry_dto(stored))
    }

    /// Called under the caller's operation gate. All snapshots in this month are atomic.
    pub(crate) async fn initialize_special_month_unlocked(
        &self,
        month: YearMonth,
    ) -> Result<u64, AppError> {
        let store = self.current_store().await;
        let mut transaction = store
            .pool()
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(database_error)?;
        let allocations = sqlx::query(
            "SELECT id, project_id, category, amount_scaled FROM special_allocations \
             WHERE month = ? ORDER BY project_id, category",
        )
        .bind(month.database_anchor())
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let mut created = 0_u64;
        let now = timestamp();
        for row in allocations {
            let project_id = persisted_uuid(
                &row.try_get::<String, _>("project_id")
                    .map_err(database_error)?,
            )?;
            let project = project_record_on(&mut transaction, project_id).await?;
            let category = parse_expense_category(
                &row.try_get::<String, _>("category")
                    .map_err(database_error)?,
            )?;
            let existing = Store::get_monthly_item_by_special_month_on(
                &mut transaction,
                project_id,
                month,
                category,
            )
            .await
            .map_err(AppError::from)?;
            if existing
                .as_ref()
                .is_some_and(|item| item.value.item_source() == MonthlyItemSource::Planned)
            {
                continue;
            }
            let allocation_id =
                persisted_uuid(&row.try_get::<String, _>("id").map_err(database_error)?)?;
            let amount = persisted_amount(row.try_get("amount_scaled").map_err(database_error)?)?;
            ensure_special_container_on(
                &mut transaction,
                &project,
                month,
                category,
                Some((allocation_id, amount)),
                &now,
            )
            .await?;
            created += 1;
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(created)
    }

    /// Nominal allocations, never periodic monthly equivalents or the whole project cap.
    pub(crate) async fn special_month_projection_unlocked(
        &self,
        month: YearMonth,
    ) -> Result<[(Category, Amount); 3], AppError> {
        let store = self.current_store().await;
        let mut transaction = store.pool().begin().await.map_err(database_error)?;
        let settings = Store::get_settings_on(&mut transaction)
            .await
            .map_err(AppError::from)?
            .ok_or_else(setup_required)?;
        let rows = sqlx::query(
            "SELECT a.category, p.currency_code, \
                 CASE WHEN m.item_source = 'PLANNED' THEN m.planned_amount_scaled \
                      ELSE a.amount_scaled END AS amount_scaled \
             FROM special_allocations a JOIN special_projects p ON p.id = a.project_id \
             LEFT JOIN monthly_items m ON m.source_special_project_id = a.project_id \
                 AND m.month = a.month AND m.category = a.category \
             WHERE a.month = ? ORDER BY a.project_id, a.category",
        )
        .bind(month.database_anchor())
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let mut totals = EXPENSE_CATEGORIES.map(|category| (category, Amount::zero()));
        for row in rows {
            let currency = CurrencyCode::new(
                row.try_get::<String, _>("currency_code")
                    .map_err(database_error)?,
            )
            .map_err(|error| AppError::from_domain(error, None))?;
            if &currency != settings.value.base_currency() {
                return Err(project_currency_mismatch());
            }
            let category = parse_expense_category(
                &row.try_get::<String, _>("category")
                    .map_err(database_error)?,
            )?;
            let amount = persisted_amount(row.try_get("amount_scaled").map_err(database_error)?)?;
            if let Some((_, total)) = totals.iter_mut().find(|(code, _)| *code == category) {
                *total = total
                    .checked_add(amount)
                    .map_err(|error| AppError::from_domain(error, None))?;
            }
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(totals)
    }
}

async fn project_record_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<ProjectRecord, AppError> {
    let row = sqlx::query(
        "SELECT id, name, total_budget_scaled, currency_code, archived, note, created_at, updated_at \
         FROM special_projects WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_one(&mut *connection)
    .await
    .map_err(database_error)?;
    Ok(ProjectRecord {
        id,
        name: row.try_get("name").map_err(database_error)?,
        total_budget: persisted_amount(
            row.try_get("total_budget_scaled").map_err(database_error)?,
        )?,
        currency: CurrencyCode::new(
            row.try_get::<String, _>("currency_code")
                .map_err(database_error)?,
        )
        .map_err(|error| AppError::from_domain(error, None))?,
        archived: row.try_get::<i64, _>("archived").map_err(database_error)? != 0,
        note: row.try_get("note").map_err(database_error)?,
        created_at: row.try_get("created_at").map_err(database_error)?,
        updated_at: row.try_get("updated_at").map_err(database_error)?,
    })
}

async fn project_dto_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<SpecialProjectDto, AppError> {
    let project = project_record_on(connection, id).await?;
    let allocated = allocated_amount_on(connection, id, None).await?;
    let actual_rows = sqlx::query(
        "SELECT e.amount_scaled, e.effect FROM actual_entries e \
         JOIN monthly_items m ON m.id = e.monthly_item_id \
         WHERE m.source_special_project_id = ?",
    )
    .bind(id.to_string())
    .fetch_all(&mut *connection)
    .await
    .map_err(database_error)?;
    let mut actual = Decimal::ZERO;
    for row in &actual_rows {
        let amount: i64 = row.try_get("amount_scaled").map_err(database_error)?;
        let effect: String = row.try_get("effect").map_err(database_error)?;
        actual = checked_add(actual, signed_decimal(amount, &effect))?;
    }
    let total_budget = project.total_budget.as_decimal();
    Ok(SpecialProjectDto {
        id: project.id.to_string(),
        name: project.name,
        total_budget: project.total_budget.decimal_string(),
        allocated_budget: money(allocated),
        unallocated_budget: money(checked_sub(total_budget, allocated)?),
        actual_net_amount: (!actual_rows.is_empty()).then(|| money(actual)),
        remaining_budget: money(checked_sub(total_budget, actual)?),
        currency: project.currency.to_string(),
        archived: project.archived,
        note: project.note,
        created_at: project.created_at,
        updated_at: project.updated_at,
    })
}

async fn allocated_amount_on(
    connection: &mut SqliteConnection,
    project_id: Uuid,
    exclude_id: Option<Uuid>,
) -> Result<Decimal, AppError> {
    let amounts: Vec<i64> = sqlx::query_scalar(
        "SELECT amount_scaled FROM special_allocations WHERE project_id = ? \
         AND (? IS NULL OR id != ?)",
    )
    .bind(project_id.to_string())
    .bind(exclude_id.map(|id| id.to_string()))
    .bind(exclude_id.map(|id| id.to_string()))
    .fetch_all(&mut *connection)
    .await
    .map_err(database_error)?;
    amounts.into_iter().try_fold(Decimal::ZERO, |sum, amount| {
        checked_add(sum, Decimal::new(amount, 2))
    })
}

const ALLOCATION_SELECT: &str = "SELECT a.id, a.project_id, a.month, a.category, a.amount_scaled, m.id AS monthly_item_id, \
     CASE WHEN m.item_source = 'PLANNED' THEN 1 ELSE 0 END AS frozen \
     FROM special_allocations a LEFT JOIN monthly_items m \
     ON m.source_special_project_id = a.project_id AND m.month = a.month AND m.category = a.category";

async fn allocation_on(
    connection: &mut SqliteConnection,
    id: Uuid,
) -> Result<SpecialAllocationDto, AppError> {
    let mut query = QueryBuilder::<Sqlite>::new(ALLOCATION_SELECT);
    query.push(" WHERE a.id = ?");
    let row = query
        .build()
        .bind(id.to_string())
        .fetch_one(&mut *connection)
        .await
        .map_err(database_error)?;
    allocation_from_row(&row)
}

async fn allocation_by_key_on(
    connection: &mut SqliteConnection,
    project_id: Uuid,
    month: YearMonth,
    category: Category,
) -> Result<Option<SpecialAllocationDto>, AppError> {
    let mut query = QueryBuilder::<Sqlite>::new(ALLOCATION_SELECT);
    query.push(" WHERE a.project_id = ? AND a.month = ? AND a.category = ?");
    let row = query
        .build()
        .bind(project_id.to_string())
        .bind(month.database_anchor())
        .bind(category.code())
        .fetch_optional(&mut *connection)
        .await
        .map_err(database_error)?;
    row.as_ref().map(allocation_from_row).transpose()
}

async fn list_allocations_on(
    connection: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Vec<SpecialAllocationDto>, AppError> {
    let mut query = QueryBuilder::<Sqlite>::new(ALLOCATION_SELECT);
    query.push(" WHERE a.project_id = ? ORDER BY a.month, a.category, a.id");
    let rows = query
        .build()
        .bind(project_id.to_string())
        .fetch_all(&mut *connection)
        .await
        .map_err(database_error)?;
    rows.iter().map(allocation_from_row).collect()
}

fn allocation_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<SpecialAllocationDto, AppError> {
    Ok(SpecialAllocationDto {
        id: row.try_get("id").map_err(database_error)?,
        project_id: row.try_get("project_id").map_err(database_error)?,
        month: persisted_month(&row.try_get::<String, _>("month").map_err(database_error)?)?
            .to_string(),
        category: row.try_get("category").map_err(database_error)?,
        amount: persisted_amount(row.try_get("amount_scaled").map_err(database_error)?)?
            .decimal_string(),
        frozen: row.try_get::<i64, _>("frozen").map_err(database_error)? != 0,
        monthly_item_id: row.try_get("monthly_item_id").map_err(database_error)?,
    })
}

async fn ensure_special_container_on(
    connection: &mut SqliteConnection,
    project: &ProjectRecord,
    month: YearMonth,
    category: Category,
    allocation: Option<(Uuid, Amount)>,
    now: &str,
) -> Result<StoredMonthlyItem, AppError> {
    let existing =
        Store::get_monthly_item_by_special_month_on(connection, project.id, month, category)
            .await
            .map_err(AppError::from)?;
    if let Some(existing) = &existing {
        if existing.value.currency() != &project.currency {
            return Err(project_currency_mismatch());
        }
        if existing.value.item_source() == MonthlyItemSource::Planned || allocation.is_none() {
            return Ok(existing.clone());
        }
    }
    let settings = Store::get_settings_on(connection)
        .await
        .map_err(AppError::from)?
        .ok_or_else(setup_required)?;
    require_project_currency(project, settings.value.base_currency())?;
    let (allocation_id, planned_amount) = allocation
        .map(|(id, amount)| (Some(id), amount))
        .unwrap_or((None, Amount::zero()));
    let monthly = MonthlyItem::special_project(
        existing
            .as_ref()
            .map(|existing| existing.value.id())
            .unwrap_or_else(Uuid::new_v4),
        project.id,
        allocation_id,
        project.name.clone(),
        month,
        category,
        planned_amount,
        project.currency.clone(),
        project.note.clone(),
    )
    .map_err(|error| AppError::from_domain(error, None))?;
    Store::insert_monthly_item_on(connection, &monthly, now)
        .await
        .map_err(AppError::from)?;
    Store::get_monthly_item_by_special_month_on(connection, project.id, month, category)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::business("NOT_FOUND", "error.not_found"))
}

fn detail_totals(
    allocations: &[SpecialAllocationDto],
    entries: &[SpecialActualEntryDto],
) -> Result<(Vec<SpecialMonthTotalDto>, Vec<SpecialDetailGroupTotalDto>), AppError> {
    let mut months = BTreeMap::<String, (Decimal, Option<Decimal>)>::new();
    let mut groups = BTreeMap::<Option<String>, (Decimal, u64)>::new();
    for allocation in allocations {
        let total = months
            .entry(allocation.month.clone())
            .or_insert((Decimal::ZERO, None));
        total.0 = checked_add(
            total.0,
            parse_amount(&allocation.amount, "amount")?.as_decimal(),
        )?;
    }
    for entry in entries {
        let actual = parse_amount(&entry.entry.amount, "amount")?.as_decimal();
        let actual = if entry.entry.effect == "DECREASE" {
            -actual
        } else {
            actual
        };
        let month = months
            .entry(entry.month.clone())
            .or_insert((Decimal::ZERO, None));
        month.1 = Some(checked_add(month.1.unwrap_or(Decimal::ZERO), actual)?);
        let group = groups.entry(entry.entry.detail_group.clone()).or_default();
        group.0 = checked_add(group.0, actual)?;
        group.1 += 1;
    }
    Ok((
        months
            .into_iter()
            .map(|(month, (planned, actual))| SpecialMonthTotalDto {
                month,
                planned_amount: money(planned),
                actual_net_amount: actual.map(money),
            })
            .collect(),
        groups
            .into_iter()
            .map(
                |(detail_group, (actual, entry_count))| SpecialDetailGroupTotalDto {
                    detail_group,
                    actual_net_amount: money(actual),
                    entry_count,
                },
            )
            .collect(),
    ))
}

fn require_budget_capacity(total_budget: Amount, allocated: Decimal) -> Result<(), AppError> {
    if allocated > total_budget.as_decimal() {
        return Err(AppError::validation(
            "SPECIAL_BUDGET_EXCEEDED_BY_ALLOCATIONS",
            "amount",
            "error.special_budget_exceeded_by_allocations",
        ));
    }
    Ok(())
}

fn require_open_project(project: &ProjectRecord) -> Result<(), AppError> {
    if project.archived {
        Err(AppError::business(
            "SPECIAL_PROJECT_ARCHIVED",
            "error.special_project_archived",
        ))
    } else {
        Ok(())
    }
}

fn require_project_currency(project: &ProjectRecord, base: &CurrencyCode) -> Result<(), AppError> {
    if &project.currency == base {
        Ok(())
    } else {
        Err(project_currency_mismatch())
    }
}

fn parse_expense_category(value: &str) -> Result<Category, AppError> {
    let category = Category::from_str(value)
        .map_err(|error| AppError::from_domain(error, Some("category")))?;
    if category.flow_type() != FlowType::Expense {
        return Err(AppError::validation(
            "SPECIAL_EXPENSE_CATEGORY_REQUIRED",
            "category",
            "error.special_expense_category_required",
        ));
    }
    Ok(category)
}

fn parse_amount(value: &str, field: &str) -> Result<Amount, AppError> {
    Amount::from_str(value).map_err(|error| AppError::from_domain(error, Some(field)))
}

fn persisted_amount(value: i64) -> Result<Amount, AppError> {
    Amount::from_scaled_i64(value).map_err(|error| AppError::from_domain(error, None))
}

fn persisted_uuid(value: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value).map_err(|_| AppError::from(StoreError::InvalidUuid))
}

fn persisted_month(value: &str) -> Result<YearMonth, AppError> {
    YearMonth::from_database_anchor(value).map_err(|error| AppError::from_domain(error, None))
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn signed_decimal(amount: i64, effect: &str) -> Decimal {
    let amount = Decimal::new(amount, 2);
    if effect == "DECREASE" {
        -amount
    } else {
        amount
    }
}

fn checked_add(left: Decimal, right: Decimal) -> Result<Decimal, AppError> {
    left.checked_add(right).ok_or_else(arithmetic_overflow)
}

fn checked_sub(left: Decimal, right: Decimal) -> Result<Decimal, AppError> {
    left.checked_sub(right).ok_or_else(arithmetic_overflow)
}

fn money(value: Decimal) -> String {
    format!("{value:.2}")
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::from(StoreError::from(error))
}

fn setup_required() -> AppError {
    AppError::business("SETUP_REQUIRED", "error.setup_required")
}

fn frozen_allocation() -> AppError {
    AppError::business(
        "SPECIAL_ALLOCATION_FROZEN",
        "error.special_allocation_frozen",
    )
}

fn project_currency_mismatch() -> AppError {
    AppError::business("BASE_CURRENCY_MISMATCH", "error.base_currency_mismatch")
}

fn arithmetic_overflow() -> AppError {
    AppError::business("ARITHMETIC_OVERFLOW", "error.arithmetic_overflow")
}
