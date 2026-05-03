import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPriorityContext,
  buildPracticeQueue,
  buildReviewQueue,
  buildTodoItems,
  cardsForGraphNode,
  clozeAnswerMatches,
  evaluateClozeAnswers,
  filterGraphForView,
  ratingWasManuallyOverridden,
  recommendRating,
  summarizeTodoMetrics,
  todoLearningTarget,
} from "../.test-dist/studyLogic.js";

const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();

function card(overrides = {}) {
  const id = overrides.id ?? "card-1";
  return {
    id,
    block_id: overrides.block_id ?? `block-${id}`,
    question: overrides.question ?? `Question ${id}`,
    answer_markdown: overrides.answer_markdown ?? "Answer",
    deck: overrides.deck ?? "German",
    deck_slug: overrides.deck_slug ?? "german",
    topic: overrides.topic ?? "Basics",
    topic_slug: overrides.topic_slug ?? "basics",
    source_page: overrides.source_page ?? "German",
    linked_pages: overrides.linked_pages ?? [],
    tags: overrides.tags ?? [],
    raw_content: overrides.raw_content ?? "",
    properties: overrides.properties ?? {},
    incomplete: false,
    srs: {
      state: "review",
      due_at: iso(-60_000),
      interval_days: 3,
      ease: 2.2,
      reps: 3,
      lapses: 0,
      last_reviewed_at: iso(-86_400_000),
      last_rating: "good",
      hard_count: 0,
      created_at: iso(-604_800_000),
      ...(overrides.srs ?? {}),
    },
    ...overrides,
  };
}

const settings = {
  defaultDeck: "Default",
  defaultTopic: "General",
  newCardsPerDay: 1,
  reviewsPerDay: 10,
  apiProviderEnabled: false,
  apiBaseUrl: "",
  apiModel: "",
  openAiConnectionMode: "none",
  openAiAccountEmail: "",
  openAiAccountStatus: "not connected",
  openAiApiKeyConfigured: false,
  openAiApiKeyLastFour: "",
  debugMode: false,
};

test("review queue prioritizes next-up cards, excludes done cards, and limits new cards", () => {
  const nextUp = card({ id: "next", properties: { "sgd-todo": "doing" }, srs: { due_at: iso(86_400_000), reps: 5 } });
  const overdue = card({ id: "overdue", question: "A overdue", srs: { due_at: iso(-86_400_000), reps: 2 } });
  const weak = card({ id: "weak", question: "B weak", srs: { due_at: iso(-120_000), ease: 1.4, reps: 4 } });
  const newOne = card({ id: "new-1", question: "C new 1", srs: { due_at: null, reps: 0, state: "new" } });
  const newTwo = card({ id: "new-2", question: "D new 2", srs: { due_at: null, reps: 0, state: "new" } });
  const done = card({ id: "done", properties: { "sgd-todo": "done" } });

  const queue = buildReviewQueue([newTwo, done, weak, newOne, overdue, nextUp], null, settings);

  assert.deepEqual(queue.map((item) => item.id), ["next", "weak", "overdue", "new-1"]);
});

test("cloze evaluation accepts umlaut variants and suggests ratings by completion", () => {
  assert.equal(clozeAnswerMatches("kaese", "Käse").correct, true);
  assert.equal(clozeAnswerMatches("recursion", "recursoin").correct, true);
  assert.equal(clozeAnswerMatches("", "Käse").kind, "empty");

  const incomplete = evaluateClozeAnswers(["Käse", "Apfel"], ["kaese", ""]);
  assert.equal(incomplete.suggestedRating, "again");
  assert.equal(incomplete.filledCount, 1);

  const mostlyCorrect = evaluateClozeAnswers(["one", "two", "three", "four"], ["one", "two", "three", "nope"]);
  assert.equal(mostlyCorrect.suggestedRating, "good");
});

test("rating recommendations combine classic timing with weakness and history", () => {
  const fastStable = recommendRating({ mode: "classic", card: card({ srs: { last_rating: "easy" } }), responseTimeMs: 3_500 });
  assert.equal(fastStable.rating, "easy");
  assert.ok(fastStable.reasonCodes.includes("classic-fast-recall"));
  assert.ok(fastStable.reasonCodes.includes("fast-answer"));

  const weakSlow = recommendRating({
    mode: "classic",
    card: card({ srs: { ease: 1.4, hard_count: 2, last_rating: "again", lapses: 2 } }),
    responseTimeMs: 26_000,
  });
  assert.equal(weakSlow.rating, "hard");
  assert.ok(weakSlow.reasonCodes.includes("weak-card"));
  assert.ok(weakSlow.reasonCodes.includes("recent-again"));
  assert.ok(weakSlow.summary.includes("Hard"));
});

test("rating recommendations combine cloze accuracy, response time, and manual override", () => {
  const perfectWeak = recommendRating({
    mode: "cloze",
    card: card({ srs: { ease: 1.5, hard_count: 2, reps: 6 } }),
    responseTimeMs: 4_000,
    cloze: { blankCount: 4, filledCount: 4, correctCount: 4 },
  });
  assert.equal(perfectWeak.rating, "good");
  assert.equal(perfectWeak.clozeAccuracy, 1);
  assert.ok(perfectWeak.reasonCodes.includes("cloze-perfect"));
  assert.ok(perfectWeak.reasonCodes.includes("weak-card"));
  assert.equal(ratingWasManuallyOverridden("easy", perfectWeak), true);
  assert.equal(ratingWasManuallyOverridden("good", perfectWeak), false);

  const partial = recommendRating({
    mode: "cloze",
    card: card(),
    responseTimeMs: 48_000,
    cloze: { blankCount: 5, filledCount: 5, correctCount: 2 },
  });
  assert.equal(partial.rating, "hard");
  assert.ok(partial.reasonCodes.includes("cloze-partial"));
  assert.ok(partial.reasonCodes.includes("very-slow-answer"));
});

test("todo items infer learning targets from linked source pages and route to review", () => {
  const page = {
    id: "plan",
    name: "Plan",
    properties: {},
    blocks: [{ id: "todo-1", content: "TODO Review [[German]] basics", properties: { "sgd-todo": "open" }, children: [] }],
  };
  const dueCard = card({ id: "linked", block_id: "card-block", source_page: "German", deck: "German", deck_slug: "german", topic: "Basics", topic_slug: "basics" });

  const items = buildTodoItems([page], [dueCard]);
  const explicit = items.find((item) => item.id === "todo-1");

  assert.ok(explicit, "explicit TODO block should become a todo item");
  assert.equal(explicit.targetKind, "topic");
  assert.equal(explicit.learningNodeId, "topic:german:basics");
  assert.equal(explicit.metrics.dueCards, 1);
  assert.equal(todoLearningTarget(explicit, [dueCard], settings).kind, "review");

  const summary = summarizeTodoMetrics(items.filter((item) => item.status !== "done"));
  assert.equal(summary.dueCards >= 1, true);
});

test("graph card lookup uses concepts, sources, and returns copy-safe arrays", () => {
  const conceptCard = card({ id: "concept", linked_pages: ["Rust Ownership"], tags: ["systems"], source_page: "Rust Book" });
  const weakCard = card({ id: "weak-cache", tags: ["systems"], srs: { ease: 1.3, reps: 4 } });
  const cards = [conceptCard, weakCard];

  const firstLookup = cardsForGraphNode(cards, "concept:systems");
  firstLookup.pop();

  assert.deepEqual(cardsForGraphNode(cards, "concept:systems").map((item) => item.id), ["concept", "weak-cache"]);
  assert.deepEqual(cardsForGraphNode(cards, "concept:rust-ownership").map((item) => item.id), ["concept"]);
  assert.deepEqual(cardsForGraphNode(cards, "source:rust-book").map((item) => item.id), ["concept"]);
  assert.deepEqual(cardsForGraphNode(cards, "concept:weak-cards").map((item) => item.id), ["weak-cache"]);
});

test("graph filters keep only matching deck/status cards and connected parents", () => {
  const dueGerman = card({ id: "due-german", deck: "German", deck_slug: "german", topic: "Basics", topic_slug: "basics" });
  const futureGerman = card({ id: "future-german", deck: "German", deck_slug: "german", topic: "Basics", topic_slug: "basics", srs: { due_at: iso(86_400_000), reps: 5 } });
  const dueMath = card({ id: "due-math", deck: "Math", deck_slug: "math", topic: "Algebra", topic_slug: "algebra" });
  const snapshot = {
    workspace: { id: "workspace", name: "Workspace", pages: [] },
    cards: [dueGerman, futureGerman, dueMath],
    backlinks: [],
    graph: {
      nodes: [
        { id: "deck:german", kind: "deck", label: "German", total_cards: 2, due_cards: 1, weak_cards: 0 },
        { id: "topic:german:basics", kind: "topic", label: "Basics", total_cards: 2, due_cards: 1, weak_cards: 0 },
        { id: "card:due-german", kind: "card", label: "Due German", total_cards: 1, due_cards: 1, weak_cards: 0 },
        { id: "card:future-german", kind: "card", label: "Future German", total_cards: 1, due_cards: 0, weak_cards: 0 },
        { id: "deck:math", kind: "deck", label: "Math", total_cards: 1, due_cards: 1, weak_cards: 0 },
        { id: "card:due-math", kind: "card", label: "Due Math", total_cards: 1, due_cards: 1, weak_cards: 0 },
      ],
      edges: [
        { id: "german-topic", source: "deck:german", target: "topic:german:basics", kind: "contains" },
        { id: "german-due", source: "topic:german:basics", target: "card:due-german", kind: "contains" },
        { id: "german-future", source: "topic:german:basics", target: "card:future-german", kind: "contains" },
        { id: "math-due", source: "deck:math", target: "card:due-math", kind: "contains" },
      ],
    },
  };

  const filtered = filterGraphForView(snapshot, "due", "german");
  assert.deepEqual(filtered.nodes.map((node) => node.id).sort(), ["card:due-german", "concept:overdue-cards", "deck:german", "topic:german:basics"]);
  assert.deepEqual(filtered.edges.map((edge) => edge.id).sort(), ["Related:concept:overdue-cards:card:due-german", "german-due", "german-topic"]);
});

test("priority engine explains topic/card pressure from due weakness timing cloze and next-up", () => {
  const target = card({ id: "target", properties: { "sgd-todo": "doing" }, srs: { due_at: iso(-172_800_000), ease: 1.45, lapses: 2, hard_count: 2, last_rating: "again" } });
  const session = {
    id: "session-1",
    workspaceId: "workspace",
    kind: "review",
    scopeLabel: "German",
    startedAt: iso(-7_200_000),
    completedAt: iso(-7_000_000),
    items: [{
      id: "item-1",
      sessionId: "session-1",
      cardId: "target",
      question: target.question,
      rating: "again",
      responseTimeMs: 31_000,
      clozeResult: { suggestedRating: "again", blanks: [{ expected: "Mercedes", input: "", correct: false }, { expected: "Auto", input: "Auto", correct: true }] },
      ratingRecommendation: null,
      ratingOverridden: false,
      answeredAt: iso(-7_000_000),
      position: 0,
    }],
  };

  const context = buildPriorityContext([target], [session]);
  const topic = context.topicsByKey.get("german:basics");
  const priority = context.cardsById.get("target");

  assert.ok(topic.score > 70);
  assert.ok(priority.score > 80);
  assert.ok(priority.reasons.some((reason) => reason.includes("Next up")));
  assert.ok(priority.factors.some((factor) => factor.code === "answer-time" && factor.contribution > 0));
  assert.ok(priority.factors.some((factor) => factor.code === "cloze-misses" && factor.contribution > 0));
});

test("priority propagation lifts related topics through shared concepts with decayed weight", () => {
  const mercedes = card({
    id: "mercedes",
    topic: "Mercedes",
    topic_slug: "mercedes",
    linked_pages: ["Auto"],
    tags: ["cars"],
    srs: { due_at: iso(-86_400_000), ease: 1.35, lapses: 3, hard_count: 3, last_rating: "again" },
  });
  const bmw = card({
    id: "bmw",
    topic: "BMW",
    topic_slug: "bmw",
    linked_pages: ["Auto"],
    tags: ["cars"],
    srs: { due_at: iso(86_400_000), ease: 2.4, reps: 4 },
  });
  const unrelated = card({
    id: "grammar",
    topic: "Grammar",
    topic_slug: "grammar",
    linked_pages: ["Cases"],
    tags: ["grammar"],
    srs: { due_at: iso(86_400_000), ease: 2.4, reps: 4 },
  });

  const context = buildPriorityContext([mercedes, bmw, unrelated]);
  const bmwTopic = context.topicsByKey.get("german:bmw");
  const unrelatedTopic = context.topicsByKey.get("german:grammar");

  assert.ok(bmwTopic.propagatedScore > 0);
  assert.ok(bmwTopic.relatedWeaknessHints.some((hint) => hint.includes("Mercedes")));
  assert.ok(bmwTopic.score > unrelatedTopic.score);
});

test("review queue interleaves high-priority topics instead of draining one topic", () => {
  const a1 = card({ id: "a1", topic: "Cars", topic_slug: "cars", question: "A1", srs: { due_at: iso(-86_400_000), ease: 1.4, lapses: 2 } });
  const a2 = card({ id: "a2", topic: "Cars", topic_slug: "cars", question: "A2", srs: { due_at: iso(-80_000_000), ease: 1.5, lapses: 2 } });
  const b1 = card({ id: "b1", topic: "Food", topic_slug: "food", question: "B1", srs: { due_at: iso(-70_000_000), ease: 1.6, lapses: 1 } });
  const b2 = card({ id: "b2", topic: "Food", topic_slug: "food", question: "B2", srs: { due_at: iso(-60_000_000), ease: 1.7, lapses: 1 } });

  const queue = buildReviewQueue([a1, a2, b1, b2], null, { ...settings, reviewsPerDay: 4, newCardsPerDay: 0 });
  const topics = queue.map((item) => item.topic_slug);

  assert.equal(topics[0] !== topics[1], true);
  assert.equal(new Set(topics).size, 2);
});

test("practice queue uses priority order with interleaving", () => {
  const weak = card({ id: "weak-practice", topic: "Cars", topic_slug: "cars", srs: { due_at: iso(-86_400_000), ease: 1.3, lapses: 2 } });
  const steady = card({ id: "steady-practice", topic: "Food", topic_slug: "food", srs: { due_at: iso(86_400_000), ease: 2.6, reps: 5 } });

  const queue = buildPracticeQueue([steady, weak], "all", "", "");

  assert.equal(queue[0].id, "weak-practice");
});
