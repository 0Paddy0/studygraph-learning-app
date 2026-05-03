use crate::model::{Block, Page};
use crate::normalize::normalize_property_key;
use crate::parser::parse_logseq_markdown_page;

pub struct ImportExportPlan;

impl ImportExportPlan {
    pub const SUPPORTED_IMPORTS: &'static [&'static str] = &[
        "single-logseq-markdown-file",
        "logseq-markdown-folder",
        "studygraph-json-future",
    ];

    pub const SUPPORTED_EXPORTS: &'static [&'static str] = &[
        "logseq-compatible-markdown-folder",
        "studygraph-json",
        "cards-csv-future",
    ];
}

pub fn import_single_markdown_page(name: &str, markdown: &str) -> Page {
    parse_logseq_markdown_page(name, markdown)
}

pub fn export_page_to_logseq_markdown(page: &Page) -> String {
    let mut lines = vec![format!("# {}", page.name)];

    if !has_property(&page.properties, "id") {
        lines.push(format!("id:: {}", page.id));
    }

    for (key, value) in &page.properties {
        lines.push(format!("{key}:: {value}"));
    }

    if !page.properties.is_empty() && !page.blocks.is_empty() {
        lines.push(String::new());
    }

    for block in &page.blocks {
        lines.extend(render_block(block, 0));
    }

    lines.join("\n")
}

fn render_block(block: &Block, depth: usize) -> Vec<String> {
    let indent = "  ".repeat(depth);
    let property_indent = "  ".repeat(depth + 1);
    let mut content_lines = block.content.lines();
    let first_line = content_lines.next().unwrap_or_default();
    let mut lines = vec![format!("{indent}- {first_line}")];

    for continuation in content_lines {
        lines.push(format!("{property_indent}{continuation}"));
    }

    if !has_property(&block.properties, "id") {
        lines.push(format!("{property_indent}id:: {}", block.id));
    }

    for (key, value) in &block.properties {
        lines.push(format!("{property_indent}{key}:: {value}"));
    }

    for child in &block.children {
        lines.extend(render_block(child, depth + 1));
    }

    lines
}

fn has_property(properties: &std::collections::BTreeMap<String, String>, wanted: &str) -> bool {
    let wanted = normalize_property_key(wanted);
    properties
        .keys()
        .any(|key| normalize_property_key(key) == wanted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_and_exports_markdown_page() {
        let page = import_single_markdown_page(
            "Programming",
            "# Programming\nsgd-deck:: Programming\n- What is Rust? #card\n  sgd-topic:: Rust\n  - A language.",
        );

        let markdown = export_page_to_logseq_markdown(&page);

        assert!(markdown.contains("# Programming"));
        assert!(markdown.contains(&format!("id:: {}", page.id)));
        assert!(markdown.contains("sgd-deck:: Programming"));
        assert!(markdown.contains("- What is Rust? #card"));
        assert!(markdown.contains(&format!("  id:: {}", page.blocks[0].id)));
        assert!(markdown.contains("  sgd-topic:: Rust"));
        assert!(markdown.contains("  - A language."));
    }

    #[test]
    fn roundtrips_ids_properties_and_multiline_blocks() {
        let page = import_single_markdown_page(
            "Programming",
            "# Programming\n- What is Rust? #card\n  Explain ownership.\n  sgd-topic:: Rust\n  - Memory safety\n    without GC",
        );

        let markdown = export_page_to_logseq_markdown(&page);
        let roundtripped = import_single_markdown_page("Programming", &markdown);

        assert_eq!(roundtripped.id, page.id);
        assert_eq!(roundtripped.blocks[0].id, page.blocks[0].id);
        assert_eq!(roundtripped.blocks[0].content, page.blocks[0].content);
        assert_eq!(
            roundtripped.blocks[0].children[0].content,
            page.blocks[0].children[0].content
        );
        assert_eq!(
            roundtripped.blocks[0].properties.get("sgd-topic").unwrap(),
            "Rust"
        );
    }
}
