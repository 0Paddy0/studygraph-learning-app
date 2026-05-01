pub struct SyncPlan;

impl SyncPlan {
    pub const FIRST_RULES: &'static [&'static str] = &[
        "stable-uuid-for-workspaces-pages-blocks-cards",
        "append-only-review-events",
        "derive-srs-from-review-events-when-possible",
        "last-writer-wins-settings",
        "preserve-conflicting-block-copy-when-unsafe",
    ];
}
