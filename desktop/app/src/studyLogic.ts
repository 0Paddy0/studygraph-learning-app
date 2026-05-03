import type {
  AppSettings,
  BacklinkReference,
  Block,
  ClozeSessionResult,
  DesktopSnapshot,
  DocBlock,
  DocBlockKind,
  Page,
  Rating,
  RatingRecommendation,
  RatingRecommendationMode,
  RatingRecommendationReasonCode,
  ReviewSession,
  StudyCard,
  StudyGraphEdge,
  StudyGraphNode,
} from "./types";

export type Screen = "notes" | "doc" | "todo" | "dashboard" | "review" | "practice" | "graph" | "generate" | "settings" | "import" | "export";
export type PracticeMode = "all" | "deck" | "weak" | "new" | "graph";
export type GraphStatusFilter = "all" | "due" | "overdue" | "weak" | "new";
export type TodoStatus = "open" | "doing" | "done";

export type SearchResultType = "page" | "block" | "card" | "command";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  pageId?: string;
  blockId?: string;
  action?: Screen | "refresh";
  haystack: string;
}

export type TodoTargetKind = "block" | "deck" | "topic";

export interface TodoQueueMetrics {
  totalCards: number;
  dueCards: number;
  newCards: number;
  weakCards: number;
  overdueCards: number;
  estimatedMinutes: number;
}

export interface TodoItem {
  id: string;
  pageId: string;
  pageName: string;
  block: Block;
  blockIds: string[];
  path: string[];
  status: TodoStatus;
  scope: "block" | "topic";
  targetKind: TodoTargetKind;
  deck?: string;
  topic?: string;
  cardCount?: number;
  learningNodeId?: string;
  learningLabel?: string;
  metrics: TodoQueueMetrics;
  hint?: string;
}

export function evaluateClozeAnswers(blanks: string[], answers: string[]) {
  const results = blanks.map((blank, index) => {
    const answer = answers[index] ?? "";
    const filled = answer.trim().length > 0;
    const match = filled ? clozeAnswerMatches(answer, blank) : { correct: false, kind: "empty" as const };
    return {
      filled,
      correct: match.correct,
      matchKind: match.kind,
    };
  });
  const filledCount = results.filter((result) => result.filled).length;
  const correctCount = results.filter((result) => result.correct).length;
  const ratio = blanks.length === 0 ? 1 : correctCount / blanks.length;
  const suggestedRating: Rating = filledCount < blanks.length
    ? "again"
    : ratio >= 1
      ? "easy"
      : ratio >= 0.75
        ? "good"
        : ratio >= 0.4
          ? "hard"
          : "again";
  const message = filledCount < blanks.length
    ? "Complete all blanks before rating."
    : ratio >= 1
      ? "All blanks correct. This can be rated Easy."
      : ratio >= 0.75
        ? "Mostly correct. Good is appropriate."
        : ratio >= 0.4
          ? "Partial recall. Hard is appropriate."
          : "Too many misses. Again is appropriate.";
  return { results, filledCount, correctCount, suggestedRating, message };
}

export function clozeEvaluationToResult(blanks: string[], answers: string[], suggestedRating: Rating): ClozeSessionResult {
  return {
    suggestedRating,
    blanks: blanks.map((blank, index) => ({
      expected: blank,
      input: answers[index] ?? "",
      correct: clozeAnswerMatches(answers[index] ?? "", blank).correct,
    })),
  };
}

export function ratingLabel(rating: Rating) {
  return rating === "again" ? "Again" : rating === "hard" ? "Hard" : rating === "easy" ? "Easy" : "Good";
}

export interface RatingRecommendationInput {
  mode: RatingRecommendationMode;
  card: StudyCard;
  responseTimeMs?: number | null;
  cloze?: {
    blankCount: number;
    filledCount: number;
    correctCount: number;
  } | null;
}

const ratingOrder: Rating[] = ["again", "hard", "good", "easy"];
const fastRecommendationMs = 5_000;
const slowRecommendationMs = 20_000;
const verySlowRecommendationMs = 45_000;

export function recommendRating(input: RatingRecommendationInput): RatingRecommendation {
  const reasons: RatingRecommendationReasonCode[] = [];
  const responseTimeMs = typeof input.responseTimeMs === "number" ? input.responseTimeMs : undefined;
  const weak = isWeak(input.card);
  let rating: Rating = "good";
  let clozeAccuracy: number | undefined;

  if (input.mode === "cloze" && input.cloze) {
    const { blankCount, filledCount, correctCount } = input.cloze;
    clozeAccuracy = blankCount > 0 ? correctCount / blankCount : 1;
    if (blankCount === 0) {
      rating = "good";
      reasons.push("cloze-no-blanks");
    } else if (filledCount < blankCount) {
      rating = "again";
      reasons.push("cloze-incomplete");
    } else if (clozeAccuracy >= 1) {
      rating = "easy";
      reasons.push("cloze-perfect");
    } else if (clozeAccuracy >= 0.75) {
      rating = "good";
      reasons.push("cloze-mostly-correct");
    } else if (clozeAccuracy >= 0.4) {
      rating = "hard";
      reasons.push("cloze-partial");
    } else {
      rating = "again";
      reasons.push("cloze-many-misses");
    }
  } else {
    if (responseTimeMs === undefined) {
      rating = "good";
      reasons.push("classic-no-timing");
    } else if (responseTimeMs <= fastRecommendationMs) {
      rating = "easy";
      reasons.push("classic-fast-recall");
    } else if (responseTimeMs >= slowRecommendationMs) {
      rating = "hard";
      reasons.push("classic-slow-recall");
    } else {
      rating = "good";
      reasons.push("classic-steady-recall");
    }
  }

  if (responseTimeMs !== undefined) {
    if (responseTimeMs <= fastRecommendationMs) {
      reasons.push("fast-answer");
      if (!weak && rating === "good") rating = "easy";
    } else if (responseTimeMs >= verySlowRecommendationMs) {
      reasons.push("very-slow-answer");
      if (rating === "easy") rating = "good";
      if (rating === "good") rating = "hard";
    } else if (responseTimeMs >= slowRecommendationMs) {
      reasons.push("slow-answer");
      if (rating === "easy") rating = "good";
      else if (rating === "good") rating = "hard";
    }
  }

  if (input.card.srs.reps === 0) {
    reasons.push("history-new");
  } else if (!weak && input.card.srs.reps >= 3 && input.card.srs.last_rating === "easy") {
    reasons.push("history-easy-last");
    if (rating === "good" && responseTimeMs !== undefined && responseTimeMs <= slowRecommendationMs) rating = "easy";
  } else if (!weak && input.card.srs.reps >= 3) {
    reasons.push("history-stable");
  }

  if (input.card.srs.last_rating === "again") {
    reasons.push("recent-again");
    rating = minRating(rating, responseTimeMs !== undefined && responseTimeMs <= fastRecommendationMs ? "good" : "hard");
  }
  if (input.card.srs.hard_count >= 2) {
    reasons.push("repeated-hard");
    rating = minRating(rating, responseTimeMs !== undefined && responseTimeMs <= fastRecommendationMs ? "good" : "hard");
  }
  if (input.card.srs.lapses >= 2) {
    reasons.push("lapses");
    rating = minRating(rating, "good");
    if (responseTimeMs === undefined || responseTimeMs >= slowRecommendationMs) rating = minRating(rating, "hard");
  }
  if (input.card.srs.ease <= 1.6) {
    reasons.push("low-ease");
    rating = minRating(rating, "good");
  }
  if (weak) {
    reasons.push("weak-card");
    rating = minRating(rating, "good");
  }

  const reasonCodes = uniqueReasonCodes(reasons);
  return {
    mode: input.mode,
    policy: "balanced",
    rating,
    confidence: recommendationConfidence(input.mode, rating, reasonCodes, responseTimeMs, clozeAccuracy),
    reasonCodes,
    summary: recommendationSummary(rating, reasonCodes),
    responseTimeMs: responseTimeMs ?? null,
    clozeAccuracy: clozeAccuracy ?? null,
  };
}

export function recommendationReasonLabel(code: RatingRecommendationReasonCode) {
  const labels: Record<RatingRecommendationReasonCode, string> = {
    "cloze-incomplete": "some blanks are still empty",
    "cloze-perfect": "all cloze blanks are correct",
    "cloze-mostly-correct": "most cloze blanks are correct",
    "cloze-partial": "partial cloze recall",
    "cloze-many-misses": "many cloze misses",
    "cloze-no-blanks": "no cloze blanks available",
    "classic-fast-recall": "fast Classic recall",
    "classic-steady-recall": "steady Classic recall",
    "classic-slow-recall": "slow Classic recall",
    "classic-no-timing": "no timing signal",
    "weak-card": "card is weak",
    "recent-again": "last rating was Again",
    "repeated-hard": "repeated Hard history",
    "lapses": "multiple lapses",
    "low-ease": "low ease",
    "fast-answer": "fast answer time",
    "slow-answer": "slow answer time",
    "very-slow-answer": "very slow answer time",
    "history-new": "new card",
    "history-stable": "stable review history",
    "history-easy-last": "last rating was Easy",
  };
  return labels[code];
}

export function ratingWasManuallyOverridden(rating: Rating, recommendation?: RatingRecommendation | null) {
  return Boolean(recommendation && rating !== recommendation.rating);
}

function recommendationSummary(rating: Rating, reasonCodes: RatingRecommendationReasonCode[]) {
  const primaryReasons = reasonCodes.slice(0, 3).map(recommendationReasonLabel);
  return `Balanced policy recommends ${ratingLabel(rating)}${primaryReasons.length > 0 ? `: ${primaryReasons.join(", ")}.` : "."}`;
}

function recommendationConfidence(
  mode: RatingRecommendationMode,
  rating: Rating,
  reasonCodes: RatingRecommendationReasonCode[],
  responseTimeMs?: number,
  clozeAccuracy?: number,
) {
  let confidence = mode === "cloze" ? 0.66 : 0.52;
  if (mode === "cloze" && clozeAccuracy !== undefined) {
    confidence += Math.abs(clozeAccuracy - 0.5) * 0.26;
  }
  if (responseTimeMs !== undefined) confidence += 0.08;
  if (reasonCodes.some((code) => code === "weak-card" || code === "recent-again" || code === "repeated-hard")) confidence += 0.06;
  if (rating === "again" || rating === "easy") confidence += 0.03;
  return Math.min(0.95, Math.max(0.35, Number(confidence.toFixed(2))));
}

function minRating(left: Rating, right: Rating): Rating {
  return ratingOrder[Math.min(ratingOrder.indexOf(left), ratingOrder.indexOf(right))] ?? "good";
}

function uniqueReasonCodes(reasons: RatingRecommendationReasonCode[]) {
  return reasons.filter((reason, index) => reasons.indexOf(reason) === index);
}

export function buildClozePrompt(card: StudyCard) {
  const text = card.answer_markdown || "(No answer child blocks)";
  const words = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu));
  const unique = new Set<string>();
  const candidates = words
    .map((match) => ({ value: match[0], index: match.index ?? 0, score: clozeWordScore(match[0], text, card) }))
    .filter((word) => {
      const normalized = normalizeAnswer(word.value);
      if (unique.has(normalized) || commonClozeWords.has(normalized) || word.score <= 0) return false;
      unique.add(normalized);
      return true;
    })
    .sort((left, right) => right.score - left.score || right.value.length - left.value.length);
  const strength = Math.max(card.srs.reps, Math.round(card.srs.ease));
  const blankCount = Math.min(Math.max(1, Math.floor(strength / 2)), 6, candidates.length);
  const selected = candidates.slice(0, blankCount).sort((left, right) => left.index - right.index);
  const parts: Array<{ kind: "text"; value: string } | { kind: "blank"; blankIndex: number }> = [];
  const blanks: string[] = [];
  let cursor = 0;
  for (const blank of selected) {
    parts.push({ kind: "text", value: text.slice(cursor, blank.index) });
    parts.push({ kind: "blank", blankIndex: blanks.length });
    blanks.push(blank.value);
    cursor = blank.index + blank.value.length;
  }
  parts.push({ kind: "text", value: text.slice(cursor) });
  return { text, parts, blanks };
}

export function clozeWordScore(word: string, fullText: string, card: StudyCard) {
  const normalized = normalizeAnswer(word);
  if (normalized.length < 4) return 0;
  let score = normalized.length;
  if (/^[A-ZÄÖÜ]/.test(word)) score += 4;
  if (card.question.toLowerCase().includes(word.toLowerCase())) score += 3;
  if (card.tags.some((tag) => normalizeAnswer(tag) === normalized)) score += 5;
  if (card.linked_pages.some((page) => normalizeAnswer(page).includes(normalized))) score += 5;
  const occurrences = fullText.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"))?.length ?? 0;
  if (occurrences > 1) score -= occurrences;
  return score;
}

export function clozeAnswerMatches(input: string, expected: string): { correct: boolean; kind: "empty" | "exact" | "variant" | "typo" | "miss" } {
  const normalizedInput = normalizeAnswer(input);
  if (!normalizedInput) return { correct: false, kind: "empty" };
  const expectedVariants = answerVariants(expected);
  if (expectedVariants.has(normalizedInput)) return { correct: true, kind: "exact" };

  const inputVariants = answerVariants(input);
  for (const variant of inputVariants) {
    if (expectedVariants.has(variant)) return { correct: true, kind: "variant" };
  }

  const bestDistance = Math.min(
    ...Array.from(expectedVariants).map((variant) => levenshteinDistance(normalizedInput, variant)),
  );
  const typoAllowance = normalizedInput.length >= 9 ? 2 : normalizedInput.length >= 5 ? 1 : 0;
  if (typoAllowance > 0 && bestDistance <= typoAllowance) {
    return { correct: true, kind: "typo" };
  }

  return { correct: false, kind: "miss" };
}

export function answerVariants(value: string) {
  const compact = normalizeAnswer(value);
  const transliterated = normalizeAnswer(transliterateUmlauts(value));
  const withoutArticles = compact.replace(/^(der|die|das|ein|eine|the|a|an) /, "");
  return new Set([compact, transliterated, withoutArticles].filter(Boolean));
}

export function normalizeAnswer(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function transliterateUmlauts(value: string) {
  return value
    .replace(/[äæ]/gi, (match) => match === match.toUpperCase() ? "Ae" : "ae")
    .replace(/[öőø]/gi, (match) => match === match.toUpperCase() ? "Oe" : "oe")
    .replace(/[üű]/gi, (match) => match === match.toUpperCase() ? "Ue" : "ue")
    .replace(/[ß]/g, "ss");
}

export function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

const commonClozeWords = new Set(["this", "that", "with", "from", "have", "will", "eine", "einer", "einen", "einem", "oder", "aber", "auch", "dass", "nicht", "werden", "kann", "sind", "the", "and", "for", "into"]);


export interface PriorityFactor {
  code: string;
  label: string;
  value: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface PriorityHistorySignal {
  averageResponseTimeMs?: number;
  slowAnswers: number;
  clozeMisses: number;
  clozeBlanks: number;
  againCount: number;
  hardCount: number;
}

export interface TopicPriority {
  key: string;
  deck: string;
  deckSlug: string;
  topic: string;
  topicSlug: string;
  score: number;
  baseScore: number;
  propagatedScore: number;
  cards: StudyCard[];
  factors: PriorityFactor[];
  reasons: string[];
  relatedWeaknessHints: string[];
}

export interface CardPriority {
  cardId: string;
  score: number;
  topicKey: string;
  topicScore: number;
  factors: PriorityFactor[];
  reasons: string[];
  relatedWeaknessHints: string[];
}

export interface PriorityContext {
  topics: TopicPriority[];
  topicsByKey: Map<string, TopicPriority>;
  cardsById: Map<string, CardPriority>;
}

interface TopicPriorityDraft {
  key: string;
  deck: string;
  deckSlug: string;
  topic: string;
  topicSlug: string;
  cards: StudyCard[];
  concepts: Set<string>;
  sources: Set<string>;
  baseScore: number;
  propagatedScore: number;
  factors: PriorityFactor[];
  reasons: string[];
  relatedWeaknessHints: string[];
  debt: number;
}

const priorityContextCache = new WeakMap<StudyCard[], { sessions?: ReviewSession[]; context: PriorityContext }>();
const slowPriorityAnswerMs = 20_000;

export function buildPriorityContext(cards: StudyCard[], reviewSessions: ReviewSession[] = []): PriorityContext {
  const cached = priorityContextCache.get(cards);
  if (cached && cached.sessions === reviewSessions) return cached.context;

  const historyByCard = buildPriorityHistorySignals(reviewSessions);
  const topicDrafts = buildTopicPriorityDrafts(cards, historyByCard);
  propagateTopicWeakness(topicDrafts);

  const topics = Array.from(topicDrafts.values()).map(finalizeTopicPriority).sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic));
  const topicsByKey = new Map(topics.map((topic) => [topic.key, topic]));
  const cardsById = new Map<string, CardPriority>();
  for (const card of cards) {
    const priority = scoreCardPriority(card, topicsByKey.get(topicPriorityKey(card)), historyByCard.get(card.id));
    cardsById.set(card.id, priority);
  }

  const context = { topics, topicsByKey, cardsById };
  priorityContextCache.set(cards, { sessions: reviewSessions, context });
  return context;
}

export function cardPriorityFor(card: StudyCard, context: PriorityContext = buildPriorityContext([card])) {
  return context.cardsById.get(card.id) ?? scoreCardPriority(card, context.topicsByKey.get(topicPriorityKey(card)));
}

export function priorityReasonSummary(priority?: CardPriority | TopicPriority, maxReasons = 2) {
  if (!priority) return "No priority signal yet";
  const reasons = priority.reasons.slice(0, maxReasons);
  if (reasons.length === 0) return "Low pressure";
  return reasons.join(" · ");
}

export function priorityBadgeLabel(priority?: CardPriority | TopicPriority) {
  const score = priority?.score ?? 0;
  if (score >= 75) return "P1";
  if (score >= 50) return "P2";
  if (score >= 25) return "P3";
  return "P4";
}

export function priorityScoreLabel(priority?: CardPriority | TopicPriority) {
  const score = priority?.score ?? 0;
  return `${priorityBadgeLabel(priority)} · ${Math.round(score)}/100`;
}

export function topicPriorityKey(card: StudyCard) {
  return `${card.deck_slug}:${card.topic_slug}`;
}

function buildPriorityHistorySignals(reviewSessions: ReviewSession[]) {
  const byCard = new Map<string, PriorityHistorySignal>();
  for (const session of reviewSessions.slice(-30)) {
    for (const item of session.items ?? []) {
      const current = byCard.get(item.cardId) ?? { slowAnswers: 0, clozeMisses: 0, clozeBlanks: 0, againCount: 0, hardCount: 0 };
      if (typeof item.responseTimeMs === "number") {
        const previousCount = (current as PriorityHistorySignal & { responseCount?: number }).responseCount ?? 0;
        const previousAverage = current.averageResponseTimeMs ?? 0;
        current.averageResponseTimeMs = ((previousAverage * previousCount) + item.responseTimeMs) / (previousCount + 1);
        (current as PriorityHistorySignal & { responseCount?: number }).responseCount = previousCount + 1;
        if (item.responseTimeMs >= slowPriorityAnswerMs) current.slowAnswers += 1;
      }
      if (item.rating === "again") current.againCount += 1;
      if (item.rating === "hard") current.hardCount += 1;
      if (item.clozeResult?.blanks) {
        current.clozeBlanks += item.clozeResult.blanks.length;
        current.clozeMisses += item.clozeResult.blanks.filter((blank) => !blank.correct).length;
      }
      byCard.set(item.cardId, current);
    }
  }
  return byCard;
}

function buildTopicPriorityDrafts(cards: StudyCard[], historyByCard: Map<string, PriorityHistorySignal>) {
  const drafts = new Map<string, TopicPriorityDraft>();
  for (const card of cards.filter((item) => todoStatusForCard(item) !== "done")) {
    const key = topicPriorityKey(card);
    const draft = drafts.get(key) ?? {
      key,
      deck: card.deck,
      deckSlug: card.deck_slug,
      topic: card.topic,
      topicSlug: card.topic_slug,
      cards: [],
      concepts: new Set<string>(),
      sources: new Set<string>(),
      baseScore: 0,
      propagatedScore: 0,
      factors: [],
      reasons: [],
      relatedWeaknessHints: [],
      debt: 0,
    };
    draft.cards.push(card);
    priorityConceptsForCard(card).forEach((concept) => draft.concepts.add(concept));
    if (card.source_page) draft.sources.add(normalizeSlug(card.source_page));
    drafts.set(key, draft);
  }

  for (const draft of drafts.values()) {
    const historySignals = draft.cards.map((card) => historyByCard.get(card.id)).filter((signal): signal is PriorityHistorySignal => Boolean(signal));
    const dueCards = draft.cards.filter(isDue);
    const overdueCards = draft.cards.filter(isOverdue);
    const weakCards = draft.cards.filter(isWeak);
    const newCards = draft.cards.filter(isNewCard);
    const nextUpCards = draft.cards.filter((card) => todoStatusForCard(card) === "doing");
    const maxOverdueDays = overdueCards.reduce((max, card) => Math.max(max, overdueDays(card)), 0);
    const srsAgainCount = draft.cards.filter((card) => card.srs.last_rating === "again").length;
    const srsHardCount = draft.cards.reduce((total, card) => total + Math.min(card.srs.hard_count ?? 0, 3), 0);
    const historyAgainCount = historySignals.reduce((total, signal) => total + signal.againCount, 0);
    const historyHardCount = historySignals.reduce((total, signal) => total + signal.hardCount, 0);
    const slowAnswers = historySignals.reduce((total, signal) => total + signal.slowAnswers, 0);
    const averageResponseTimeMs = average(historySignals.map((signal) => signal.averageResponseTimeMs).filter((value): value is number => typeof value === "number"));
    const clozeBlanks = historySignals.reduce((total, signal) => total + signal.clozeBlanks, 0);
    const clozeMisses = historySignals.reduce((total, signal) => total + signal.clozeMisses, 0);
    draft.debt = dueCards.length + weakCards.length * 1.6 + overdueCards.length * 2 + newCards.length * 0.5;

    addFactor(draft.factors, "overdue", "Overdue", normalizeSignal(overdueCards.length * 0.35 + maxOverdueDays * 0.18), 28, `${overdueCards.length} overdue${maxOverdueDays > 0 ? `, max ${Math.round(maxOverdueDays)}d late` : ""}`);
    addFactor(draft.factors, "weak", "Weak cards", normalizeSignal(weakCards.length * 0.42 + weakCards.length / Math.max(1, draft.cards.length)), 22, `${weakCards.length} weak cards`);
    addFactor(draft.factors, "errors", "Errors", normalizeSignal((srsAgainCount + historyAgainCount) * 0.5 + (srsHardCount + historyHardCount) * 0.22), 18, `${srsAgainCount + historyAgainCount} Again, ${srsHardCount + historyHardCount} Hard signals`);
    addFactor(draft.factors, "answer-time", "Answer time", normalizeSignal(slowAnswers * 0.35 + Math.max(0, (averageResponseTimeMs - 12_000) / 25_000)), 12, averageResponseTimeMs ? `avg ${Math.round(averageResponseTimeMs / 100) / 10}s, ${slowAnswers} slow` : "no recent timing pressure");
    addFactor(draft.factors, "cloze-misses", "Cloze misses", clozeBlanks > 0 ? Math.min(1, clozeMisses / clozeBlanks + clozeMisses * 0.08) : 0, 12, clozeBlanks > 0 ? `${clozeMisses}/${clozeBlanks} missed blanks` : "no cloze miss history");
    addFactor(draft.factors, "learning-debt", "Learning debt", normalizeSignal(draft.debt * 0.24), 15, `${dueCards.length} due, ${newCards.length} new`);
    addFactor(draft.factors, "next-up", "Next up", nextUpCards.length > 0 ? 1 : 0, 18, nextUpCards.length > 0 ? `${nextUpCards.length} Next up card(s)` : "not marked Next up");

    draft.baseScore = clampPriority(draft.factors.reduce((total, factor) => total + factor.contribution, 0));
  }
  return drafts;
}

function propagateTopicWeakness(drafts: Map<string, TopicPriorityDraft>) {
  const topics = Array.from(drafts.values());
  for (const source of topics) {
    const sourceWeakness = source.factors.find((factor) => factor.code === "weak")?.contribution ?? 0;
    const sourceErrors = source.factors.find((factor) => factor.code === "errors")?.contribution ?? 0;
    const sourceDebt = source.factors.find((factor) => factor.code === "learning-debt")?.contribution ?? 0;
    const sourceSignal = Math.min(30, sourceWeakness + sourceErrors * 0.8 + sourceDebt * 0.35);
    if (sourceSignal < 2) continue;
    for (const target of topics) {
      if (target.key === source.key) continue;
      const relatedness = topicRelatedness(source, target);
      if (relatedness <= 0) continue;
      const propagated = sourceSignal * relatedness;
      if (propagated < 1) continue;
      target.propagatedScore += propagated;
      target.relatedWeaknessHints.push(`${source.deck}/${source.topic} +${Math.round(propagated)} via ${relatednessLabel(source, target)}`);
    }
  }
}

function finalizeTopicPriority(draft: TopicPriorityDraft): TopicPriority {
  const propagation = Math.min(20, draft.propagatedScore);
  if (propagation > 0) {
    addFactor(draft.factors, "related-weakness", "Related weakness", propagation / 20, 20, draft.relatedWeaknessHints.slice(0, 2).join("; "));
  }
  const score = clampPriority(draft.factors.reduce((total, factor) => total + factor.contribution, 0));
  return {
    key: draft.key,
    deck: draft.deck,
    deckSlug: draft.deckSlug,
    topic: draft.topic,
    topicSlug: draft.topicSlug,
    score,
    baseScore: draft.baseScore,
    propagatedScore: propagation,
    cards: draft.cards,
    factors: draft.factors.filter((factor) => factor.contribution > 0).sort((left, right) => right.contribution - left.contribution),
    reasons: priorityReasons(draft.factors),
    relatedWeaknessHints: uniqueStrings(draft.relatedWeaknessHints).slice(0, 4),
  };
}

function scoreCardPriority(card: StudyCard, topic?: TopicPriority, history?: PriorityHistorySignal): CardPriority {
  const factors: PriorityFactor[] = [];
  const overdue = overdueDays(card);
  addFactor(factors, "due", "Due", isDue(card) ? 1 : 0, isNewCard(card) ? 16 : 24, isNewCard(card) ? "new and available" : overdue > 0 ? `${Math.round(overdue)}d late` : "due now");
  addFactor(factors, "weak", "Weak", isWeak(card) ? 1 : 0, 20, "weak SRS history");
  const lapses = card.srs.lapses ?? 0;
  const hardCount = card.srs.hard_count ?? 0;
  const ease = card.srs.ease ?? 2.5;
  const intervalDays = card.srs.interval_days ?? 0;
  addFactor(factors, "errors", "Errors", normalizeSignal(Number(card.srs.last_rating === "again") * 0.7 + lapses * 0.3 + hardCount * 0.22 + (history?.againCount ?? 0) * 0.35 + (history?.hardCount ?? 0) * 0.18), 18, `${lapses + (history?.againCount ?? 0)} lapse/Again, ${hardCount + (history?.hardCount ?? 0)} Hard`);
  addFactor(factors, "answer-time", "Answer time", normalizeSignal((history?.slowAnswers ?? 0) * 0.45 + Math.max(0, ((history?.averageResponseTimeMs ?? 0) - 12_000) / 28_000)), 10, history?.averageResponseTimeMs ? `avg ${Math.round(history.averageResponseTimeMs / 100) / 10}s` : "no recent timing pressure");
  addFactor(factors, "cloze-misses", "Cloze misses", history?.clozeBlanks ? Math.min(1, history.clozeMisses / history.clozeBlanks + history.clozeMisses * 0.1) : 0, 10, history?.clozeBlanks ? `${history.clozeMisses}/${history.clozeBlanks} missed blanks` : "no cloze miss history");
  addFactor(factors, "learning-debt", "Learning debt", normalizeSignal((isDue(card) ? 0.45 : 0) + (isNewCard(card) ? 0.35 : 0) + Math.max(0, (2.2 - ease) / 1.4)), 13, `ease ${ease.toFixed(1)}, interval ${intervalDays}d`);
  addFactor(factors, "topic-pressure", "Topic pressure", Math.min(1, (topic?.baseScore ?? 0) / 80), 14, topic ? `${topic.topic} base ${Math.round(topic.baseScore)}` : "no topic pressure");
  addFactor(factors, "related-weakness", "Related weakness", Math.min(1, (topic?.propagatedScore ?? 0) / 20), 12, topic?.relatedWeaknessHints[0] ?? "no related weakness");
  addFactor(factors, "next-up", "Next up", todoStatusForCard(card) === "doing" ? 1 : 0, 60, "marked Next up");

  const score = clampPriority(factors.reduce((total, factor) => total + factor.contribution, 0));
  const activeFactors = factors.filter((factor) => factor.contribution > 0).sort((left, right) => right.contribution - left.contribution);
  return {
    cardId: card.id,
    score,
    topicKey: topicPriorityKey(card),
    topicScore: topic?.score ?? 0,
    factors: activeFactors,
    reasons: priorityReasons(activeFactors),
    relatedWeaknessHints: topic?.relatedWeaknessHints ?? [],
  };
}

function priorityReasons(factors: PriorityFactor[]) {
  return factors
    .filter((factor) => factor.contribution >= 2)
    .sort((left, right) => right.contribution - left.contribution)
    .map((factor) => `${factor.label}: ${factor.detail}`)
    .slice(0, 5);
}

function addFactor(factors: PriorityFactor[], code: string, label: string, value: number, weight: number, detail: string) {
  const normalized = Math.min(1, Math.max(0, value));
  factors.push({
    code,
    label,
    value: Number(normalized.toFixed(3)),
    weight,
    contribution: Number((normalized * weight).toFixed(2)),
    detail,
  });
}

function topicRelatedness(left: TopicPriorityDraft, right: TopicPriorityDraft) {
  let score = 0;
  if (left.deckSlug === right.deckSlug) score += 0.18;
  const sharedConcepts = intersectionCount(left.concepts, right.concepts);
  score += Math.min(0.55, sharedConcepts * 0.22);
  if (intersectionCount(left.sources, right.sources) > 0) score += 0.18;
  if (left.topicSlug === right.topicSlug) score += 0.25;
  return Math.min(0.75, score);
}

function relatednessLabel(left: TopicPriorityDraft, right: TopicPriorityDraft) {
  const sharedConcepts = Array.from(left.concepts).filter((concept) => right.concepts.has(concept));
  if (sharedConcepts.length > 0) return `shared ${sharedConcepts.slice(0, 2).join(", ")}`;
  if (left.deckSlug === right.deckSlug) return "same deck";
  if (intersectionCount(left.sources, right.sources) > 0) return "same source";
  return "graph link";
}

function priorityConceptsForCard(card: StudyCard) {
  const concepts = new Set<string>();
  for (const page of card.linked_pages) {
    const lower = page.toLocaleLowerCase();
    if (!lower.startsWith("deck/") && !lower.startsWith("topic/")) concepts.add(normalizeSlug(page));
  }
  for (const tag of card.tags) {
    const lower = tag.toLocaleLowerCase();
    if (lower !== "card" && !lower.startsWith("deck/") && !lower.startsWith("topic/")) concepts.add(normalizeSlug(`#${tag}`));
  }
  concepts.add(normalizeSlug(card.topic));
  return Array.from(concepts).filter(Boolean);
}

function intersectionCount<T>(left: Set<T>, right: Set<T>) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function normalizeSignal(value: number) {
  return 1 - Math.exp(-Math.max(0, value));
}

function clampPriority(value: number) {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function overdueDays(card: StudyCard) {
  if (!isOverdue(card) || !card.srs.due_at) return 0;
  return Math.max(0, (Date.now() - new Date(card.srs.due_at).getTime()) / 86_400_000);
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function interleaveByTopic(cards: StudyCard[], priorities: Map<string, CardPriority>, limit = cards.length) {
  const buckets = new Map<string, StudyCard[]>();
  for (const card of cards) {
    const key = topicPriorityKey(card);
    buckets.set(key, [...(buckets.get(key) ?? []), card]);
  }
  for (const bucket of buckets.values()) bucket.sort((left, right) => compareCardPriority(left, right, priorities));

  const result: StudyCard[] = [];
  let lastTopic = "";
  while (result.length < limit && buckets.size > 0) {
    const candidates = Array.from(buckets.entries())
      .filter(([, bucket]) => bucket.length > 0)
      .sort((left, right) => compareCardPriority(left[1][0], right[1][0], priorities));
    const selected = candidates.find(([topic]) => topic !== lastTopic) ?? candidates[0];
    if (!selected) break;
    const [topic, bucket] = selected;
    const next = bucket.shift();
    if (!next) {
      buckets.delete(topic);
      continue;
    }
    result.push(next);
    lastTopic = topic;
    if (bucket.length === 0) buckets.delete(topic);
  }
  return result;
}

function compareCardPriority(left: StudyCard, right: StudyCard, priorities: Map<string, CardPriority>) {
  const scoreCompare = (priorities.get(right.id)?.score ?? 0) - (priorities.get(left.id)?.score ?? 0);
  if (scoreCompare !== 0) return scoreCompare;
  return sortReviewCards(left, right);
}

export function countBlocks(pages: Page[]) {
  return pages.reduce((total, page) => total + flattenBlocks(page.blocks).length, 0);
}

export function singleLine(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function groupCardsByDeck(cards: StudyCard[]) {
  const groups = new Map<string, StudyCard[]>();
  for (const card of cards) {
    groups.set(card.deck_slug, [...(groups.get(card.deck_slug) ?? []), card]);
  }
  return Array.from(groups.values()).map((deckCards) => ({
    deck: deckCards[0].deck,
    deck_slug: deckCards[0].deck_slug,
    total: deckCards.length,
    due: deckCards.filter(isDue).length,
    weak: deckCards.filter(isWeak).length,
    newCards: deckCards.filter(isNewCard).length,
  }));
}

export function buildReviewQueue(cards: StudyCard[], nodeId: string | null, settings: AppSettings, reviewSessions: ReviewSession[] = []) {
  const context = buildPriorityContext(cards, reviewSessions);
  const scopedCards = nodeId ? cardsForGraphNode(cards, nodeId) : cards;
  const activeCards = scopedCards.filter((card) => todoStatusForCard(card) !== "done");
  const nextUpCards = activeCards.filter((card) => todoStatusForCard(card) === "doing");
  const dueReviewCards = activeCards.filter((card) => isDue(card) && !isNewCard(card));
  const newCards = activeCards
    .filter((card) => isDue(card) && isNewCard(card))
    .sort((left, right) => compareCardPriority(left, right, context.cardsById))
    .slice(0, settings.newCardsPerDay);
  const candidates = uniqueCards([...nextUpCards, ...dueReviewCards, ...newCards])
    .sort((left, right) => compareCardPriority(left, right, context.cardsById));
  return interleaveByTopic(candidates, context.cardsById, settings.reviewsPerDay);
}

export function buildPracticeQueue(cards: StudyCard[], mode: PracticeMode, deckSlug: string, nodeId: string, reviewSessions: ReviewSession[] = []) {
  let queue = [...cards];

  if (mode === "graph" && nodeId) {
    queue = cardsForGraphNode(cards, nodeId);
  } else if (mode === "deck" && deckSlug) {
    queue = queue.filter((card) => card.deck_slug === deckSlug);
  } else if (mode === "weak") {
    queue = queue.filter(isWeak);
    if (deckSlug) {
      queue = queue.filter((card) => card.deck_slug === deckSlug);
    }
  } else if (mode === "new") {
    queue = queue.filter(isNewCard);
    if (deckSlug) {
      queue = queue.filter((card) => card.deck_slug === deckSlug);
    }
  }

  const context = buildPriorityContext(cards, reviewSessions);
  return interleaveByTopic(
    queue.sort((left, right) => compareCardPriority(left, right, context.cardsById)),
    context.cardsById,
  );
}

interface GraphCardIndex {
  byDeck: Map<string, StudyCard[]>;
  byTopic: Map<string, StudyCard[]>;
  byCard: Map<string, StudyCard[]>;
  byConcept: Map<string, StudyCard[]>;
  bySource: Map<string, StudyCard[]>;
  weak: StudyCard[];
  overdue: StudyCard[];
  newCards: StudyCard[];
}

const graphCardIndexCache = new WeakMap<StudyCard[], GraphCardIndex>();

export function cardsForGraphNode(cards: StudyCard[], nodeId: string) {
  const index = graphCardIndexFor(cards);

  if (nodeId.startsWith("deck:")) {
    return [...(index.byDeck.get(nodeId.slice("deck:".length)) ?? [])];
  }

  if (nodeId.startsWith("topic:")) {
    const [, deckSlug, topicSlug] = nodeId.split(":");
    return [...(index.byTopic.get(`${deckSlug}:${topicSlug}`) ?? [])];
  }

  if (nodeId.startsWith("card:")) {
    return [...(index.byCard.get(nodeId.slice("card:".length)) ?? [])];
  }

  if (nodeId === "concept:weak-cards") {
    return [...index.weak];
  }

  if (nodeId === "concept:overdue-cards") {
    return [...index.overdue];
  }

  if (nodeId === "concept:new-cards") {
    return [...index.newCards];
  }

  if (nodeId.startsWith("concept:")) {
    return [...(index.byConcept.get(nodeId.slice("concept:".length)) ?? [])];
  }

  if (nodeId.startsWith("source:")) {
    return [...(index.bySource.get(nodeId.slice("source:".length)) ?? [])];
  }

  return [];
}

function graphCardIndexFor(cards: StudyCard[]): GraphCardIndex {
  const cached = graphCardIndexCache.get(cards);
  if (cached) return cached;

  const index: GraphCardIndex = {
    byDeck: new Map(),
    byTopic: new Map(),
    byCard: new Map(),
    byConcept: new Map(),
    bySource: new Map(),
    weak: [],
    overdue: [],
    newCards: [],
  };

  for (const card of cards) {
    pushIndexed(index.byDeck, card.deck_slug, card);
    pushIndexed(index.byTopic, `${card.deck_slug}:${card.topic_slug}`, card);
    pushIndexed(index.byCard, card.id, card);

    for (const page of card.linked_pages) {
      const lower = page.toLocaleLowerCase();
      if (!lower.startsWith("deck/") && !lower.startsWith("topic/")) {
        pushIndexed(index.byConcept, normalizeSlug(page), card);
      }
    }
    for (const tag of card.tags) {
      const lower = tag.toLocaleLowerCase();
      if (lower !== "card" && !lower.startsWith("deck/") && !lower.startsWith("topic/")) {
        pushIndexed(index.byConcept, normalizeSlug(`#${tag}`), card);
      }
    }
    if (card.source_page) {
      pushIndexed(index.bySource, normalizeSlug(card.source_page), card);
    }
    if (isWeak(card)) index.weak.push(card);
    if (isOverdue(card)) index.overdue.push(card);
    if (isNewCard(card)) index.newCards.push(card);
  }

  graphCardIndexCache.set(cards, index);
  return index;
}

function pushIndexed(index: Map<string, StudyCard[]>, key: string, card: StudyCard) {
  if (!key) return;
  const current = index.get(key);
  if (current) {
    if (!current.some((item) => item.id === card.id)) current.push(card);
  } else {
    index.set(key, [card]);
  }
}

export function uniqueCards(cards: StudyCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

export function sortReviewCards(left: StudyCard, right: StudyCard) {
  const leftDue = left.srs.due_at ? new Date(left.srs.due_at).getTime() : 0;
  const rightDue = right.srs.due_at ? new Date(right.srs.due_at).getTime() : 0;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const weakCompare = Number(isWeak(right)) - Number(isWeak(left));
  if (weakCompare !== 0) return weakCompare;
  const newCompare = Number(isNewCard(right)) - Number(isNewCard(left));
  if (newCompare !== 0) return newCompare;
  return left.question.localeCompare(right.question);
}

export function buildBlockLocations(pages: Page[]) {
  const locations = new Map<string, { pageId: string; pageName: string; path: string[] }>();
  for (const page of pages) {
    for (const block of flattenBlocks(page.blocks)) {
      locations.set(block.block.id, {
        pageId: page.id,
        pageName: page.name,
        path: block.path,
      });
    }
  }
  return locations;
}

export function buildTodoItems(pages: Page[], cards: StudyCard[]): TodoItem[] {
  const blockEntries = new Map<string, { page: Page; block: Block; path: string[] }>();
  for (const page of pages) {
    for (const entry of flattenBlocks(page.blocks)) {
      blockEntries.set(entry.block.id, { page, block: entry.block, path: entry.path });
    }
  }

  const cardBlockIds = new Set(cards.map((card) => card.block_id));
  const items: TodoItem[] = [];

  for (const entry of blockEntries.values()) {
    if (cardBlockIds.has(entry.block.id)) {
      continue;
    }
    const status = todoStatusForBlock(entry.block);
    if (!status) {
      continue;
    }
    const target = todoBlockTarget(entry.page, entry.block, cards);
    const metrics = buildTodoMetrics(target.cards);
    items.push({
      id: entry.block.id,
      pageId: entry.page.id,
      pageName: entry.page.name,
      block: entry.block,
      blockIds: [entry.block.id],
      path: entry.path,
      status,
      scope: "block",
      targetKind: target.targetKind,
      deck: target.deck,
      topic: target.topic,
      cardCount: target.cards.length || undefined,
      learningNodeId: target.nodeId,
      learningLabel: target.label,
      metrics,
      hint: targetHint(metrics, false),
    });
  }

  const topicGroups = new Map<string, Array<{ card: StudyCard; entry: { page: Page; block: Block; path: string[] } }>>();
  for (const card of cards) {
    const entry = blockEntries.get(card.block_id);
    if (!entry) {
      continue;
    }
    const key = `${card.deck_slug}:${card.topic_slug}`;
    topicGroups.set(key, [...(topicGroups.get(key) ?? []), { card, entry }]);
  }

  for (const [key, group] of topicGroups) {
    const topicCards = group.map(({ card }) => card);
    const statuses = topicCards.map(todoStatusForCard).filter((status): status is TodoStatus => Boolean(status));
    const metrics = buildTodoMetrics(topicCards);
    const hasQueueSignal = metrics.newCards > 0 || metrics.dueCards > 0 || metrics.weakCards > 0;
    if (!hasQueueSignal && statuses.length === 0) {
      continue;
    }

    const status = statuses.includes("doing")
      ? "doing"
      : statuses.length > 0 && statuses.every((value) => value === "done")
        ? "done"
        : "open";
    const first = group[0];
    items.push({
      id: `topic:${key}`,
      pageId: first.entry.page.id,
      pageName: first.entry.page.name,
      block: first.entry.block,
      blockIds: uniqueStrings(group.map(({ card }) => card.block_id)),
      path: [first.card.deck, first.card.topic],
      status,
      scope: "topic",
      targetKind: "topic",
      deck: first.card.deck,
      topic: first.card.topic,
      cardCount: group.length,
      learningNodeId: `topic:${key}`,
      learningLabel: `${first.card.deck} / ${first.card.topic}`,
      metrics,
      hint: targetHint(metrics, true),
    });
  }

  return items.sort((left, right) => {
    const statusCompare = todoStatusOrder(left.status) - todoStatusOrder(right.status);
    if (statusCompare !== 0) return statusCompare;
    const urgencyCompare = todoUrgencyScore(right) - todoUrgencyScore(left);
    if (urgencyCompare !== 0) return urgencyCompare;
    const titleCompare = todoItemTitle(left).localeCompare(todoItemTitle(right));
    if (titleCompare !== 0) return titleCompare;
    return left.pageName.localeCompare(right.pageName);
  });
}

export function countDocBlockKinds(blocks: DocBlock[]) {
  return blocks.reduce(
    (counts, block) => ({
      ...counts,
      [block.kind]: counts[block.kind] + 1,
    }),
    { heading: 0, paragraph: 0, todo: 0, quote: 0 } satisfies Record<DocBlockKind, number>,
  );
}

export function todoStatusForBlock(block: Block): TodoStatus | null {
  const property = normalizeTodoToken(block.properties["sgd-todo"] ?? block.properties.todo ?? "");
  if (property) {
    return property;
  }

  const content = normalizeSearchText(block.content);
  if (/^(\- )?\[x\]\s+/.test(content) || content.startsWith("done ") || content.includes("#done")) {
    return "done";
  }
  if (content.startsWith("doing ") || content.includes("#doing")) {
    return "doing";
  }
  if (/^(\- )?\[ \]\s+/.test(content) || content.startsWith("todo ") || content.includes("#todo")) {
    return "open";
  }
  return null;
}

export function normalizeTodoToken(value: string): TodoStatus | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (["open", "todo", "to-do", "false", "unchecked"].includes(normalized)) return "open";
  if (["doing", "progress", "in-progress", "active"].includes(normalized)) return "doing";
  if (["done", "true", "checked", "complete", "completed"].includes(normalized)) return "done";
  return null;
}

export function todoStatusForCard(card: StudyCard): TodoStatus | null {
  return normalizeTodoToken(card.properties["sgd-todo"] ?? card.properties.todo ?? "");
}

export function isUnlearnedCard(card: StudyCard) {
  return card.srs.reps === 0 || card.srs.state === "new";
}

export function todoStatusOrder(status: TodoStatus) {
  if (status === "open") return 0;
  if (status === "doing") return 1;
  return 2;
}

export function filterTodoItems(items: TodoItem[], query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return items;
  }
  return items.filter((item) =>
    normalizeSearchText(`${item.block.content} ${item.pageName} ${item.path.join(" ")} ${item.deck ?? ""} ${item.topic ?? ""} ${item.hint ?? ""}`).includes(normalized),
  );
}

export function stripTodoPrefix(value: string) {
  return value
    .replace(/^(\- )?\[[ xX]\]\s+/, "")
    .replace(/^(todo|doing|done)\s+/i, "")
    .trim() || "Untitled task";
}

export function todoLearningTarget(item: TodoItem, cards: StudyCard[], settings: AppSettings) {
  const nodeId = item.learningNodeId;
  if (!nodeId) {
    return {
      kind: "source" as const,
      message: "No deck or topic target found, so the source block was opened instead.",
    };
  }

  const scopedCards = cardsForGraphNode(cards, nodeId).filter((card) => todoStatusForCard(card) !== "done");
  if (scopedCards.length === 0) {
    return {
      kind: "source" as const,
      message: "This target has no active cards left, so the source block was opened instead.",
    };
  }

  const dueQueue = buildReviewQueue(cards, nodeId, settings);
  if (dueQueue.length > 0) {
    return {
      kind: "review" as const,
      nodeId,
      label: item.learningLabel ?? todoItemTitle(item),
    };
  }

  return {
    kind: "practice" as const,
    nodeId,
    label: item.learningLabel ?? todoItemTitle(item),
  };
}

export function todoBlockTarget(page: Page, block: Block, cards: StudyCard[]) {
  const blockDeck = singleLine(block.properties["sgd-deck"] ?? block.properties.deck ?? "", "");
  const pageDeck = singleLine(page.properties["sgd-deck"] ?? page.properties.deck ?? "", "");
  const deck = blockDeck || pageDeck;
  const blockTopic = singleLine(block.properties["sgd-topic"] ?? block.properties.topic ?? "", "");
  const pageTopic = singleLine(page.properties["sgd-topic"] ?? page.properties.topic ?? "", "");
  const topic = blockTopic || pageTopic;

  if (deck && topic) {
    const nodeId = `topic:${normalizeSlug(deck)}:${normalizeSlug(topic)}`;
    const targetCards = cardsForGraphNode(cards, nodeId);
    return {
      targetKind: "topic" as const,
      nodeId,
      label: `${deck} / ${topic}`,
      deck,
      topic,
      cards: targetCards,
    };
  }

  if (deck) {
    const nodeId = `deck:${normalizeSlug(deck)}`;
    const targetCards = cardsForGraphNode(cards, nodeId);
    return {
      targetKind: "deck" as const,
      nodeId,
      label: deck,
      deck,
      cards: targetCards,
    };
  }

  const linkedPageNames = pageLinksInText(block.content);
  const directCards = cards.filter((card) =>
    card.source_page === page.name ||
    linkedPageNames.some((linkedPage) => normalizePageRef(linkedPage) === normalizePageRef(card.source_page ?? "")),
  );
  const uniqueTopics = uniqueStrings(directCards.map((card) => `${card.deck_slug}:${card.topic_slug}`));
  if (uniqueTopics.length === 1) {
    const firstCard = directCards[0];
    const nodeId = `topic:${uniqueTopics[0]}`;
    return {
      targetKind: "topic" as const,
      nodeId,
      label: `${firstCard.deck} / ${firstCard.topic}`,
      deck: firstCard.deck,
      topic: firstCard.topic,
      cards: cardsForGraphNode(cards, nodeId),
    };
  }

  const uniqueDecks = uniqueStrings(directCards.map((card) => card.deck_slug));
  if (uniqueDecks.length === 1) {
    const firstCard = directCards[0];
    const nodeId = `deck:${firstCard.deck_slug}`;
    return {
      targetKind: "deck" as const,
      nodeId,
      label: firstCard.deck,
      deck: firstCard.deck,
      cards: cardsForGraphNode(cards, nodeId),
    };
  }

  return {
    targetKind: "block" as const,
    cards: directCards,
  };
}

export function buildTodoMetrics(cards: StudyCard[]): TodoQueueMetrics {
  const activeCards = cards.filter((card) => todoStatusForCard(card) !== "done");
  const dueCards = activeCards.filter(isDue);
  const newCards = activeCards.filter(isNewCard);
  const weakCards = activeCards.filter(isWeak);
  const overdueCards = dueCards.filter((card) => !isNewCard(card));
  return {
    totalCards: activeCards.length,
    dueCards: dueCards.length,
    newCards: newCards.length,
    weakCards: weakCards.length,
    overdueCards: overdueCards.length,
    estimatedMinutes: estimateQueueMinutes(activeCards),
  };
}

export function summarizeTodoMetrics(items: TodoItem[]): TodoQueueMetrics {
  return items.reduce<TodoQueueMetrics>((summary, item) => ({
    totalCards: summary.totalCards + item.metrics.totalCards,
    dueCards: summary.dueCards + item.metrics.dueCards,
    newCards: summary.newCards + item.metrics.newCards,
    weakCards: summary.weakCards + item.metrics.weakCards,
    overdueCards: summary.overdueCards + item.metrics.overdueCards,
    estimatedMinutes: summary.estimatedMinutes + item.metrics.estimatedMinutes,
  }), { totalCards: 0, dueCards: 0, newCards: 0, weakCards: 0, overdueCards: 0, estimatedMinutes: 0 });
}

export function estimateQueueMinutes(cards: StudyCard[]) {
  const minutes = cards.reduce((total, card) => {
    if (isNewCard(card)) return total + 2;
    if (isWeak(card)) return total + 2;
    if (isDue(card)) return total + 1;
    return total + 1;
  }, 0);
  return Math.max(cards.length > 0 ? 1 : 0, minutes);
}

export function targetHint(metrics: TodoQueueMetrics, automaticTopic: boolean) {
  if (metrics.weakCards > 0 && metrics.overdueCards > 0) return "Weak + overdue";
  if (metrics.weakCards > 0) return automaticTopic ? "Weak topic" : "Weak cards";
  if (metrics.overdueCards > 0) return automaticTopic ? "Overdue topic" : "Overdue";
  if (metrics.newCards > 0) return automaticTopic ? "New topic" : "New cards";
  return undefined;
}

export function todoUrgencyScore(item: TodoItem) {
  return item.metrics.overdueCards * 8 + item.metrics.weakCards * 5 + item.metrics.dueCards * 3 + item.metrics.newCards;
}

export function todoTargetLabel(item: TodoItem) {
  if (item.targetKind === "topic") return "Topic target";
  if (item.targetKind === "deck") return "Deck target";
  return "Block target";
}

export function todoLearnButtonLabel(item: TodoItem) {
  if (!item.learningNodeId) return "Open Source";
  if (item.metrics.dueCards > 0) return "Review Due";
  if (item.targetKind === "deck") return "Practice Deck";
  if (item.targetKind === "topic") return "Practice Topic";
  return "Learn";
}

export function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function pageLinksInText(value: string) {
  const links: string[] = [];
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(value)) !== null) {
    links.push(normalizePageTitle(match[1]));
  }
  return uniqueStrings(links);
}

export function todoItemTitle(item: TodoItem) {
  if (item.scope === "topic") {
    return `${item.deck ?? "Deck"} / ${item.topic ?? "Topic"}`;
  }
  return stripTodoPrefix(stripPageLinks(item.block.content));
}

export function todoItemSubtitle(item: TodoItem) {
  if (item.scope === "topic") {
    const count = item.cardCount === 1 ? "1 card" : `${item.cardCount ?? item.blockIds.length} cards`;
    return `${count} | first source: ${item.pageName}`;
  }
  return `${item.pageName}${item.path.length > 1 ? ` / ${item.path.slice(0, -1).map(stripPageLinks).join(" / ")}` : ""}`;
}

export function filterPages(pages: Page[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return pages;
  }
  return pages.filter((page) => {
    const blocks = flattenBlocks(page.blocks)
      .map((entry) => entry.block.content)
      .join(" ");
    return normalizeSearchText(`${page.name} ${blocks}`).includes(normalizedQuery);
  });
}

export function findLastChildId(blocks: Block[], parentBlockId: string): string | null {
  for (const block of blocks) {
    if (block.id === parentBlockId) {
      return block.children.at(-1)?.id ?? null;
    }
    const nested = findLastChildId(block.children, parentBlockId);
    if (nested) return nested;
  }
  return null;
}

export function findNextSiblingId(blocks: Block[], blockId: string): string | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    return blocks[index + 1]?.id ?? null;
  }

  for (const block of blocks) {
    const nested = findNextSiblingId(block.children, blockId);
    if (nested) return nested;
  }
  return null;
}

export function buildSearchResults(snapshot: DesktopSnapshot | null, query: string): SearchResult[] {
  const commands: SearchResult[] = [
    commandResult("notes", "Open Edit Desk", "Open the Logseq-style outliner"),
    commandResult("doc", "Open Documentation", "Open the Notion-style documentation desk"),
    commandResult("todo", "Open To Do", "Capture and review task blocks"),
    commandResult("dashboard", "Open Deck Dashboard", "Show deck counts and due cards"),
    commandResult("review", "Start Due Review", "Open review flow for due cards"),
    commandResult("practice", "Start Free Practice", "Practice cards without changing SRS by default"),
    commandResult("graph", "Open Study Graph", "Show graph-based learning view"),
    commandResult("generate", "Generate Cards", "Create local parser cards from source text"),
    commandResult("settings", "Open Settings and Debug", "Show SQLite settings, storage paths, and debug report"),
    commandResult("import", "Import Markdown", "Import Markdown text, file, or folder"),
    commandResult("export", "Export Markdown", "Preview or export Markdown files"),
    commandResult("refresh", "Refresh Workspace", "Reload local snapshot"),
  ];

  if (!snapshot) {
    return filterSearchResults(commands, query).slice(0, 30);
  }

  const results: SearchResult[] = [...commands];
  const blockLocations = new Map<string, { pageId: string; pageName: string; path: string[] }>();

  for (const page of snapshot.workspace.pages) {
    results.push({
      id: `page:${page.id}`,
      type: "page",
      title: page.name,
      subtitle: "Page",
      pageId: page.id,
      haystack: page.name,
    });

    for (const block of flattenBlocks(page.blocks)) {
      blockLocations.set(block.block.id, {
        pageId: page.id,
        pageName: page.name,
        path: block.path,
      });
      results.push({
        id: `block:${block.block.id}`,
        type: "block",
        title: stripPageLinks(block.block.content),
        subtitle: `${page.name}${block.path.length > 1 ? ` / ${block.path.slice(0, -1).map(stripPageLinks).join(" / ")}` : ""}`,
        pageId: page.id,
        blockId: block.block.id,
        haystack: `${page.name} ${block.path.join(" ")} ${Object.values(block.block.properties).join(" ")}`,
      });
    }
  }

  for (const card of snapshot.cards) {
    const location = blockLocations.get(card.block_id);
    results.push({
      id: `card:${card.id}`,
      type: "card",
      title: card.question,
      subtitle: `${card.deck} / ${card.topic}${location ? ` / ${location.pageName}` : ""}`,
      pageId: location?.pageId,
      blockId: card.block_id,
      haystack: `${card.question} ${card.answer_markdown} ${card.deck} ${card.topic} ${card.linked_pages.join(" ")} ${card.tags.join(" ")}`,
    });
  }

  return filterSearchResults(results, query).slice(0, 50);
}

export function commandResult(action: NonNullable<SearchResult["action"]>, title: string, subtitle: string): SearchResult {
  return {
    id: `command:${action}`,
    type: "command",
    title,
    subtitle,
    action,
    haystack: `${title} ${subtitle}`,
  };
}

export function filterSearchResults(results: SearchResult[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const scored = results
    .map((result) => ({ result, score: scoreSearchResult(result, tokens, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || resultTypeOrder(left.result.type) - resultTypeOrder(right.result.type));

  return scored.map((entry) => entry.result);
}

export function scoreSearchResult(result: SearchResult, tokens: string[], normalizedQuery: string) {
  if (tokens.length === 0) {
    return result.type === "command" ? 80 : 30 - resultTypeOrder(result.type);
  }

  const title = normalizeSearchText(result.title);
  const haystack = normalizeSearchText(result.haystack);
  if (!tokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  let score = 10;
  if (title === normalizedQuery) score += 100;
  if (title.startsWith(normalizedQuery)) score += 70;
  if (title.includes(normalizedQuery)) score += 35;
  if (result.type === "page") score += 12;
  if (result.type === "command") score += 8;
  if (result.type === "card") score += 6;
  return score;
}

export function resultTypeOrder(type: SearchResultType) {
  const order: Record<SearchResultType, number> = {
    command: 0,
    page: 1,
    card: 2,
    block: 3,
  };
  return order[type];
}

export function normalizeSearchText(value: string) {
  return stripPageLinks(value).toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeSlug(value: string) {
  let out = "";
  let lastWasDash = false;
  let lastWasSlash = false;

  for (const character of value.trim().toLocaleLowerCase()) {
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      out += character;
      lastWasDash = false;
      lastWasSlash = false;
    } else if (character === "/") {
      while (out.endsWith("-")) {
        out = out.slice(0, -1);
      }
      if (out && !lastWasSlash) {
        out += "/";
      }
      lastWasDash = false;
      lastWasSlash = true;
    } else if (!lastWasDash && !lastWasSlash && out) {
      out += "-";
      lastWasDash = true;
    }
  }

  return out.replace(/^[-/]+|[-/]+$/g, "");
}

export function flattenBlocks(blocks: Block[], ancestors: string[] = []): Array<{ block: Block; path: string[] }> {
  return blocks.flatMap((block) => {
    const path = [...ancestors, block.content];
    return [{ block, path }, ...flattenBlocks(block.children, path)];
  });
}

export function isDue(card: StudyCard) {
  return !card.srs.due_at || new Date(card.srs.due_at).getTime() <= Date.now();
}

export function dueLabel(card: StudyCard) {
  if (!card.srs.due_at) {
    return "Due now";
  }

  const diffMs = new Date(card.srs.due_at).getTime() - Date.now();
  if (diffMs <= 0) {
    return "Due now";
  }

  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }

  return `${Math.ceil(hours / 24)}d`;
}

export function isNewCard(card: StudyCard) {
  return card.srs.reps === 0 || !card.srs.due_at;
}

export function isWeak(card: StudyCard) {
  return card.srs.lapses >= 2 || card.srs.ease <= 1.6 || card.srs.last_rating === "again" || card.srs.hard_count >= 2;
}

export function isOverdue(card: StudyCard) {
  return isDue(card) && !isNewCard(card);
}

export function applyGraphCardFilters(cards: StudyCard[], statusFilter: GraphStatusFilter, deckFilter: string) {
  let filtered = [...cards];
  if (deckFilter !== "all") {
    filtered = filtered.filter((card) => card.deck_slug === deckFilter);
  }

  if (statusFilter === "due") {
    filtered = filtered.filter(isDue);
  } else if (statusFilter === "overdue") {
    filtered = filtered.filter(isOverdue);
  } else if (statusFilter === "weak") {
    filtered = filtered.filter(isWeak);
  } else if (statusFilter === "new") {
    filtered = filtered.filter(isNewCard);
  }

  return filtered;
}

export function filterGraphForView(snapshot: DesktopSnapshot, statusFilter: GraphStatusFilter, deckFilter: string) {
  const graph = graphWithLearningClusters(snapshot);
  const filteredCardIds = new Set(
    applyGraphCardFilters(snapshot.cards, statusFilter, deckFilter).map((card) => `card:${card.id}`),
  );

  if (statusFilter === "all" && deckFilter === "all") {
    return graph;
  }

  const nodes = graph.nodes.filter((node) => {
    if (node.kind === "card") {
      return filteredCardIds.has(node.id);
    }
    return applyGraphCardFilters(cardsForGraphNode(snapshot.cards, node.id), statusFilter, deckFilter).length > 0;
  });
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return { nodes, edges };
}

export function graphWithLearningClusters(snapshot: DesktopSnapshot) {
  const nodes = [...snapshot.graph.nodes];
  const edges = [...snapshot.graph.edges];
  appendLearningCluster(nodes, edges, "concept:overdue-cards", "Overdue Cards", snapshot.cards.filter(isOverdue));
  appendLearningCluster(nodes, edges, "concept:new-cards", "New Cards", snapshot.cards.filter(isNewCard));
  return { nodes, edges };
}

export function appendLearningCluster(
  nodes: StudyGraphNode[],
  edges: StudyGraphEdge[],
  id: string,
  label: string,
  cards: StudyCard[],
) {
  if (cards.length === 0 || nodes.some((node) => node.id === id)) {
    return;
  }
  nodes.push({
    id,
    kind: "concept",
    label,
    total_cards: cards.length,
    due_cards: cards.filter(isDue).length,
    weak_cards: cards.filter(isWeak).length,
  });
  for (const card of cards) {
    edges.push({
      id: `Related:${id}:card:${card.id}`,
      source: id,
      target: `card:${card.id}`,
      kind: "related",
    });
  }
}

export function summarizeCards(cards: StudyCard[]) {
  const topicMap = new Map<string, { deck: string; topic: string; count: number; due: number; weak: number }>();
  let easeTotal = 0;
  let intervalTotal = 0;

  for (const card of cards) {
    easeTotal += card.srs.ease;
    intervalTotal += card.srs.interval_days;
    const key = `${card.deck_slug}:${card.topic_slug}`;
    const current = topicMap.get(key) ?? { deck: card.deck, topic: card.topic, count: 0, due: 0, weak: 0 };
    current.count += 1;
    current.due += Number(isDue(card));
    current.weak += Number(isWeak(card));
    topicMap.set(key, current);
  }

  return {
    total: cards.length,
    due: cards.filter(isDue).length,
    overdue: cards.filter(isOverdue).length,
    weak: cards.filter(isWeak).length,
    newCards: cards.filter(isNewCard).length,
    upcoming: cards.filter((card) => !isDue(card)).length,
    averageEase: cards.length > 0 ? easeTotal / cards.length : 0,
    averageIntervalDays: cards.length > 0 ? intervalTotal / cards.length : 0,
    topTopics: Array.from(topicMap.values()).sort((left, right) => {
      const pressureCompare = (right.due * 3 + right.weak * 2 + right.count) - (left.due * 3 + left.weak * 2 + left.count);
      if (pressureCompare !== 0) return pressureCompare;
      return left.topic.localeCompare(right.topic);
    }),
  };
}

export function isSystemGraphNode(node: StudyGraphNode) {
  return node.id === "concept:weak-cards" || node.id === "concept:overdue-cards" || node.id === "concept:new-cards";
}

export function graphNodeSignalClasses(stats: ReturnType<typeof summarizeCards>, isSelected: boolean) {
  return [
    isSelected ? "selected" : "",
    stats.overdue > 0 ? "overdue" : "",
    stats.weak > 0 ? "weak" : "",
    stats.newCards > 0 && stats.total === stats.newCards ? "new" : "",
  ].filter(Boolean).join(" ");
}

export function nodeRadius(node: StudyGraphNode) {
  const base = node.kind === "deck" ? 22 : node.kind === "topic" ? 17 : node.kind === "concept" ? 15 : 12;
  return Math.min(base + Math.floor(Math.sqrt(node.total_cards || 1)), base + 8);
}

export function clampZoom(value: number) {
  return Math.min(2.8, Math.max(0.35, Number(value.toFixed(2))));
}

export function layoutGraph(nodes: StudyGraphNode[], edges: StudyGraphEdge[]) {
  const lanes: Record<StudyGraphNode["kind"], number> = {
    deck: 90,
    topic: 300,
    card: 540,
    concept: 790,
    source: 1030,
  };
  const grouped: Record<StudyGraphNode["kind"], StudyGraphNode[]> = {
    deck: [],
    topic: [],
    card: [],
    concept: [],
    source: [],
  };
  for (const node of nodes) {
    grouped[node.kind].push(node);
  }

  const orderNodes = (items: StudyGraphNode[]) => [...items].sort((left, right) => {
    const signalCompare = (right.due_cards + right.weak_cards) - (left.due_cards + left.weak_cards);
    if (signalCompare !== 0) return signalCompare;
    return left.label.localeCompare(right.label);
  });

  const laidOut: Array<StudyGraphNode & { x: number; y: number }> = [];
  let maxLaneCount = 1;
  (Object.keys(grouped) as Array<StudyGraphNode["kind"]>).forEach((kind) => {
    const ordered = orderNodes(grouped[kind]);
    maxLaneCount = Math.max(maxLaneCount, ordered.length);
    ordered.forEach((node, index) => {
      laidOut.push({ ...node, x: lanes[kind], y: 70 + index * 78 });
    });
  });

  const maxY = Math.max(620, 150 + maxLaneCount * 78);
  const maxX = Math.max(1120, Math.max(...laidOut.map((node) => node.x), 1030) + 120);
  return {
    nodes: laidOut,
    edges,
    size: { width: maxX, height: maxY },
  };
}

export function titleForScreen(screen: Screen) {
  const titles: Record<Screen, string> = {
    notes: "Edit Desk",
    doc: "Documentation",
    todo: "To Do",
    dashboard: "Deck Dashboard",
    review: "Review",
    practice: "Free Practice",
    graph: "Study Graph",
    generate: "Generate Cards",
    settings: "Settings / Debug",
    import: "Import Markdown",
    export: "Export Markdown",
  };
  return titles[screen];
}

export function shorten(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

export function pageNameFromFilePath(filePath: string) {
  const fileName = filePath.split(/[\\/]/).pop() ?? "Imported Page";
  return fileName.replace(/\.(md|markdown|txt)$/i, "") || "Imported Page";
}

export function extractPageLinks(value: string) {
  const links = new Set<string>();
  const pattern = /\[\[([^\]]+)]]/g;
  let match = pattern.exec(value);
  while (match) {
    const link = normalizePageTitle(match[1]);
    if (link) {
      links.add(link);
    }
    match = pattern.exec(value);
  }
  return Array.from(links);
}

export function normalizePageTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function backlinksForPage(backlinks: BacklinkReference[], pageName: string) {
  const wanted = normalizePageRef(pageName);
  return backlinks.filter((backlink) => normalizePageRef(backlink.target_page) === wanted);
}

export function normalizePageRef(value: string) {
  return normalizePageTitle(value).toLocaleLowerCase();
}

export function groupBacklinksBySource(backlinks: BacklinkReference[]) {
  const groups = new Map<string, { source_page_id: string; source_page: string; references: BacklinkReference[] }>();
  for (const backlink of backlinks) {
    const current = groups.get(backlink.source_page_id) ?? {
      source_page_id: backlink.source_page_id,
      source_page: backlink.source_page,
      references: [],
    };
    current.references.push(backlink);
    groups.set(backlink.source_page_id, current);
  }
  return Array.from(groups.values()).sort((left, right) => left.source_page.localeCompare(right.source_page));
}

export function stripPageLinks(value: string) {
  return value.replace(/\[\[([^\]]+)]]/g, "$1");
}
