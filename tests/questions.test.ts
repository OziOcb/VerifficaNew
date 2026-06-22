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
