// CLIENT-ONLY — Dexie wraps IndexedDB, which has no global in the Cloudflare
// workerd SSR runtime. NEVER import this module from `.astro` frontmatter or any
// server module, or the build/render throws. Mount Dexie-backed islands with
// `client:only="react"`. (dexie-reference.md §SSR gotcha)
import { Dexie, type EntityTable } from "dexie";
import type { CamelCasedPropertiesDeep } from "type-fest";
import type { Database } from "@/db/database.types";

// The on-device inspection row: the camelCase projection of the generated
// snake_case DB Row, plus a local-only `synced` flag. Deriving from the generated
// types means this auto-tracks `npm run db:types` — no hand-written interface,
// no per-table mapper (lessons.md "Field casing"). `synced` is purely a local
// outbox flag (no DB column); it's `0 | 1` because IndexedDB can't index booleans.
type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];
type Inspection = CamelCasedPropertiesDeep<InspectionRow> & { synced: 0 | 1 };

// The Change Queue (outbox) is purely local — no DB table — so it's a
// hand-written interface. `seq` is the auto-incremented FIFO ordinal; `payload`
// is camelCase and converted to snake_case at the sync endpoint, not here.
interface ChangeOp {
  seq?: number;
  entity: "inspections";
  entityId: string;
  op: "put" | "delete";
  payload: Inspection;
  createdAt: number;
}

const db = new Dexie("veriffica") as Dexie & {
  inspections: EntityTable<Inspection, "id">;
  changeQueue: EntityTable<ChangeOp, "seq">;
};

db.version(1).stores({
  // First token = primary key; the rest are indexes (camelCase property names).
  // `id` is a supplied uuid (bare, not `++`) so the same id works locally and in
  // Supabase. `++seq` gives the queue a monotonic FIFO ordinal for free.
  inspections: "id, ownerId, updatedAt, synced",
  changeQueue: "++seq, entity, entityId, createdAt",
});

export { db };
export type { Inspection, ChangeOp };
