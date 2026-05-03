import {
  buildClozePrompt,
  clampNumber,
  escapeRegExp,
  shorten,
  singleLine,
  stripPageLinks,
} from "./studyLogic.js";
import type {
  AiCardGenerationRequest,
  AiCardGenerationResponse,
  AiClozeGenerationRequest,
  AiClozeGenerationResponse,
  AiProviderKind,
  AiQualityIssue,
  AppSettings,
  CardGeneratorInput,
  GeneratedCard,
  StudyCard,
} from "./types.js";

export interface AiGenerationProvider {
  id: string;
  label: string;
  kind: AiProviderKind;
  offline: boolean;
  privacyNote: string;
  generateCards(request: AiCardGenerationRequest): AiCardGenerationResponse;
  generateCloze(request: AiClozeGenerationRequest): AiClozeGenerationResponse;
}

const LOCAL_PROVIDER_ID = "local-heuristic-v1";

export const localHeuristicAiProvider: AiGenerationProvider = {
  id: LOCAL_PROVIDER_ID,
  label: "Local heuristic provider",
  kind: "local-heuristic",
  offline: true,
  privacyNote: "Runs deterministic card and cloze generation locally. No source text leaves this device.",
  generateCards: runLocalAiCardGeneration,
  generateCloze: runLocalAiClozeGeneration,
};

export function createConfiguredAiProvider(settings: AppSettings): AiGenerationProvider {
  if (settings.apiProviderEnabled && (settings.apiBaseUrl || settings.apiModel || settings.openAiConnectionMode !== "none")) {
    return createExternalApiPlaceholderProvider(settings);
  }
  return localHeuristicAiProvider;
}

function createExternalApiPlaceholderProvider(settings: AppSettings): AiGenerationProvider {
  return {
    id: "external-api-placeholder",
    label: settings.apiModel ? `External API placeholder (${settings.apiModel})` : "External API placeholder",
    kind: "external-api-placeholder",
    offline: true,
    privacyNote: "OpenAI/API settings are metadata only in this build. Requests intentionally fall back to the local heuristic provider.",
    generateCards(request) {
      const response = runLocalAiCardGeneration(request);
      return {
        ...response,
        providerId: LOCAL_PROVIDER_ID,
        providerKind: "local-heuristic",
        issues: [
          apiPlaceholderIssue(),
          ...response.issues,
        ],
      };
    },
    generateCloze(request) {
      const response = runLocalAiClozeGeneration(request);
      return {
        ...response,
        providerId: LOCAL_PROVIDER_ID,
        providerKind: "local-heuristic",
        issues: [
          apiPlaceholderIssue(),
          ...response.issues,
        ],
      };
    },
  };
}

function apiPlaceholderIssue(): AiQualityIssue {
  return {
    level: "info",
    code: "external-api-placeholder",
    message: "External AI provider hookup is reserved for a later secure implementation; this run used the offline local provider.",
  };
}

export function runLocalAiCardGeneration(request: AiCardGenerationRequest): AiCardGenerationResponse {
  const input = normalizeCardGeneratorInput(request.input);
  const rawCards = generateLocalCards(input);
  const { cards, issues, duplicateCount, qualityWarningCount } = filterGeneratedCardQuality(rawCards, request.existingCards ?? []);

  return {
    providerId: LOCAL_PROVIDER_ID,
    providerKind: "local-heuristic",
    offline: true,
    cards,
    issues: [
      {
        level: "info",
        code: "offline-local",
        message: "Generated locally with deterministic heuristics; no external API call was made.",
      },
      ...issues,
    ],
    diagnostics: {
      requestedCards: input.number_of_cards,
      candidateCards: rawCards.length,
      acceptedCards: cards.length,
      rejectedDuplicates: duplicateCount,
      qualityWarnings: qualityWarningCount,
    },
  };
}

export function runLocalAiClozeGeneration(request: AiClozeGenerationRequest): AiClozeGenerationResponse {
  const cloze = buildClozePrompt(request.card);
  const issues: AiQualityIssue[] = [
    {
      level: "info",
      code: "offline-local",
      message: "Cloze blanks were selected locally from the card answer; no model/API call was made.",
    },
  ];
  const cleanAnswer = singleLine(request.card.answer_markdown, "");

  if (!cleanAnswer) {
    issues.push({
      level: "error",
      code: "missing-answer",
      message: "This card has no answer text, so cloze generation cannot create blanks.",
    });
  } else if (cloze.blanks.length === 0) {
    issues.push({
      level: "warning",
      code: "no-strong-blank",
      message: "No sufficiently distinctive terms were found for cloze practice; use Classic Q/A for this card.",
    });
  }

  const duplicateBlankCount = countDuplicates(cloze.blanks.map(normalizeForDuplicate));
  if (duplicateBlankCount > 0) {
    issues.push({
      level: "warning",
      code: "duplicate-cloze-blank",
      message: `${duplicateBlankCount} repeated cloze blank${duplicateBlankCount === 1 ? " was" : "s were"} ignored by the quality check.`,
    });
  }

  return {
    providerId: LOCAL_PROVIDER_ID,
    providerKind: "local-heuristic",
    offline: true,
    cloze,
    issues,
    diagnostics: {
      blankCount: cloze.blanks.length,
      answerCharacters: request.card.answer_markdown.length,
      qualityWarnings: issues.filter((issue) => issue.level === "warning" || issue.level === "error").length,
    },
  };
}

export function aiQualitySummary(issues: AiQualityIssue[]) {
  const warnings = issues.filter((issue) => issue.level === "warning").length;
  const errors = issues.filter((issue) => issue.level === "error").length;
  if (errors > 0) return `${errors} quality error${errors === 1 ? "" : "s"}`;
  if (warnings > 0) return `${warnings} quality warning${warnings === 1 ? "" : "s"}`;
  return "quality checks passed";
}

function normalizeCardGeneratorInput(input: CardGeneratorInput): CardGeneratorInput {
  return {
    ...input,
    deck: singleLine(input.deck, "Generated"),
    topic: singleLine(input.topic, "General"),
    source_text: input.source_text.trim(),
    number_of_cards: clampNumber(input.number_of_cards, 1, 30),
    vocabulary_deck: singleLine(input.vocabulary_deck, `${singleLine(input.deck, "Generated")} Vocabulary`),
  };
}

function filterGeneratedCardQuality(candidates: GeneratedCard[], existingCards: StudyCard[]) {
  const cards: GeneratedCard[] = [];
  const issues: AiQualityIssue[] = [];
  const seenKeys = new Set<string>();
  const existingQuestionKeys = new Set(existingCards.map((card) => normalizeForDuplicate(card.question)).filter(Boolean));
  const existingCardKeys = new Set(existingCards.map((card) => duplicateKey(card.question, card.answer_markdown)).filter(Boolean));
  let duplicateCount = 0;
  let qualityWarningCount = 0;

  candidates.forEach((candidate, cardIndex) => {
    const question = singleLine(candidate.question, "");
    const answer = singleLine(candidate.answer, "");
    const key = duplicateKey(question, answer);
    const questionKey = normalizeForDuplicate(question);

    if (!question || !answer) {
      qualityWarningCount += 1;
      issues.push({ level: "error", code: "empty-card-field", cardIndex, field: !question ? "question" : "answer", message: "Generated card has an empty question or answer and was skipped." });
      return;
    }
    if (question.length < 8 || answer.length < 8) {
      qualityWarningCount += 1;
      issues.push({ level: "warning", code: "short-card", cardIndex, message: "Generated card is very short; review it before inserting." });
    }
    if (normalizeForDuplicate(question) === normalizeForDuplicate(answer)) {
      qualityWarningCount += 1;
      issues.push({ level: "error", code: "question-answer-identical", cardIndex, message: "Generated question and answer are effectively identical and were skipped." });
      return;
    }
    if (seenKeys.has(key) || existingCardKeys.has(key) || existingQuestionKeys.has(questionKey)) {
      duplicateCount += 1;
      issues.push({ level: "warning", code: "duplicate-card", cardIndex, message: "Duplicate or already-existing card was skipped." });
      return;
    }

    seenKeys.add(key);
    cards.push({
      ...candidate,
      question,
      answer,
      deck: singleLine(candidate.deck, "Generated"),
      topic: singleLine(candidate.topic, "General"),
      tags: candidate.tags.map((tag) => singleLine(tag, "")).filter(Boolean),
      source_summary: candidate.source_summary ? shorten(candidate.source_summary, 160) : undefined,
    });
  });

  return { cards, issues, duplicateCount, qualityWarningCount };
}

function duplicateKey(question: string, answer: string) {
  return `${normalizeForDuplicate(question)}::${normalizeForDuplicate(answer)}`;
}

function normalizeForDuplicate(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countDuplicates(values: string[]) {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates += 1;
    seen.add(value);
  }
  return duplicates;
}

function generateLocalCards(input: CardGeneratorInput): GeneratedCard[] {
  const sentences = splitSourceSentences(input.source_text);
  const definitionFacts = extractDefinitionFacts(input.source_text);
  if (sentences.length === 0 && definitionFacts.length === 0) {
    return [];
  }

  const language = resolveGeneratorLanguage(input.language, input.source_text);
  const deck = singleLine(input.deck, "Generated");
  const topic = singleLine(input.topic, "General");
  const vocabularyDeck = singleLine(input.vocabulary_deck, `${deck} Vocabulary`);
  const limit = clampNumber(input.number_of_cards, 1, 30);
  const directCards = definitionFacts.slice(0, limit).map((fact) => ({
    question: fact.question || (language === "de" ? `Was bedeutet "${fact.term}" im Kontext ${topic}?` : `What does "${fact.term}" mean in the context of ${topic}?`),
    answer: fact.answer,
    deck,
    topic,
    tags: ["generated", input.difficulty, "definition"],
    source_summary: shorten(fact.answer, 120),
  } satisfies GeneratedCard));
  const directSources = new Set(definitionFacts.map((fact) => fact.source));
  const remainingSentences = sentences.filter((sentence) => !directSources.has(sentence));
  const remainingLimit = Math.max(0, limit - directCards.length);

  const sentenceCards = remainingSentences.slice(0, remainingLimit).map((sentence, index) => {
    const term = pickKeyTerm(sentence, topic);
    const style = input.card_style === "mixed" ? (index % 3 === 1 ? "cloze" : "basic") : input.card_style;
    const promptPrefix =
      input.difficulty === "hard"
        ? language === "de" ? "Erklaere technisch praezise" : "Explain precisely"
        : input.difficulty === "easy"
          ? language === "de" ? "Was bedeutet" : "What does"
          : language === "de" ? "Wie erklaerst du" : "How would you explain";
    const contextPhrase = language === "de" ? `im Kontext ${topic}` : `in the context of ${topic}`;

    if (style === "cloze") {
      return {
        question: language === "de"
          ? `Ergaenze den zentralen Begriff: ${maskTerm(sentence, term)}`
          : `Fill in the key term: ${maskTerm(sentence, term)}`,
        answer: `${term}: ${sentence}`,
        deck,
        topic,
        tags: ["generated", input.difficulty, "cloze"],
        source_summary: shorten(sentence, 120),
      } satisfies GeneratedCard;
    }

    return {
      question: `${promptPrefix} "${term}" ${contextPhrase}?`,
      answer: sentence,
      deck,
      topic,
      tags: ["generated", input.difficulty, "basic"],
      source_summary: shorten(sentence, 120),
    } satisfies GeneratedCard;
  });
  const baseCards = [...directCards, ...sentenceCards];

  const bidirectionalCards = input.bidirectional_cards
    ? baseCards.map((card) => ({
        question: language === "de" ? `Welche Frage passt zu: ${shorten(card.answer, 90)}?` : `Which prompt matches: ${shorten(card.answer, 90)}?`,
        answer: card.question,
        deck: card.deck,
        topic: card.topic,
        tags: [...card.tags.filter((tag) => !["basic", "cloze", "definition"].includes(tag)), "bidirectional"],
        source_summary: card.source_summary,
      } satisfies GeneratedCard))
    : [];

  const vocabularyCards = input.vocabulary_mode
    ? extractVocabularyTerms([...definitionFacts.map((fact) => `${fact.term}: ${fact.answer}`), ...sentences], topic).slice(0, Math.min(limit, 12)).map(({ term, sentence }) => ({
        question: language === "de" ? `Was bedeutet "${term}" in diesem Text?` : `What does "${term}" mean in this text?`,
        answer: language === "de" ? `Kontext: ${sentence}` : `Context: ${sentence}`,
        deck: vocabularyDeck,
        topic: language === "de" ? "Vokabeln" : "Vocabulary",
        tags: ["generated", "vocabulary", "language-learning"],
        source_summary: shorten(sentence, 120),
      } satisfies GeneratedCard))
    : [];

  return [...baseCards, ...bidirectionalCards, ...vocabularyCards];
}

interface DefinitionFact {
  term: string;
  answer: string;
  source: string;
  question?: string;
}

function splitSourceSentences(value: string) {
  const seen = new Set<string>();
  const chunks: string[] = [];
  for (const rawLine of value.replace(/\r/g, "").split(/\n+/)) {
    const cleanLine = cleanSourceLine(rawLine);
    if (!cleanLine) continue;
    const parts = cleanLine.length > 220
      ? cleanLine.split(/(?<=[.!?])\s+/)
      : [cleanLine];
    for (const part of parts) {
      const cleanPart = singleLine(part.replace(/[.!?]+$/, ""), "");
      const key = cleanPart.toLocaleLowerCase();
      if (cleanPart.length >= 8 && !seen.has(key)) {
        seen.add(key);
        chunks.push(cleanPart);
      }
    }
  }
  return chunks;
}

function extractDefinitionFacts(value: string): DefinitionFact[] {
  const lines = value.replace(/\r/g, "").split(/\n+/).map(cleanSourceLine).filter(Boolean);
  const facts: DefinitionFact[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    const qaMatch = line.match(/^(?:q|frage|question)\s*[:?]\s*(.+)$/i);
    const answerMatch = next.match(/^(?:a|antwort|answer)\s*[:\-]\s*(.+)$/i);
    if (qaMatch && answerMatch) {
      addDefinitionFact(facts, seen, {
        term: pickKeyTerm(qaMatch[1], ""),
        question: singleLine(qaMatch[1], "Generated question"),
        answer: singleLine(answerMatch[1], "Generated answer"),
        source: line,
      });
      index += 1;
      continue;
    }

    const arrowMatch = line.match(/^(.{2,80}?)\s*(?:=>|->|—|–)\s*(.{8,})$/);
    if (arrowMatch) {
      addDefinitionFact(facts, seen, {
        term: cleanTerm(arrowMatch[1]),
        answer: singleLine(arrowMatch[2], "Generated answer"),
        source: line,
      });
      continue;
    }

    const colonMatch = line.match(/^([^:]{2,70}):\s*(.{8,})$/);
    if (colonMatch && !/^(sgd-|deck|topic|card)\b/i.test(colonMatch[1])) {
      addDefinitionFact(facts, seen, {
        term: cleanTerm(colonMatch[1]),
        answer: singleLine(colonMatch[2], "Generated answer"),
        source: line,
      });
    }
  }

  return facts;
}

function cleanSourceLine(value: string) {
  const trimmed = value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^TODO\s+/i, "");
  if (!trimmed || /^(sgd-|deck|topic|card)[\w-]*::/i.test(trimmed)) return "";
  return singleLine(stripPageLinks(trimmed), "");
}

function cleanTerm(value: string) {
  return singleLine(value.replace(/^[`*_]+|[`*_]+$/g, ""), "concept").replace(/[.:;,-]+$/, "");
}

function addDefinitionFact(facts: DefinitionFact[], seen: Set<string>, fact: DefinitionFact) {
  const term = cleanTerm(fact.term);
  const answer = singleLine(fact.answer, "");
  const key = `${term.toLocaleLowerCase()}::${answer.toLocaleLowerCase()}`;
  if (!term || !answer || seen.has(key)) return;
  seen.add(key);
  facts.push({ ...fact, term, answer });
}

function resolveGeneratorLanguage(language: CardGeneratorInput["language"], sourceText: string): "de" | "en" {
  if (language === "de" || language === "en") {
    return language;
  }
  const lower = ` ${sourceText.toLocaleLowerCase()} `;
  return /[äöüß]/i.test(sourceText) || /\b(der|die|das|und|ist|eine|einen|mit|fuer|für|nicht)\b/.test(lower)
    ? "de"
    : "en";
}

function extractVocabularyTerms(sentences: string[], topic: string) {
  const seen = new Set<string>();
  const terms: Array<{ term: string; sentence: string }> = [];

  for (const sentence of sentences) {
    for (const rawWord of sentence.replace(/[`*_()[\]{}"':;,.!?]/g, " ").split(/\s+/)) {
      const term = rawWord.trim();
      const normalized = term.toLocaleLowerCase();
      if (term.length < 4 || seen.has(normalized) || normalizeVocabularyStopWords(topic).has(normalized)) {
        continue;
      }
      seen.add(normalized);
      terms.push({ term, sentence });
    }
  }

  return terms.sort((left, right) => right.term.length - left.term.length);
}

function normalizeVocabularyStopWords(topic: string) {
  return new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "das",
    "der",
    "die",
    "eine",
    "einen",
    "for",
    "from",
    "ist",
    "mit",
    "nicht",
    "oder",
    "that",
    "the",
    "this",
    "und",
    "von",
    "was",
    "were",
    "with",
    ...topic.split(/[\s/,-]+/).map((word) => word.toLocaleLowerCase()).filter((word) => word.length > 0),
  ]);
}

function pickKeyTerm(sentence: string, topic: string) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "because",
    "das",
    "der",
    "die",
    "eine",
    "einen",
    "for",
    "from",
    "ist",
    "mit",
    "nicht",
    "oder",
    "that",
    "the",
    "this",
    "und",
    "von",
    "was",
    "were",
    "with",
  ]);
  const topicWords = topic.split(/[\s/,-]+/).filter((word) => word.length > 3);
  const words = sentence
    .replace(/[`*_()[\]{}"':;,.!?]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const candidates = words.filter((word) => {
    const normalized = word.toLocaleLowerCase();
    return word.length >= 4 && !stopWords.has(normalized);
  });

  const topicCandidate = candidates.find((word) =>
    topicWords.some((topicWord) => word.toLocaleLowerCase().includes(topicWord.toLocaleLowerCase())),
  );
  return topicCandidate ?? candidates.sort((left, right) => right.length - left.length)[0] ?? words[0] ?? "concept";
}

function maskTerm(sentence: string, term: string) {
  if (!term) {
    return sentence;
  }
  return sentence.replace(new RegExp(escapeRegExp(term), "i"), "____");
}
