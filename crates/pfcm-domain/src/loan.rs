use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};

use crate::{Amount, CalendarDate, DomainError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoanFrequency {
    Day,
    Month,
    Quarter,
    Year,
}

impl LoanFrequency {
    pub fn date(
        self,
        first: CalendarDate,
        interval: u32,
        index: u32,
    ) -> Result<CalendarDate, DomainError> {
        if interval == 0 {
            return Err(DomainError::InvalidPeriod);
        }
        let offset = interval
            .checked_mul(index)
            .ok_or(DomainError::ArithmeticOverflow)?;
        let months = match self {
            Self::Day => return first.add_days(offset),
            Self::Month => offset,
            Self::Quarter => offset
                .checked_mul(3)
                .ok_or(DomainError::ArithmeticOverflow)?,
            Self::Year => offset
                .checked_mul(12)
                .ok_or(DomainError::ArithmeticOverflow)?,
        };
        Ok(first
            .year_month()
            .add_months(i32::try_from(months).map_err(|_| DomainError::InvalidPeriod)?)?
            .date_clamped_to_day(first.day()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoanScheduleMethod {
    EqualPrincipal,
    Annuity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoanScheduleRow {
    pub due_on: CalendarDate,
    pub principal: Amount,
    pub interest: Amount,
    pub fees: Amount,
}

/// The rate is explicitly per repayment period; no annual/day-count convention is guessed.
pub fn generate_loan_schedule(
    principal: Amount,
    first: CalendarDate,
    frequency: LoanFrequency,
    interval: u32,
    count: u32,
    method: LoanScheduleMethod,
    period_rate_percent: Decimal,
) -> Result<Vec<LoanScheduleRow>, DomainError> {
    if count == 0
        || count > 10_000
        || interval == 0
        || interval > 10_000
        || principal.scaled_i64() < i64::from(count)
    {
        return Err(DomainError::InvalidPeriod);
    }
    if period_rate_percent < Decimal::ZERO
        || period_rate_percent > Decimal::ONE_HUNDRED
        || period_rate_percent.scale() > 8
    {
        return Err(DomainError::InvalidRatio);
    }
    let rate = period_rate_percent / Decimal::ONE_HUNDRED;
    let mut remaining = principal.scaled_i64();
    let regular_principal = principal.scaled_i64() / i64::from(count);
    let payment = if method == LoanScheduleMethod::Annuity && rate > Decimal::ZERO {
        // Discounted annuity avoids overflowing (1+r)^n for long daily schedules.
        let discount = Decimal::ONE
            .checked_div(Decimal::ONE + rate)
            .ok_or(DomainError::ArithmeticOverflow)?;
        let mut power = Decimal::ONE;
        for _ in 0..count {
            power = power
                .checked_mul(discount)
                .ok_or(DomainError::ArithmeticOverflow)?;
        }
        Amount::from_decimal(
            principal
                .as_decimal()
                .checked_mul(rate)
                .and_then(|v| v.checked_div(Decimal::ONE - power))
                .ok_or(DomainError::ArithmeticOverflow)?,
        )?
        .as_decimal()
    } else {
        Decimal::ZERO
    };
    let mut rows = Vec::with_capacity(count as usize);
    for index in 0..count {
        let balance = Amount::from_scaled_i64(remaining)?;
        let interest = Amount::from_decimal(
            balance
                .as_decimal()
                .checked_mul(rate)
                .ok_or(DomainError::ArithmeticOverflow)?,
        )?;
        let paid_principal = if index == count - 1 {
            remaining
        } else if method == LoanScheduleMethod::Annuity && rate > Decimal::ZERO {
            let part = payment - interest.as_decimal();
            if part <= Decimal::ZERO {
                return Err(DomainError::InvalidAmount);
            }
            Amount::from_decimal(
                part.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero),
            )?
            .scaled_i64()
            .min(remaining)
        } else {
            regular_principal
        };
        rows.push(LoanScheduleRow {
            due_on: frequency.date(first, interval, index)?,
            principal: Amount::from_scaled_i64(paid_principal)?,
            interest,
            fees: Amount::zero(),
        });
        remaining -= paid_principal;
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_periods_keep_the_original_anchor_and_cross_leap_days() {
        let first = "2028-01-31".parse().unwrap();
        for (unit, index, expected) in [
            (LoanFrequency::Day, 30, "2028-03-01"),
            (LoanFrequency::Month, 1, "2028-02-29"),
            (LoanFrequency::Month, 2, "2028-03-31"),
            (LoanFrequency::Quarter, 1, "2028-04-30"),
            (LoanFrequency::Quarter, 2, "2028-07-31"),
            (LoanFrequency::Year, 1, "2029-01-31"),
        ] {
            assert_eq!(unit.date(first, 1, index).unwrap().to_string(), expected);
        }
        let leap = "2028-02-29".parse().unwrap();
        assert_eq!(
            LoanFrequency::Year.date(leap, 1, 1).unwrap().to_string(),
            "2029-02-28"
        );
        assert_eq!(
            LoanFrequency::Year.date(leap, 1, 4).unwrap().to_string(),
            "2032-02-29"
        );
        assert!(
            LoanFrequency::Day
                .date("9999-12-31".parse().unwrap(), 1, 1)
                .is_err()
        );
    }
    #[test]
    fn schedules_reconcile_principal_including_final_cent_and_annuity() {
        for method in [
            LoanScheduleMethod::EqualPrincipal,
            LoanScheduleMethod::Annuity,
        ] {
            for unit in [
                LoanFrequency::Day,
                LoanFrequency::Month,
                LoanFrequency::Quarter,
                LoanFrequency::Year,
            ] {
                let rows = generate_loan_schedule(
                    "10000.01".parse().unwrap(),
                    "2026-01-31".parse().unwrap(),
                    unit,
                    2,
                    12,
                    method,
                    "0.5".parse().unwrap(),
                )
                .unwrap();
                assert_eq!(
                    rows.iter().map(|r| r.principal.scaled_i64()).sum::<i64>(),
                    1_000_001
                );
                assert_eq!(rows[0].interest.to_string(), "50.00");
                assert_eq!(rows.len(), 12);
            }
        }
        assert!(
            generate_loan_schedule(
                "1".parse().unwrap(),
                "2026-01-01".parse().unwrap(),
                LoanFrequency::Day,
                0,
                12,
                LoanScheduleMethod::Annuity,
                Decimal::ZERO
            )
            .is_err()
        );
    }
}
