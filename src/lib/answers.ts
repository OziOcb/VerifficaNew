// Pure answer-value domain + the small aggregations the card flow (S-05) needs now
// and the Summary (S-06) reuses later, plus the FR-018 contextual-note block helper.
//
// SERVER-SAFE: no Dexie / React / catalogue import — every export is a total, pure
// function over plain values, so it unit-tests directly and is safe to import from
// either the `.astro` route frontmatter or the client island.
//
// Casing: the answer ENUM VALUES (`"dont_know"`) are opaque domain tokens that match
// the catalogue's `allowedAnswers` verbatim — they are wire values, NOT DB column
// names, so the snake↔camel boundary (lessons.md "Field casing") does not touch them.
// The answers MAP keys are opaque `q_…` question IDs and likewise stay verbatim (the
// sync boundary excludes the `answers` jsonb from deep key-casing — see Phase 1).

// Type-only import (erased at build), so this module stays catalogue-free and server-safe —
// the same discipline `@/lib/session-counts` uses to import `PartId` without shipping the bank.
import type { PartId } from "@/lib/questions";

/** A single answer to a question card. Mirrors the catalogue's `allowedAnswers`. */
export type Answer = "yes" | "no" | "dont_know";

/**
 * Question ID → answer. Keys are opaque `q_…` catalogue IDs, kept verbatim. `Partial` so
 * indexing by an arbitrary id yields `Answer | undefined` — an absent answer is the normal
 * case the helpers below branch on (mirrors the catalogue's `explanations` typing in
 * `questions.ts`, and matches the runtime reality that most ids have no answer yet).
 */
export type AnswersMap = Partial<Record<string, Answer>>;

/** How many of `ids` have an answer recorded in `answers`. */
export function answeredCount(ids: readonly string[], answers: AnswersMap): number {
  let n = 0;
  for (const id of ids) if (answers[id] !== undefined) n++;
  return n;
}

/**
 * The resume index into `orderedIds`: the position of the first question with no
 * recorded answer, in deck order. Returns `orderedIds.length` when every question is
 * answered — i.e. one past the final card, which the card deck reads as "land on the
 * end-of-Part transition screen". An empty deck likewise returns 0 (= length).
 */
export function firstUnansweredIndex(orderedIds: readonly string[], answers: AnswersMap): number {
  for (let i = 0; i < orderedIds.length; i++) {
    if (answers[orderedIds[i]] === undefined) return i;
  }
  return orderedIds.length;
}

/** The raw Yes / No / Don't-know tally across `ids` (equal weighting, FR-019). */
export function distribution(
  ids: readonly string[],
  answers: AnswersMap,
): { yes: number; no: number; dontKnow: number } {
  const dist = { yes: 0, no: 0, dontKnow: 0 };
  for (const id of ids) {
    const a = answers[id];
    if (a === "yes") dist.yes++;
    else if (a === "no") dist.no++;
    else if (a === "dont_know") dist.dontKnow++;
  }
  return dist;
}

// --- Answer polarity / sentiment (S-06, FR-019) ---------------------------
//
// The SENTIMENT of a raw answer depends on the Part (idea/veriffica-instruction.md:25-27,
// reconciled with FR-019). Parts 2–4 are defect/symptom checks — every question asks "is this
// fault present?", so `No` is the POSITIVE (good) answer and `Yes` the negative. Part 5 is
// presence/validity — every question asks "is this document/mark present & valid?", so `Yes`
// is positive and `No` negative. `dont_know` is `unknown` everywhere. This is an equal-weight
// INTERPRETATION rule (every question still counts once) — NOT severity weighting, which stays
// an FR-019 non-goal. The Summary/Total-Score charts render this sentiment; the raw
// `distribution()` above is kept for any need of the literal yes/no tally.

/** A per-answer sentiment tally: positive (good) / negative (bad) / unknown (Don't know). */
export interface Sentiment {
  positive: number;
  negative: number;
  unknown: number;
}

/**
 * The raw answer that counts as POSITIVE (good) for a Part: `no` for the condition Parts (2–4),
 * `yes` for the documents Part (5). `PartId` is imported as a type only, so this stays
 * catalogue-free and server-safe. The per-Part rule is uniform (no per-question overrides).
 */
export function positiveAnswer(part: PartId): Answer {
  return part === "part5" ? "yes" : "no";
}

/**
 * Classify each answered id in `ids` into positive/negative/unknown by the given polarity
 * (`positive` = which raw answer is good for this Part). Unanswered ids are skipped; `dont_know`
 * is always `unknown`. Pass one Part's ids + `positiveAnswer(part)` so the correct polarity
 * applies — sentiment is inherently per-Part, so a flat all-parts call would mix polarities.
 */
export function sentimentDistribution(ids: readonly string[], answers: AnswersMap, positive: Answer): Sentiment {
  const s: Sentiment = { positive: 0, negative: 0, unknown: 0 };
  for (const id of ids) {
    const a = answers[id];
    if (a === undefined) continue;
    if (a === "dont_know") s.unknown++;
    else if (a === positive) s.positive++;
    else s.negative++;
  }
  return s;
}

/** Add up several per-Part sentiment tallies into the global (Total Score) sentiment. */
export function sumSentiments(parts: readonly Sentiment[]): Sentiment {
  const total: Sentiment = { positive: 0, negative: 0, unknown: 0 };
  for (const p of parts) {
    total.positive += p.positive;
    total.negative += p.negative;
    total.unknown += p.unknown;
  }
  return total;
}

// --- FR-018 contextual-note blocks ----------------------------------------
//
// The global notes document (FR-010, one 10,000-char doc per inspection) is a free-form
// textarea. FR-018 appends a per-question note to it as a delimited "block": a header line
// — the question's part + identity, e.g. `Part 2 — Standstill: Front suspension — cracked
// rubber parts` — followed by the note body, with every body line quoted as a markdown
// blockquote (`> …`). The blockquote IS the machine-readable marker that lets a block parse
// back for in-place replace / pre-fill (so re-noting REPLACES rather than duplicates).
// Blocks (and any free user text) are separated by a blank line, so a block reads naturally
// in the textarea and parses back deterministically.
//
// Documented constraint of this model: a note body must not contain a blank line (`\n\n`),
// which would be mis-read as a block boundary. The 500-char card cap keeps notes short; the
// card UI is the place to discourage these.

const BODY_QUOTE = "> ";
const SEGMENT_SEPARATOR = "\n\n";

interface Segment {
  /** The block header line when this segment is a note block, else `null` (free user text). */
  header: string | null;
  /** The de-quoted note body (block) or the verbatim free text (non-block). */
  body: string;
}

function parseSegment(segment: string): Segment {
  const nl = segment.indexOf("\n");
  if (nl === -1) return { header: null, body: segment };
  const firstLine = segment.slice(0, nl);
  const restLines = segment.slice(nl + 1).split("\n");
  // A note block: a header line followed by one or more `>`-quoted body lines. The blockquote
  // on every following line is what distinguishes a block from incidental free user text.
  if (restLines.every((l) => l.startsWith(">"))) {
    return { header: firstLine, body: restLines.map((l) => l.replace(/^>\s?/, "")).join("\n") };
  }
  return { header: null, body: segment };
}

function splitSegments(globalNotes: string): string[] {
  return globalNotes === "" ? [] : globalNotes.split(SEGMENT_SEPARATOR);
}

/**
 * Return the existing contextual-note body for `header`, or `null` if no block for that
 * question exists. Lets the card pre-fill its note field so an edit replaces in place.
 */
export function readNoteBlock(globalNotes: string, header: string): string | null {
  for (const seg of splitSegments(globalNotes)) {
    const parsed = parseSegment(seg);
    if (parsed.header === header) return parsed.body;
  }
  return null;
}

/**
 * Upsert the contextual-note block for `header` into the global notes document:
 * - a non-empty `note` replaces the existing block in place, or appends a new block at the
 *   end when none exists (preserving the order of all other content);
 * - an empty / whitespace-only `note` removes the block entirely.
 *
 * Deterministic and idempotent: `upsert(upsert(doc, h, n), h, n) === upsert(doc, h, n)`.
 * Length is still bounded by the caller's existing 10,000-char `MAX_GLOBAL_NOTES_LENGTH`
 * guard — this helper does not enforce the cap.
 */
export function upsertNoteBlock(globalNotes: string, header: string, note: string): string {
  const isEmpty = note.trim() === "";
  const quotedBody = note
    .split("\n")
    .map((l) => `${BODY_QUOTE}${l}`)
    .join("\n");
  const newBlock = `${header}\n${quotedBody}`;

  let replaced = false;
  const segments: string[] = [];
  for (const seg of splitSegments(globalNotes)) {
    if (parseSegment(seg).header === header) {
      replaced = true;
      if (!isEmpty) segments.push(newBlock); // else: drop the block (empty note removes it)
    } else {
      segments.push(seg);
    }
  }
  if (!replaced && !isEmpty) segments.push(newBlock);

  return segments.join(SEGMENT_SEPARATOR);
}
