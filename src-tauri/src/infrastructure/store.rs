use std::str::FromStr;

use pfcm_domain::{
    Amount, Category, CurrencyCode, ExchangeRate, FlowType, MonthlyItem, PlanItem, RecognitionMode,
    Settings, YearMonth,
};
use sqlx::{Row, Sqlite, SqliteConnection, SqlitePool, pool::PoolConnection};
use uuid::Uuid;

use super::{
    DeletePlanResult, StoreError, StoredExchangeRate, StoredMonthlyItem, StoredPlanItem,
    StoredSettings,
};

#[derive(Debug, Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    #[cfg(test)]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn acquire(&self) -> Result<PoolConnection<Sqlite>, StoreError> {
        Ok(self.pool.acquire().await?)
    }

    pub async fn get_settings(&self) -> Result<Option<StoredSettings>, StoreError> {
        let mut connection = self.acquire().await?;
        Self::get_settings_on(&mut connection).await
    }

    pub async fn create_settings(
        &self,
        settings: &Settings,
        timestamp: &str,
    ) -> Result<StoredSettings, StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO exchange_rates (currency_code, rate_scaled, updated_at) \
             VALUES (?, 100000000, ?) \
             ON CONFLICT(currency_code) DO UPDATE SET rate_scaled = 100000000, updated_at = excluded.updated_at",
        )
        .bind(settings.base_currency().as_str())
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO settings (id, target_month, base_currency_code, minimum_savings_rate_bp, created_at, updated_at) \
             VALUES (1, ?, ?, ?, ?, ?)",
        )
        .bind(settings.target_month().database_anchor())
        .bind(settings.base_currency().as_str())
        .bind(i64::from(settings.minimum_savings_rate().basis_points()))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.get_settings()
            .await?
            .ok_or(StoreError::Database(sqlx::Error::RowNotFound))
    }

    pub async fn update_settings(
        &self,
        settings: &Settings,
        timestamp: &str,
    ) -> Result<StoredSettings, StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO exchange_rates (currency_code, rate_scaled, updated_at) \
             VALUES (?, 100000000, ?) \
             ON CONFLICT(currency_code) DO NOTHING",
        )
        .bind(settings.base_currency().as_str())
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        let result = sqlx::query(
            "UPDATE settings \
             SET target_month = ?, base_currency_code = ?, minimum_savings_rate_bp = ?, updated_at = ? \
             WHERE id = 1",
        )
        .bind(settings.target_month().database_anchor())
        .bind(settings.base_currency().as_str())
        .bind(i64::from(settings.minimum_savings_rate().basis_points()))
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        require_changed(result.rows_affected())?;
        transaction.commit().await?;
        self.get_settings()
            .await?
            .ok_or(StoreError::Database(sqlx::Error::RowNotFound))
    }

    pub async fn list_exchange_rates(&self) -> Result<Vec<StoredExchangeRate>, StoreError> {
        let settings = self.get_settings().await?;
        let Some(settings) = settings else {
            return Ok(Vec::new());
        };
        let rows = sqlx::query(
            "SELECT e.currency_code, e.rate_scaled, e.updated_at, \
                    COUNT(p.id) AS plan_reference_count \
             FROM exchange_rates e \
             LEFT JOIN plan_items p ON p.currency_code = e.currency_code \
             GROUP BY e.currency_code, e.rate_scaled, e.updated_at \
             ORDER BY e.currency_code",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.iter()
            .map(|row| exchange_rate_from_row(row, settings.value.base_currency()))
            .collect()
    }

    pub async fn upsert_exchange_rate(
        &self,
        exchange_rate: &ExchangeRate,
        timestamp: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO exchange_rates (currency_code, rate_scaled, updated_at) \
             VALUES (?, ?, ?) \
             ON CONFLICT(currency_code) DO UPDATE \
             SET rate_scaled = excluded.rate_scaled, updated_at = excluded.updated_at",
        )
        .bind(exchange_rate.source_currency().as_str())
        .bind(exchange_rate.scaled_i64())
        .bind(timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_exchange_rate(&self, currency: &CurrencyCode) -> Result<(), StoreError> {
        let result = sqlx::query("DELETE FROM exchange_rates WHERE currency_code = ?")
            .bind(currency.as_str())
            .execute(&self.pool)
            .await?;
        require_changed(result.rows_affected())
    }

    pub async fn list_plan_items(&self) -> Result<Vec<StoredPlanItem>, StoreError> {
        let mut connection = self.acquire().await?;
        Self::list_plan_items_on(&mut connection).await
    }

    pub async fn get_plan_item(&self, id: Uuid) -> Result<StoredPlanItem, StoreError> {
        let row = sqlx::query(
            "SELECT id, name, category, planned_amount_scaled, currency_code, period_months, \
                    recognition_mode, start_month, end_month, note, created_at, updated_at \
             FROM plan_items WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::Database(sqlx::Error::RowNotFound))?;
        plan_item_from_row(&row)
    }

    pub async fn insert_plan_item(
        &self,
        plan_item: &PlanItem,
        timestamp: &str,
    ) -> Result<StoredPlanItem, StoreError> {
        sqlx::query(
            "INSERT INTO plan_items (id, name, category, planned_amount_scaled, currency_code, \
                    period_months, recognition_mode, start_month, end_month, note, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_item.id().to_string())
        .bind(plan_item.name())
        .bind(plan_item.category().code())
        .bind(plan_item.amount().scaled_i64())
        .bind(plan_item.currency().as_str())
        .bind(i64::from(plan_item.period_months()))
        .bind(plan_item.recognition_mode().code())
        .bind(plan_item.start_month().database_anchor())
        .bind(plan_item.end_month().map(YearMonth::database_anchor))
        .bind(plan_item.note())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&self.pool)
        .await?;
        self.get_plan_item(plan_item.id()).await
    }

    pub async fn update_plan_item(
        &self,
        plan_item: &PlanItem,
        timestamp: &str,
    ) -> Result<StoredPlanItem, StoreError> {
        let result = sqlx::query(
            "UPDATE plan_items SET name = ?, category = ?, planned_amount_scaled = ?, \
                    currency_code = ?, period_months = ?, recognition_mode = ?, start_month = ?, \
                    end_month = ?, note = ?, updated_at = ? WHERE id = ?",
        )
        .bind(plan_item.name())
        .bind(plan_item.category().code())
        .bind(plan_item.amount().scaled_i64())
        .bind(plan_item.currency().as_str())
        .bind(i64::from(plan_item.period_months()))
        .bind(plan_item.recognition_mode().code())
        .bind(plan_item.start_month().database_anchor())
        .bind(plan_item.end_month().map(YearMonth::database_anchor))
        .bind(plan_item.note())
        .bind(timestamp)
        .bind(plan_item.id().to_string())
        .execute(&self.pool)
        .await?;
        require_changed(result.rows_affected())?;
        self.get_plan_item(plan_item.id()).await
    }

    pub async fn delete_plan_item(&self, id: Uuid) -> Result<DeletePlanResult, StoreError> {
        let mut transaction = self.pool.begin().await?;
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM monthly_items WHERE source_plan_item_id = ?")
                .bind(id.to_string())
                .fetch_one(&mut *transaction)
                .await?;
        let result = sqlx::query("DELETE FROM plan_items WHERE id = ?")
            .bind(id.to_string())
            .execute(&mut *transaction)
            .await?;
        require_changed(result.rows_affected())?;
        transaction.commit().await?;
        Ok(DeletePlanResult {
            plan_item_id: id,
            detached_monthly_items: u64::try_from(count).unwrap_or_default(),
        })
    }

    pub async fn list_monthly_items(
        &self,
        month: YearMonth,
    ) -> Result<Vec<StoredMonthlyItem>, StoreError> {
        let next_month = month.next_month()?;
        let rows = sqlx::query(
            "SELECT id, source_plan_item_id, month, snapshot_name, category, flow_type, \
                    recognition_mode, planned_amount_scaled, actual_amount_scaled, currency_code, \
                    note, created_at, updated_at \
             FROM monthly_items \
             WHERE month >= ? AND month < ? \
             ORDER BY flow_type, category, snapshot_name, id",
        )
        .bind(month.database_anchor())
        .bind(next_month.database_anchor())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(monthly_item_from_row).collect()
    }

    pub async fn list_existing_months(&self) -> Result<Vec<YearMonth>, StoreError> {
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT DISTINCT month FROM monthly_items ORDER BY month DESC")
                .fetch_all(&self.pool)
                .await?;
        rows.iter()
            .map(|value| YearMonth::from_database_anchor(value).map_err(StoreError::from))
            .collect()
    }

    pub async fn count_monthly_items(&self, month: YearMonth) -> Result<u64, StoreError> {
        let next_month = month.next_month()?;
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM monthly_items WHERE month >= ? AND month < ?")
                .bind(month.database_anchor())
                .bind(next_month.database_anchor())
                .fetch_one(&self.pool)
                .await?;
        Ok(u64::try_from(count).unwrap_or_default())
    }

    pub async fn update_monthly_actual(
        &self,
        id: Uuid,
        actual_amount: Option<Amount>,
        timestamp: &str,
    ) -> Result<StoredMonthlyItem, StoreError> {
        let result = sqlx::query(
            "UPDATE monthly_items SET actual_amount_scaled = ?, updated_at = ? WHERE id = ?",
        )
        .bind(actual_amount.map(Amount::scaled_i64))
        .bind(timestamp)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        require_changed(result.rows_affected())?;
        self.get_monthly_item(id).await
    }

    pub async fn update_monthly_note(
        &self,
        id: Uuid,
        note: Option<&str>,
        timestamp: &str,
    ) -> Result<StoredMonthlyItem, StoreError> {
        let note = note.map(str::trim).filter(|value| !value.is_empty());
        let result = sqlx::query("UPDATE monthly_items SET note = ?, updated_at = ? WHERE id = ?")
            .bind(note)
            .bind(timestamp)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        require_changed(result.rows_affected())?;
        self.get_monthly_item(id).await
    }

    pub async fn confirm_unset_actuals(
        &self,
        month: YearMonth,
        category: Option<Category>,
        timestamp: &str,
    ) -> Result<u64, StoreError> {
        let next_month = month.next_month()?;
        let result = match category {
            Some(category) => {
                sqlx::query(
                    "UPDATE monthly_items \
                     SET actual_amount_scaled = planned_amount_scaled, updated_at = ? \
                     WHERE month >= ? AND month < ? AND category = ? \
                       AND actual_amount_scaled IS NULL",
                )
                .bind(timestamp)
                .bind(month.database_anchor())
                .bind(next_month.database_anchor())
                .bind(category.code())
                .execute(&self.pool)
                .await?
            }
            None => {
                sqlx::query(
                    "UPDATE monthly_items \
                     SET actual_amount_scaled = planned_amount_scaled, updated_at = ? \
                     WHERE month >= ? AND month < ? AND actual_amount_scaled IS NULL",
                )
                .bind(timestamp)
                .bind(month.database_anchor())
                .bind(next_month.database_anchor())
                .execute(&self.pool)
                .await?
            }
        };
        Ok(result.rows_affected())
    }

    pub async fn get_monthly_item(&self, id: Uuid) -> Result<StoredMonthlyItem, StoreError> {
        let row = sqlx::query(
            "SELECT id, source_plan_item_id, month, snapshot_name, category, flow_type, \
                    recognition_mode, planned_amount_scaled, actual_amount_scaled, currency_code, \
                    note, created_at, updated_at \
             FROM monthly_items WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::Database(sqlx::Error::RowNotFound))?;
        monthly_item_from_row(&row)
    }

    pub async fn get_settings_on(
        connection: &mut SqliteConnection,
    ) -> Result<Option<StoredSettings>, StoreError> {
        let row = sqlx::query(
            "SELECT target_month, base_currency_code, minimum_savings_rate_bp, created_at, updated_at \
             FROM settings WHERE id = 1",
        )
        .fetch_optional(&mut *connection)
        .await?;
        row.as_ref().map(settings_from_row).transpose()
    }

    pub async fn list_plan_items_on(
        connection: &mut SqliteConnection,
    ) -> Result<Vec<StoredPlanItem>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, name, category, planned_amount_scaled, currency_code, period_months, \
                    recognition_mode, start_month, end_month, note, created_at, updated_at \
             FROM plan_items ORDER BY category, name, id",
        )
        .fetch_all(&mut *connection)
        .await?;
        rows.iter().map(plan_item_from_row).collect()
    }

    pub async fn get_exchange_rate_on(
        connection: &mut SqliteConnection,
        source_currency: &CurrencyCode,
        base_currency: &CurrencyCode,
    ) -> Result<Option<ExchangeRate>, StoreError> {
        let rate: Option<i64> =
            sqlx::query_scalar("SELECT rate_scaled FROM exchange_rates WHERE currency_code = ?")
                .bind(source_currency.as_str())
                .fetch_optional(&mut *connection)
                .await?;
        rate.map(|value| {
            ExchangeRate::from_scaled_i64(source_currency.clone(), base_currency.clone(), value)
                .map_err(StoreError::from)
        })
        .transpose()
    }

    pub async fn existing_source_ids_on(
        connection: &mut SqliteConnection,
        month: YearMonth,
    ) -> Result<Vec<Uuid>, StoreError> {
        let next_month = month.next_month()?;
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT source_plan_item_id FROM monthly_items \
             WHERE month >= ? AND month < ? AND source_plan_item_id IS NOT NULL",
        )
        .bind(month.database_anchor())
        .bind(next_month.database_anchor())
        .fetch_all(&mut *connection)
        .await?;
        rows.iter()
            .map(|value| Uuid::parse_str(value).map_err(|_| StoreError::InvalidUuid))
            .collect()
    }

    pub async fn insert_monthly_item_on(
        connection: &mut SqliteConnection,
        monthly_item: &MonthlyItem,
        timestamp: &str,
    ) -> Result<bool, StoreError> {
        let result = sqlx::query(
            "INSERT INTO monthly_items (id, source_plan_item_id, month, snapshot_name, category, \
                    flow_type, recognition_mode, planned_amount_scaled, actual_amount_scaled, \
                    currency_code, note, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(source_plan_item_id, month) DO NOTHING",
        )
        .bind(monthly_item.id().to_string())
        .bind(monthly_item.source_plan_item_id().map(|id| id.to_string()))
        .bind(monthly_item.month().database_anchor())
        .bind(monthly_item.item_name())
        .bind(monthly_item.category().code())
        .bind(monthly_item.flow_type().code())
        .bind(monthly_item.recognition_mode().code())
        .bind(monthly_item.planned_amount().scaled_i64())
        .bind(monthly_item.actual_amount().map(Amount::scaled_i64))
        .bind(monthly_item.currency().as_str())
        .bind(monthly_item.note())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *connection)
        .await?;
        Ok(result.rows_affected() == 1)
    }
}

fn settings_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredSettings, StoreError> {
    let target_month: String = row.try_get("target_month")?;
    let base_currency: String = row.try_get("base_currency_code")?;
    let savings_rate: i64 = row.try_get("minimum_savings_rate_bp")?;
    let savings_rate = u16::try_from(savings_rate)
        .map_err(|_| StoreError::Domain(pfcm_domain::DomainError::InvalidSavingsRate))?;
    Ok(StoredSettings {
        value: Settings::new(
            YearMonth::from_database_anchor(&target_month)?,
            CurrencyCode::new(base_currency)?,
            savings_rate,
        )?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn exchange_rate_from_row(
    row: &sqlx::sqlite::SqliteRow,
    base_currency: &CurrencyCode,
) -> Result<StoredExchangeRate, StoreError> {
    let currency = CurrencyCode::new(row.try_get::<String, _>("currency_code")?)?;
    Ok(StoredExchangeRate {
        exchange_rate: ExchangeRate::from_scaled_i64(
            currency.clone(),
            base_currency.clone(),
            row.try_get("rate_scaled")?,
        )?,
        currency,
        updated_at: row.try_get("updated_at")?,
        plan_reference_count: row.try_get("plan_reference_count")?,
    })
}

fn plan_item_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredPlanItem, StoreError> {
    let id = Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
        .map_err(|_| StoreError::InvalidUuid)?;
    let category = Category::from_str(row.try_get::<String, _>("category")?.as_str())?;
    let amount = Amount::from_scaled_i64(row.try_get("planned_amount_scaled")?)?;
    let currency = CurrencyCode::new(row.try_get::<String, _>("currency_code")?)?;
    let period = u32::try_from(row.try_get::<i64, _>("period_months")?)
        .map_err(|_| StoreError::Domain(pfcm_domain::DomainError::InvalidPeriod))?;
    let mode = RecognitionMode::from_str(row.try_get::<String, _>("recognition_mode")?.as_str())?;
    let start = YearMonth::from_database_anchor(row.try_get::<String, _>("start_month")?.as_str())?;
    let end = row
        .try_get::<Option<String>, _>("end_month")?
        .as_deref()
        .map(YearMonth::from_database_anchor)
        .transpose()?;
    Ok(StoredPlanItem {
        value: PlanItem::new(
            id,
            row.try_get::<String, _>("name")?,
            category,
            amount,
            currency,
            period,
            start,
            end,
            mode,
            row.try_get("note")?,
        )?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn monthly_item_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredMonthlyItem, StoreError> {
    let id = Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
        .map_err(|_| StoreError::InvalidUuid)?;
    let source_plan_item_id = row
        .try_get::<Option<String>, _>("source_plan_item_id")?
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| StoreError::InvalidUuid)?;
    let category = Category::from_str(row.try_get::<String, _>("category")?.as_str())?;
    let flow_type = FlowType::from_str(row.try_get::<String, _>("flow_type")?.as_str())?;
    if category.flow_type() != flow_type {
        return Err(StoreError::Domain(
            pfcm_domain::DomainError::InvalidFlowType,
        ));
    }
    let actual_amount = row
        .try_get::<Option<i64>, _>("actual_amount_scaled")?
        .map(Amount::from_scaled_i64)
        .transpose()?;
    Ok(StoredMonthlyItem {
        value: MonthlyItem::rehydrate(
            id,
            source_plan_item_id,
            row.try_get("snapshot_name")?,
            YearMonth::from_database_anchor(row.try_get::<String, _>("month")?.as_str())?,
            category,
            flow_type,
            RecognitionMode::from_str(row.try_get::<String, _>("recognition_mode")?.as_str())?,
            Amount::from_scaled_i64(row.try_get("planned_amount_scaled")?)?,
            actual_amount,
            CurrencyCode::new(row.try_get::<String, _>("currency_code")?)?,
            row.try_get("note")?,
        ),
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn require_changed(rows_affected: u64) -> Result<(), StoreError> {
    if rows_affected == 0 {
        Err(StoreError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(())
    }
}
