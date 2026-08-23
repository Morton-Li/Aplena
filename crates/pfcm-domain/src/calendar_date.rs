use std::{fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use crate::{DomainError, YearMonth};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CalendarDate {
    year: i32,
    month: u8,
    day: u8,
}

impl CalendarDate {
    pub fn new(year: i32, month: u32, day: u32) -> Result<Self, DomainError> {
        if !(1..=9999).contains(&year) {
            return Err(DomainError::InvalidDate);
        }
        let month = u8::try_from(month).map_err(|_| DomainError::InvalidDate)?;
        let day = u8::try_from(day).map_err(|_| DomainError::InvalidDate)?;
        let max_day = days_in_month(year, month).ok_or(DomainError::InvalidDate)?;
        if day == 0 || day > max_day {
            return Err(DomainError::InvalidDate);
        }
        Ok(Self { year, month, day })
    }

    pub fn year_month(self) -> YearMonth {
        YearMonth::new(self.year, self.month).expect("valid date always has a valid year-month")
    }

    pub fn day(self) -> u32 {
        u32::from(self.day)
    }
}

impl fmt::Display for CalendarDate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{:04}-{:02}-{:02}",
            self.year, self.month, self.day
        )
    }
}

impl FromStr for CalendarDate {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() != 10 {
            return Err(DomainError::InvalidDate);
        }
        if value.as_bytes().get(4) != Some(&b'-') || value.as_bytes().get(7) != Some(&b'-') {
            return Err(DomainError::InvalidDate);
        }
        let year = value[0..4].parse().map_err(|_| DomainError::InvalidDate)?;
        let month = value[5..7].parse().map_err(|_| DomainError::InvalidDate)?;
        let day = value[8..10].parse().map_err(|_| DomainError::InvalidDate)?;
        Self::new(year, month, day)
    }
}

fn days_in_month(year: i32, month: u8) -> Option<u8> {
    Some(match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return None,
    })
}

impl Serialize for CalendarDate {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for CalendarDate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .parse()
            .map_err(de::Error::custom)
    }
}
