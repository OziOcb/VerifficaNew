// The Part 1 vehicle-configuration form island (S-03). Composes the Zod contract
// (@/lib/part1-config), the local-first persistence path (@/lib/sync), and the
// shadcn primitives into a controlled form for all 15 config fields.
//
// MUST be mounted `client:only="react"` — it imports @/lib/sync → @/lib/db
// (Dexie), which has no global on the workerd SSR runtime; a server mount throws
// (see src/lib/db.ts). The SSR page (`[id].astro`) loads the inspection under RLS,
// camelizes the row at that boundary, and passes it in as the `inspection` prop.
//
// Validation timing mirrors the rules doc §2: soft on input (no blocking), inline
// on blur (UX-1), full blocking validation on Save (UX-2/UX-3 scroll+focus). The
// Parts 2-5 unlock is derived purely from `isConfigUnlocked(values)` — the full
// schema parse incl. CF-1 — so it tracks the current values, never a "saved" flag
// (CF-3: re-editing an invalid required field re-locks).
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerError } from "@/components/auth/ServerError";
import { validatePart1, isConfigUnlocked, normalizeFieldOnBlur, type Part1Field } from "@/lib/part1-config";
import { saveInspection, flushQueue, startAutoSync } from "@/lib/sync";

// Cosmic glass palette — matches the dashboard/home shell. The shadcn primitives
// are light-themed by default; these className overrides recolor them for the dark
// shell (tailwind-merge lets the later utilities win).
const PANEL = "border-white/10 bg-white/5 text-white backdrop-blur-xl";
const FIELD_INPUT = "border-white/20 bg-white/10 text-white placeholder:text-white/40";
const PRIMARY_BTN = "bg-purple-600 text-white hover:bg-purple-500";

// Field order drives the first-invalid scroll/focus scan (UX-2/UX-3) and render
// order. Matches the rules doc §4 table.
const FIELD_ORDER: Part1Field[] = [
  "price",
  "make",
  "model",
  "year",
  "registrationNumber",
  "vin",
  "mileage",
  "fuelType",
  "transmission",
  "drive",
  "color",
  "bodyType",
  "doorCount",
  "address",
  "notes",
];

// The six PRD-required fields (FR-013). Drives the "*" affordance only; the actual
// gate is the full-schema parse in `isConfigUnlocked`. Year + Registration are
// optional (FR-006 — tile title only), so they are NOT here.
const REQUIRED: ReadonlySet<Part1Field> = new Set<Part1Field>([
  "make",
  "model",
  "fuelType",
  "transmission",
  "drive",
  "bodyType",
]);

const LABELS: Record<Part1Field, string> = {
  price: "Price",
  make: "Make",
  model: "Model",
  year: "Year of production",
  registrationNumber: "Registration number",
  vin: "VIN number",
  mileage: "Mileage",
  fuelType: "Fuel type",
  transmission: "Transmission",
  drive: "Drive",
  color: "Color",
  bodyType: "Body type",
  doorCount: "No of doors",
  address: "Address",
  notes: "Notes",
};

// Year: dropdown from the current year down to 1886 (mirrors the schema bounds).
const YEAR_MAX = new Date().getFullYear();
const YEAR_OPTIONS: [string, string][] = Array.from({ length: YEAR_MAX - 1886 + 1 }, (_, i) => {
  const y = String(YEAR_MAX - i);
  return [y, y];
});

// No. of doors: dropdown 0–7 (mirrors the schema bounds).
const DOOR_OPTIONS: [string, string][] = Array.from({ length: 8 }, (_, i) => [String(i), String(i)]);

// Fields rendered as a <Select>. Enum keys are the lowercase stored values (mirror
// the DB CHECK keys); year/doorCount store their numeric string as-is.
const ENUM_OPTIONS: Partial<Record<Part1Field, [string, string][]>> = {
  year: YEAR_OPTIONS,
  fuelType: [
    ["petrol", "Petrol"],
    ["diesel", "Diesel"],
    ["hybrid", "Hybrid"],
    ["electric", "Electric"],
  ],
  transmission: [
    ["manual", "Manual"],
    ["automatic", "Automatic"],
  ],
  drive: [
    ["2wd", "2WD"],
    ["4wd", "4WD"],
  ],
  bodyType: [
    ["sedan", "Sedan"],
    ["hatchback", "Hatchback"],
    ["suv", "SUV"],
    ["coupe", "Coupe"],
    ["convertible", "Convertible"],
    ["van", "Van"],
    ["pickup", "Pickup"],
    ["other", "Other"],
  ],
  doorCount: DOOR_OPTIONS,
};

// The loaded inspection the SSR page passes in: id + lifecycle fields we must
// preserve on save (`status`, `createdAt`) + the 15 config columns, already
// camelCased at the `[id].astro` read boundary.
export interface Part1FormInspection {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  price: number | null;
  make: string | null;
  model: string | null;
  year: number | null;
  registrationNumber: string | null;
  vin: string | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  drive: string | null;
  color: string | null;
  bodyType: string | null;
  doorCount: number | null;
  address: string | null;
  notes: string | null;
}

interface Props {
  inspection: Part1FormInspection;
}

// Form values are all strings (the schema INPUT is raw form text). Seed each field
// from the loaded config: null → "", numbers → their string form.
function toFormValue(v: string | number | null): string {
  return v === null ? "" : String(v);
}

// Drop one key without a dynamic `delete` (lint: no-dynamic-delete).
function omitError(
  errors: Partial<Record<Part1Field, string>>,
  field: Part1Field,
): Partial<Record<Part1Field, string>> {
  const { [field]: _removed, ...rest } = errors;
  return rest;
}

function seedValues(i: Part1FormInspection): Record<Part1Field, string> {
  return {
    price: toFormValue(i.price),
    make: toFormValue(i.make),
    model: toFormValue(i.model),
    year: toFormValue(i.year),
    registrationNumber: toFormValue(i.registrationNumber),
    vin: toFormValue(i.vin),
    mileage: toFormValue(i.mileage),
    fuelType: toFormValue(i.fuelType),
    transmission: toFormValue(i.transmission),
    drive: toFormValue(i.drive),
    color: toFormValue(i.color),
    bodyType: toFormValue(i.bodyType),
    doorCount: toFormValue(i.doorCount),
    address: toFormValue(i.address),
    notes: toFormValue(i.notes),
  };
}

export default function Part1Form({ inspection }: Props) {
  const [values, setValues] = useState<Record<Part1Field, string>>(() => seedValues(inspection));
  const [errors, setErrors] = useState<Partial<Record<Part1Field, string>>>({});
  const [name, setName] = useState<string | null>(inspection.name);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Focus targets for UX-3. Inputs register their <input>; selects register their
  // trigger button. Keyed by field id.
  const refs = useRef<Partial<Record<Part1Field, HTMLElement | null>>>({});

  // Drain the outbox for this session: a Save enqueues, and these redundant
  // triggers (online/visibility/timer/initial) guarantee it reaches the server.
  useEffect(() => startAutoSync(), []);

  // Unlock is derived from the current values every render — exactly "would a Save
  // succeed" (full schema incl. CF-1). No "saved" flag (CF-3).
  const unlocked = isConfigUnlocked(values);

  // Re-run full validation but only (un)set the one field's error, so blurring a
  // field never lights up untouched fields.
  function validateField(field: Part1Field, vals: Record<Part1Field, string>) {
    const result = validatePart1(vals);
    setErrors((prev) => {
      if (result.ok || !result.errors[field]) return omitError(prev, field);
      return { ...prev, [field]: result.errors[field] };
    });
  }

  function handleInput(field: Part1Field, value: string) {
    // Numeric fields reject letters as the user types: mileage is digits only;
    // price also allows the decimal separators (. ,). The schema still does the
    // authoritative parse — this is just a soft guard so the field never shows
    // letters (rules doc §2 "soft on input").
    let next = value;
    if (field === "mileage") next = value.replace(/\D/g, "");
    else if (field === "price") next = value.replace(/[^\d.,]/g, "");
    setValues((prev) => ({ ...prev, [field]: next }));
    // Soft on-input: clear a showing error as the user types, but don't add new
    // ones until blur (rules doc §2).
    if (errors[field]) {
      setErrors((prev) => omitError(prev, field));
    }
    setJustSaved(false);
  }

  function handleEnumChange(field: Part1Field, value: string) {
    const next = { ...values, [field]: value };
    // CF-1 guard at the UI: picking Electric clears a now-impossible Manual
    // selection so the transmission dropdown (which hides Manual for Electric)
    // never shows a stale, invalid value.
    if (field === "fuelType" && value === "electric" && next.transmission === "manual") {
      next.transmission = "";
    }
    setValues(next);
    validateField(field, next);
    setJustSaved(false);
  }

  function handleBlur(field: Part1Field) {
    // Text fields with a blur normalizer (make, model, registration, color,
    // address, notes) update live so the input reflects exactly what will be saved.
    const normalized = normalizeFieldOnBlur(field, values[field]);
    if (normalized !== values[field]) {
      const next = { ...values, [field]: normalized };
      setValues(next);
      validateField(field, next);
      return;
    }
    validateField(field, values);
  }

  async function handleSave() {
    const result = validatePart1(values);
    if (!result.ok) {
      setErrors(result.errors);
      const firstInvalid = FIELD_ORDER.find((f) => result.errors[f]);
      if (firstInvalid) {
        const el = refs.current[firstInvalid];
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        // `preventScroll` so the default focus jump doesn't cancel the smooth scroll.
        el?.focus({ preventScroll: true });
      }
      return;
    }

    setSaving(true);
    setErrors({});
    setSaveError(null);
    const config = result.config;
    // Tile title (FR-006): Make + Model, plus Year + Registration when present.
    const autoName = [config.make, config.model, config.year, config.registrationNumber]
      .filter((part) => part !== null && part !== "")
      .join(" ");
    try {
      // Preserve the original createdAt + status — the sync endpoint upserts both
      // explicitly with no protective trigger, so omitting them would clobber the
      // creation timestamp and reset status to "draft".
      await saveInspection({
        id: inspection.id,
        status: inspection.status,
        createdAt: inspection.createdAt,
        name: autoName,
        ...config,
      });
      void flushQueue();
      setName(autoName);
      setJustSaved(true);
    } catch {
      // The optimistic Dexie write failed (e.g. IndexedDB quota/blocked,
      // private browsing). Nothing was persisted — surface it so the user
      // knows the save did not take, rather than silently resetting.
      setSaveError("Could not save on this device. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <a
          href="/dashboard"
          className="text-sm text-purple-300 transition-colors hover:text-purple-100 hover:underline"
        >
          &larr; Back to dashboard
        </a>
        <h1 className="mt-4 text-2xl font-bold text-white">{name ?? "Inspection"}</h1>
        <p className="mt-1 text-blue-100/60">
          Info about the car — fill in the required fields, then save to continue.
        </p>
      </header>

      <Card className={PANEL}>
        <CardHeader>
          <CardTitle className="text-white">Part 1 — Vehicle configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 sm:grid-cols-2">
            {FIELD_ORDER.map((field) => {
              const enumOptions = ENUM_OPTIONS[field];
              if (enumOptions) {
                // Hide Manual when Electric is selected (CF-1 made unreachable in the UI).
                const options =
                  field === "transmission" && values.fuelType === "electric"
                    ? enumOptions.filter(([key]) => key !== "manual")
                    : enumOptions;
                return (
                  <EnumFieldRow
                    key={field}
                    field={field}
                    value={values[field]}
                    error={errors[field]}
                    required={REQUIRED.has(field)}
                    options={options}
                    onChange={(v) => {
                      handleEnumChange(field, v);
                    }}
                    registerRef={(el) => {
                      refs.current[field] = el;
                    }}
                  />
                );
              }
              return (
                <TextFieldRow
                  key={field}
                  field={field}
                  value={values[field]}
                  error={errors[field]}
                  required={REQUIRED.has(field)}
                  multiline={field === "notes"}
                  inputModeHint={field === "mileage" ? "numeric" : field === "price" ? "decimal" : undefined}
                  onInput={(v) => {
                    handleInput(field, v);
                  }}
                  onBlur={() => {
                    handleBlur(field);
                  }}
                  registerRef={(el) => {
                    refs.current[field] = el;
                  }}
                />
              );
            })}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button type="button" onClick={() => void handleSave()} disabled={saving} className={PRIMARY_BTN}>
              {saving ? "Saving…" : "Save Part 1"}
            </Button>
            {justSaved && <span className="text-sm text-emerald-300">Saved.</span>}
          </div>
          {saveError && (
            <div className="mt-4">
              <ServerError message={saveError} />
            </div>
          )}
        </CardContent>
      </Card>

      <PartsNav unlocked={unlocked} />
    </div>
  );
}

interface TextRowProps {
  field: Part1Field;
  value: string;
  error?: string;
  required: boolean;
  multiline: boolean;
  inputModeHint?: "numeric" | "decimal";
  onInput: (value: string) => void;
  onBlur: () => void;
  registerRef: (el: HTMLElement | null) => void;
}

function TextFieldRow({
  field,
  value,
  error,
  required,
  multiline,
  inputModeHint,
  onInput,
  onBlur,
  registerRef,
}: TextRowProps) {
  return (
    <div className={multiline ? "sm:col-span-2" : undefined}>
      <Label htmlFor={field} className="mb-1 text-blue-100/80">
        {LABELS[field]}
        {required && <span className="text-red-300"> *</span>}
      </Label>
      {multiline ? (
        <textarea
          id={field}
          ref={(el) => {
            registerRef(el);
          }}
          value={value}
          onChange={(e) => {
            onInput(e.target.value);
          }}
          onBlur={onBlur}
          rows={3}
          aria-invalid={error ? true : undefined}
          className={`flex w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-purple-400/50 ${FIELD_INPUT}`}
        />
      ) : (
        <Input
          id={field}
          ref={(el) => {
            registerRef(el);
          }}
          value={value}
          inputMode={inputModeHint}
          onChange={(e) => {
            onInput(e.target.value);
          }}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          className={FIELD_INPUT}
        />
      )}
      {error && <FieldError message={error} />}
    </div>
  );
}

interface EnumRowProps {
  field: Part1Field;
  value: string;
  error?: string;
  required: boolean;
  options: [string, string][];
  onChange: (value: string) => void;
  registerRef: (el: HTMLElement | null) => void;
}

function EnumFieldRow({ field, value, error, required, options, onChange, registerRef }: EnumRowProps) {
  return (
    <div>
      <Label htmlFor={field} className="mb-1 text-blue-100/80">
        {LABELS[field]}
        {required && <span className="text-red-300"> *</span>}
      </Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger
          id={field}
          ref={(el) => {
            registerRef(el);
          }}
          aria-invalid={error ? true : undefined}
          className={`w-full ${FIELD_INPUT}`}
        >
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, display]) => (
            <SelectItem key={key} value={key}>
              {display}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

// Parts 2-5 placeholder. Disabled (with an explanatory line) until the config is
// fully valid; once unlocked the cards are enabled-but-inert (no S-04 target yet).
function PartsNav({ unlocked }: { unlocked: boolean }) {
  const parts = [
    { n: 2, title: "Condition" },
    { n: 3, title: "Documents" },
    { n: 4, title: "Test drive" },
    { n: 5, title: "Summary" },
  ];
  return (
    <section className={`rounded-xl border p-5 ${PANEL}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white">Parts 2–5</h2>
        {!unlocked && <Lock className="size-4 text-blue-100/50" />}
      </div>
      {!unlocked && (
        <p className="mb-4 text-sm text-blue-100/60">Save the required Part 1 fields to unlock Parts 2–5.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {parts.map((p) => (
          <div
            key={p.n}
            aria-disabled={!unlocked}
            className={`rounded-lg border p-4 transition-opacity ${
              unlocked ? "border-white/15 bg-white/10" : "border-white/10 bg-white/5 opacity-50"
            }`}
          >
            <p className="text-xs tracking-wider text-blue-100/40 uppercase">Part {p.n}</p>
            <p className="mt-1 font-medium text-white">{p.title}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!unlocked}
              className="mt-3 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              Open
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
