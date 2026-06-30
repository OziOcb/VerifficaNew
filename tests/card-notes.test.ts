import { describe, expect, it } from "vitest";
import { readNoteBlock, upsertNoteBlock } from "@/lib/answers";
import { selectCardDeck, type PartId, type RuntimeFlag, type VisibilityConfig } from "@/lib/questions";
import bankJson from "@/data/questions/question-bank.json";

// Phase-4 coverage of the card's education-popup and contextual-note CONTRACTS — the exact
// seams `QuestionCards.tsx` wires to. The pure note helpers (`upsertNoteBlock`/`readNoteBlock`)
// and explanation resolution are unit-tested in answers.test.ts / questions.test.ts; here we
// assert them against a REAL card deck (real `header` / `explanation` values) so the card's
// composition — not just the helpers in isolation — is pinned.

const PETROL: VisibilityConfig = { fuelType: "petrol", transmission: "manual", drive: "2wd", bodyType: "sedan" };
const PARTS: PartId[] = ["part2", "part3", "part4", "part5"];
const flags = (...f: RuntimeFlag[]) => new Set<RuntimeFlag>(f);

const deck = PARTS.flatMap((p) => selectCardDeck(PETROL, flags("turboEquipped", "importedFromEU"), p));

describe("FR-018 contextual note on the card (4.1: note save produces expected document)", () => {
  // The card composes its block header as `${partLabel}: ${card.header}` and saves
  // `upsertNoteBlock(globalNotes, header, draft)`, pre-filling from `readNoteBlock`. The block
  // is a header line + a `>`-quoted body. Drive that with a real card header + part label.
  const card = deck[0];
  const header = `Part 2 — Standstill: ${card.header}`;

  it("inserts a headed block (header line + blockquoted body) keyed by the card's note header", () => {
    const doc = upsertNoteBlock("", header, "rust on the bonnet");
    expect(doc).toBe(`Part 2 — Standstill: ${card.header}\n> rust on the bonnet`);
    expect(readNoteBlock(doc, header)).toBe("rust on the bonnet");
  });

  it("re-noting the same question replaces its block in place (no duplicate header)", () => {
    const first = upsertNoteBlock("", header, "first take");
    const second = upsertNoteBlock(first, header, "second take");
    // Exactly one block for this question — the header appears once, body is the latest.
    expect(second.split(header).length - 1).toBe(1);
    expect(readNoteBlock(second, header)).toBe("second take");
  });

  it("clearing the note removes the block, preserving other content", () => {
    const otherHeader = `Part 2 — Standstill: ${deck[1].header}`;
    let doc = upsertNoteBlock("", header, "note A");
    doc = upsertNoteBlock(doc, otherHeader, "note B");
    const cleared = upsertNoteBlock(doc, header, "");
    expect(readNoteBlock(cleared, header)).toBeNull();
    expect(readNoteBlock(cleared, otherHeader)).toBe("note B");
  });
});

describe("FR-017 education icon presence maps to explanation presence (4.2)", () => {
  // The card renders the `i` icon iff `card.explanation !== null`. Assert that predicate
  // tracks the underlying question's `explanationRef` for every card in a real deck.
  const refById = new Map(bankJson.questions.map((q) => [q.id, q.explanationRef ?? null]));

  it("the icon-render predicate is true exactly when the question has an explanation ref", () => {
    expect(deck.length).toBeGreaterThan(0);
    for (const card of deck) {
      const hasRef = refById.get(card.id) != null;
      // `card.explanation !== null` is the exact condition QuestionCards uses to show the icon.
      expect(card.explanation !== null).toBe(hasRef);
    }
  });

  it("the deck has both kinds of card (a meaningful icon-presence test)", () => {
    expect(deck.some((c) => c.explanation !== null)).toBe(true);
    expect(deck.some((c) => c.explanation === null)).toBe(true);
  });
});
