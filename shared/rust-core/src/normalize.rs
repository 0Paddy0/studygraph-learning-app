pub fn normalize_display_name(value: &str, fallback: &str) -> String {
    let display = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if display.is_empty() {
        fallback.to_string()
    } else {
        display
    }
}

pub fn normalize_slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = false;
    let mut last_was_slash = false;

    for ch in value.trim().to_lowercase().chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_was_dash = false;
            last_was_slash = false;
        } else if ch == '/' {
            while out.ends_with('-') {
                out.pop();
            }
            if !out.is_empty() && !last_was_slash {
                out.push('/');
            }
            last_was_dash = false;
            last_was_slash = true;
        } else if !last_was_dash && !last_was_slash && !out.is_empty() {
            out.push('-');
            last_was_dash = true;
        }
    }

    out.trim_matches(|ch| ch == '-' || ch == '/').to_string()
}

pub fn normalize_deck_name(value: Option<&str>) -> (String, String) {
    let display = normalize_display_name(value.unwrap_or(""), "Unassigned");
    let slug = normalize_slug(&display);
    (
        display,
        if slug.is_empty() {
            "unassigned".to_string()
        } else {
            slug
        },
    )
}

pub fn normalize_topic_name(value: Option<&str>) -> (String, String) {
    let display = normalize_display_name(value.unwrap_or(""), "General");
    let slug = normalize_slug(&display);
    (
        display,
        if slug.is_empty() {
            "general".to_string()
        } else {
            slug
        },
    )
}

pub fn normalize_property_key(key: &str) -> String {
    let mut out = String::new();
    let mut previous_was_lower = false;

    for ch in key.trim().chars() {
        if ch == '_' {
            out.push('-');
            previous_was_lower = false;
        } else if ch.is_uppercase() {
            if previous_was_lower {
                out.push('-');
            }
            out.extend(ch.to_lowercase());
            previous_was_lower = false;
        } else {
            previous_was_lower = ch.is_lowercase();
            out.push(ch.to_ascii_lowercase());
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_slug_case_insensitive() {
        assert_eq!(normalize_slug(" Trading Basics "), "trading-basics");
        assert_eq!(normalize_slug("Trading"), normalize_slug("trading"));
    }

    #[test]
    fn preserves_unicode_letters() {
        assert_eq!(
            normalize_slug("Risikomanagement fuer Anfaenger"),
            "risikomanagement-fuer-anfaenger"
        );
    }
}
