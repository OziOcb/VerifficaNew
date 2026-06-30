// Pure card-deck navigation logic for the Parts 2–5 answering flow (S-05, FR-015).
//
// SERVER-SAFE: no Dexie / React / catalogue import — every export is a total, pure
// function over plain values, so the interaction rules unit-test directly in Node
// (the suite has no DOM) while the `QuestionCards` island just wires these to state
// + the History API. Keeping the rules here is what makes the "cannot advance an
// unanswered card / Next gated on answered / Back decrements / resume honored"
// guarantees testable without a browser.
//
// Index model: a deck of `length` cards occupies indices `0 … length-1`; index
// `length` is the end-of-Part TRANSITION screen (one past the final card). An empty
// deck (`length === 0`) is therefore the transition screen at index 0.
import { firstUnansweredIndex, type AnswersMap } from "@/lib/answers";

/**
 * Where the deck opens. Normally the first unanswered card in deck order (delegating to
 * {@link firstUnansweredIndex}, so resume and the session-screen denominator share one
 * definition of "answered"). Two special cases:
 *
 * - A **fully-answered, non-empty** Part opens on **card 1** (index 0) for review/edit —
 *   NOT the end-of-Part transition screen. The transition screen is an end-of-deck state
 *   reached by advancing through the last card, never a resume target.
 * - An **empty** deck (no questions apply to this car) has no card 1, so it stays on the
 *   transition screen (index 0 === length).
 */
export function initialIndex(orderedIds: readonly string[], answers: AnswersMap): number {
  const idx = firstUnansweredIndex(orderedIds, answers);
  if (idx === orderedIds.length && orderedIds.length > 0) return 0;
  return idx;
}

/** Whether `index` is on the end-of-Part transition screen (one past the final card). */
export function isTransition(index: number, length: number): boolean {
  return index >= length;
}

/**
 * Whether the current card may advance — the single rule behind both the auto-advance
 * gate (mandatory answering: a fresh card has no forward affordance until answered) and
 * the Next control (enabled iff the current card already has an answer). False on the
 * transition screen and out-of-range indices.
 */
export function canAdvance(index: number, orderedIds: readonly string[], answers: AnswersMap): boolean {
  if (index < 0 || index >= orderedIds.length) return false;
  return answers[orderedIds[index]] !== undefined;
}

/** Move forward one card, capped at the transition screen (`index === length`). */
export function nextIndex(index: number, length: number): number {
  return Math.min(index + 1, length);
}

/**
 * The result of a Back request: either step to the previous card, or leave the deck.
 * Back from the first card (`index === 0`) exits to the session screen — every other
 * position decrements by one. (Back is always lossless because each answer is persisted
 * before the move, so this carries no answer data.)
 */
export type BackResult = { type: "card"; index: number } | { type: "exit" };

export function back(index: number): BackResult {
  return index <= 0 ? { type: "exit" } : { type: "card", index: index - 1 };
}
