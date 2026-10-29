//! A short log of what the window did (log.txt in its settings folder), so a problem on someone's PC can be traced
//! afterwards. It keeps about the last 256 KiB, in log.txt and log.old.txt.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE: &str = "log.txt";
const LIMIT: u64 = 128 * 1024;

#[derive(Clone, Debug)]
pub struct Log {
    pub path: PathBuf,
}

impl Log {
    pub fn new(path: PathBuf) -> Log {
        Log { path }
    }

    /// Appends a line with the time; a log that cannot be written is not worth stopping for.
    pub fn write(&self, line: &str) {
        let _ = self.append(line);
    }

    fn append(&self, line: &str) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::metadata(&self.path).is_ok_and(|meta| meta.len() > LIMIT) {
            let _ = fs::rename(&self.path, self.path.with_extension("old.txt"));
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{} {line}", timestamp(SystemTime::now()))
    }
}

/// UTC time such as `2026-10-29 10:51:02Z`.
pub fn timestamp(time: SystemTime) -> String {
    let seconds = time.duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0);
    let (year, month, day) = civil((seconds / 86_400) as i64);
    let rest = seconds % 86_400;
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// The calendar date `days` after 1970-01-01 (Howard Hinnant's days-to-civil).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 } as u32;
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_utc_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(11_016), (2000, 2, 29));
        assert_eq!(civil(19_723), (2024, 1, 1));
        assert_eq!(timestamp(UNIX_EPOCH + Duration::from_secs(19_723 * 86_400 + 3723)), "2024-01-01 01:02:03Z");
    }

    #[test]
    fn appends_lines_and_rolls_over() {
        let dir = std::env::temp_dir().join(format!("spraylab-direction-log-{}", std::process::id()));
        let log = Log::new(dir.join(FILE));
        log.write("first");
        log.write("second");
        let text = fs::read_to_string(&log.path).unwrap();
        assert!(text.lines().count() == 2 && text.ends_with("Z second\n"), "{text}");
        fs::write(&log.path, vec![b'x'; LIMIT as usize + 1]).unwrap();
        log.write("third");
        assert!(dir.join("log.old.txt").is_file());
        assert!(fs::read_to_string(&log.path).unwrap().ends_with("third\n"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
