use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::{CalendarDate, DomainError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct YearMonth {
    year: i32,
    month: u8,
}

impl YearMonth {
    pub fn new(year: i32, month: u8) -> Result<Self, DomainError> {
        if !(1..=9999).contains(&year) || !(1..=12).contains(&month) {
            return Err(DomainError::InvalidYearMonth);
        }

        Ok(Self { year, month })
    }

    pub const fn year(self) -> i32 {
        self.year
    }

    pub const fn month(self) -> u8 {
        self.month
    }

    pub fn database_anchor(self) -> String {
        format!("{self}-01")
    }

    pub fn first_date(self) -> CalendarDate {
        CalendarDate::new(self.year, u32::from(self.month), 1)
            .expect("valid year-month always has a first day")
    }

    pub fn last_day(self) -> u32 {
        match self.month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if self.year % 400 == 0 || (self.year % 4 == 0 && self.year % 100 != 0) => 29,
            2 => 28,
            _ => unreachable!("YearMonth invariant guarantees valid month"),
        }
    }

    pub fn date_clamped_to_day(self, day: u32) -> CalendarDate {
        CalendarDate::new(self.year, u32::from(self.month), day.min(self.last_day()))
            .expect("clamped day is valid")
    }

    pub fn from_database_anchor(value: &str) -> Result<Self, DomainError> {
        if value.len() != 10 || !value.ends_with("-01") {
            return Err(DomainError::InvalidYearMonth);
        }
        value[0..7].parse()
    }

    pub fn add_months(self, months: i32) -> Result<Self, DomainError> {
        let month_index = self.month_index() + i64::from(months);
        let year = month_index.div_euclid(12);
        let month = month_index.rem_euclid(12) + 1;
        let year = i32::try_from(year).map_err(|_| DomainError::InvalidYearMonth)?;
        let month = u8::try_from(month).map_err(|_| DomainError::InvalidYearMonth)?;

        Self::new(year, month)
    }

    pub fn next_month(self) -> Result<Self, DomainError> {
        self.add_months(1)
    }

    pub fn months_since(self, earlier: Self) -> Option<u32> {
        let difference = self.month_index() - earlier.month_index();
        u32::try_from(difference).ok()
    }

    fn month_index(self) -> i64 {
        i64::from(self.year) * 12 + i64::from(self.month) - 1
    }
}

impl fmt::Display for YearMonth {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:04}-{:02}", self.year, self.month)
    }
}

impl FromStr for YearMonth {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() != 7 || value.as_bytes().get(4) != Some(&b'-') {
            return Err(DomainError::InvalidYearMonth);
        }

        let year = value[0..4]
            .parse::<i32>()
            .map_err(|_| DomainError::InvalidYearMonth)?;
        let month = value[5..7]
            .parse::<u8>()
            .map_err(|_| DomainError::InvalidYearMonth)?;
        Self::new(year, month)
    }
}
