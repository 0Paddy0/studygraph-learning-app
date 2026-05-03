import assert from "node:assert/strict";
import test from "node:test";
import {
  aiQualitySummary,
  createConfiguredAiProvider,
  runLocalAiCardGeneration,
  runLocalAiClozeGeneration,
} from "../.test-dist/aiPipeline.js";

const now = new Date().toISOString();

function generatorInput(overrides = {}) {
  return {
    deck: "Algorithms",
    topic: "Graphs",
    source_text: "Dijkstra algorithm: Finds shortest paths in weighted graphs with non-negative edge costs.\nPriority queue: Data structure that returns the most urgent item first.",
    language: "en",
    number_of_cards: 4,
    difficulty: "medium",
    card_style: "mixed",
    bidirectional_cards: false,
    vocabulary_mode: false,
    vocabulary_deck: "Vocabulary",
    ...overrides,
  };
}

function studyCard(overrides = {}) {
  return {
    id: "card-existing",
    block_id: "block-existing",
    question: "What does \"Dijkstra algorithm\" mean in the context of Graphs?",
    answer_markdown: "Finds shortest paths in weighted graphs with non-negative edge costs",
    deck: "Algorithms",
    deck_slug: "algorithms",
    topic: "Graphs",
    topic_slug: "graphs",
    source_page: "Algorithms",
    linked_pages: [],
    tags: [],
    raw_content: "",
    properties: {},
    incomplete: false,
    srs: {
      state: "review",
      due_at: null,
      interval_days: 0,
      ease: 2.5,
      reps: 3,
      lapses: 0,
      last_reviewed_at: null,
      last_rating: null,
      hard_count: 0,
      created_at: now,
    },
    ...overrides,
  };
}

const settings = {
  defaultDeck: "Generated",
  defaultTopic: "General",
  newCardsPerDay: 20,
  reviewsPerDay: 120,
  apiProviderEnabled: true,
  apiBaseUrl: "https://api.example.invalid",
  apiModel: "future-model",
  openAiConnectionMode: "apiKey",
  openAiAccountEmail: "",
  openAiAccountStatus: "metadata-only",
  openAiApiKeyConfigured: true,
  openAiApiKeyLastFour: "1234",
  debugMode: false,
};

test("local AI card pipeline filters existing duplicates and reports offline quality diagnostics", () => {
  const response = runLocalAiCardGeneration({
    input: generatorInput(),
    existingCards: [studyCard()],
  });

  assert.equal(response.offline, true);
  assert.equal(response.providerKind, "local-heuristic");
  assert.equal(response.diagnostics.rejectedDuplicates, 1);
  assert.ok(response.cards.length >= 1);
  assert.ok(response.issues.some((issue) => issue.code === "offline-local"));
  assert.equal(aiQualitySummary(response.issues).includes("warning"), true);
});

test("configured external provider is a safe placeholder that falls back locally", () => {
  const provider = createConfiguredAiProvider(settings);
  const response = provider.generateCards({ input: generatorInput({ source_text: "Recursion: A function solving a problem by calling itself with smaller inputs." }) });

  assert.equal(provider.kind, "external-api-placeholder");
  assert.equal(response.offline, true);
  assert.equal(response.providerKind, "local-heuristic");
  assert.ok(response.issues.some((issue) => issue.code === "external-api-placeholder"));
});

test("local AI cloze pipeline exposes blank diagnostics and no-blank warnings", () => {
  const strong = runLocalAiClozeGeneration({
    card: studyCard({
      answer_markdown: "Dijkstra repeatedly selects the nearest unvisited vertex and relaxes outgoing weighted edges.",
      tags: ["Dijkstra"],
    }),
  });
  assert.equal(strong.offline, true);
  assert.equal(strong.cloze.blanks.length > 0, true);
  assert.equal(strong.diagnostics.blankCount, strong.cloze.blanks.length);

  const empty = runLocalAiClozeGeneration({ card: studyCard({ answer_markdown: "" }) });
  assert.ok(empty.issues.some((issue) => issue.code === "missing-answer"));
});
