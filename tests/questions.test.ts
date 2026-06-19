import { describe, expect, it } from "vitest";
import {
  activeFlagsFromInspection,
  FLAG_COLUMN_MAP,
  parseCatalogue,
  relevantFlags,
  relevantToggles,
  relevantTogglesByFuel,
  resolveExplanation,
  RUNTIME_FLAGS,
  selectVisibleGroups,
  selectVisibleQuestionIds,
  sessionCounts,
  visibleCountsByPart,
  type RuntimeFlag,
  type VisibilityConfig,
} from "@/lib/questions";
import { countsForFlags, totalCount } from "@/lib/session-counts";
import bankJson from "@/data/questions/question-bank.json";
import mappingJson from "@/data/questions/question-mapping-config.json";

// Pure-unit coverage of the FR-014 additive visibility engine. Reference counts below
// were computed against the markdown source-of-truth catalogue and lock the predicate
// behavior; they shift only if the authored catalogue changes (which would be a
// deliberate, reviewed edit).

const NO_FLAGS = new Set<RuntimeFlag>();
const flags = (...f: RuntimeFlag[]) => new Set<RuntimeFlag>(f);

const PETROL: VisibilityConfig = { fuelType: "petrol", transmission: "manual", drive: "2wd", bodyType: "sedan" };
const EV: VisibilityConfig = { fuelType: "electric", transmission: "automatic", drive: "2wd", bodyType: "sedan" };
const HYBRID: VisibilityConfig = { fuelType: "hybrid", transmission: "automatic", drive: "2wd", bodyType: "sedan" };

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

  it("returns groups sorted by order", () => {
    const orders = selectVisibleGroups(PETROL, NO_FLAGS).map((g) => g.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
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
    const evNoFlags = selectVisibleQuestionIds(EV, NO_FLAGS);
    const evWithTurbo = selectVisibleQuestionIds(EV, flags("turboEquipped", "mechanicalCompressorEquipped"));
    expect([...evWithTurbo].sort()).toEqual([...evNoFlags].sort());
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
});

describe("explanation resolver", () => {
  it("resolves a known ref and returns null for an unknown one", () => {
    expect(resolveExplanation("exp_001")).toBe("Damaged cylinder head, cylinder head gasket or engine block");
    expect(resolveExplanation("exp_does_not_exist")).toBeNull();
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

describe("Phase 4: each flag toggle changes the visible set by exactly its gated group", () => {
  // HYBRID makes all 5 flags relevant (asserted by relevantFlags above), so every
  // flag-gated group is config-visible — the clean fixture for the per-flag delta contract.
  const base = selectVisibleQuestionIds(HYBRID, NO_FLAGS);

  // The questions a flag should reveal, derived straight from the JSON: questions whose
  // group is gated by that flag (under HYBRID every such group passes its config axes).
  const expectedFor = (flag: RuntimeFlag) =>
    new Set(
      bankJson.questions
        .filter((q) => mappingJson.questionGroups.find((g) => g.id === q.groupId)?.requiresEquipmentFlag === flag)
        .map((q) => q.id),
    );

  it.each(RUNTIME_FLAGS)("toggling %s adds exactly that flag's gated questions, additively", (flag) => {
    const withFlag = selectVisibleQuestionIds(HYBRID, new Set<RuntimeFlag>([flag]));
    const added = new Set([...withFlag].filter((id) => !base.has(id)));
    const expected = expectedFor(flag);
    expect(expected.size).toBeGreaterThan(0); // every flag reveals at least one question
    expect(added).toEqual(expected); // exactly the gated group's questions, no more
    expect([...base].every((id) => withFlag.has(id))).toBe(true); // purely additive
    expect(withFlag.size).toBe(base.size + expected.size);
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
});
