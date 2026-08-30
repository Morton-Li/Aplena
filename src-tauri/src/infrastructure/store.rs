use std::str::FromStr;

use pfcm_domain::{
    ActualEntry, ActualEntryEffect, ActualEntryOrigin, Amount, CalendarDate, Category,
    CurrencyCode, ExchangeRate, FlowType, MonthlyItem, MonthlyItemSource, NextMonthGoal, PlanItem,
    RecognitionMode, Settings, SignedAmount, YearMonth,
};
use sqlx::{Row, Sqlite, SqliteConnection, SqlitePool, pool::PoolConnection};
use uuid::Uuid;

use super::{
    ActualEntryExchangeSnapshot, DeletePlanResult, StoreError, StoredActualEntry,
    StoredExchangeRate, StoredMonthlyItem, StoredNextMonthGoal, StoredPlanItem, StoredSettings,
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
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    #[cfg(test)]
    pub(crate) async fn close(&self) {
        self.pool.close().await;
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
            "INSERT INTO exchange_rates (currency_code, rate_scaled, source, observed_on, updated_at) \
             VALUES (?, 100000000, 'BASE_CURRENCY', date(?), ?) \
             ON CONFLICT(currency_code) DO UPDATE SET rate_scaled = 100000000, \
             source = 'BASE_CURRENCY', observed_on = excluded.observed_on, updated_at = excluded.updated_at",
        )
        .bind(settings.base_currency().as_str())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO settings (id, base_currency_code, created_at, updated_at) \
             VALUES (1, ?, ?, ?)",
        )
        .bind(settings.base_currency().as_str())
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
            "INSERT INTO exchange_rates (currency_code, rate_scaled, source, observed_on, updated_at) \
             VALUES (?, 100000000, 'BASE_CURRENCY', date(?), ?) \
             ON CONFLICT(currency_code) DO NOTHING",
        )
        .bind(settings.base_currency().as_str())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
        let result =
            sqlx::query("UPDATE settings SET base_currency_code = ?, updated_at = ? WHERE id = 1")
                .bind(settings.base_currency().as_str())
                .bind(timestamp)
                .execute(&mut *transaction)
                .await?;
        require_changed(result.rows_affected())?;
        transaction.commit().await?;
        self.get_settings()
            .await?
            .ok_or(StoreError::Database(sqlx::Error::RowNotFound))
    }

    pub async fn get_next_month_goal(&self) -> Result<Option<StoredNextMonthGoal>, StoreError> {
        let row = sqlx::query(
            "SELECT target_month, minimum_savings_rate_bp, created_at, updated_at \
             FROM next_month_goal WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(next_month_goal_from_row).transpose()
    }

    pub async fn upsert_next_month_goal(
        &self,
        goal: &NextMonthGoal,
        timestamp: &str,
    ) -> Result<StoredNextMonthGoal, StoreError> {
        sqlx::query(
            "INSERT INTO next_month_goal \
               (id, target_month, minimum_savings_rate_bp, created_at, updated_at) \
             VALUES (1, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET \
               target_month = excluded.target_month, \
               minimum_savings_rate_bp = excluded.minimum_savings_rate_bp, \
               updated_at = excluded.updated_at",
        )
        .bind(goal.target_month().database_anchor())
        .bind(i64::from(goal.minimum_savings_rate().basis_points()))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&self.pool)
        .await?;
        self.get_next_month_goal()
            .await?
            .ok_or(StoreError::Database(sqlx::Error::RowNotFound))
    }

    pub async fn list_exchange_rates(&self) -> Result<Vec<StoredExchangeRate>, StoreError> {
        let settings = self.get_settings().await?;
        let Some(settings) = settings else {
            return Ok(Vec::new());
        };
        let rows = sqlx::query(
            "SELECT e.currency_code, e.rate_scaled, e.source, e.observed_on, e.updated_at, \
                    COUNT(p.id) AS plan_reference_count \
             FROM exchange_rates e \
             LEFT JOIN plan_items p ON p.currency_code = e.currency_code \
             GROUP BY e.currency_code, e.rate_scaled, e.source, e.observed_on, e.updated_at \
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
        source: &str,
        observed_on: Option<CalendarDate>,
        timestamp: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO exchange_rates (currency_code, rate_scaled, source, observed_on, updated_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(currency_code) DO UPDATE \
             SET rate_scaled = excluded.rate_scaled, source = excluded.source, \
                 observed_on = excluded.observed_on, updated_at = excluded.updated_at",
        )
        .bind(exchange_rate.source_currency().as_str())
        .bind(exchange_rate.scaled_i64())
        .bind(source)
        .bind(observed_on.map(|date| date.to_string()))
        .bind(timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn upsert_exchange_rates(
        &self,
        exchange_rates: &[ExchangeRate],
        source: &str,
        observed_on: Option<CalendarDate>,
        timestamp: &str,
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        for exchange_rate in exchange_rates {
            sqlx::query(
                "INSERT INTO exchange_rates (currency_code, rate_scaled, source, observed_on, updated_at) \
                 VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT(currency_code) DO UPDATE \
                 SET rate_scaled = excluded.rate_scaled, source = excluded.source, \
                     observed_on = excluded.observed_on, updated_at = excluded.updated_at",
            )
            .bind(exchange_rate.source_currency().as_str())
            .bind(exchange_rate.scaled_i64())
            .bind(source)
            .bind(observed_on.map(|date| date.to_string()))
            .bind(timestamp)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
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
                    recognition_mode, start_date, end_date, note, created_at, updated_at, \
                    (SELECT COUNT(*) FROM monthly_items m WHERE m.source_plan_item_id = plan_items.id) \
                    AS history_month_count \
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
                    period_months, recognition_mode, start_date, end_date, note, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(plan_item.id().to_string())
        .bind(plan_item.name())
        .bind(plan_item.category().code())
        .bind(plan_item.amount().scaled_i64())
        .bind(plan_item.currency().as_str())
        .bind(i64::from(plan_item.period_months()))
        .bind(plan_item.recognition_mode().code())
        .bind(plan_item.start_date().to_string())
        .bind(plan_item.end_date().map(|date| date.to_string()))
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
                    currency_code = ?, period_months = ?, recognition_mode = ?, start_date = ?, \
                    end_date = ?, note = ?, updated_at = ? WHERE id = ?",
        )
        .bind(plan_item.name())
        .bind(plan_item.category().code())
        .bind(plan_item.amount().scaled_i64())
        .bind(plan_item.currency().as_str())
        .bind(i64::from(plan_item.period_months()))
        .bind(plan_item.recognition_mode().code())
        .bind(plan_item.start_date().to_string())
        .bind(plan_item.end_date().map(|date| date.to_string()))
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
            "SELECT m.id, m.source_plan_item_id, m.month, m.snapshot_name, m.category, m.flow_type, \
                    m.recognition_mode, m.item_source, m.item_origin, m.scheduled_date, m.planned_amount_scaled, \
                    CASE WHEN COUNT(e.id) > 0 OR m.actual_confirmed_at IS NOT NULL \
                      THEN COALESCE(SUM(CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END), 0) \
                      ELSE NULL END AS derived_actual_amount_scaled, \
                    COUNT(e.id) AS actual_entry_count, m.actual_confirmed_at, m.currency_code, \
                    m.note, m.created_at, m.updated_at \
             FROM monthly_items m LEFT JOIN actual_entries e ON e.monthly_item_id = m.id \
             WHERE m.month >= ? AND m.month < ? \
             GROUP BY m.id \
             ORDER BY m.flow_type, m.category, m.snapshot_name, m.id",
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

    pub async fn confirm_actuals(
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
                     SET actual_confirmed_at = ?, updated_at = ? \
                     WHERE month >= ? AND month < ? AND category = ? \
                       AND actual_confirmed_at IS NULL",
                )
                .bind(timestamp)
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
                     SET actual_confirmed_at = ?, updated_at = ? \
                     WHERE month >= ? AND month < ? AND actual_confirmed_at IS NULL",
                )
                .bind(timestamp)
                .bind(timestamp)
                .bind(month.database_anchor())
                .bind(next_month.database_anchor())
                .execute(&self.pool)
                .await?
            }
        };
        Ok(result.rows_affected())
    }

    pub async fn confirm_monthly_item(
        &self,
        id: Uuid,
        timestamp: &str,
    ) -> Result<StoredMonthlyItem, StoreError> {
        let result = sqlx::query(
            "UPDATE monthly_items SET actual_confirmed_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(timestamp)
        .bind(timestamp)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        require_changed(result.rows_affected())?;
        self.get_monthly_item(id).await
    }

    pub async fn insert_monthly_item(
        &self,
        monthly_item: &MonthlyItem,
        timestamp: &str,
    ) -> Result<StoredMonthlyItem, StoreError> {
        let mut connection = self.acquire().await?;
        Self::insert_monthly_item_on(&mut connection, monthly_item, timestamp).await?;
        // The in-memory test store deliberately has a single connection. Release
        // it before the follow-up aggregate read so this method cannot deadlock
        // while waiting for another lease from the same pool.
        drop(connection);
        match monthly_item.source_plan_item_id() {
            Some(source_plan_item_id) => self
                .get_monthly_item_by_source_month(source_plan_item_id, monthly_item.month())
                .await?
                .ok_or(StoreError::Database(sqlx::Error::RowNotFound)),
            None => self.get_monthly_item(monthly_item.id()).await,
        }
    }

    pub async fn get_monthly_item(&self, id: Uuid) -> Result<StoredMonthlyItem, StoreError> {
        let row = sqlx::query(
            "SELECT m.id, m.source_plan_item_id, m.month, m.snapshot_name, m.category, m.flow_type, \
                    m.recognition_mode, m.item_source, m.item_origin, m.scheduled_date, m.planned_amount_scaled, \
                    CASE WHEN COUNT(e.id) > 0 OR m.actual_confirmed_at IS NOT NULL \
                      THEN COALESCE(SUM(CASE e.effect WHEN 'INCREASE' THEN e.amount_scaled ELSE -e.amount_scaled END), 0) \
                      ELSE NULL END AS derived_actual_amount_scaled, \
                    COUNT(e.id) AS actual_entry_count, m.actual_confirmed_at, m.currency_code, \
                    m.note, m.created_at, m.updated_at \
             FROM monthly_items m LEFT JOIN actual_entries e ON e.monthly_item_id = m.id \
             WHERE m.id = ? GROUP BY m.id",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::Database(sqlx::Error::RowNotFound))?;
        monthly_item_from_row(&row)
    }

    pub async fn get_monthly_item_by_source_month(
        &self,
        source_plan_item_id: Uuid,
        month: YearMonth,
    ) -> Result<Option<StoredMonthlyItem>, StoreError> {
        let id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM monthly_items WHERE source_plan_item_id = ? AND month = ?",
        )
        .bind(source_plan_item_id.to_string())
        .bind(month.database_anchor())
        .fetch_optional(&self.pool)
        .await?;
        match id {
            Some(id) => self
                .get_monthly_item(Uuid::parse_str(&id).map_err(|_| StoreError::InvalidUuid)?)
                .await
                .map(Some),
            None => Ok(None),
        }
    }

    pub async fn list_actual_entries(
        &self,
        monthly_item_id: Uuid,
    ) -> Result<Vec<StoredActualEntry>, StoreError> {
        let rows = sqlx::query(
            "SELECT e.id, e.monthly_item_id, e.occurred_on, e.effect, e.amount_scaled, \
                    e.source_amount_scaled, e.source_currency_code, e.exchange_rate_scaled, \
                    e.exchange_rate_source, e.exchange_rate_observed_on, e.origin, e.note, \
                    e.created_at, e.updated_at, m.month, s.base_currency_code \
             FROM actual_entries e JOIN monthly_items m ON m.id = e.monthly_item_id \
             JOIN settings s ON s.id = 1 \
             WHERE e.monthly_item_id = ? ORDER BY e.occurred_on DESC, e.created_at DESC, e.id",
        )
        .bind(monthly_item_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(actual_entry_from_row).collect()
    }

    pub async fn insert_actual_entry(
        &self,
        entry: &ActualEntry,
        exchange_snapshot: &ActualEntryExchangeSnapshot,
        timestamp: &str,
    ) -> Result<StoredActualEntry, StoreError> {
        sqlx::query(
            "INSERT INTO actual_entries (id, monthly_item_id, occurred_on, effect, amount_scaled, \
                    source_amount_scaled, source_currency_code, exchange_rate_scaled, \
                    exchange_rate_source, exchange_rate_observed_on, origin, note, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(entry.id().to_string())
        .bind(entry.monthly_item_id().to_string())
        .bind(entry.occurred_on().to_string())
        .bind(entry.effect().code())
        .bind(entry.amount().scaled_i64())
        .bind(exchange_snapshot.source_amount.scaled_i64())
        .bind(exchange_snapshot.source_currency.as_str())
        .bind(exchange_snapshot.exchange_rate.scaled_i64())
        .bind(&exchange_snapshot.source)
        .bind(exchange_snapshot.observed_on.to_string())
        .bind(entry.origin().code())
        .bind(entry.note())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&self.pool)
        .await?;
        self.get_actual_entry(entry.id()).await
    }

    pub async fn update_actual_entry(
        &self,
        entry: &ActualEntry,
        exchange_snapshot: &ActualEntryExchangeSnapshot,
        timestamp: &str,
    ) -> Result<StoredActualEntry, StoreError> {
        let result = sqlx::query(
            "UPDATE actual_entries SET occurred_on = ?, effect = ?, amount_scaled = ?, \
                    source_amount_scaled = ?, source_currency_code = ?, exchange_rate_scaled = ?, \
                    exchange_rate_source = ?, exchange_rate_observed_on = ?, note = ?, updated_at = ? \
             WHERE id = ? AND origin = 'USER'",
        )
        .bind(entry.occurred_on().to_string())
        .bind(entry.effect().code())
        .bind(entry.amount().scaled_i64())
        .bind(exchange_snapshot.source_amount.scaled_i64())
        .bind(exchange_snapshot.source_currency.as_str())
        .bind(exchange_snapshot.exchange_rate.scaled_i64())
        .bind(&exchange_snapshot.source)
        .bind(exchange_snapshot.observed_on.to_string())
        .bind(entry.note())
        .bind(timestamp)
        .bind(entry.id().to_string())
        .execute(&self.pool)
        .await?;
        require_changed(result.rows_affected())?;
        self.get_actual_entry(entry.id()).await
    }

    pub async fn delete_actual_entry(&self, id: Uuid) -> Result<(), StoreError> {
        let result = sqlx::query("DELETE FROM actual_entries WHERE id = ? AND origin = 'USER'")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        require_changed(result.rows_affected())
    }

    pub async fn get_actual_entry(&self, id: Uuid) -> Result<StoredActualEntry, StoreError> {
        let row = sqlx::query(
            "SELECT e.id, e.monthly_item_id, e.occurred_on, e.effect, e.amount_scaled, \
                    e.source_amount_scaled, e.source_currency_code, e.exchange_rate_scaled, \
                    e.exchange_rate_source, e.exchange_rate_observed_on, e.origin, e.note, \
                    e.created_at, e.updated_at, m.month, s.base_currency_code \
             FROM actual_entries e JOIN monthly_items m ON m.id = e.monthly_item_id \
             JOIN settings s ON s.id = 1 WHERE e.id = ?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::Database(sqlx::Error::RowNotFound))?;
        actual_entry_from_row(&row)
    }

    pub async fn get_settings_on(
        connection: &mut SqliteConnection,
    ) -> Result<Option<StoredSettings>, StoreError> {
        let row = sqlx::query(
            "SELECT base_currency_code, created_at, updated_at FROM settings WHERE id = 1",
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
                    recognition_mode, start_date, end_date, note, created_at, updated_at, \
                    (SELECT COUNT(*) FROM monthly_items m WHERE m.source_plan_item_id = plan_items.id) \
                    AS history_month_count \
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

    pub async fn actual_only_source_ids_on(
        connection: &mut SqliteConnection,
        month: YearMonth,
    ) -> Result<Vec<Uuid>, StoreError> {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT source_plan_item_id FROM monthly_items \
             WHERE month = ? AND item_source = 'ACTUAL_ONLY' AND source_plan_item_id IS NOT NULL",
        )
        .bind(month.database_anchor())
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
                    flow_type, recognition_mode, item_source, item_origin, scheduled_date, planned_amount_scaled, \
                    actual_confirmed_at, currency_code, note, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(source_plan_item_id, month) DO UPDATE SET \
               snapshot_name = excluded.snapshot_name, category = excluded.category, \
               flow_type = excluded.flow_type, recognition_mode = excluded.recognition_mode, \
               item_source = excluded.item_source, item_origin = excluded.item_origin, scheduled_date = excluded.scheduled_date, \
               planned_amount_scaled = excluded.planned_amount_scaled, \
               currency_code = excluded.currency_code, note = excluded.note, updated_at = excluded.updated_at \
             WHERE monthly_items.item_source = 'ACTUAL_ONLY' AND excluded.item_source = 'PLANNED'",
        )
        .bind(monthly_item.id().to_string())
        .bind(monthly_item.source_plan_item_id().map(|id| id.to_string()))
        .bind(monthly_item.month().database_anchor())
        .bind(monthly_item.item_name())
        .bind(monthly_item.category().code())
        .bind(monthly_item.flow_type().code())
        .bind(monthly_item.recognition_mode().code())
        .bind(monthly_item.item_source().code())
        .bind(monthly_item.item_origin().code())
        .bind(monthly_item.scheduled_date().map(|date| date.to_string()))
        .bind(monthly_item.planned_amount().scaled_i64())
        .bind(monthly_item.actual_confirmed_at())
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
    let base_currency: String = row.try_get("base_currency_code")?;
    Ok(StoredSettings {
        value: Settings::new(CurrencyCode::new(base_currency)?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn next_month_goal_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<StoredNextMonthGoal, StoreError> {
    let target_month: String = row.try_get("target_month")?;
    let savings_rate: i64 = row.try_get("minimum_savings_rate_bp")?;
    let savings_rate = u16::try_from(savings_rate)
        .map_err(|_| StoreError::Domain(pfcm_domain::DomainError::InvalidSavingsRate))?;
    Ok(StoredNextMonthGoal {
        value: NextMonthGoal::new(
            YearMonth::from_database_anchor(&target_month)?,
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
        source: row.try_get("source")?,
        observed_on: row
            .try_get::<Option<String>, _>("observed_on")?
            .as_deref()
            .map(CalendarDate::from_str)
            .transpose()?,
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
    let start = CalendarDate::from_str(row.try_get::<String, _>("start_date")?.as_str())?;
    let end = row
        .try_get::<Option<String>, _>("end_date")?
        .as_deref()
        .map(CalendarDate::from_str)
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
        history_month_count: row.try_get("history_month_count")?,
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
        .try_get::<Option<i64>, _>("derived_actual_amount_scaled")?
        .map(SignedAmount::from_scaled_i64)
        .transpose()?;
    let entry_count =
        u64::try_from(row.try_get::<i64, _>("actual_entry_count")?).unwrap_or_default();
    Ok(StoredMonthlyItem {
        value: MonthlyItem::rehydrate(
            id,
            source_plan_item_id,
            row.try_get("snapshot_name")?,
            YearMonth::from_database_anchor(row.try_get::<String, _>("month")?.as_str())?,
            category,
            flow_type,
            RecognitionMode::from_str(row.try_get::<String, _>("recognition_mode")?.as_str())?,
            MonthlyItemSource::from_str(row.try_get::<String, _>("item_source")?.as_str())?,
            pfcm_domain::MonthlyItemOrigin::from_str(
                row.try_get::<String, _>("item_origin")?.as_str(),
            )?,
            row.try_get::<Option<String>, _>("scheduled_date")?
                .as_deref()
                .map(CalendarDate::from_str)
                .transpose()?,
            Amount::from_scaled_i64(row.try_get("planned_amount_scaled")?)?,
            actual_amount,
            entry_count,
            row.try_get("actual_confirmed_at")?,
            CurrencyCode::new(row.try_get::<String, _>("currency_code")?)?,
            row.try_get("note")?,
        ),
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn actual_entry_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<StoredActualEntry, StoreError> {
    let id = Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
        .map_err(|_| StoreError::InvalidUuid)?;
    let monthly_item_id = Uuid::parse_str(row.try_get::<String, _>("monthly_item_id")?.as_str())
        .map_err(|_| StoreError::InvalidUuid)?;
    let month = YearMonth::from_database_anchor(row.try_get::<String, _>("month")?.as_str())?;
    let source_currency = CurrencyCode::new(row.try_get::<String, _>("source_currency_code")?)?;
    let base_currency = CurrencyCode::new(row.try_get::<String, _>("base_currency_code")?)?;
    Ok(StoredActualEntry {
        value: ActualEntry::new(
            id,
            monthly_item_id,
            month,
            CalendarDate::from_str(row.try_get::<String, _>("occurred_on")?.as_str())?,
            ActualEntryEffect::from_str(row.try_get::<String, _>("effect")?.as_str())?,
            Amount::from_scaled_i64(row.try_get("amount_scaled")?)?,
            ActualEntryOrigin::from_str(row.try_get::<String, _>("origin")?.as_str())?,
            row.try_get("note")?,
        )?,
        exchange_snapshot: ActualEntryExchangeSnapshot {
            source_amount: Amount::from_scaled_i64(row.try_get("source_amount_scaled")?)?,
            source_currency: source_currency.clone(),
            exchange_rate: ExchangeRate::from_scaled_i64(
                source_currency,
                base_currency,
                row.try_get("exchange_rate_scaled")?,
            )?,
            source: row.try_get("exchange_rate_source")?,
            observed_on: CalendarDate::from_str(
                row.try_get::<String, _>("exchange_rate_observed_on")?
                    .as_str(),
            )?,
        },
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
