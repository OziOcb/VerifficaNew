import { describe, expect, it } from "vitest";
import {
  activeFlagsFromInspection,
  composeNoteHeader,
  FLAG_COLUMN_MAP,
  parseCatalogue,
  relevantFlags,
  relevantToggles,
  relevantTogglesByFuel,
  resolveExplanation,
  RUNTIME_FLAGS,
  selectCardDeck,
  selectVisibleGroups,
  selectVisibleQuestionIds,
  selectVisibleQuestions,
  sessionCounts,
  sessionQuestionIds,
  visibleCountsByPart,
  visibleQuestionIdsByPart,
  type PartId,
  type RuntimeFlag,
  type VisibilityConfig,
} from "@/lib/questions";
import { countsForFlags, questionIdsForFlags, totalCount } from "@/lib/session-counts";
import {
  answerSentiment,
  positiveAnswer,
  sentimentDistribution,
  sumSentiments,
  type Answer,
  type AnswersMap,
  type Sentiment,
} from "@/lib/answers";
import bankJson from "@/data/questions/question-bank.json";
import mappingJson from "@/data/questions/question-mapping-config.json";
// The authored originals the runtime copies under `src/data/questions/` are hand-copied
// from — imported here (relative, outside the `@/` → src alias) so the drift guard fails
// loudly if the two ever diverge.
import ideaBankJson from "../idea/veriffica-questions-list/question-bank.json";
import ideaMappingJson from "../idea/veriffica-questions-list/question-mapping-config.json";

// Pure-unit coverage of the FR-014 additive visibility engine. Two independent oracles
// guard the predicate, belt-and-suspenders:
//   1. The CATALOGUE-DERIVED oracle (`expectedGroupIds`/`expectedQuestionIds` below)
//      recomputes the expected visible set straight from `mappingJson`/`bankJson` — the
//      independently-authored catalogue — NEVER from the engine's own output. It drives
//      the full 128 axis-config matrix and so catches a wrong/missing/extra group from a
//      traversal bug. This is the primary oracle the whole suite hangs on.
//   2. The hand-written magic-number literals (the "frozen catalogue & stable counts"
//      block) are a deliberate INDEPENDENT MANUAL COUNT against the markdown source — a
//      human canary that catches a wrong manual count the derived oracle would miss
//      because both it and the engine read the same JSON. They shift only on a
//      deliberate, reviewed catalogue edit.

const NO_FLAGS = new Set<RuntimeFlag>();
const flags = (...f: RuntimeFlag[]) => new Set<RuntimeFlag>(f);

const PETROL: VisibilityConfig = { fuelType: "petrol", transmission: "manual", drive: "2wd", bodyType: "sedan" };
const EV: VisibilityConfig = { fuelType: "electric", transmission: "automatic", drive: "2wd", bodyType: "sedan" };
const HYBRID: VisibilityConfig = { fuelType: "hybrid", transmission: "automatic", drive: "2wd", bodyType: "sedan" };

// --- The catalogue-derived oracle (the independent source of truth) --------
//
// `expectedGroupIds`/`expectedQuestionIds` reproduce the engine's predicate by reading the
// authored catalogue (`mappingJson` groups, `bankJson` questions) directly — they must
// NEVER call `selectVisibleGroups`/`selectVisibleQuestionIds`. Asserting the engine against
// its own output is the banned anti-pattern; this oracle is authored from the same data the
// HUMAN authored, so a divergence means the engine traverses the catalogue wrongly.

// Axis value domains, mirroring the engine enums (`src/lib/questions.ts:33-36`). Listed here
// (not lifted at runtime — the schemas aren't exported) so the 128-product is explicit; the
// `relevantTogglesByFuel` / formula cross-checks guard against these drifting from the data.
const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
const TRANSMISSIONS = ["manual", "automatic"] as const;
const DRIVES = ["2wd", "4wd"] as const;
const BODY_TYPES = ["sedan", "hatchback", "suv", "coupe", "convertible", "van", "pickup", "other"] as const;

// `visibleWhen` as the oracle reads it: a partial map of axis → allowed values.
type VisibleWhen = Partial<Record<keyof VisibilityConfig, string[]>>;

/** Expected visible group ids for `(config, flags)`, ordered by `group.order`, computed
 *  purely from `mappingJson` — the independent oracle. */
function expectedGroupIds(config: VisibilityConfig, activeFlags: ReadonlySet<RuntimeFlag>): string[] {
  return mappingJson.questionGroups
    .filter((g) => {
      const visibleWhen = g.visibleWhen as VisibleWhen;
      const axisMatch = (Object.keys(visibleWhen) as (keyof VisibilityConfig)[]).every((axis) => {
        const v = config[axis];
        return v != null && (visibleWhen[axis]?.includes(v) ?? false);
      });
      const flagMatch = !g.requiresEquipmentFlag || activeFlags.has(g.requiresEquipmentFlag as RuntimeFlag);
      return axisMatch && flagMatch;
    })
    .sort((a, b) => a.order - b.order)
    .map((g) => g.id);
}

/** Expected visible question ids for `(config, flags)`, mapping the oracle's group set
 *  through `bankJson.questions` by `groupId`. */
function expectedQuestionIds(config: VisibilityConfig, activeFlags: ReadonlySet<RuntimeFlag>): Set<string> {
  const groupIds = new Set(expectedGroupIds(config, activeFlags));
  return new Set(bankJson.questions.filter((q) => groupIds.has(q.groupId)).map((q) => q.id));
}

// The full 4×2×2×8 = 128 axis-config product, the matrix the engine is reconciled against.
const ALL_AXIS_CONFIGS: VisibilityConfig[] = FUEL_TYPES.flatMap((fuelType) =>
  TRANSMISSIONS.flatMap((transmission) =>
    DRIVES.flatMap((drive) => BODY_TYPES.map((bodyType) => ({ fuelType, transmission, drive, bodyType }))),
  ),
);

describe("base groups (visibleWhen {})", () => {
  it("are the only groups visible for an empty config with no flags", () => {
    const groups = selectVisibleGroups({}, NO_FLAGS);
    // Every visible group must have an empty `visibleWhen` and no equipment-flag gate.
    expect(groups.every((g) => Object.keys(g.visibleWhen).length === 0 && !g.requiresEquipmentFlag)).toBe(true);
    expect(groups).toHaveLength(20);
  });

  it("stay visible regardless of the config axes", () => {
    const empty = selectVisibleGroups({}, NO_FLAGS).map((g) => g.id);
    const baseInPetrol = selectVisibleGroups(PETROL, NO_FLAGS)
      .map((g) => g.id)
      .filter((id) => empty.includes(id));
    expect(baseInPetrol).toEqual(empty);
  });

  it("returns the petrol/manual/2wd/sedan groups in the exact authored order", () => {
    // A hard-coded ordered-id oracle (NOT the engine's own output sorted against itself).
    // This is the real guard for Risk #2 (a missing / extra / reordered group in the session
    // nav): it pins both the membership and the sequence the buyer sees. The previous
    // assertion `expect(orders).toEqual([...orders].sort())` was tautological — it passes for
    // any already-ascending array, so it never proved the engine sorts.
    //
    // NOTE on the engine's `.sort((a, b) => a.order - b.order)`: mutation testing flags the
    // three sort mutants (drop `.sort`, no-op comparator, `a.order + b.order`) as SURVIVED.
    // They are genuinely EQUIVALENT under the current data — the catalogue is authored in
    // unique, strictly-ascending `order` (enforced by the invariant test below), so sorting an
    // already-sorted input is a no-op. Killing them would require feeding the engine an
    // unsorted catalogue, i.e. making the catalogue injectable — a production refactor not
    // worth it for an equivalent mutant. The `.sort()` stays as defence for the day the
    // catalogue is authored out of order; that day is what the invariant test guards against.
    const ids = selectVisibleGroups(PETROL, NO_FLAGS).map((g) => g.id);
    expect(ids).toEqual([
      "g_p2_base_car_body_corrosion",
      "g_p2_base_car_body_repair_traces",
      "g_p2_base_engine_structure_bumpers_fenders",
      "g_p2_base_engine_structure_side_members",
      "g_p2_base_engine_structure_welds",
      "g_p2_base_front_suspension_condition",
      "g_p2_base_tires_condition",
      "g_p2_base_interior_high_mileage_wear",
      "g_p2_base_interior_upholstery_condition",
      "g_p2_base_interior_electrics",
      "g_p2_base_interior_steering_system",
      "g_p2_fuel_combustion_coolant_condition",
      "g_p2_fuel_combustion_oil_condition",
      "g_p2_fuel_combustion_belts_pulleys",
      "g_p2_fuel_combustion_exhaust_condition",
      "g_p2_fuel_petrol_hybrid_spark_plugs",
      "g_p3_base_interior_steering_system",
      "g_p3_fuel_combustion_engine_start_up",
      "g_p3_fuel_combustion_engine_condition",
      "g_p3_fuel_combustion_exhaust_system",
      "g_p3_fuel_petrol_hybrid_black_exhaust",
      "g_p4_base_suspension_responses",
      "g_p4_base_steering_responses",
      "g_p4_base_other_phenomena",
      "g_p4_base_braking_responses",
      "g_p4_transmission_manual_gearbox_clutch_condition",
      "g_p5_base_vin_number_compliance",
      "g_p5_base_service_booklet",
      "g_p5_base_registration_certificate",
      "g_p5_base_vehicle_card",
    ]);
  });

  it("authored group order is unique and strictly ascending within every part", () => {
    // The precondition that makes the engine's `.sort()` a no-op AND keeps the session nav
    // deterministic. If a future catalogue edit introduces a duplicate or out-of-order
    // `order`, the nav sequence becomes unstable — this fails loudly at the authoring step,
    // before the (equivalent today) sort ever matters.
    const byPart = new Map<string, number[]>();
    for (const g of mappingJson.questionGroups) {
      const list = byPart.get(g.part) ?? [];
      list.push(g.order);
      byPart.set(g.part, list);
    }
    for (const [, orders] of byPart) {
      const strictlyAscending = orders.slice(1).every((o, i) => o > orders[i]);
      expect(strictlyAscending).toBe(true);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});

describe("axis matching includes/excludes the right groups", () => {
  it("a petrol-only spark-plugs group shows for petrol, not for diesel", () => {
    const petrolGroups = new Set(selectVisibleGroups(PETROL, NO_FLAGS).map((g) => g.id));
    const dieselGroups = new Set(selectVisibleGroups({ ...PETROL, fuelType: "diesel" }, NO_FLAGS).map((g) => g.id));
    expect(petrolGroups.has("g_p2_fuel_petrol_hybrid_spark_plugs")).toBe(true);
    expect(dieselGroups.has("g_p2_fuel_petrol_hybrid_spark_plugs")).toBe(false);
    // ...and a diesel-only group is the mirror image.
    expect(dieselGroups.has("g_p2_fuel_diesel_fuel_system")).toBe(true);
    expect(petrolGroups.has("g_p2_fuel_diesel_fuel_system")).toBe(false);
  });

  it("a missing axis fails its predicate without throwing", () => {
    // No fuelType at all → no fuel-gated group is visible (only base groups remain).
    const groups = selectVisibleGroups({ transmission: "manual" }, NO_FLAGS);
    expect(groups.every((g) => !("fuelType" in g.visibleWhen))).toBe(true);
  });
});

describe("empty buckets add nothing", () => {
  it("2wd and sedan contribute no extra groups", () => {
    // 2wd is an empty drive bucket; sedan an empty body bucket. Switching them to other
    // empty-bucket values must not change the visible set.
    const a = selectVisibleQuestionIds(PETROL, NO_FLAGS);
    const b = selectVisibleQuestionIds({ ...PETROL, bodyType: "hatchback" }, NO_FLAGS);
    expect([...a].sort()).toEqual([...b].sort());
  });
});

describe("full axis-config matrix reconciles against the catalogue oracle", () => {
  // All 128 axis configs (4 fuel × 2 transmission × 2 drive × 8 body), no flags. Each row
  // asserts the engine's emitted group set AND ORDER equals the independent oracle, and the
  // question-id projection matches too. This subsumes the empty-bucket no-op and petrol↔diesel
  // mirror cases above, and is the first place `4wd` and the non-empty body types
  // (`suv`/`van`/`pickup`/`convertible`) are asserted visible.
  const cases = ALL_AXIS_CONFIGS.map(
    (c) => [`${c.fuelType ?? ""}/${c.transmission ?? ""}/${c.drive ?? ""}/${c.bodyType ?? ""}`, c] as const,
  );

  it.each(cases)("%s: engine group set + order equals the oracle", (_name, config) => {
    expect(selectVisibleGroups(config, NO_FLAGS).map((g) => g.id)).toEqual(expectedGroupIds(config, NO_FLAGS));
  });

  it.each(cases)("%s: engine visible question ids equal the oracle", (_name, config) => {
    expect(selectVisibleQuestionIds(config, NO_FLAGS)).toEqual(expectedQuestionIds(config, NO_FLAGS));
  });
});

describe("equipment-flag gating", () => {
  it("hides a requiresEquipmentFlag group until its flag is active", () => {
    const without = selectVisibleQuestionIds(PETROL, NO_FLAGS);
    const withTurbo = selectVisibleQuestionIds(PETROL, flags("turboEquipped"));
    expect(without.has("q_p4_fuel_combustion_turbocharger_increased_oil_consumption_and_emissions")).toBe(false);
    // Toggling turbo adds EXACTLY the turbo group's questions (the S-07 delta contract).
    const added = [...withTurbo].filter((id) => !without.has(id));
    expect(added).toHaveLength(3);
    expect(withTurbo.size - without.size).toBe(3);
  });

  it("EV cross-case: electric never reveals turbo/compressor even if the flag is set", () => {
    // The fuel axis already excludes electric, so the flag can't bring the group back.
    const flagged = flags("turboEquipped", "mechanicalCompressorEquipped");
    const evNoFlags = selectVisibleQuestionIds(EV, NO_FLAGS);
    const evWithTurbo = selectVisibleQuestionIds(EV, flagged);
    expect(evWithTurbo).toEqual(evNoFlags);
    // ...and the oracle agrees an axis-excluded group cannot be resurrected by a flag.
    expect(expectedQuestionIds(EV, flagged)).toEqual(expectedQuestionIds(EV, NO_FLAGS));
    expect(evWithTurbo).toEqual(expectedQuestionIds(EV, flagged));
  });
});

describe("frozen catalogue & stable counts", () => {
  it("petrol vs EV totals differ in the expected direction", () => {
    const petrol = visibleCountsByPart(PETROL, NO_FLAGS);
    const ev = visibleCountsByPart(EV, NO_FLAGS);
    expect(petrol).toEqual({ part2: 86, part3: 14, part4: 18, part5: 10 });
    expect(ev).toEqual({ part2: 72, part3: 8, part4: 21, part5: 10 });
    const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
    expect(total(petrol)).toBe(128);
    expect(total(ev)).toBe(111);
    expect(total(petrol)).toBeGreaterThan(total(ev));
  });

  it("the imported-from-EU flag adds 8 questions for any config (no fuel axis)", () => {
    const without = selectVisibleQuestionIds(PETROL, NO_FLAGS);
    const withEu = selectVisibleQuestionIds(PETROL, flags("importedFromEU"));
    expect(withEu.size - without.size).toBe(8);
  });

  it("hands out a deeply frozen catalogue (no consumer can mutate it)", () => {
    // `deepFreeze` (src/lib/questions.ts) recursively freezes the parsed catalogue at module
    // load so no consumer can mutate the shared singleton. Nothing asserted this before, so
    // the entire freeze body could be deleted with the suite still green. Reach a group object
    // and its nested `visibleWhen` through the public engine output and prove both are frozen.
    const group = selectVisibleGroups(PETROL, NO_FLAGS)[0];
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.visibleWhen)).toBe(true);
  });
});

describe("importedFromEU groups gate purely on the flag, config-independent", () => {
  // The two importedFromEU groups carry `visibleWhen: {}`, so they must appear under ANY
  // axis config when the flag is active and vanish when it is not — independent of fuel/
  // transmission/drive/body. Proven on two structurally different configs.
  const A: VisibilityConfig = { fuelType: "petrol", transmission: "automatic", drive: "4wd", bodyType: "suv" };
  const B: VisibilityConfig = EV; // electric 2wd sedan — different on every axis

  const oracleEuDelta = (config: VisibilityConfig) => {
    const without = new Set(expectedGroupIds(config, NO_FLAGS));
    return expectedGroupIds(config, flags("importedFromEU"))
      .filter((id) => !without.has(id))
      .sort();
  };
  const engineEuDelta = (config: VisibilityConfig) => {
    const without = new Set(selectVisibleGroups(config, NO_FLAGS).map((g) => g.id));
    return selectVisibleGroups(config, flags("importedFromEU"))
      .map((g) => g.id)
      .filter((id) => !without.has(id))
      .sort();
  };

  it("the same two empty-visibleWhen groups appear under any config, and the engine agrees", () => {
    const deltaA = oracleEuDelta(A);
    const deltaB = oracleEuDelta(B);
    // identical added group set across structurally different configs → config-independent
    expect(deltaA).toEqual(deltaB);
    expect(deltaA).toHaveLength(2);
    // the engine matches the oracle delta for each config
    expect(engineEuDelta(A)).toEqual(deltaA);
    expect(engineEuDelta(B)).toEqual(deltaA);
    // the two added groups really have empty visibleWhen (so they gate purely on the flag)
    const emptyVisibleWhenIds = mappingJson.questionGroups
      .filter((g) => Object.keys(g.visibleWhen).length === 0 && g.requiresEquipmentFlag === "importedFromEU")
      .map((g) => g.id)
      .sort();
    expect(deltaA).toEqual(emptyVisibleWhenIds);
  });

  it("reconciles the +8 imported-question literal against the oracle", () => {
    // The literal (human canary) and the oracle agree, on a config with no shared fuel axis.
    const without = expectedQuestionIds(B, NO_FLAGS);
    const withEu = expectedQuestionIds(B, flags("importedFromEU"));
    expect(withEu.size - without.size).toBe(8);
    expect(selectVisibleQuestionIds(B, flags("importedFromEU"))).toEqual(withEu);
  });
});

describe("explanation resolver", () => {
  it("resolves a known ref and returns null for an unknown one", () => {
    expect(resolveExplanation("exp_001")).toBe("Damaged cylinder head, cylinder head gasket or engine block");
    expect(resolveExplanation("exp_does_not_exist")).toBeNull();
  });
});

describe("selectVisibleQuestions + selectCardDeck (S-05 card deck)", () => {
  const PARTS: PartId[] = ["part2", "part3", "part4", "part5"];

  /** Oracle: ordered visible question ids for ONE part, computed straight from the authored
   *  catalogue (group.order then question.order) — never from the engine's own output. */
  function expectedOrderedIds(config: VisibilityConfig, activeFlags: ReadonlySet<RuntimeFlag>, part: PartId): string[] {
    const groupOrder = new Map(
      mappingJson.questionGroups
        .filter((g) => g.part === part && expectedGroupIds(config, activeFlags).includes(g.id))
        .map((g) => [g.id, g.order]),
    );
    return bankJson.questions
      .filter((q) => groupOrder.has(q.groupId))
      .slice()
      .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.order - b.order)
      .map((q) => q.id);
  }

  it.each(PARTS)("%s: deck order equals the catalogue oracle (group order then question order)", (part) => {
    const ids = selectVisibleQuestions(PETROL, NO_FLAGS, part).map((q) => q.id);
    expect(ids).toEqual(expectedOrderedIds(PETROL, NO_FLAGS, part));
  });

  it("partitions the visible question ids across the four parts with no overlap or loss", () => {
    // The union of the four per-part decks must equal the whole visible set, disjointly.
    const all = selectVisibleQuestionIds(PETROL, NO_FLAGS);
    const perPart = PARTS.flatMap((p) => selectVisibleQuestions(PETROL, NO_FLAGS, p).map((q) => q.id));
    expect(new Set(perPart)).toEqual(all);
    expect(perPart).toHaveLength(all.size); // disjoint → no id appears twice
  });

  it("a flag-gated question only enters its part's deck when the flag is active", () => {
    const turboId = "q_p4_fuel_combustion_turbocharger_increased_oil_consumption_and_emissions";
    const without = selectVisibleQuestions(PETROL, NO_FLAGS, "part4").map((q) => q.id);
    const withTurbo = selectVisibleQuestions(PETROL, flags("turboEquipped"), "part4").map((q) => q.id);
    expect(without).not.toContain(turboId);
    expect(withTurbo).toContain(turboId);
  });

  it("resolves explanation text for questions that have a ref, and null otherwise", () => {
    const deck = PARTS.flatMap((p) => selectCardDeck(PETROL, flags("turboEquipped", "importedFromEU"), p));
    const bankById = new Map(bankJson.questions.map((q) => [q.id, q]));
    for (const card of deck) {
      const ref = bankById.get(card.id)?.explanationRef;
      if (ref) {
        expect(card.explanation).toBe(bankJson.explanations[ref as keyof typeof bankJson.explanations].text);
      } else {
        expect(card.explanation).toBeNull();
      }
    }
    // sanity: the deck actually exercises both branches
    expect(deck.some((c) => c.explanation !== null)).toBe(true);
    expect(deck.some((c) => c.explanation === null)).toBe(true);
  });

  it("carries the display fields straight from the catalogue question", () => {
    const card = selectCardDeck(PETROL, NO_FLAGS, "part2")[0];
    const q = bankJson.questions.find((q) => q.id === card.id);
    expect(card).toMatchObject({ id: q?.id, label: q?.label, section: q?.section, subsection: q?.subsection });
  });
});

describe("composeNoteHeader (FR-018 note header)", () => {
  it("joins section, subsection, and label with an em dash", () => {
    expect(composeNoteHeader("Front suspension", "Suspension condition", "cracked rubber parts")).toBe(
      "Front suspension — Suspension condition — cracked rubber parts",
    );
  });

  it("omits a null subsection", () => {
    expect(composeNoteHeader("Car Body", null, "Bonnet")).toBe("Car Body — Bonnet");
  });

  it("every catalogue question yields a non-empty, uniquely-keyed header", () => {
    // The header keys a note block, so collisions would let two questions' notes overwrite
    // each other. Reconcile against the authored bank: distinct headers for distinct questions.
    const headers = bankJson.questions.map((q) => composeNoteHeader(q.section, q.subsection, q.label));
    expect(headers.every((h) => h.length > 0)).toBe(true);
    expect(new Set(headers).size).toBe(bankJson.questions.length);
  });
});

describe("flag-binding symmetry (the importedFromEU↔importedFromEu guard)", () => {
  it("every runtime flag has a backing column entry and vice-versa", () => {
    const mapped = new Set(Object.values(FLAG_COLUMN_MAP));
    expect(mapped).toEqual(new Set(RUNTIME_FLAGS));
  });

  it("an inspection row with importedFromEu: true activates the importedFromEU flag", () => {
    const active = activeFlagsFromInspection({ importedFromEu: true });
    expect(active.has("importedFromEU")).toBe(true);
    // null / false / missing do not activate.
    expect(activeFlagsFromInspection({ importedFromEu: false }).has("importedFromEU")).toBe(false);
    expect(activeFlagsFromInspection({ importedFromEu: null }).has("importedFromEU")).toBe(false);
    expect(activeFlagsFromInspection({}).has("importedFromEU")).toBe(false);
  });

  it("maps every other column to its like-named flag", () => {
    const active = activeFlagsFromInspection({
      chargingPortEquipped: true,
      evBatteryDocsAvailable: true,
      turboEquipped: true,
      mechanicalCompressorEquipped: true,
    });
    expect(active).toEqual(
      new Set<RuntimeFlag>([
        "chargingPortEquipped",
        "evBatteryDocsAvailable",
        "turboEquipped",
        "mechanicalCompressorEquipped",
      ]),
    );
  });
});

describe("relevantFlags (catalogue-derived toggle filter)", () => {
  it("petrol exposes turbo / compressor / imported, never EV flags", () => {
    expect(relevantFlags(PETROL)).toEqual(flags("turboEquipped", "mechanicalCompressorEquipped", "importedFromEU"));
  });

  it("EV exposes charging-port / EV-docs / imported, never turbo/compressor", () => {
    expect(relevantFlags(EV)).toEqual(flags("chargingPortEquipped", "evBatteryDocsAvailable", "importedFromEU"));
  });

  it("hybrid exposes all five", () => {
    expect(relevantFlags(HYBRID)).toEqual(new Set(RUNTIME_FLAGS));
  });
});

describe("relevantTogglesByFuel (Part 1's catalogue-free relevance map)", () => {
  it("every flag-gated group depends only on fuelType — the map's load-bearing assumption", () => {
    // If a future catalogue edit gates a flag on drive/bodyType/etc., the fuelType-keyed
    // map in Part 1 would silently go wrong; this fails loudly instead.
    for (const g of mappingJson.questionGroups) {
      if (!g.requiresEquipmentFlag) continue;
      expect(Object.keys(g.visibleWhen).every((axis) => axis === "fuelType")).toBe(true);
    }
  });

  it("keys each fuelType plus `none`, each entry matching relevantToggles for that config", () => {
    const map = relevantTogglesByFuel();
    expect(Object.keys(map).sort()).toEqual(["diesel", "electric", "hybrid", "none", "petrol"]);
    expect(map.none).toEqual(relevantToggles({}));
    expect(map.petrol).toEqual(relevantToggles({ fuelType: "petrol" }));
    expect(map.electric).toEqual(relevantToggles({ fuelType: "electric" }));
    // An unset fuelType still surfaces the always-relevant imported-from-EU toggle.
    expect(map.none.map((t) => t.column)).toEqual(["importedFromEu"]);
  });
});

describe("flag layering reconciles against the catalogue oracle across diverse configs", () => {
  // Span the matrix, not just the 2wd/sedan fixtures: a 4wd + non-empty-body config per fuel
  // family, plus the original PETROL/EV/HYBRID. For each, every RELEVANT flag must layer
  // purely additively and the resulting set must equal the independent oracle — so a wrong
  // catalogue is caught, not merely a flag-traversal bug.
  const DIVERSE_CONFIGS: { name: string; config: VisibilityConfig }[] = [
    { name: "petrol 2wd sedan", config: PETROL },
    { name: "EV 2wd sedan", config: EV },
    { name: "hybrid 2wd sedan", config: HYBRID },
    {
      name: "petrol 4wd suv",
      config: { fuelType: "petrol", transmission: "automatic", drive: "4wd", bodyType: "suv" },
    },
    {
      name: "diesel 4wd pickup",
      config: { fuelType: "diesel", transmission: "manual", drive: "4wd", bodyType: "pickup" },
    },
    {
      name: "hybrid 4wd van",
      config: { fuelType: "hybrid", transmission: "automatic", drive: "4wd", bodyType: "van" },
    },
    {
      name: "electric 4wd suv",
      config: { fuelType: "electric", transmission: "automatic", drive: "4wd", bodyType: "suv" },
    },
  ];

  it.each(DIVERSE_CONFIGS)("$name: each relevant flag layers additively and matches the oracle", ({ config }) => {
    const base = selectVisibleQuestionIds(config, NO_FLAGS);
    for (const flag of relevantFlags(config)) {
      const withFlag = selectVisibleQuestionIds(config, flags(flag));
      const oracle = expectedQuestionIds(config, flags(flag));

      // Headline: the engine equals the independently-authored catalogue oracle.
      expect(withFlag).toEqual(oracle);

      // The questions the flag added, per engine and per oracle, must be the same non-empty set.
      const addedByEngine = new Set([...withFlag].filter((id) => !base.has(id)));
      const addedByOracle = new Set([...oracle].filter((id) => !base.has(id)));
      expect(addedByOracle.size).toBeGreaterThan(0); // a relevant flag reveals at least one question
      expect(addedByEngine).toEqual(addedByOracle);

      // Purely additive: base ⊆ withFlag, and the size grows by exactly the oracle delta.
      expect([...base].every((id) => withFlag.has(id))).toBe(true);
      expect(withFlag.size).toBe(base.size + addedByOracle.size);
    }
  });
});

describe("Phase 4: sessionCounts ⇄ countsForFlags equals the engine for any flag subset", () => {
  it.each([
    ["petrol", PETROL],
    ["EV", EV],
    ["hybrid", HYBRID],
  ])("recomputes %s counts client-side identically to visibleCountsByPart", (_name, cfg) => {
    const payload = sessionCounts(cfg);
    const rel = [...relevantFlags(cfg)];
    // empty set, each singleton, and the full relevant set
    const subsets: RuntimeFlag[][] = [[], rel, ...rel.map((f) => [f])];
    for (const sub of subsets) {
      const active = new Set(sub);
      const live = countsForFlags(payload, active);
      expect(live).toEqual(visibleCountsByPart(cfg, active));
      // the denominator the session screen shows tracks the same recompute
      const expectedTotal = Object.values(visibleCountsByPart(cfg, active)).reduce((a, b) => a + b, 0);
      expect(totalCount(live)).toBe(expectedTotal);
    }
  });

  it("an irrelevant flag has no delta entry, so it can never move the counts", () => {
    // EV: turbo/compressor are irrelevant (fuel axis excludes them) → not in the payload.
    const payload = sessionCounts(EV);
    expect(payload.flagDeltas.turboEquipped).toBeUndefined();
    expect(payload.flagDeltas.mechanicalCompressorEquipped).toBeUndefined();
    expect(relevantToggles(EV).map((t) => t.column)).toEqual([
      "chargingPortEquipped",
      "evBatteryDocsAvailable",
      "importedFromEu",
    ]);
  });
});

describe("sessionQuestionIds ⇄ questionIdsForFlags equals the engine for any flag subset", () => {
  const PARTS: PartId[] = ["part2", "part3", "part4", "part5"];

  it.each([
    ["petrol", PETROL],
    ["EV", EV],
    ["hybrid", HYBRID],
  ])("recomputes %s visible IDs client-side identically to visibleQuestionIdsByPart", (_name, cfg) => {
    const payload = sessionQuestionIds(cfg);
    const rel = [...relevantFlags(cfg)];
    const subsets: RuntimeFlag[][] = [[], rel, ...rel.map((f) => [f])];
    for (const sub of subsets) {
      const active = new Set(sub);
      const live = questionIdsForFlags(payload, active);
      const expected = visibleQuestionIdsByPart(cfg, active);
      // Compare as sets per Part — order is not part of the contract for the answered tally.
      for (const part of PARTS) {
        expect([...live[part]].sort()).toEqual([...expected[part]].sort());
      }
      // And the ID-count tracks the count payload exactly (numerator/denominator consistency).
      const liveCounts = countsForFlags(sessionCounts(cfg), active);
      for (const part of PARTS) expect(live[part].length).toBe(liveCounts[part]);
    }
  });
});

describe("S-06 sentiment glue: per-Part polarity + summed global (Total Score)", () => {
  const PARTS: PartId[] = ["part2", "part3", "part4", "part5"];

  it("positiveAnswer is No for the condition Parts (2–4) and Yes for the documents Part (5)", () => {
    expect(positiveAnswer("part2")).toBe("no");
    expect(positiveAnswer("part3")).toBe("no");
    expect(positiveAnswer("part4")).toBe("no");
    expect(positiveAnswer("part5")).toBe("yes");
  });

  it("the SAME raw No reads positive in a condition Part but negative in the documents Part", () => {
    // The load-bearing polarity behavior: identical answers, opposite sentiment by Part.
    const ids = ["q_x"];
    expect(sentimentDistribution(ids, { q_x: "no" }, positiveAnswer("part2"))).toEqual({
      positive: 1,
      negative: 0,
      unknown: 0,
    });
    expect(sentimentDistribution(ids, { q_x: "no" }, positiveAnswer("part5"))).toEqual({
      positive: 0,
      negative: 1,
      unknown: 0,
    });
  });

  // The session-hub Total Score (and the Summary's global chart) sum, across Parts 2–5,
  // `sentimentDistribution(liveIds[part], answers, positiveAnswer(part))`. This pins that glue
  // over the real engine output: correct per-Part polarity, correct summation, orphan exclusion.
  it.each([
    ["petrol", PETROL],
    ["EV", EV],
    ["hybrid", HYBRID],
  ])("classifies %s answers by per-Part polarity, sums to the global, excludes orphans", (_name, cfg) => {
    const liveIds = questionIdsForFlags(sessionQuestionIds(cfg), relevantFlags(cfg));
    const cycle: Answer[] = ["yes", "no", "dont_know"];
    const answers: AnswersMap = { q_orphan_not_visible: "yes" };

    // Independent oracle: answer two-thirds of each Part and tally the expected sentiment with the
    // Part's own polarity (Part 5 → yes positive, else no positive) — never via the code under test.
    const zero = (): Sentiment => ({ positive: 0, negative: 0, unknown: 0 });
    const expectedPerPart: Record<PartId, Sentiment> = { part2: zero(), part3: zero(), part4: zero(), part5: zero() };
    for (const part of PARTS) {
      const ids = liveIds[part];
      const pos: Answer = part === "part5" ? "yes" : "no";
      const n = Math.floor((ids.length * 2) / 3);
      for (let i = 0; i < n; i++) {
        const a = cycle[i % 3];
        answers[ids[i]] = a;
        if (a === "dont_know") expectedPerPart[part].unknown++;
        else if (a === pos) expectedPerPart[part].positive++;
        else expectedPerPart[part].negative++;
      }
    }

    // Per-Part sentiment matches the oracle (polarity applied), and the denominator is real.
    for (const part of PARTS) {
      expect(sentimentDistribution(liveIds[part], answers, positiveAnswer(part))).toEqual(expectedPerPart[part]);
    }
    const denom = totalCount(countsForFlags(sessionCounts(cfg), relevantFlags(cfg)));
    expect(PARTS.reduce((s, p) => s + liveIds[p].length, 0)).toBe(denom);

    // Global (Total Score) = the sum across Parts; the orphan "yes" never inflates positive.
    const global = sumSentiments(PARTS.map((p) => sentimentDistribution(liveIds[p], answers, positiveAnswer(p))));
    expect(global).toEqual(sumSentiments(PARTS.map((p) => expectedPerPart[p])));
    const answered = PARTS.reduce((s, p) => s + Math.floor((liveIds[p].length * 2) / 3), 0);
    expect(global.positive + global.negative + global.unknown).toBe(answered);
  });
});

describe("S-06 Summary glue: per-Part decks + modal answer coloring", () => {
  const PARTS: PartId[] = ["part2", "part3", "part4", "part5"];

  // The Summary route ships each Part's `selectCardDeck(...)` metadata to the island; the modal
  // groups it by section and the charts sum the per-Part sentiment over those same ids. This pins
  // that the deck the modal iterates and the ID set the chart tallies are the SAME set — so a
  // colored row and the chart can never disagree — over the real engine output, with per-Part
  // polarity and orphan exclusion. Independent oracle: tally straight off the deck, not via
  // `questionIdsForFlags`.
  it.each([
    ["petrol", PETROL],
    ["EV", EV],
    ["hybrid", HYBRID],
  ])("charts sum the same per-Part decks the modal shows, with polarity + orphan exclusion (%s)", (_name, cfg) => {
    const flagSet = relevantFlags(cfg);
    const deckIds: Record<PartId, string[]> = {
      part2: selectCardDeck(cfg, flagSet, "part2").map((c) => c.id),
      part3: selectCardDeck(cfg, flagSet, "part3").map((c) => c.id),
      part4: selectCardDeck(cfg, flagSet, "part4").map((c) => c.id),
      part5: selectCardDeck(cfg, flagSet, "part5").map((c) => c.id),
    };

    // The deck the modal iterates and the ID payload the charts tally are the SAME SET (the
    // tally is order-independent; the deck is group/question-ordered, the payload is
    // base+flag-delta-ordered — so compare as sets, not sequences).
    const liveIds = questionIdsForFlags(sessionQuestionIds(cfg), flagSet);
    for (const part of PARTS) expect([...deckIds[part]].sort()).toEqual([...liveIds[part]].sort());

    const cycle: Answer[] = ["yes", "no", "dont_know"];
    const answers: AnswersMap = { q_orphan_not_visible: "yes" };
    const zero = (): Sentiment => ({ positive: 0, negative: 0, unknown: 0 });
    const expected: Record<PartId, Sentiment> = { part2: zero(), part3: zero(), part4: zero(), part5: zero() };
    for (const part of PARTS) {
      const pos: Answer = part === "part5" ? "yes" : "no";
      const half = Math.floor(deckIds[part].length / 2);
      for (let i = 0; i < half; i++) {
        const a = cycle[i % 3];
        answers[deckIds[part][i]] = a;
        if (a === "dont_know") expected[part].unknown++;
        else if (a === pos) expected[part].positive++;
        else expected[part].negative++;
      }
    }

    for (const part of PARTS) {
      expect(sentimentDistribution(deckIds[part], answers, positiveAnswer(part))).toEqual(expected[part]);
    }
    const global = sumSentiments(PARTS.map((p) => sentimentDistribution(deckIds[p], answers, positiveAnswer(p))));
    expect(global).toEqual(sumSentiments(PARTS.map((p) => expected[p]))); // orphan "yes" excluded
  });

  it("answerSentiment colors the literal answer by the Part's polarity", () => {
    // The load-bearing modal-coloring rule: the SAME raw No reads positive (emerald) in a
    // condition Part and negative (red) in the documents Part — else a clean car looks alarming.
    expect(answerSentiment("no", positiveAnswer("part2"))).toBe("positive");
    expect(answerSentiment("no", positiveAnswer("part5"))).toBe("negative");
    expect(answerSentiment("yes", positiveAnswer("part2"))).toBe("negative");
    expect(answerSentiment("yes", positiveAnswer("part5"))).toBe("positive");
    expect(answerSentiment("dont_know", positiveAnswer("part2"))).toBe("unknown");
    // Unanswered is distinct from Don't-know (muted vs. blue).
    expect(answerSentiment(undefined, positiveAnswer("part2"))).toBe("unanswered");
  });

  it("a Part with zero visible questions yields an all-zero sentiment (empty modal + chart)", () => {
    const s = sentimentDistribution([], {}, positiveAnswer("part2"));
    expect(s).toEqual({ positive: 0, negative: 0, unknown: 0 });
  });
});

describe("drift guard: runtime catalogue equals the authored idea/ originals", () => {
  // The runtime copies under src/data/questions/ are hand-copied from idea/. Zod-parse-at-load
  // guards their SHAPE; this guards COPY FIDELITY — a hand-edit drift fails loudly here.
  it("question-mapping-config.json matches idea/veriffica-questions-list", () => {
    expect(mappingJson).toEqual(ideaMappingJson);
  });

  it("question-bank.json matches idea/veriffica-questions-list", () => {
    expect(bankJson).toEqual(ideaBankJson);
  });
});

describe("descriptive metadata matches the real group coverage", () => {
  it("declared-empty buckets are truly empty (no group's visibleWhen names them)", () => {
    const { emptyBuckets } = mappingJson.visibilityModel;
    for (const [axis, values] of Object.entries(emptyBuckets)) {
      for (const value of values) {
        const offenders = mappingJson.questionGroups
          .filter((g) => (g.visibleWhen as VisibleWhen)[axis as keyof VisibilityConfig]?.includes(value) ?? false)
          .map((g) => g.id);
        expect(offenders).toEqual([]); // declared empty → really empty
      }
    }
  });

  it("every visibleWhen value falls within the test's declared axis domains", () => {
    // The 128-matrix drives the hand-listed FUEL_TYPES/…/BODY_TYPES domains. If a future
    // catalogue edit introduces an axis value outside them, the matrix would silently never
    // exercise it — so assert here that the test domains still cover every value the
    // catalogue actually uses. Closes the one drift corner the matrix can't see itself.
    const domains: Record<keyof VisibilityConfig, readonly string[]> = {
      fuelType: FUEL_TYPES,
      transmission: TRANSMISSIONS,
      drive: DRIVES,
      bodyType: BODY_TYPES,
    };
    for (const g of mappingJson.questionGroups) {
      const vw = g.visibleWhen as VisibleWhen;
      for (const axis of Object.keys(vw) as (keyof VisibilityConfig)[]) {
        for (const value of vw[axis] ?? []) expect(domains[axis]).toContain(value);
      }
    }
  });

  it("formula covers exactly the axes any group references, plus base", () => {
    const referenced = new Set<string>();
    for (const g of mappingJson.questionGroups) for (const axis of Object.keys(g.visibleWhen)) referenced.add(axis);
    // `base` stands for the empty-visibleWhen groups; the remaining formula entries must be
    // exactly the axes some group actually references — no stale or missing axis.
    const formulaAxes = mappingJson.visibilityModel.formula.filter((f) => f !== "base");
    expect(new Set(formulaAxes)).toEqual(referenced);
    expect(mappingJson.visibilityModel.formula).toEqual(["base", "fuelType", "transmission", "drive", "bodyType"]);
  });
});

describe("trust boundary: garbage config degrades to base groups, never throws", () => {
  it("an out-of-enum fuelType yields exactly the base groups (the DB-CHECK trust boundary)", () => {
    // The engine does NOT runtime-validate config enums — it trusts the DB CHECK constraint
    // on the inspection columns. An impossible value simply fails every axis predicate, so
    // only the base (empty-visibleWhen, unflagged) groups survive. It must never throw.
    const baseIds = mappingJson.questionGroups
      .filter((g) => Object.keys(g.visibleWhen).length === 0 && !g.requiresEquipmentFlag)
      .map((g) => g.id)
      .sort();
    const run = () => selectVisibleGroups({ fuelType: "lpg" } as unknown as VisibilityConfig, NO_FLAGS);
    expect(run).not.toThrow();
    expect(
      run()
        .map((g) => g.id)
        .sort(),
    ).toEqual(baseIds);
  });
});

describe("drift guard: a malformed catalogue throws at parse", () => {
  it("rejects an invalid fuelType enum value in a group's visibleWhen", () => {
    const broken = structuredClone(mappingJson);
    // Inject an out-of-enum fuel value into the first fuel-gated group.
    const group = broken.questionGroups.find((g) => "fuelType" in g.visibleWhen);
    (group as { visibleWhen: { fuelType: string[] } }).visibleWhen.fuelType = ["gasoline"];
    expect(() => parseCatalogue(bankJson, broken)).toThrow();
  });

  it("rejects a question with a malformed id", () => {
    const broken = structuredClone(bankJson);
    broken.questions[0].id = "not_a_question_id";
    expect(() => parseCatalogue(broken, mappingJson)).toThrow();
  });

  it("accepts the real catalogue (the module-load drift guard passes)", () => {
    expect(() => parseCatalogue(bankJson, mappingJson)).not.toThrow();
  });

  it("returns the assembled catalogue shape, not an empty/partial object", () => {
    // Without this, `parseCatalogue`'s whole body (the assembly that wires the two parsed
    // files into one catalogue) can be replaced by `{}` and the suite stays green — the
    // existing tests only assert it throws / does not throw, never what it returns.
    const catalogue = parseCatalogue(bankJson, mappingJson);
    expect(catalogue.groups).toEqual(mappingJson.questionGroups);
    expect(catalogue.questions).toEqual(bankJson.questions);
    expect(catalogue.explanations).toEqual(bankJson.explanations);
    expect(catalogue.runtimeFlags).toEqual(mappingJson.visibilityModel.runtimeFlags);
  });
});
