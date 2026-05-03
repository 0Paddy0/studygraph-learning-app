use crate::model::StudyCard;
use crate::normalize::normalize_slug;
use crate::scheduler::{is_due, is_weak};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyGraphNode {
    pub id: String,
    pub kind: StudyGraphNodeKind,
    pub label: String,
    pub total_cards: u32,
    pub due_cards: u32,
    pub weak_cards: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyGraphNodeKind {
    Deck,
    Topic,
    Card,
    Concept,
    Source,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StudyGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: StudyGraphEdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StudyGraphEdgeKind {
    Contains,
    References,
    Source,
    Related,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyGraphData {
    pub nodes: Vec<StudyGraphNode>,
    pub edges: Vec<StudyGraphEdge>,
}

pub fn build_study_graph(cards: &[StudyCard]) -> StudyGraphData {
    let now = Utc::now();
    let mut nodes: BTreeMap<String, StudyGraphNode> = BTreeMap::new();
    let mut edges: BTreeMap<String, StudyGraphEdge> = BTreeMap::new();

    for card in cards {
        let card_due = is_due(card, now);
        let card_weak = is_weak(card);
        let deck_id = deck_node_id(&card.deck_slug);
        let topic_id = topic_node_id(&card.deck_slug, &card.topic_slug);
        let card_id = card_node_id(&card.id.to_string());

        upsert_summary_node(
            &mut nodes,
            &deck_id,
            StudyGraphNodeKind::Deck,
            &card.deck,
            card_due,
            card_weak,
        );
        upsert_summary_node(
            &mut nodes,
            &topic_id,
            StudyGraphNodeKind::Topic,
            &card.topic,
            card_due,
            card_weak,
        );
        upsert_card_node(&mut nodes, &card_id, card, card_due, card_weak);

        insert_edge(
            &mut edges,
            deck_id.clone(),
            topic_id.clone(),
            StudyGraphEdgeKind::Contains,
        );
        insert_edge(
            &mut edges,
            topic_id.clone(),
            card_id.clone(),
            StudyGraphEdgeKind::Contains,
        );

        if card.topic_slug == "general" {
            insert_edge(
                &mut edges,
                deck_id.clone(),
                card_id.clone(),
                StudyGraphEdgeKind::Contains,
            );
        }

        let mut seen_concept_slugs = BTreeSet::new();
        for concept in concept_labels(card) {
            let concept_slug = normalize_slug(&concept);
            if concept_slug.is_empty() || !seen_concept_slugs.insert(concept_slug.clone()) {
                continue;
            }

            let concept_id = concept_node_id(&concept_slug);
            upsert_summary_node(
                &mut nodes,
                &concept_id,
                StudyGraphNodeKind::Concept,
                &concept,
                card_due,
                card_weak,
            );
            insert_edge(
                &mut edges,
                card_id.clone(),
                concept_id,
                StudyGraphEdgeKind::References,
            );
        }

        if let Some(source_page) = &card.source_page {
            let source_slug = normalize_slug(source_page);
            if !source_slug.is_empty() {
                let source_id = source_node_id(&source_slug);
                upsert_summary_node(
                    &mut nodes,
                    &source_id,
                    StudyGraphNodeKind::Source,
                    source_page,
                    card_due,
                    card_weak,
                );
                insert_edge(
                    &mut edges,
                    card_id.clone(),
                    source_id,
                    StudyGraphEdgeKind::Source,
                );
            }
        }

        if card_weak {
            let weak_id = "concept:weak-cards".to_string();
            upsert_summary_node(
                &mut nodes,
                &weak_id,
                StudyGraphNodeKind::Concept,
                "Weak Cards",
                card_due,
                card_weak,
            );
            insert_edge(&mut edges, weak_id, card_id, StudyGraphEdgeKind::Related);
        }
    }

    StudyGraphData {
        nodes: nodes.into_values().collect(),
        edges: edges.into_values().collect(),
    }
}

fn upsert_summary_node(
    nodes: &mut BTreeMap<String, StudyGraphNode>,
    id: &str,
    kind: StudyGraphNodeKind,
    label: &str,
    due: bool,
    weak: bool,
) {
    let node = nodes
        .entry(id.to_string())
        .or_insert_with(|| StudyGraphNode {
            id: id.to_string(),
            kind,
            label: label.to_string(),
            total_cards: 0,
            due_cards: 0,
            weak_cards: 0,
        });
    node.total_cards += 1;
    node.due_cards += u32::from(due);
    node.weak_cards += u32::from(weak);
}

fn upsert_card_node(
    nodes: &mut BTreeMap<String, StudyGraphNode>,
    id: &str,
    card: &StudyCard,
    due: bool,
    weak: bool,
) {
    nodes
        .entry(id.to_string())
        .or_insert_with(|| StudyGraphNode {
            id: id.to_string(),
            kind: StudyGraphNodeKind::Card,
            label: card.question.clone(),
            total_cards: 1,
            due_cards: u32::from(due),
            weak_cards: u32::from(weak),
        });
}

fn insert_edge(
    edges: &mut BTreeMap<String, StudyGraphEdge>,
    source: String,
    target: String,
    kind: StudyGraphEdgeKind,
) {
    let id = format!("{kind:?}:{source}:{target}");
    edges.entry(id.clone()).or_insert(StudyGraphEdge {
        id,
        source,
        target,
        kind,
    });
}

fn concept_labels(card: &StudyCard) -> Vec<String> {
    let mut labels = BTreeSet::new();

    for page in &card.linked_pages {
        let lower = page.to_ascii_lowercase();
        if !lower.starts_with("deck/") && !lower.starts_with("topic/") {
            labels.insert(page.clone());
        }
    }

    for tag in &card.tags {
        let lower = tag.to_ascii_lowercase();
        if lower != "card" && !lower.starts_with("deck/") && !lower.starts_with("topic/") {
            labels.insert(format!("#{tag}"));
        }
    }

    labels.into_iter().collect()
}

fn deck_node_id(deck_slug: &str) -> String {
    format!("deck:{deck_slug}")
}

fn topic_node_id(deck_slug: &str, topic_slug: &str) -> String {
    format!("topic:{deck_slug}:{topic_slug}")
}

fn card_node_id(card_id: &str) -> String {
    format!("card:{card_id}")
}

fn concept_node_id(concept_slug: &str) -> String {
    format!("concept:{concept_slug}")
}

fn source_node_id(source_slug: &str) -> String {
    format!("source:{source_slug}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::{parse_logseq_markdown_page, scan_cards_from_pages};

    #[test]
    fn builds_deck_topic_card_concept_and_source_nodes() {
        let page = parse_logseq_markdown_page(
            "Trading Notes",
            "- What is a stop loss? #card [[Stop Loss]] #risk\n  sgd-deck:: Trading\n  sgd-topic:: Risk Management\n  - A predefined exit at a loss.",
        );
        let (cards, _) = scan_cards_from_pages(&[page]);

        let graph = build_study_graph(&cards);
        let node_ids = graph
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>();

        assert!(node_ids.contains(&"deck:trading"));
        assert!(node_ids.contains(&"topic:trading:risk-management"));
        assert!(node_ids.iter().any(|id| id.starts_with("card:")));
        assert!(node_ids.contains(&"concept:stop-loss"));
        assert!(node_ids.contains(&"concept:risk"));
        assert!(node_ids.contains(&"source:trading-notes"));

        let deck = graph
            .nodes
            .iter()
            .find(|node| node.id == "deck:trading")
            .unwrap();
        assert_eq!(deck.total_cards, 1);
    }

    #[test]
    fn counts_same_concept_slug_once_per_card() {
        let page = parse_logseq_markdown_page(
            "Risk",
            "- Define risk #card [[Risk]] #risk\n  - Exposure to loss.",
        );
        let (cards, warnings) = scan_cards_from_pages(&[page]);

        assert!(warnings.is_empty());

        let graph = build_study_graph(&cards);
        let concept = graph
            .nodes
            .iter()
            .find(|node| node.id == "concept:risk")
            .unwrap();
        assert_eq!(concept.total_cards, 1);
    }

    #[test]
    fn summarizes_large_graph_without_duplicate_edges() {
        let mut markdown = String::new();
        for index in 0..750 {
            markdown.push_str(&format!(
                "- Card {index} #card [[Concept {}]] #batch\n  sgd-deck:: Big Deck\n  sgd-topic:: Topic {}\n  - Answer {index}\n",
                index % 25,
                index % 10
            ));
        }
        let page = parse_logseq_markdown_page("Large", &markdown);
        let (cards, warnings) = scan_cards_from_pages(&[page]);

        assert_eq!(cards.len(), 750);
        assert!(warnings.is_empty());

        let graph = build_study_graph(&cards);
        let deck = graph
            .nodes
            .iter()
            .find(|node| node.id == "deck:big-deck")
            .unwrap();
        assert_eq!(deck.total_cards, 750);
        assert_eq!(
            graph
                .nodes
                .iter()
                .find(|node| node.id == "concept:batch")
                .unwrap()
                .total_cards,
            750
        );
        assert_eq!(
            graph
                .edges
                .iter()
                .map(|edge| &edge.id)
                .collect::<BTreeSet<_>>()
                .len(),
            graph.edges.len()
        );
    }
}
