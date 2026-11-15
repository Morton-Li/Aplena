use std::collections::BTreeMap;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{Amount, CalendarDate, DomainError, LoanFrequency};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoanInterestMode {
    Simple,
    Compound,
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanInterestRule {
    pub mode: LoanInterestMode,
    pub frequency: LoanFrequency,
    #[serde(with = "rust_decimal::serde::str")]
    pub rate_percent: Decimal,
    pub fixed_amount: Amount,
    pub started_on: CalendarDate,
}

impl LoanInterestRule {
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.rate_percent < Decimal::ZERO
            || self.rate_percent > Decimal::ONE_HUNDRED
            || self.rate_percent.scale() > 8
        {
            return Err(DomainError::InvalidRatio);
        }
        self.frequency.date(self.started_on, 1, 1)?;
        Ok(())
    }
}

pub struct LoanInterestMovement {
    pub occurred_on: CalendarDate,
    /// Positive for advances, negative for principal repayments, in cents.
    pub principal_delta: i64,
    pub paid_interest: Amount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LoanInterestAccrual {
    pub accrued_interest: Amount,
    pub paid_interest: Amount,
    pub remaining_interest: Amount,
    pub overpaid_interest: Amount,
}

/// Accrues over [started_on, as_of). Movements apply before accrual on their date.
/// Calendar periods keep the original anchor; partial periods use actual days.
/// Compound interest capitalizes unpaid interest only at completed boundaries.
/// Decimal precision is retained until the final currency rounding.
pub fn accrue_loan_interest(
    principal: Amount,
    rule: &LoanInterestRule,
    movements: &[LoanInterestMovement],
    as_of: CalendarDate,
) -> Result<LoanInterestAccrual, DomainError> {
    rule.validate()?;
    let overflow = || DomainError::ArithmeticOverflow;
    let mut dated = BTreeMap::<CalendarDate, (i64, Decimal)>::new();
    for movement in movements.iter().filter(|row| row.occurred_on <= as_of) {
        let entry = dated.entry(movement.occurred_on).or_default();
        entry.0 = entry
            .0
            .checked_add(movement.principal_delta)
            .ok_or_else(overflow)?;
        entry.1 = entry
            .1
            .checked_add(movement.paid_interest.as_decimal())
            .ok_or_else(overflow)?;
    }
    let mut events = dated.into_iter().peekable();
    let mut balance = principal.scaled_i64();
    let mut paid = Decimal::ZERO;
    let mut capitalized = Decimal::ZERO;
    let mut pending = Decimal::ZERO;
    let mut period_numerator = Decimal::ZERO;
    let mut accrued = Decimal::ZERO;
    let mut cursor = rule.started_on.min(as_of);
    let mut period = 0;
    let mut period_start = rule.started_on;
    let mut boundary = rule.frequency.date(rule.started_on, 1, 1)?;

    loop {
        while events.peek().is_some_and(|(date, _)| *date <= cursor) {
            let (_, (delta, payment)) = events.next().expect("peeked event");
            balance = balance.checked_add(delta).ok_or_else(overflow)?;
            if balance < 0 {
                return Err(DomainError::NegativeAmount);
            }
            paid = paid.checked_add(payment).ok_or_else(overflow)?;
            let capital_payment = payment.min(capitalized);
            capitalized -= capital_payment;
            // Excess payments remain a credit against subsequent accrual.
            pending = pending
                .checked_sub(payment - capital_payment)
                .ok_or_else(overflow)?;
        }
        if cursor >= as_of {
            break;
        }
        let next_event = events.peek().map(|(date, _)| *date).unwrap_or(as_of);
        let next = boundary.min(next_event).min(as_of);
        let days = Decimal::from(cursor.days_until(next)?);
        let period_days = Decimal::from(period_start.days_until(boundary)?);
        let base = Decimal::new(balance, 2)
            .checked_add(if rule.mode == LoanInterestMode::Compound {
                capitalized
            } else {
                Decimal::ZERO
            })
            .ok_or_else(overflow)?;
        let full_period = if rule.mode == LoanInterestMode::Fixed {
            if balance > 0 {
                rule.fixed_amount.as_decimal()
            } else {
                Decimal::ZERO
            }
        } else {
            base.checked_mul(rule.rate_percent)
                .and_then(|value| value.checked_div(Decimal::ONE_HUNDRED))
                .ok_or_else(overflow)?
        };
        // Sum principal-day contributions before division so splitting a period
        // at payment dates cannot move a half-cent across the rounding boundary.
        period_numerator = full_period
            .checked_mul(days)
            .and_then(|value| period_numerator.checked_add(value))
            .ok_or_else(overflow)?;
        cursor = next;
        if cursor == boundary || cursor == as_of {
            let interest = period_numerator
                .checked_div(period_days)
                .ok_or_else(overflow)?;
            pending = pending.checked_add(interest).ok_or_else(overflow)?;
            accrued = accrued.checked_add(interest).ok_or_else(overflow)?;
            period_numerator = Decimal::ZERO;
            // Fail before huge compound values consume excessive time or precision.
            Amount::from_decimal(accrued)?;
        }
        if cursor == boundary {
            if rule.mode == LoanInterestMode::Compound {
                let unpaid = capitalized.checked_add(pending).ok_or_else(overflow)?;
                capitalized = unpaid.max(Decimal::ZERO);
                pending = unpaid.min(Decimal::ZERO);
            }
            if cursor < as_of {
                period += 1;
                period_start = boundary;
                boundary = rule.frequency.date(rule.started_on, 1, period + 1)?;
            }
        }
    }
    let accrued_interest = Amount::from_decimal(accrued)?;
    let paid_interest = Amount::from_decimal(paid)?;
    let difference = accrued_interest.as_decimal() - paid_interest.as_decimal();
    Ok(LoanInterestAccrual {
        accrued_interest,
        paid_interest,
        remaining_interest: if difference > Decimal::ZERO {
            Amount::from_decimal(difference)?
        } else {
            Amount::zero()
        },
        overpaid_interest: if difference < Decimal::ZERO {
            Amount::from_decimal(-difference)?
        } else {
            Amount::zero()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(mode: LoanInterestMode, frequency: LoanFrequency, started: &str) -> LoanInterestRule {
        LoanInterestRule {
            mode,
            frequency,
            rate_percent: "1".parse().unwrap(),
            fixed_amount: "10".parse().unwrap(),
            started_on: started.parse().unwrap(),
        }
    }
    fn movement(date: &str, principal_delta: i64, paid: &str) -> LoanInterestMovement {
        LoanInterestMovement {
            occurred_on: date.parse().unwrap(),
            principal_delta,
            paid_interest: paid.parse().unwrap(),
        }
    }
    fn calculate(
        rule: &LoanInterestRule,
        movements: &[LoanInterestMovement],
        end: &str,
    ) -> LoanInterestAccrual {
        accrue_loan_interest(
            "1000".parse().unwrap(),
            rule,
            movements,
            end.parse().unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn all_modes_support_all_calendar_units() {
        for frequency in [
            LoanFrequency::Day,
            LoanFrequency::Month,
            LoanFrequency::Quarter,
            LoanFrequency::Year,
        ] {
            for (mode, expected) in [
                (LoanInterestMode::Simple, "20.00"),
                (LoanInterestMode::Compound, "20.10"),
                (LoanInterestMode::Fixed, "20.00"),
            ] {
                let rule = rule(mode, frequency, "2028-01-31");
                let end = frequency.date(rule.started_on, 1, 2).unwrap();
                let result =
                    accrue_loan_interest("1000".parse().unwrap(), &rule, &[], end).unwrap();
                assert_eq!(result.accrued_interest.to_string(), expected);
            }
        }
    }

    #[test]
    fn partial_periods_use_leap_days_and_the_original_month_end_anchor() {
        let rule = rule(LoanInterestMode::Simple, LoanFrequency::Month, "2028-01-31");
        assert_eq!(
            calculate(&rule, &[], "2028-02-15")
                .remaining_interest
                .to_string(),
            "5.17"
        );
        assert_eq!(
            calculate(&rule, &[], "2028-03-31")
                .remaining_interest
                .to_string(),
            "20.00"
        );
        let annual = rule.clone();
        let annual = LoanInterestRule {
            frequency: LoanFrequency::Year,
            ..annual
        };
        assert_eq!(
            calculate(&annual, &[], "2028-07-31")
                .remaining_interest
                .to_string(),
            "4.97"
        );
    }

    #[test]
    fn principal_changes_and_interest_payments_apply_on_their_actual_dates() {
        let rule = rule(LoanInterestMode::Simple, LoanFrequency::Month, "2028-04-01");
        let movements = [
            movement("2028-04-16", 100_000, "0"),
            movement("2028-04-01", -50_000, "0"),
            movement("2028-04-30", 0, "5"),
        ];
        let result = calculate(&rule, &movements, "2028-05-01");
        assert_eq!(result.accrued_interest.to_string(), "10.00");
        assert_eq!(result.remaining_interest.to_string(), "5.00");
        assert_eq!(result.paid_interest.to_string(), "5.00");
    }

    #[test]
    fn compound_interest_capitalizes_only_unpaid_completed_periods() {
        let rule = rule(
            LoanInterestMode::Compound,
            LoanFrequency::Month,
            "2028-04-01",
        );
        let result = calculate(&rule, &[movement("2028-05-01", 0, "5")], "2028-06-01");
        assert_eq!(result.accrued_interest.to_string(), "20.05");
        assert_eq!(result.remaining_interest.to_string(), "15.05");
        let result = calculate(&rule, &[movement("2028-05-01", 0, "25")], "2028-06-01");
        assert_eq!(result.accrued_interest.to_string(), "20.00");
        assert_eq!(result.remaining_interest.to_string(), "0.00");
        assert_eq!(result.overpaid_interest.to_string(), "5.00");
    }

    #[test]
    fn fixed_interest_stops_at_principal_settlement_and_future_records_are_ignored() {
        let rule = rule(LoanInterestMode::Fixed, LoanFrequency::Month, "2028-04-01");
        let result = calculate(
            &rule,
            &[
                movement("2028-04-16", -100_000, "0"),
                movement("2029-01-01", 100_000, "0"),
            ],
            "2028-06-01",
        );
        assert_eq!(result.accrued_interest.to_string(), "5.00");
    }

    #[test]
    fn a_later_interest_start_uses_the_then_outstanding_principal_and_prior_paid_credit() {
        let rule = rule(LoanInterestMode::Simple, LoanFrequency::Month, "2028-04-01");
        let result = calculate(&rule, &[movement("2028-03-01", -50_000, "1")], "2028-05-01");
        assert_eq!(result.remaining_interest.to_string(), "4.00");
        assert_eq!(
            calculate(&rule, &[], "2028-03-01")
                .accrued_interest
                .to_string(),
            "0.00"
        );
        assert_eq!(
            calculate(&rule, &[], "2028-04-01")
                .accrued_interest
                .to_string(),
            "0.00"
        );
    }

    #[test]
    fn overflow_and_invalid_rates_are_errors() {
        let mut rule = rule(LoanInterestMode::Compound, LoanFrequency::Day, "2028-01-01");
        rule.rate_percent = Decimal::ONE_HUNDRED;
        assert!(
            accrue_loan_interest(
                "1000".parse().unwrap(),
                &rule,
                &[],
                "2028-04-01".parse().unwrap()
            )
            .is_err()
        );
        rule.rate_percent = "0.123456789".parse().unwrap();
        assert_eq!(rule.validate(), Err(DomainError::InvalidRatio));
    }

    #[test]
    fn splitting_a_period_does_not_change_final_half_cent_rounding() {
        let mut rule = rule(LoanInterestMode::Simple, LoanFrequency::Month, "2028-04-01");
        rule.rate_percent = "0.5".parse().unwrap();
        for movements in [vec![], vec![movement("2028-04-11", 0, "0")]] {
            let result = accrue_loan_interest(
                "1".parse().unwrap(),
                &rule,
                &movements,
                "2028-05-01".parse().unwrap(),
            )
            .unwrap();
            assert_eq!(result.remaining_interest.to_string(), "0.01");
        }
    }
}
