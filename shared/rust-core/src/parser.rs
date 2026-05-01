use crate::model::{Block, CardState, Page, Rating, SrsState, StudyCard};
use crate::normalize::{normalize_deck_name, normalize_property_key, normalize_topic_name};
use crate::scheduler::{default_srs_state, SchedulerSettings};
use chrono::{DateTime, Utc};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseWarning {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FlatBlock {
    id: Uuid,
    content: String,
    properties: BTreeMap<String, String>,
    parent: Option<usize>,
}

pub fn scan_cards_from_pages(pages: &[Page]) -> (Vec<StudyCard>, Vec<ParseWarning>) {
    let mut cards = Vec::new();
    let mut warnings = Vec::new();
    let now = Utc::now();

    for page in pages {
        let mut ancestors = Vec::new();
        for block in &page.blocks {
            scan_block(page, block, &mut ancestors, &mut cards, &mut warnings, now);
        }
    }

    cards.sort_by(|left, right| left.question.cmp(&right.question));
    cards.dedup_by_key(|card| card.id);

    (cards, warnings)
}

pub fn parse_logseq_markdown_page(name: &str, markdown: &str) -> Page {
    let mut page_name = name.trim().to_string();
    let mut page_properties = BTreeMap::new();
    let mut flat_blocks: Vec<FlatBlock> = Vec::new();
    let mut depth_stack: Vec<usize> = Vec::new();
    let mut seen_block = false;

    for raw_line in markdown.lines() {
        if raw_line.trim().is_empty() {
            continue;
        }

        let leading_spaces = raw_line.chars().take_while(|ch| *ch == ' ').count();
        let trimmed = raw_line.trim();

        if !seen_block && trimmed.starts_with("# ") {
            page_name = trimmed.trim_start_matches("# ").trim().to_string();
            continue;
        }

        if let Some((key, value)) = parse_property_line(trimmed) {
            if seen_block || leading_spaces > 0 {
                if let Some(target_index) = target_block_for_property(leading_spaces, &depth_stack)
                {
                    flat_blocks[target_index]
                        .properties
                        .insert(normalize_property_key(&key), value);
                }
            } else {
                page_properties.insert(normalize_property_key(&key), value);
            }
            continue;
        }

        if let Some(content) = trimmed.strip_prefix("- ") {
            seen_block = true;
            let depth = leading_spaces / 2;
            while depth_stack.len() > depth {
                depth_stack.pop();
            }
            let parent = if depth == 0 {
                None
            } else {
                depth_stack.get(depth - 1).copied()
            };
            let index = flat_blocks.len();
            flat_blocks.push(FlatBlock {
                id: Uuid::new_v4(),
                content: content.trim().to_string(),
                properties: BTreeMap::new(),
                parent,
            });
            if depth_stack.len() == depth {
                depth_stack.push(index);
            } else {
                depth_stack[depth] = index;
            }
            continue;
        }

        if let Some(last_index) = depth_stack.last().copied() {
            flat_blocks[last_index].content.push('\n');
            flat_blocks[last_index].content.push_str(trimmed);
        }
    }

    let blocks = build_tree(&flat_blocks, None);

    Page {
        id: Uuid::new_v4(),
        name: page_name,
        properties: page_properties,
        blocks,
    }
}

pub fn block_contains_card_marker(block: &Block) -> bool {
    content_contains_card_marker(&block.content)
        || property_truthy(&block.properties, "card")
        || property_truthy(&block.properties, "sgd-card")
}

pub fn extract_linked_pages(content: &str) -> Vec<String> {
    let mut pages = BTreeSet::new();
    let mut rest = content;

    while let Some(start) = rest.find("[[") {
        let after_start = &rest[start + 2..];
        if let Some(end) = after_start.find("]]") {
            let page = after_start[..end].trim();
            if !page.is_empty() {
                pages.insert(page.to_string());
            }
            rest = &after_start[end + 2..];
        } else {
            break;
        }
    }

    pages.into_iter().collect()
}

pub fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = BTreeSet::new();
    let chars: Vec<char> = content.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        if chars[index] != '#' {
            index += 1;
            continue;
        }

        if index + 2 < chars.len() && chars[index + 1] == '[' && chars[index + 2] == '[' {
            let mut end = index + 3;
            while end + 1 < chars.len() && !(chars[end] == ']' && chars[end + 1] == ']') {
                end += 1;
            }
            if end + 1 < chars.len() {
                let tag: String = chars[index + 3..end].iter().collect();
                if !tag.trim().is_empty() {
                    tags.insert(tag.trim().to_string());
                }
                index = end + 2;
                continue;
            }
        }

        let mut end = index + 1;
        while end < chars.len() && is_tag_char(chars[end]) {
            end += 1;
        }

        if end > index + 1 {
            let tag: String = chars[index + 1..end].iter().collect();
            tags.insert(
                tag.trim_matches(|ch: char| ",.;:!?".contains(ch))
                    .to_string(),
            );
        }
        index = end.max(index + 1);
    }

    tags.into_iter().filter(|tag| !tag.is_empty()).collect()
}

pub fn strip_metadata_from_question(content: &str) -> String {
    content
        .lines()
        .filter(|line| !is_metadata_property_line(line.trim()))
        .map(strip_metadata_tokens)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn scan_block(
    page: &Page,
    block: &Block,
    ancestors: &mut Vec<String>,
    cards: &mut Vec<StudyCard>,
    warnings: &mut Vec<ParseWarning>,
    now: DateTime<Utc>,
) {
    if block_contains_card_marker(block) {
        let card = parse_block_to_card(page, block, ancestors, now);
        if card.incomplete {
            warnings.push(ParseWarning {
                message: format!("Card '{}' has no answer child blocks.", card.question),
            });
        }
        cards.push(card);
    }

    ancestors.push(block.content.clone());
    for child in &block.children {
        scan_block(page, child, ancestors, cards, warnings, now);
    }
    ancestors.pop();
}

fn parse_block_to_card(
    page: &Page,
    block: &Block,
    ancestors: &[String],
    now: DateTime<Utc>,
) -> StudyCard {
    let mut properties = block.properties.clone();
    properties.extend(extract_inline_properties(&block.content));

    let links = extract_linked_pages(&block.content);
    let tags = extract_tags(&block.content)
        .into_iter()
        .filter(|tag| !tag.eq_ignore_ascii_case("card"))
        .collect::<Vec<_>>();

    let deck_from_content = deck_or_topic_from_content(&block.content, "deck");
    let topic_from_content = deck_or_topic_from_content(&block.content, "topic");
    let ancestor_deck = deck_from_ancestors(ancestors);
    let namespace_deck = page.name.strip_prefix("Decks/").map(str::to_string);

    let deck_value = first_non_empty([
        property_value(&properties, "sgd-deck"),
        property_value(&properties, "deck"),
        property_value(&page.properties, "sgd-deck"),
        property_value(&page.properties, "deck"),
        deck_from_content.as_deref(),
        ancestor_deck.as_deref(),
        namespace_deck.as_deref(),
    ]);

    let strong_link_topic = links
        .iter()
        .find(|link| !is_metadata_namespace(link))
        .map(String::as_str);

    let topic_value = first_non_empty([
        property_value(&properties, "sgd-topic"),
        property_value(&properties, "topic"),
        property_value(&page.properties, "sgd-topic"),
        property_value(&page.properties, "topic"),
        topic_from_content.as_deref(),
        strong_link_topic,
        Some(page.name.as_str()),
    ]);

    let (deck, deck_slug) = normalize_deck_name(deck_value);
    let (topic, topic_slug) = normalize_topic_name(topic_value);
    let answer_markdown = answer_markdown_from_children(&block.children, 0)
        .trim()
        .to_string();
    let srs = srs_from_properties(&properties, now);

    StudyCard {
        id: block.id,
        block_id: block.id,
        question: strip_metadata_from_question(&block.content),
        answer_markdown: answer_markdown.clone(),
        deck,
        deck_slug,
        topic,
        topic_slug,
        source_page: Some(page.name.clone()),
        linked_pages: links,
        tags,
        raw_content: block.content.clone(),
        properties,
        srs,
        incomplete: answer_markdown.is_empty(),
    }
}

fn srs_from_properties(properties: &BTreeMap<String, String>, now: DateTime<Utc>) -> SrsState {
    let settings = SchedulerSettings::default();
    let defaults = default_srs_state(now, settings);

    SrsState {
        state: match property_value(properties, "sgd-state") {
            Some("learning") => CardState::Learning,
            Some("review") => CardState::Review,
            _ => CardState::New,
        },
        due_at: property_value(properties, "sgd-due-at").and_then(parse_datetime),
        interval_days: property_value(properties, "sgd-interval-days")
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.interval_days),
        ease: property_value(properties, "sgd-ease")
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.ease),
        reps: property_value(properties, "sgd-reps")
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.reps),
        lapses: property_value(properties, "sgd-lapses")
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.lapses),
        last_reviewed_at: property_value(properties, "sgd-last-reviewed-at")
            .and_then(parse_datetime),
        last_rating: match property_value(properties, "sgd-last-rating") {
            Some("again") => Some(Rating::Again),
            Some("hard") => Some(Rating::Hard),
            Some("good") => Some(Rating::Good),
            Some("easy") => Some(Rating::Easy),
            _ => None,
        },
        hard_count: property_value(properties, "sgd-hard-count")
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.hard_count),
        created_at: property_value(properties, "sgd-created-at")
            .and_then(parse_datetime)
            .unwrap_or(defaults.created_at),
    }
}

fn answer_markdown_from_children(children: &[Block], depth: usize) -> String {
    let mut lines = Vec::new();
    for child in children {
        let content = child
            .content
            .lines()
            .filter(|line| !is_metadata_property_line(line.trim()))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if !content.is_empty() {
            lines.push(format!("{}- {}", "  ".repeat(depth), content));
        }
        let nested = answer_markdown_from_children(&child.children, depth + 1);
        if !nested.is_empty() {
            lines.push(nested);
        }
    }
    lines.join("\n")
}

fn extract_inline_properties(content: &str) -> BTreeMap<String, String> {
    content
        .lines()
        .filter_map(|line| parse_property_line(line.trim()))
        .map(|(key, value)| (normalize_property_key(&key), value))
        .collect()
}

fn parse_property_line(line: &str) -> Option<(String, String)> {
    let (key, value) = line.split_once("::")?;
    let key = key.trim();
    if key.is_empty()
        || !key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return None;
    }
    Some((key.to_string(), value.trim().to_string()))
}

fn is_metadata_property_line(line: &str) -> bool {
    parse_property_line(line).is_some_and(|(key, _)| {
        let key = normalize_property_key(&key);
        key == "deck" || key == "topic" || key == "card" || key.starts_with("sgd-")
    })
}

fn strip_metadata_tokens(line: &str) -> String {
    line.split_whitespace()
        .filter(|token| {
            let lower = token.to_ascii_lowercase();
            lower != "#card"
                && lower != "#card,"
                && !lower.starts_with("#deck/")
                && !lower.starts_with("#topic/")
                && !lower.starts_with("[[deck/")
                && !lower.starts_with("[[topic/")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn deck_or_topic_from_content(content: &str, wanted: &str) -> Option<String> {
    for tag in extract_tags(content) {
        if let Some(value) = tag
            .strip_prefix(&format!("{wanted}/"))
            .or_else(|| tag.strip_prefix(&format!("{}/", wanted.to_ascii_uppercase())))
        {
            return Some(value.replace('-', " ").trim().to_string());
        }
    }

    for link in extract_linked_pages(content) {
        if link.to_ascii_lowercase().starts_with(&format!("{wanted}/")) {
            return Some(link.split('/').skip(1).collect::<Vec<_>>().join("/"));
        }
    }

    None
}

fn deck_from_ancestors(ancestors: &[String]) -> Option<String> {
    for ancestor in ancestors.iter().rev() {
        if let Some(deck) = deck_or_topic_from_content(ancestor, "deck") {
            return Some(deck);
        }
        let links = extract_linked_pages(ancestor);
        if links.len() == 1 && ancestor.trim() == format!("[[{}]]", links[0]) {
            return Some(links[0].clone());
        }
    }
    None
}

fn property_truthy(properties: &BTreeMap<String, String>, key: &str) -> bool {
    property_value(properties, key).is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "yes" | "y" | "1"
        )
    })
}

fn property_value<'a>(properties: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    let wanted = normalize_property_key(key);
    properties
        .iter()
        .find(|(candidate, _)| normalize_property_key(candidate) == wanted)
        .map(|(_, value)| value.as_str())
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<&'a str> {
    values
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|datetime| datetime.with_timezone(&Utc))
}

fn content_contains_card_marker(content: &str) -> bool {
    content.split_whitespace().any(|token| {
        token
            .trim_matches(|ch: char| ",.;:!?()[]{}".contains(ch))
            .eq_ignore_ascii_case("#card")
    })
}

fn is_metadata_namespace(page: &str) -> bool {
    let lower = page.to_ascii_lowercase();
    lower.starts_with("deck/") || lower.starts_with("topic/")
}

fn is_tag_char(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '/' | '-' | '_' | ':')
}

fn target_block_for_property(leading_spaces: usize, stack: &[usize]) -> Option<usize> {
    if stack.is_empty() {
        return None;
    }
    let property_depth = leading_spaces / 2;
    let target_depth = property_depth.saturating_sub(1);
    stack
        .get(target_depth)
        .copied()
        .or_else(|| stack.last().copied())
}

fn build_tree(flat_blocks: &[FlatBlock], parent: Option<usize>) -> Vec<Block> {
    flat_blocks
        .iter()
        .enumerate()
        .filter(|(_, block)| block.parent == parent)
        .map(|(index, block)| Block {
            id: block.id,
            content: block.content.clone(),
            properties: block.properties.clone(),
            children: build_tree(flat_blocks, Some(index)),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    #[test]
    fn detects_card_marker() {
        let block = Block {
            id: Uuid::new_v4(),
            content: "What is a CPU? #card".to_string(),
            properties: BTreeMap::new(),
            children: Vec::new(),
        };

        assert!(block_contains_card_marker(&block));
    }

    #[test]
    fn parses_logseq_markdown_page_tree_and_properties() {
        let page = parse_logseq_markdown_page(
            "Test",
            "# Programming\nsgd-deck:: Programming\n- What is Rust? #card\n  sgd-topic:: Rust\n  - A systems programming language.",
        );

        assert_eq!(page.name, "Programming");
        assert_eq!(page.properties.get("sgd-deck").unwrap(), "Programming");
        assert_eq!(page.blocks[0].properties.get("sgd-topic").unwrap(), "Rust");
        assert_eq!(
            page.blocks[0].children[0].content,
            "A systems programming language."
        );
    }

    #[test]
    fn scans_cards_from_pages() {
        let page = parse_logseq_markdown_page(
            "Programming",
            "- What is a union type? #card\n  sgd-deck:: Programming\n  sgd-topic:: TypeScript\n  - A type that can be one of several alternatives.",
        );

        let (cards, warnings) = scan_cards_from_pages(&[page]);

        assert!(warnings.is_empty());
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].deck, "Programming");
        assert_eq!(cards[0].topic, "TypeScript");
        assert_eq!(cards[0].question, "What is a union type?");
        assert_eq!(
            cards[0].answer_markdown,
            "- A type that can be one of several alternatives."
        );
    }

    #[test]
    fn extracts_tags_and_links() {
        let content = "Learn [[Trading]] #deck/Markets #topic/Risk-Management #card";

        assert_eq!(extract_linked_pages(content), vec!["Trading"]);
        assert_eq!(
            extract_tags(content),
            vec!["card", "deck/Markets", "topic/Risk-Management"]
        );
    }
}
