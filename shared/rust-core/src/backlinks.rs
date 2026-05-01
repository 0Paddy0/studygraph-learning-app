use crate::model::{Block, BlockId, PageId, Workspace};
use crate::parser::extract_linked_pages;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BacklinkReference {
    pub target_page: String,
    pub source_page_id: PageId,
    pub source_page: String,
    pub block_id: BlockId,
    pub block_content: String,
    pub block_path: Vec<String>,
}

pub fn build_backlinks(workspace: &Workspace) -> Vec<BacklinkReference> {
    let mut references: BTreeMap<(String, PageId, BlockId), BacklinkReference> = BTreeMap::new();

    for page in &workspace.pages {
        let mut path = Vec::new();
        for block in &page.blocks {
            collect_block_backlinks(page.id, &page.name, block, &mut path, &mut references);
        }
    }

    references.into_values().collect()
}

fn collect_block_backlinks(
    source_page_id: PageId,
    source_page: &str,
    block: &Block,
    path: &mut Vec<String>,
    references: &mut BTreeMap<(String, PageId, BlockId), BacklinkReference>,
) {
    path.push(block.content.clone());

    for target_page in extract_linked_pages(&block.content) {
        references.insert(
            (target_page.clone(), source_page_id, block.id),
            BacklinkReference {
                target_page,
                source_page_id,
                source_page: source_page.to_string(),
                block_id: block.id,
                block_content: block.content.clone(),
                block_path: path.clone(),
            },
        );
    }

    for child in &block.children {
        collect_block_backlinks(source_page_id, source_page, child, path, references);
    }

    path.pop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Workspace;
    use crate::parser::parse_logseq_markdown_page;
    use uuid::Uuid;

    #[test]
    fn builds_backlinks_from_block_page_links() {
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            pages: vec![
                parse_logseq_markdown_page("CPU", "- CPU note"),
                parse_logseq_markdown_page(
                    "Computer Architecture",
                    "- What does the [[CPU]] do?\n  - It executes instructions and coordinates components.",
                ),
            ],
        };

        let backlinks = build_backlinks(&workspace);

        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].target_page, "CPU");
        assert_eq!(backlinks[0].source_page, "Computer Architecture");
        assert_eq!(backlinks[0].block_path, vec!["What does the [[CPU]] do?"]);
    }

    #[test]
    fn includes_nested_block_path() {
        let workspace = Workspace {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            pages: vec![parse_logseq_markdown_page(
                "Linux",
                "- Shell\n  - `grep` filters [[Text Streams]]",
            )],
        };

        let backlinks = build_backlinks(&workspace);

        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].target_page, "Text Streams");
        assert_eq!(
            backlinks[0].block_path,
            vec![
                "Shell".to_string(),
                "`grep` filters [[Text Streams]]".to_string()
            ]
        );
    }
}
