import { describe, expect, it } from "vitest";
import {
  answeredCount,
  distribution,
  firstUnansweredIndex,
  positiveAnswer,
  readNoteBlock,
  sentimentDistribution,
  sumSentiments,
  upsertNoteBlock,
  type AnswersMap,
} from "@/lib/answers";

// Pure-unit coverage of the answer value domain (S-05). No catalogue / Dexie — these are
// total functions over a plain map, exercised on empty / partial / full / mixed inputs.

const IDS = ["q_a", "q_b", "q_c", "q_d"];

describe("answeredCount", () => {
  it("counts only ids that have an answer (empty / partial / full)", () => {
    expect(answeredCount(IDS, {})).toBe(0);
    expect(answeredCount(IDS, { q_a: "yes", q_c: "no" })).toBe(2);
    expect(answeredCount(IDS, { q_a: "yes", q_b: "no", q_c: "dont_know", q_d: "yes" })).toBe(4);
  });

  it("ignores answers for ids outside the visible set", () => {
    // An answer for a now-hidden question must not inflate the count of the visible deck.
    expect(answeredCount(IDS, { q_a: "yes", q_hidden: "no" })).toBe(1);
  });
});

describe("firstUnansweredIndex", () => {
  it("returns 0 when nothing is answered", () => {
    expect(firstUnansweredIndex(IDS, {})).toBe(0);
  });

  it("returns the first gap in deck order, not the first key in the map", () => {
    // q_a and q_c answered → first unanswered is q_b at index 1.
    expect(firstUnansweredIndex(IDS, { q_a: "yes", q_c: "no" })).toBe(1);
  });

  it("returns length (one past the last card) when every question is answered", () => {
    expect(firstUnansweredIndex(IDS, { q_a: "yes", q_b: "no", q_c: "dont_know", q_d: "yes" })).toBe(IDS.length);
  });

  it("returns 0 (= length) for an empty deck", () => {
    expect(firstUnansweredIndex([], {})).toBe(0);
  });
});

describe("distribution", () => {
  it("tallies yes / no / dont_know across the visible ids only", () => {
    const answers: AnswersMap = { q_a: "yes", q_b: "no", q_c: "dont_know", q_d: "yes", q_hidden: "no" };
    expect(distribution(IDS, answers)).toEqual({ yes: 2, no: 1, dontKnow: 1 });
  });

  it("is all-zero for an unanswered deck", () => {
    expect(distribution(IDS, {})).toEqual({ yes: 0, no: 0, dontKnow: 0 });
  });
});

describe("positiveAnswer (per-Part polarity)", () => {
  it("is No for the condition Parts (2–4) and Yes for the documents Part (5)", () => {
    expect(positiveAnswer("part2")).toBe("no");
    expect(positiveAnswer("part3")).toBe("no");
    expect(positiveAnswer("part4")).toBe("no");
    expect(positiveAnswer("part5")).toBe("yes");
  });
});

describe("sentimentDistribution", () => {
  it("classifies by the given polarity: positive = the good answer, dont_know = unknown", () => {
    // Condition Part (positive = "no"): No is good, Yes is bad, dont_know unknown.
    const answers: AnswersMap = { q_a: "no", q_b: "yes", q_c: "dont_know", q_d: "no" };
    expect(sentimentDistribution(IDS, answers, "no")).toEqual({ positive: 2, negative: 1, unknown: 1 });
    // Documents Part (positive = "yes"): the SAME answers flip good↔bad.
    expect(sentimentDistribution(IDS, answers, "yes")).toEqual({ positive: 1, negative: 2, unknown: 1 });
  });

  it("skips unanswered ids and excludes ids outside the visible set (orphans)", () => {
    // Only q_a is visible+answered; the orphan q_hidden must not count.
    expect(sentimentDistribution(IDS, { q_a: "no", q_hidden: "yes" }, "no")).toEqual({
      positive: 1,
      negative: 0,
      unknown: 0,
    });
  });

  it("is all-zero for an unanswered set", () => {
    expect(sentimentDistribution(IDS, {}, "no")).toEqual({ positive: 0, negative: 0, unknown: 0 });
  });
});

describe("sumSentiments", () => {
  it("adds per-Part tallies into the global sentiment", () => {
    expect(
      sumSentiments([
        { positive: 3, negative: 1, unknown: 2 },
        { positive: 0, negative: 4, unknown: 1 },
        { positive: 5, negative: 0, unknown: 0 },
      ]),
    ).toEqual({ positive: 8, negative: 5, unknown: 3 });
  });

  it("is all-zero for an empty list", () => {
    expect(sumSentiments([])).toEqual({ positive: 0, negative: 0, unknown: 0 });
  });
});

describe("upsertNoteBlock", () => {
  const H1 = "Car Body — Bonnet";
  const H2 = "Front suspension — cracked rubber parts";

  it("inserts a headed block (header line + blockquoted body) into an empty document", () => {
    expect(upsertNoteBlock("", H1, "rust spot")).toBe("Car Body — Bonnet\n> rust spot");
  });

  it("appends a new block after existing free text, separated by a blank line", () => {
    expect(upsertNoteBlock("seller seems honest", H1, "rust spot")).toBe(
      "seller seems honest\n\nCar Body — Bonnet\n> rust spot",
    );
  });

  it("replaces an existing block in place without duplicating its header", () => {
    const doc = upsertNoteBlock("", H1, "first");
    const updated = upsertNoteBlock(doc, H1, "second");
    expect(updated).toBe("Car Body — Bonnet\n> second");
    // exactly one header line for the question
    expect(updated.match(/Car Body — Bonnet/g)).toHaveLength(1);
  });

  it("preserves the order and content of other blocks when replacing one", () => {
    let doc = upsertNoteBlock("", H1, "a");
    doc = upsertNoteBlock(doc, H2, "b");
    const updated = upsertNoteBlock(doc, H1, "a2");
    expect(updated).toBe("Car Body — Bonnet\n> a2\n\nFront suspension — cracked rubber parts\n> b");
  });

  it("removes the block when the note is empty or whitespace-only", () => {
    let doc = upsertNoteBlock("", H1, "a");
    doc = upsertNoteBlock(doc, H2, "b");
    expect(upsertNoteBlock(doc, H1, "")).toBe("Front suspension — cracked rubber parts\n> b");
    expect(upsertNoteBlock(doc, H1, "   ")).toBe("Front suspension — cracked rubber parts\n> b");
  });

  it("is a no-op when removing a block that does not exist", () => {
    const doc = upsertNoteBlock("", H1, "a");
    expect(upsertNoteBlock(doc, H2, "")).toBe(doc);
  });

  it("is idempotent — re-upserting the same note yields the same document", () => {
    const once = upsertNoteBlock("free text", H1, "note body");
    expect(upsertNoteBlock(once, H1, "note body")).toBe(once);
  });
});

describe("readNoteBlock", () => {
  it("reads back the body a prior upsert wrote (round-trip)", () => {
    const doc = upsertNoteBlock("", "Car Body — Bonnet", "rust spot");
    expect(readNoteBlock(doc, "Car Body — Bonnet")).toBe("rust spot");
  });

  it("returns null for a header with no block", () => {
    expect(readNoteBlock("", "missing")).toBeNull();
    expect(readNoteBlock("just free text", "missing")).toBeNull();
  });

  it("round-trips a multi-line note (each line quoted, de-quoted on read)", () => {
    const doc = upsertNoteBlock("", "H", "line one\nline two");
    expect(doc).toBe("H\n> line one\n> line two");
    expect(readNoteBlock(doc, "H")).toBe("line one\nline two");
  });
});
