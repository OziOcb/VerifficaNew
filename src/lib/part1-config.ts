// Single source of truth for the Part 1 vehicle-configuration contract (S-03).
//
// Encodes `idea/veriffica-part-1-validation-rules.md` once as a Zod schema that
// validates, NORMALIZES, and yields the typed config — plus the unlock predicate
// that gates Parts 2-5. Shared by the form island (blur + Save validation) and
// usable server-side. The schema's INPUT is the raw form values (every field a
// string, "" when empty); its OUTPUT is the normalized, persisted payload
// (numbers parsed, enums lowercased, empty optionals → null) matching rules §8.
//
// Casing: OUTPUT keys are camelCase and line up 1:1 with the camelCase Dexie
// `Inspection` config fields, so a successful parse is ready to hand to
// `saveInspection` (lessons.md "Field casing" — the snake↔camel conversion stays
// at the sync boundary; this module is camelCase throughout).
import { z } from "zod";

// Field-level error copy — the EXACT strings from rules doc §9. Do not reword:
// they are user-facing and asserted verbatim in tests. Exported so the sync-boundary
// server guard returns the identical messages the client shows (single source of truth).
export const M = {
  price: "Enter a valid price greater than or equal to 0.",
  make: "Enter the car make.",
  model: "Enter the car model.",
  year: "Enter a valid production year.",
  registrationNumber: "Enter a valid registration number.",
  vin: "VIN must contain exactly 17 letters and digits without I, O or Q.",
  mileage: "Enter a valid mileage.",
  fuelType: "Select the fuel type.",
  transmission: "Select the transmission type.",
  drive: "Select the drive type.",
  color: "Enter a valid color.",
  bodyType: "Select the body type.",
  doorCount: "Enter a valid number of doors.",
  address: "Enter a valid address.",
  notes: "Notes cannot be longer than 1000 characters.",
  crossFieldElectricTransmission: "Electric cars must use Automatic transmission.",
  // The inspection-level global-notes document (FR-010) — distinct from Part 1 `notes`.
  // Lives here (not in the React island) so the server guard can import it without
  // pulling in Dexie. Verbatim from the SessionScreen island it replaces.
  globalNotes: "Global notes cannot be longer than 10,000 characters.",
} as const;

// Length caps shared by the client validators and the sync-boundary server guard,
// so neither limit is duplicated. `MAX_GLOBAL_NOTES_LENGTH` is the new home for the
// literal that used to live in SessionScreen.tsx.
export const MAX_PART1_NOTES_LENGTH = 1000;
export const MAX_GLOBAL_NOTES_LENGTH = 10_000;

/**
 * CF-1 predicate: Electric cars must use Automatic transmission. Returns true when the
 * pair is valid (or when either field is absent — an electric car with no transmission
 * set yet is not a violation). Consumed by the schema's object-level `.refine` and by
 * the sync-boundary server guard so both enforce the identical rule.
 */
export const isElectricTransmissionValid = (d: { fuelType?: string | null; transmission?: string | null }): boolean =>
  !(d.fuelType === "electric" && d.transmission !== "automatic");

// Enum keys are stored lowercase (rules §8); these mirror the DB CHECK constraints.
const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
const TRANSMISSIONS = ["manual", "automatic"] as const;
const DRIVES = ["2wd", "4wd"] as const;
const BODY_TYPES = ["sedan", "hatchback", "suv", "coupe", "convertible", "van", "pickup", "other"] as const;

// VIN: exactly 17 chars from a restricted alphabet that EXCLUDES I, O, Q.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
// Registration: letters, digits, spaces, hyphen; 2-15 chars (after uppercasing).
const REGISTRATION_RE = /^[A-Z0-9 -]{2,15}$/;
// Year upper bound is dynamic — the current year (no future years); lower bound 1886.
// IMPORTANT: the upper bound MUST be read lazily (per-validation), never cached at
// module load. On the Cloudflare Workers runtime, top-level module code runs outside
// a request context where the clock is frozen at the Unix epoch (Spectre mitigation),
// so a module-level `new Date().getFullYear()` evaluates to 1970 on the server and
// rejects every real year — silently re-locking Parts 2–5 (the `isConfigUnlocked`
// gate in session.astro). Computed inside the refine, it runs per request where the
// clock is live. Browser-side (the client:only form) was unaffected; this keeps both correct.
const MIN_YEAR = 1886;
const currentYear = (): number => new Date().getFullYear();

// Trim + collapse runs of whitespace to a single space (rules "collapse repeated spaces").
const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");

// --- Field builders -------------------------------------------------------
// Each builder produces a string→normalized pipeline carrying ONE message, so a
// failing field surfaces exactly the rules-doc copy regardless of which sub-rule
// tripped. We validate via `.refine` (not the deprecated `.superRefine`) and, for
// enums, cast after a membership `.refine` to sidestep `.pipe`'s input-type
// mismatch (a plain string is not assignable to a z.enum's literal-union input).

// Capitalize the first character, leave the rest untouched ("toyota" → "Toyota").
const capitalizeFirst = (s: string): string => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const requiredText = (message: string, opts: { min: number; max: number; capitalize?: boolean }) =>
  z
    .string()
    .transform((s) => {
      const v = collapse(s);
      return opts.capitalize ? capitalizeFirst(v) : v;
    })
    .refine((s) => s.length >= opts.min && s.length <= opts.max, { message });

const optionalText = (
  message: string,
  opts: {
    min: number;
    max: number;
    collapseSpaces?: boolean;
    uppercase?: boolean;
    capitalize?: boolean;
    regex?: RegExp;
  },
) =>
  z
    .string()
    .transform((s) => {
      let v = opts.collapseSpaces === false ? s.trim() : collapse(s);
      if (opts.uppercase) v = v.toUpperCase();
      if (opts.capitalize) v = capitalizeFirst(v);
      return v;
    })
    .refine(
      (s) => s === "" || ((opts.regex ? opts.regex.test(s) : true) && s.length >= opts.min && s.length <= opts.max),
      {
        message,
      },
    )
    .transform((s) => (s === "" ? null : s));

// `max` may be a function so date-derived bounds (the year) are read per-validation,
// not captured at schema-build time — see the Cloudflare frozen-clock note above.
const optionalInt = (message: string, opts: { min: number; max: number | (() => number); stripSpaces?: boolean }) =>
  z
    .string()
    .transform((s) => (opts.stripSpaces ? s.replace(/\s+/g, "") : s.trim()))
    .refine(
      (s) => {
        if (s === "") return true;
        const max = typeof opts.max === "function" ? opts.max() : opts.max;
        return /^\d+$/.test(s) && Number(s) >= opts.min && Number(s) <= max;
      },
      { message },
    )
    .transform((s) => (s === "" ? null : Number(s)));

const enumField = <const T extends readonly [string, ...string[]]>(values: T, message: string) => {
  const allowed = new Set<string>(values);
  return z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .refine((s) => allowed.has(s), { message })
    .transform((s) => s as T[number]);
};

// --- The schema -----------------------------------------------------------

export const part1ConfigSchema = z
  .object({
    // Optional decimal: comma→dot, max 2 fractional digits, 0…99,999,999.99
    // (upper bound matches the DB column `price numeric(10,2)` — keep them in sync).
    price: z
      .string()
      .transform((s) => s.trim().replace(",", "."))
      .refine((s) => s === "" || (/^\d+(\.\d{1,2})?$/.test(s) && Number(s) >= 0 && Number(s) <= 99_999_999.99), {
        message: M.price,
      })
      .transform((s) => (s === "" ? null : Number(s))),
    make: requiredText(M.make, { min: 1, max: 50, capitalize: true }),
    model: requiredText(M.model, { min: 1, max: 60, capitalize: true }),
    // Year + Registration are OPTIONAL (PRD FR-013 lists only six required fields;
    // FR-006 uses them for the tile title only, not the question logic). They still
    // validate strictly when present. This diverges from the rules-doc §4 table,
    // which marked them Required — the PRD is authoritative.
    year: optionalInt(M.year, { min: MIN_YEAR, max: currentYear }),
    registrationNumber: optionalText(M.registrationNumber, {
      min: 2,
      max: 15,
      uppercase: true,
      regex: REGISTRATION_RE,
    }),
    vin: optionalText(M.vin, { min: 17, max: 17, collapseSpaces: false, uppercase: true, regex: VIN_RE }),
    mileage: optionalInt(M.mileage, { min: 0, max: 9_999_999, stripSpaces: true }),
    fuelType: enumField(FUEL_TYPES, M.fuelType),
    transmission: enumField(TRANSMISSIONS, M.transmission),
    drive: enumField(DRIVES, M.drive),
    color: optionalText(M.color, { min: 1, max: 40, capitalize: true }),
    bodyType: enumField(BODY_TYPES, M.bodyType),
    doorCount: optionalInt(M.doorCount, { min: 0, max: 7 }),
    address: optionalText(M.address, { min: 5, max: 150, capitalize: true }),
    // Notes preserve internal line breaks; only leading/trailing whitespace is
    // trimmed, then the first letter is capitalized.
    notes: z
      .string()
      .transform((s) => capitalizeFirst(s.trim()))
      .refine((s) => s.length <= MAX_PART1_NOTES_LENGTH, { message: M.notes })
      .transform((s) => (s === "" ? null : s)),
  })
  // CF-1: Electric requires Automatic. Surfaced on the transmission field so the
  // first-invalid focus/scroll lands somewhere meaningful. Object-level refines
  // run only once all fields parse — which is exactly the case we must catch
  // (electric + manual are each individually valid), so this also drives unlock.
  .refine((d) => isElectricTransmissionValid(d), {
    message: M.crossFieldElectricTransmission,
    path: ["transmission"],
  });

// Raw form input (every field a string) and the normalized, persisted output.
export type Part1Input = z.input<typeof part1ConfigSchema>;
export type Part1Config = z.infer<typeof part1ConfigSchema>;
export type Part1Field = keyof Part1Config;

export type Part1ValidationResult =
  | { ok: true; config: Part1Config }
  | { ok: false; errors: Partial<Record<Part1Field, string>> };

// Per-field display normalizers applied on blur so the input reflects exactly what
// will be persisted, without a full-form parse. Each mirrors the STRING part of its
// schema transform (they keep the value a string — no empty→null/number coercion,
// since the field stays text in the form). Fields not listed are left untouched on
// blur (e.g. enums, numeric inputs, VIN — normalized on Save only).
const BLUR_NORMALIZERS: Partial<Record<Part1Field, (s: string) => string>> = {
  make: (s) => capitalizeFirst(collapse(s)),
  model: (s) => capitalizeFirst(collapse(s)),
  registrationNumber: (s) => collapse(s).toUpperCase(),
  color: (s) => capitalizeFirst(collapse(s)),
  address: (s) => capitalizeFirst(collapse(s)),
  notes: (s) => capitalizeFirst(s.trim()),
};

/**
 * Normalize a single field's display value on blur, mirroring its schema transform
 * (e.g. Make/Model → collapse + capitalize; Registration → collapse + uppercase;
 * Color/Address → collapse; Notes → trim). Returns the value unchanged for fields
 * without a blur normalizer.
 */
export function normalizeFieldOnBlur(field: Part1Field, value: string): string {
  const fn = BLUR_NORMALIZERS[field];
  return fn ? fn(value) : value;
}

/**
 * Validate + normalize raw form values. On success, `config` is the rules §8
 * payload ready for `saveInspection`. On failure, `errors` maps each invalid
 * field to its (first) message — UX-1 renders these inline.
 */
export function validatePart1(input: Part1Input): Part1ValidationResult {
  const result = part1ConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  const errors: Partial<Record<Part1Field, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in errors)) {
      errors[key as Part1Field] = issue.message;
    }
  }
  return { ok: false, errors };
}

/**
 * Whether Parts 2-5 should be unlocked: TRUE iff a Save would succeed — i.e. the
 * FULL schema parses, including the CF-1 cross-field rule. Deliberately not a
 * six-field presence check: electric + manual passes every field individually but
 * fails CF-1, so a presence-only predicate would wrongly unlock. Derived purely
 * from current values, so re-editing an invalid required field re-locks (CF-3).
 */
export function isConfigUnlocked(input: Part1Input): boolean {
  return part1ConfigSchema.safeParse(input).success;
}

/** A camelCased inspection row's config columns as loaded from the DB (mixed types, nullable). */
export type Part1Row = Partial<Record<Part1Field, string | number | null>>;

/**
 * Build raw form INPUT (every field a string, "" when empty) from a camelCased DB row,
 * mirroring the form's seed logic (null → "", numbers → their string form). Lets server
 * code (e.g. the session route's unlock gate) reuse `validatePart1`/`isConfigUnlocked`
 * against a persisted row without re-implementing the stringify.
 */
export function rowToInput(row: Part1Row): Part1Input {
  const s = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));
  return {
    price: s(row.price),
    make: s(row.make),
    model: s(row.model),
    year: s(row.year),
    registrationNumber: s(row.registrationNumber),
    vin: s(row.vin),
    mileage: s(row.mileage),
    fuelType: s(row.fuelType),
    transmission: s(row.transmission),
    drive: s(row.drive),
    color: s(row.color),
    bodyType: s(row.bodyType),
    doorCount: s(row.doorCount),
    address: s(row.address),
    notes: s(row.notes),
  };
}
