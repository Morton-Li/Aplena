use rust_decimal::Decimal;
use uuid::Uuid;

use crate::{
    Amount, CurrencyCode, DomainError, ExchangeRate, MonthlyItem, PlanItem, RecognitionMode,
    YearMonth,
};

pub fn is_effective_in(plan_item: &PlanItem, month: YearMonth) -> bool {
    plan_item.start_month() <= month && plan_item.end_month().is_none_or(|end| month <= end)
}

fn converted_value(
    plan_item: &PlanItem,
    exchange_rate: &ExchangeRate,
    base_currency: &CurrencyCode,
) -> Result<Decimal, DomainError> {
    if exchange_rate.source_currency() != plan_item.currency()
        || exchange_rate.base_currency() != base_currency
    {
        return Err(DomainError::CurrencyMismatch);
    }

    plan_item
        .amount()
        .as_decimal()
        .checked_mul(exchange_rate.value())
        .ok_or(DomainError::ArithmeticOverflow)
}

pub fn recognized_amount(
    plan_item: &PlanItem,
    month: YearMonth,
    exchange_rate: &ExchangeRate,
    base_currency: &CurrencyCode,
) -> Result<Option<Amount>, DomainError> {
    if !is_effective_in(plan_item, month) {
        return Ok(None);
    }

    let value = converted_value(plan_item, exchange_rate, base_currency)?;
    match plan_item.recognition_mode() {
        RecognitionMode::Amortized => {
            let period = Decimal::from(plan_item.period_months());
            let amount = value
                .checked_div(period)
                .ok_or(DomainError::ArithmeticOverflow)?;
            Amount::from_decimal(amount).map(Some)
        }
        RecognitionMode::Payment => {
            let elapsed = month
                .months_since(plan_item.start_month())
                .expect("effective month cannot precede start month");
            if elapsed.is_multiple_of(plan_item.period_months()) {
                Amount::from_decimal(value).map(Some)
            } else {
                Ok(None)
            }
        }
    }
}

pub fn monthly_equivalent(
    plan_item: &PlanItem,
    month: YearMonth,
    exchange_rate: &ExchangeRate,
    base_currency: &CurrencyCode,
) -> Result<Option<Amount>, DomainError> {
    if !is_effective_in(plan_item, month) {
        return Ok(None);
    }

    let value = converted_value(plan_item, exchange_rate, base_currency)?;
    let monthly = value
        .checked_div(Decimal::from(plan_item.period_months()))
        .ok_or(DomainError::ArithmeticOverflow)?;
    Amount::from_decimal(monthly).map(Some)
}

pub fn create_monthly_snapshot(
    snapshot_id: Uuid,
    plan_item: &PlanItem,
    month: YearMonth,
    exchange_rate: &ExchangeRate,
    base_currency: &CurrencyCode,
) -> Result<Option<MonthlyItem>, DomainError> {
    recognized_amount(plan_item, month, exchange_rate, base_currency).map(|amount| {
        amount.map(|planned_amount| {
            MonthlyItem::snapshot(
                snapshot_id,
                plan_item,
                month,
                planned_amount,
                base_currency.clone(),
            )
        })
    })
}
