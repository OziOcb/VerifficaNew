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

/** The Yes / No / Don't-know distribution across `ids` (equal weighting, FR-019). */
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

// --- FR-018 contextual-note blocks ----------------------------------------
//
// The global notes document (FR-010, one 10,000-char doc per inspection) is a free-form
// textarea. FR-018 appends a per-question note to it under the question's header. To make
// re-noting REPLACE rather than duplicate, each contextual note is stored as a delimited
// "block": a header line `### <header>` followed by the note body. Blocks (and any free
// user text) are separated by a blank line, so a block reads naturally in the textarea and
// parses back deterministically.
//
// Documented constraint of this model: a note body must not itself contain a blank line
// (`\n\n`) or a line beginning with `### ` — either would be mis-parsed as a block boundary.
// The 500-char card cap keeps notes short; the card UI is the place to discourage these.

const NOTE_HEADER_PREFIX = "### ";
const SEGMENT_SEPARATOR = "\n\n";

interface Segment {
  /** The block header when this segment is a note block, else `null` (free user text). */
  header: string | null;
  /** The note body (block) or the verbatim free text (non-block). */
  body: string;
}

function parseSegment(segment: string): Segment {
  const nl = segment.indexOf("\n");
  const firstLine = nl === -1 ? segment : segment.slice(0, nl);
  if (firstLine.startsWith(NOTE_HEADER_PREFIX)) {
    return { header: firstLine.slice(NOTE_HEADER_PREFIX.length), body: nl === -1 ? "" : segment.slice(nl + 1) };
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
  const newBlock = `${NOTE_HEADER_PREFIX}${header}\n${note}`;

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
