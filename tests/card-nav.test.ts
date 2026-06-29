import { describe, expect, it } from "vitest";
import { back, canAdvance, initialIndex, isTransition, nextIndex } from "@/lib/card-nav";
import type { AnswersMap } from "@/lib/answers";

// Pure-unit coverage of the card-deck navigation rules (S-05, FR-015) — the logic the
// `QuestionCards` island wires to state + the History API. No DOM: the rules are total
// functions, so the answering guarantees (mandatory answering, lossless back, resume)
// are asserted here directly.

const DECK = ["q_a", "q_b", "q_c"];

describe("initialIndex (resume)", () => {
  it("opens at the first unanswered card", () => {
    expect(initialIndex(DECK, {})).toBe(0);
    expect(initialIndex(DECK, { q_a: "yes" })).toBe(1);
    expect(initialIndex(DECK, { q_a: "yes", q_b: "no" })).toBe(2);
  });

  it("opens on card 1 (not the transition screen) when every card is answered", () => {
    // A fully-answered Part is a review/edit target, not a dead-end transition screen.
    expect(initialIndex(DECK, { q_a: "yes", q_b: "no", q_c: "dont_know" })).toBe(0);
  });

  it("an empty deck (no questions apply) opens on the transition screen", () => {
    expect(initialIndex([], {})).toBe(0); // === length, so isTransition is true
  });

  it("resumes at the first gap, not the last answered card", () => {
    // q_a + q_c answered, q_b is the gap → resume at index 1.
    expect(initialIndex(DECK, { q_a: "yes", q_c: "no" })).toBe(1);
  });
});

describe("canAdvance (mandatory answering / Next gate)", () => {
  it("is false for an unanswered current card", () => {
    expect(canAdvance(0, DECK, {})).toBe(false);
  });

  it("is true once the current card has an answer", () => {
    expect(canAdvance(0, DECK, { q_a: "yes" })).toBe(true);
    expect(canAdvance(1, DECK, { q_b: "dont_know" })).toBe(true);
  });

  it("answering a different card does not unlock the current one", () => {
    expect(canAdvance(1, DECK, { q_a: "yes" })).toBe(false);
  });

  it("is false on the transition screen and out-of-range indices", () => {
    expect(canAdvance(DECK.length, DECK, { q_a: "yes", q_b: "no", q_c: "yes" })).toBe(false);
    expect(canAdvance(-1, DECK, { q_a: "yes" })).toBe(false);
    expect(canAdvance(99, DECK, { q_a: "yes" })).toBe(false);
  });
});

describe("nextIndex (forward / auto-advance)", () => {
  it("advances one card", () => {
    expect(nextIndex(0, DECK.length)).toBe(1);
    expect(nextIndex(1, DECK.length)).toBe(2);
  });

  it("advancing off the last card lands on the transition screen and stays there", () => {
    expect(nextIndex(2, DECK.length)).toBe(3); // === length → transition
    expect(nextIndex(3, DECK.length)).toBe(3); // capped, never past
  });
});

describe("back", () => {
  it("decrements one card", () => {
    expect(back(2)).toEqual({ type: "card", index: 1 });
    expect(back(1)).toEqual({ type: "card", index: 0 });
  });

  it("exits to the session screen from the first card", () => {
    expect(back(0)).toEqual({ type: "exit" });
  });

  it("steps the transition screen back onto the final card", () => {
    expect(back(DECK.length)).toEqual({ type: "card", index: DECK.length - 1 });
  });
});

describe("isTransition", () => {
  it("is the index one past the final card", () => {
    expect(isTransition(2, DECK.length)).toBe(false);
    expect(isTransition(3, DECK.length)).toBe(true);
  });

  it("an empty deck is the transition screen at index 0", () => {
    expect(isTransition(0, 0)).toBe(true);
  });
});

// Composition check: starting at the resume index, the landing card is unanswered (can't
// advance) until an answer is recorded — the resume + mandatory-answer rules together.
describe("resume + mandatory answering", () => {
  it("lands on a card the user must answer before advancing", () => {
    const answers: AnswersMap = { q_a: "yes" };
    const start = initialIndex(DECK, answers);
    expect(start).toBe(1);
    expect(canAdvance(start, DECK, answers)).toBe(false);
    const after = { ...answers, [DECK[start]]: "no" } as AnswersMap;
    expect(canAdvance(start, DECK, after)).toBe(true);
    expect(nextIndex(start, DECK.length)).toBe(2);
  });
});
