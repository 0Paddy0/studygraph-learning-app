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
        let deck_id = deck_node_id(&card.deck_slug);
        let topic_id = topic_node_id(&card.deck_slug, &card.topic_slug);
        let card_id = card_node_id(&card.id.to_string());

        upsert_node(
            &mut nodes,
            StudyGraphNode {
                id: deck_id.clone(),
                kind: StudyGraphNodeKind::Deck,
                label: card.deck.clone(),
                total_cards: 0,
                due_cards: 0,
                weak_cards: 0,
            },
            card,
        );

        upsert_node(
            &mut nodes,
            StudyGraphNode {
                id: topic_id.clone(),
                kind: StudyGraphNodeKind::Topic,
                label: card.topic.clone(),
                total_cards: 0,
                due_cards: 0,
                weak_cards: 0,
            },
            card,
        );

        upsert_node(
            &mut nodes,
            StudyGraphNode {
                id: card_id.clone(),
                kind: StudyGraphNodeKind::Card,
                label: card.question.clone(),
                total_cards: 0,
                due_cards: 0,
                weak_cards: 0,
            },
            card,
        );

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

        for concept in concept_labels(card) {
            let concept_slug = normalize_slug(&concept);
            if concept_slug.is_empty() {
                continue;
            }

            let concept_id = concept_node_id(&concept_slug);
            upsert_node(
                &mut nodes,
                StudyGraphNode {
                    id: concept_id.clone(),
                    kind: StudyGraphNodeKind::Concept,
                    label: concept,
                    total_cards: 0,
                    due_cards: 0,
                    weak_cards: 0,
                },
                card,
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
                upsert_node(
                    &mut nodes,
                    StudyGraphNode {
                        id: source_id.clone(),
                        kind: StudyGraphNodeKind::Source,
                        label: source_page.clone(),
                        total_cards: 0,
                        due_cards: 0,
                        weak_cards: 0,
                    },
                    card,
                );
                insert_edge(
                    &mut edges,
                    card_id.clone(),
                    source_id,
                    StudyGraphEdgeKind::Source,
                );
            }
        }

        if is_weak(card) {
            let weak_id = "concept:weak-cards".to_string();
            upsert_node(
                &mut nodes,
                StudyGraphNode {
                    id: weak_id.clone(),
                    kind: StudyGraphNodeKind::Concept,
                    label: "Weak Cards".to_string(),
                    total_cards: 0,
                    due_cards: 0,
                    weak_cards: 0,
                },
                card,
            );
            insert_edge(&mut edges, weak_id, card_id, StudyGraphEdgeKind::Related);
        }
    }

    for node in nodes.values_mut() {
        if node.kind == StudyGraphNodeKind::Card {
            continue;
        }
        let related_cards = cards_for_node(node, cards);
        node.total_cards = related_cards.len() as u32;
        node.due_cards = related_cards
            .iter()
            .filter(|card| is_due(card, now))
            .count() as u32;
        node.weak_cards = related_cards.iter().filter(|card| is_weak(card)).count() as u32;
    }

    StudyGraphData {
        nodes: nodes.into_values().collect(),
        edges: edges.into_values().collect(),
    }
}

fn upsert_node(
    nodes: &mut BTreeMap<String, StudyGraphNode>,
    mut node: StudyGraphNode,
    card: &StudyCard,
) {
    if node.kind == StudyGraphNodeKind::Card {
        node.total_cards = 1;
        node.due_cards = u32::from(is_due(card, Utc::now()));
        node.weak_cards = u32::from(is_weak(card));
    }
    nodes.entry(node.id.clone()).or_insert(node);
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

fn cards_for_node<'a>(node: &StudyGraphNode, cards: &'a [StudyCard]) -> Vec<&'a StudyCard> {
    match node.kind {
        StudyGraphNodeKind::Deck => cards
            .iter()
            .filter(|card| node.id == deck_node_id(&card.deck_slug))
            .collect(),
        StudyGraphNodeKind::Topic => cards
            .iter()
            .filter(|card| node.id == topic_node_id(&card.deck_slug, &card.topic_slug))
            .collect(),
        StudyGraphNodeKind::Concept => {
            if node.id == "concept:weak-cards" {
                cards.iter().filter(|card| is_weak(card)).collect()
            } else {
                cards
                    .iter()
                    .filter(|card| {
                        concept_labels(card)
                            .iter()
                            .any(|concept| node.id == concept_node_id(&normalize_slug(concept)))
                    })
                    .collect()
            }
        }
        StudyGraphNodeKind::Source => cards
            .iter()
            .filter(|card| {
                card.source_page
                    .as_ref()
                    .is_some_and(|source| node.id == source_node_id(&normalize_slug(source)))
            })
            .collect(),
        StudyGraphNodeKind::Card => cards
            .iter()
            .filter(|card| node.id == card_node_id(&card.id.to_string()))
            .collect(),
    }
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
    }
}
