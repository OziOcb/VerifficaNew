// Single source of runtime truth for the question catalogue + the FR-014 additive
// visibility engine (S-04).
//
// The catalogue (questions + the data-driven group→visibility mapping) is authored
// as JSON under `src/data/questions/`. This module parses both files through a Zod
// schema and FREEZES them on first import, so a malformed catalogue throws at module
// load (drift guard) rather than misbehaving silently at runtime.
//
// The visibility model is "additive buckets": every group carries a pure, data-driven
// `visibleWhen` predicate over the Part 1 config axes, AND an optional
// `requiresEquipmentFlag` gate. A group is visible iff every axis it names matches the
// config AND its flag (if any) is in the active set. "Additive" falls out of evaluating
// independent per-group predicates — there is nothing to persist, the visible set is a
// pure function of (catalogue, config, flags) and is recomputed on read (the identical
// path S-07 will re-run and diff).
//
// SERVER-SAFE: this module must NOT import `@/lib/db` (Dexie) — it is imported from the
// `.astro` session-route frontmatter, so the 80 KB bank is parsed once on the server and
// only the filtered set crosses to the client island. Keep it Dexie-free.
//
// Casing: the engine speaks camelCase throughout (lessons.md "Field casing"). The one
// place that bridges DB column names and catalogue flag names is `activeFlagsFromInspection`
// via an EXPLICIT column↔flag map — see FLAG_COLUMN_MAP below.
import { z } from "zod";
import type { Part1Config } from "@/lib/part1-config";
import type { PartCounts, PartQuestionIds, SessionCounts, SessionQuestionIds } from "@/lib/session-counts";
import bankJson from "@/data/questions/question-bank.json";
import mappingJson from "@/data/questions/question-mapping-config.json";

// --- Catalogue schema (the drift guard) -----------------------------------

const partIdSchema = z.enum(["part2", "part3", "part4", "part5"]);
const fuelTypeSchema = z.enum(["petrol", "diesel", "hybrid", "electric"]);
const transmissionSchema = z.enum(["manual", "automatic"]);
const driveSchema = z.enum(["2wd", "4wd"]);
const bodyTypeSchema = z.enum(["sedan", "hatchback", "suv", "coupe", "convertible", "van", "pickup", "other"]);
// The 5 runtime equipment flags, canonically spelled (note the all-caps `EU` in
// `importedFromEU` — see the casing gotcha on FLAG_COLUMN_MAP). This enum is the
// validation guard; the iterable list of flags comes from the parsed data (RUNTIME_FLAGS).
const runtimeFlagSchema = z.enum([
  "chargingPortEquipped",
  "evBatteryDocsAvailable",
  "turboEquipped",
  "mechanicalCompressorEquipped",
  "importedFromEU",
]);

const visibleWhenSchema = z.object({
  fuelType: z.array(fuelTypeSchema).min(1).optional(),
  transmission: z.array(transmissionSchema).min(1).optional(),
  drive: z.array(driveSchema).min(1).optional(),
  bodyType: z.array(bodyTypeSchema).min(1).optional(),
});

const questionGroupSchema = z.object({
  id: z.string().regex(/^g_.+$/),
  part: partIdSchema,
  order: z.number().int(),
  section: z.string().min(1),
  subsection: z.string().nullable(),
  dependsOnFields: z.array(z.enum(["fuelType", "transmission", "drive", "bodyType"])),
  visibleWhen: visibleWhenSchema,
  requiresEquipmentFlag: runtimeFlagSchema.optional(),
});

const visibilityModelSchema = z.object({
  type: z.literal("additive-buckets"),
  formula: z.array(z.enum(["base", "fuelType", "transmission", "drive", "bodyType"])).min(5),
  emptyBuckets: z.object({
    drive: z.array(driveSchema),
    bodyType: z.array(bodyTypeSchema),
  }),
  runtimeFlags: z.array(runtimeFlagSchema).min(1),
});

const mappingConfigSchema = z.object({
  version: z.literal(1),
  sourceFile: z.string().min(1),
  visibilityModel: visibilityModelSchema,
  questionGroups: z.array(questionGroupSchema),
});

const questionSchema = z.object({
  id: z.string().regex(/^q_.+$/),
  groupId: z.string().regex(/^g_.+$/),
  part: partIdSchema,
  section: z.string().min(1),
  subsection: z.string().nullable(),
  label: z.string().min(1),
  order: z.number().int(),
  explanationRef: z
    .string()
    .regex(/^exp_.+$/)
    .optional(),
});

const explanationEntrySchema = z.object({
  legacyNumber: z.number().int().min(1),
  text: z.string().min(1),
});

const questionBankSchema = z.object({
  version: z.literal(1),
  sourceFile: z.string().min(1),
  allowedAnswers: z.array(z.enum(["yes", "no", "dont_know"])).min(1),
  questions: z.array(questionSchema),
  explanations: z.record(z.string().regex(/^exp_.+$/), explanationEntrySchema),
});

// --- Public types ---------------------------------------------------------

export type PartId = z.infer<typeof partIdSchema>;
export type RuntimeFlag = z.infer<typeof runtimeFlagSchema>;
export type QuestionGroup = z.infer<typeof questionGroupSchema>;
export type Question = z.infer<typeof questionSchema>;

/**
 * The Part 1 config axes the visibility predicate reads. Nullable-tolerant: a missing
 * axis simply fails any predicate that names it (it never throws). Pick'd from the real
 * Part1Config so the four axis names + value enums auto-track the Part 1 contract.
 */
export type VisibilityConfig = Partial<Pick<Part1Config, "fuelType" | "transmission" | "drive" | "bodyType">>;

interface Catalogue {
  groups: readonly QuestionGroup[];
  questions: readonly Question[];
  // Partial so indexing by an arbitrary ref yields `| undefined` (an unknown ref is a
  // real possibility the resolver must guard) rather than a falsely non-null value.
  explanations: Readonly<Partial<Record<string, { legacyNumber: number; text: string }>>>;
  runtimeFlags: readonly RuntimeFlag[];
}

/**
 * Parse the raw catalogue JSON through the Zod schema. Exported so tests can feed a
 * deliberately malformed catalogue and assert this throws — the same call runs at module
 * load below on the real data, which is the drift guard.
 */
export function parseCatalogue(bankRaw: unknown, mappingRaw: unknown): Catalogue {
  const bank = questionBankSchema.parse(bankRaw);
  const mapping = mappingConfigSchema.parse(mappingRaw);
  return {
    groups: mapping.questionGroups,
    questions: bank.questions,
    explanations: bank.explanations,
    runtimeFlags: mapping.visibilityModel.runtimeFlags,
  };
}

// Recursively freeze so the frozen catalogue cannot be mutated by any consumer.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const CATALOGUE = deepFreeze(parseCatalogue(bankJson, mappingJson));

/** The 5 equipment-flag names, derived from the catalogue data (not redeclared). */
export const RUNTIME_FLAGS: readonly RuntimeFlag[] = CATALOGUE.runtimeFlags;

// --- The casing bridge ----------------------------------------------------
//
// Casing gotcha: the catalogue/schema/PRD canonically spell one flag `importedFromEU`
// (all-caps EU), but its DB column `imported_from_eu` camelCases to `importedFromEu` —
// they do NOT match. The other 4 flags round-trip only by luck of having no acronym. So
// the active-flag set is built through this EXPLICIT column→flag map, never by reading
// `row[flagName]`. This binding layer is the one place that knows the column-side spelling.
export const FLAG_COLUMN_MAP = {
  chargingPortEquipped: "chargingPortEquipped",
  evBatteryDocsAvailable: "evBatteryDocsAvailable",
  turboEquipped: "turboEquipped",
  mechanicalCompressorEquipped: "mechanicalCompressorEquipped",
  importedFromEu: "importedFromEU",
} as const satisfies Record<string, RuntimeFlag>;

/** The camelCased DB column names for the 5 equipment flags (the keys of FLAG_COLUMN_MAP). */
export type FlagColumn = keyof typeof FLAG_COLUMN_MAP;

/** The camelCased inspection columns this engine reads to build the active-flag set. */
export type InspectionFlagRow = Partial<Record<FlagColumn, boolean | null>>;

// Reverse of FLAG_COLUMN_MAP — catalogue flag → DB column. The session island works in
// column space (it reads/writes the inspection's flag columns), so this is the binding it
// needs to translate a relevant catalogue flag back to the column to persist.
const FLAG_TO_COLUMN = Object.fromEntries(
  Object.entries(FLAG_COLUMN_MAP).map(([column, flag]) => [flag, column]),
) as Record<RuntimeFlag, FlagColumn>;

// --- The visibility predicate (the one contract S-07 reuses) --------------

/**
 * A group is visible iff every axis it names matches `config`, AND its
 * `requiresEquipmentFlag` (if any) is in the active flag set.
 */
function isGroupVisible(
  group: QuestionGroup,
  config: VisibilityConfig,
  activeFlags: ReadonlySet<RuntimeFlag>,
): boolean {
  for (const [axis, allowed] of Object.entries(group.visibleWhen)) {
    const v = config[axis as keyof VisibilityConfig];
    if (!v || !(allowed as string[]).includes(v)) return false;
  }
  if (group.requiresEquipmentFlag && !activeFlags.has(group.requiresEquipmentFlag)) return false;
  return true;
}

/** The camelCased inspection columns the visibility predicate reads as its config axes. */
type InspectionConfigRow = Partial<Record<"fuelType" | "transmission" | "drive" | "bodyType", string | null>>;

/**
 * Build the engine's {@link VisibilityConfig} (the 4 axes) from a camelCased inspection
 * row. The CHECK constraints on the config columns guarantee any non-null value is a valid
 * enum member, so this is the one place that narrows the DB-side `string | null` to the
 * predicate's enum domain (`null` → `undefined`, i.e. an unset axis that fails its predicate).
 */
export function configFromInspection(row: InspectionConfigRow): VisibilityConfig {
  return {
    fuelType: (row.fuelType ?? undefined) as VisibilityConfig["fuelType"],
    transmission: (row.transmission ?? undefined) as VisibilityConfig["transmission"],
    drive: (row.drive ?? undefined) as VisibilityConfig["drive"],
    bodyType: (row.bodyType ?? undefined) as VisibilityConfig["bodyType"],
  };
}

/** Groups visible for `(config, flags)`, sorted by `order`. */
export function selectVisibleGroups(config: VisibilityConfig, flags: ReadonlySet<RuntimeFlag>): QuestionGroup[] {
  return CATALOGUE.groups.filter((g) => isGroupVisible(g, config, flags)).sort((a, b) => a.order - b.order);
}

/**
 * The visible questions' `q_…` IDs. **The single source of truth for visibility** that
 * S-07 will re-run and diff.
 */
export function selectVisibleQuestionIds(config: VisibilityConfig, flags: ReadonlySet<RuntimeFlag>): Set<string> {
  const visibleGroupIds = new Set(selectVisibleGroups(config, flags).map((g) => g.id));
  const ids = new Set<string>();
  for (const q of CATALOGUE.questions) if (visibleGroupIds.has(q.groupId)) ids.add(q.id);
  return ids;
}

/** Per-Part visible question counts for the session nav. */
export function visibleCountsByPart(config: VisibilityConfig, flags: ReadonlySet<RuntimeFlag>): Record<PartId, number> {
  const visibleGroupIds = new Set(selectVisibleGroups(config, flags).map((g) => g.id));
  const counts: Record<PartId, number> = { part2: 0, part3: 0, part4: 0, part5: 0 };
  for (const q of CATALOGUE.questions) if (visibleGroupIds.has(q.groupId)) counts[q.part]++;
  return counts;
}

/** Per-Part visible question IDs (the ID-list analogue of {@link visibleCountsByPart}). */
export function visibleQuestionIdsByPart(config: VisibilityConfig, flags: ReadonlySet<RuntimeFlag>): PartQuestionIds {
  const visibleGroupIds = new Set(selectVisibleGroups(config, flags).map((g) => g.id));
  const ids: PartQuestionIds = { part2: [], part3: [], part4: [], part5: [] };
  for (const q of CATALOGUE.questions) if (visibleGroupIds.has(q.groupId)) ids[q.part].push(q.id);
  return ids;
}

/** `explanationRef` → explanation text (for S-05; S-04 only wires it). */
export function resolveExplanation(ref: string): string | null {
  return CATALOGUE.explanations[ref]?.text ?? null;
}

// --- The card deck (S-05) -------------------------------------------------
//
// The route asks the engine for ONE Part's ordered, personalized cards and ships the
// result to the `client:only` island. The 80 KB catalogue and `resolveExplanation` stay
// server-side: the island receives only the filtered `QuestionCard[]` — never the bank.

/**
 * One question as the card island consumes it: the stable `id` (answer-map key), the
 * display fields, the resolved `explanation` text (`null` when the question has no
 * `explanationRef`), and the FR-018 note `header` that keys its contextual-note block.
 */
export interface QuestionCard {
  id: string;
  header: string;
  label: string;
  section: string;
  subsection: string | null;
  explanation: string | null;
}

/**
 * The FR-018 contextual-note header for a question: its `section`, `subsection` (when
 * present), and `label` joined with " — ", so the note block reads naturally in the
 * global notes document (e.g. "Front suspension — Suspension condition — cracked rubber
 * parts"). Exported for direct unit reconciliation against the catalogue.
 */
export function composeNoteHeader(section: string, subsection: string | null, label: string): string {
  return [section, subsection, label].filter((p): p is string => p != null && p !== "").join(" — ");
}

/**
 * The visible questions for ONE Part, ordered by group `order` then question `order` —
 * the exact sequence the buyer swipes through. Built from {@link selectVisibleGroups}, so
 * it shares the single visibility predicate S-07 will re-run and diff.
 */
export function selectVisibleQuestions(
  config: VisibilityConfig,
  flags: ReadonlySet<RuntimeFlag>,
  part: PartId,
): Question[] {
  const visibleGroups = selectVisibleGroups(config, flags).filter((g) => g.part === part);
  const groupOrder = new Map(visibleGroups.map((g) => [g.id, g.order]));
  return CATALOGUE.questions
    .filter((q) => groupOrder.has(q.groupId))
    .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.order - b.order);
}

/**
 * The ordered card payload for ONE Part: {@link selectVisibleQuestions} with each question
 * mapped to a {@link QuestionCard} (display fields + resolved explanation + note header).
 * This is the single call the Part route makes to hand the island its deck.
 */
export function selectCardDeck(
  config: VisibilityConfig,
  flags: ReadonlySet<RuntimeFlag>,
  part: PartId,
): QuestionCard[] {
  return selectVisibleQuestions(config, flags, part).map((q) => ({
    id: q.id,
    header: composeNoteHeader(q.section, q.subsection, q.label),
    label: q.label,
    section: q.section,
    subsection: q.subsection,
    explanation: q.explanationRef ? resolveExplanation(q.explanationRef) : null,
  }));
}

/**
 * Build the active-flag set the predicate consumes from a camelCased inspection row, via
 * the explicit {@link FLAG_COLUMN_MAP} (NOT incidental casing agreement). A column whose
 * value is exactly `true` activates its catalogue flag; `null`/`false`/missing do not.
 */
export function activeFlagsFromInspection(row: InspectionFlagRow): Set<RuntimeFlag> {
  const active = new Set<RuntimeFlag>();
  for (const [column, flag] of Object.entries(FLAG_COLUMN_MAP)) {
    if (row[column as keyof typeof FLAG_COLUMN_MAP] === true) active.add(flag);
  }
  return active;
}

/**
 * Which equipment flags the current `config` makes relevant (Phase 4 toggle filter).
 * A flag X is relevant iff some group with `requiresEquipmentFlag === X` becomes visible
 * when X is forced active (its `visibleWhen` axes still evaluated against `config`).
 * Reuses {@link isGroupVisible}, so the toggle UI carries no hand-coded fuel rules to drift.
 */
export function relevantFlags(config: VisibilityConfig): Set<RuntimeFlag> {
  const relevant = new Set<RuntimeFlag>();
  for (const flag of RUNTIME_FLAGS) {
    const forced = new Set<RuntimeFlag>([flag]);
    if (CATALOGUE.groups.some((g) => g.requiresEquipmentFlag === flag && isGroupVisible(g, config, forced))) {
      relevant.add(flag);
    }
  }
  return relevant;
}

/** An equipment toggle the session screen should render: the catalogue `flag` (for the
 *  visibility recompute) paired with its DB `column` (for reading/persisting state). */
export interface RelevantToggle {
  flag: RuntimeFlag;
  column: FlagColumn;
}

/**
 * The equipment toggles to render for `config`, derived from {@link relevantFlags} so the
 * toggle UI carries no hand-coded fuel rules to drift. Stable order (RUNTIME_FLAGS order).
 */
export function relevantToggles(config: VisibilityConfig): RelevantToggle[] {
  return [...relevantFlags(config)].map((flag) => ({ flag, column: FLAG_TO_COLUMN[flag] }));
}

/** The relevant equipment toggles keyed by `fuelType` value (plus `"none"` for an unset
 *  fuelType). Lets the Part 1 form pick the toggles its live fuelType selection makes
 *  relevant WITHOUT importing the catalogue. Catalogue-derived via {@link relevantToggles};
 *  valid because every flag-gated group depends only on `fuelType` — guarded by a unit
 *  test (`tests/questions.test.ts`). */
export type RelevantTogglesByFuel = Record<string, RelevantToggle[]>;

export function relevantTogglesByFuel(): RelevantTogglesByFuel {
  const map: RelevantTogglesByFuel = { none: relevantToggles({}) };
  for (const fuel of fuelTypeSchema.options) map[fuel] = relevantToggles({ fuelType: fuel });
  return map;
}

/**
 * The catalogue-derived count payload the session island consumes (Phase 4): the
 * flag-independent `base` per-Part counts plus, for each config-relevant flag, the per-Part
 * delta that flag reveals. The island recomputes live counts as `base + Σ(active deltas)`
 * WITHOUT the catalogue (see `@/lib/session-counts`); the additive model guarantees that
 * sum equals `visibleCountsByPart(config, activeFlags)`.
 */
export function sessionCounts(config: VisibilityConfig): SessionCounts {
  const base = visibleCountsByPart(config, new Set<RuntimeFlag>());
  const flagDeltas: Partial<Record<RuntimeFlag, PartCounts>> = {};
  for (const flag of relevantFlags(config)) {
    const withFlag = visibleCountsByPart(config, new Set<RuntimeFlag>([flag]));
    flagDeltas[flag] = {
      part2: withFlag.part2 - base.part2,
      part3: withFlag.part3 - base.part3,
      part4: withFlag.part4 - base.part4,
      part5: withFlag.part5 - base.part5,
    };
  }
  return { base, flagDeltas };
}

/**
 * The ID-list analogue of {@link sessionCounts}: the per-Part base visible question IDs plus,
 * for each config-relevant flag, the IDs that flag reveals (its delta over the base). The
 * session island unions the base with the active flags' deltas (`questionIdsForFlags`) to get
 * the live visible set, then counts how many are answered (FR-010). The additive model
 * guarantees `|base| + Σ|delta|` equals `visibleQuestionIdsByPart(config, activeFlags)`.
 */
export function sessionQuestionIds(config: VisibilityConfig): SessionQuestionIds {
  const base = visibleQuestionIdsByPart(config, new Set<RuntimeFlag>());
  const flagDeltas: Partial<Record<RuntimeFlag, PartQuestionIds>> = {};
  for (const flag of relevantFlags(config)) {
    const withFlag = visibleQuestionIdsByPart(config, new Set<RuntimeFlag>([flag]));
    // The flag's delta = its visible IDs not already in the base (additive model: withFlag ⊇ base).
    const notInBase = (part: PartId) => withFlag[part].filter((id) => !base[part].includes(id));
    flagDeltas[flag] = {
      part2: notInBase("part2"),
      part3: notInBase("part3"),
      part4: notInBase("part4"),
      part5: notInBase("part5"),
    };
  }
  return { base, flagDeltas };
}
