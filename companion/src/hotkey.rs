//! Hotkeys such as `ctrl+alt+p` or `f8`, as the modifier flags and virtual-key codes of Windows' RegisterHotKey.

pub const MOD_ALT: u32 = 0x0001;
pub const MOD_CONTROL: u32 = 0x0002;
pub const MOD_SHIFT: u32 = 0x0004;
pub const MOD_WIN: u32 = 0x0008;
/// Holding the keys down does not repeat the hotkey.
pub const MOD_NOREPEAT: u32 = 0x4000;
pub const DEFAULT: &str = "ctrl+alt+p";

#[derive(Clone, Debug, PartialEq)]
pub struct Hotkey {
    pub modifiers: u32,
    pub key: u32,
    pub name: String,
}

fn virtual_key(name: &str) -> Option<u32> {
    let bytes = name.as_bytes();
    match name {
        _ if bytes.len() == 1 && bytes[0].is_ascii_lowercase() => Some(bytes[0].to_ascii_uppercase() as u32),
        _ if bytes.len() == 1 && bytes[0].is_ascii_digit() => Some(bytes[0] as u32),
        "pause" => Some(0x13),
        "pageup" => Some(0x21),
        "pagedown" => Some(0x22),
        "end" => Some(0x23),
        "home" => Some(0x24),
        "insert" => Some(0x2D),
        "scrolllock" => Some(0x91),
        _ => {
            if let Some(n) = name.strip_prefix("numpad").and_then(|n| n.parse::<u32>().ok()).filter(|n| *n <= 9) {
                return Some(0x60 + n);
            }
            name.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()).filter(|n| (1..=24).contains(n)).map(|n| 0x6F + n)
        }
    }
}

/// Parses `ctrl+alt+p`, `shift+f9`, `f8`, ... Letters and digits need a modifier, so the hotkey never swallows typing.
pub fn parse(text: &str) -> Result<Hotkey, String> {
    let mut modifiers = 0;
    let mut key = None;
    let mut parts = Vec::new();
    for part in text.split('+').map(|part| part.trim().to_ascii_lowercase()) {
        let modifier = match part.as_str() {
            "ctrl" | "control" => MOD_CONTROL,
            "alt" => MOD_ALT,
            "shift" => MOD_SHIFT,
            "win" => MOD_WIN,
            _ => 0,
        };
        if modifier != 0 {
            modifiers |= modifier;
        } else if key.is_some() {
            return Err(format!("The hotkey \"{text}\" has more than one key besides ctrl, alt, shift and win."));
        } else {
            key = Some(virtual_key(&part).ok_or_else(|| format!("The hotkey \"{text}\" has a key this program does not know: \"{part}\". Use a letter, digit, F1-F24, pause, scrolllock, insert, home, end, pageup, pagedown or numpad0-9."))?);
        }
        parts.push(part);
    }
    let key = key.ok_or_else(|| format!("The hotkey \"{text}\" has no key besides its modifiers."))?;
    if modifiers == 0 && ((0x30..=0x39).contains(&key) || (0x41..=0x5A).contains(&key)) {
        return Err(format!("A letter or digit hotkey needs ctrl, alt or shift with it (\"{text}\" alone would stop it from typing)."));
    }
    Ok(Hotkey { modifiers, key, name: parts.join("+") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modifiers_letters_and_function_keys() {
        assert_eq!(parse("Ctrl+Alt+P").unwrap(), Hotkey { modifiers: MOD_CONTROL | MOD_ALT, key: 0x50, name: "ctrl+alt+p".into() });
        assert_eq!(parse("f8").unwrap().key, 0x77);
        assert_eq!(parse("shift + F24").unwrap(), Hotkey { modifiers: MOD_SHIFT, key: 0x87, name: "shift+f24".into() });
        assert_eq!(parse("ctrl+numpad5").unwrap().key, 0x65);
        assert_eq!(parse("alt+7").unwrap().key, 0x37);
        assert_eq!(parse("scrolllock").unwrap().key, 0x91);
        assert_eq!(parse(DEFAULT).unwrap().name, DEFAULT);
    }

    #[test]
    fn refuses_bare_typing_keys_and_nonsense() {
        assert!(parse("p").unwrap_err().contains("needs ctrl"));
        assert!(parse("ctrl+alt").unwrap_err().contains("no key"));
        assert!(parse("ctrl+a+b").unwrap_err().contains("more than one"));
        assert!(parse("ctrl+f25").is_err());
        assert!(parse("ctrl+tab").is_err());
    }
}
