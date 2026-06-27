import type { APIRoute } from "astro";
import camelcaseKeys from "camelcase-keys";
import snakecaseKeys from "snakecase-keys";
import { createClient } from "@/lib/supabase";
import { validateSyncPayload } from "@/lib/sync-payload-validation";

// The SINGLE server boundary for syncing one queued op to `inspections`. Mirrors
// /api/auth/* (server client + cookie session). It re-establishes server
// authority and is the one place casing converts (camelCase app ⇄ snake_case
// Postgres) — never a per-table mapper (lessons.md "Field casing"). Runs on
// workerd; reuses the proven @supabase/ssr server client, no Node-only deps.
//
// Responsibilities (research Decision #2): 401 unless a session is present;
// strip the local-only `synced` flag (no DB column); stamp `owner_id` from the
// session, never the client (RLS `with check` governs inserts); handle `put`
// (upsert → authoritative camelCase row) and `delete` (204).

interface SyncOp {
  op: "put" | "delete";
  entityId: string;
  payload?: Record<string, unknown> & { synced?: 0 | 1 };
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const user = context.locals.user; // cookie session, set by src/middleware.ts
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: SyncOp;
  try {
    body = (await context.request.json()) as SyncOp;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (body.op === "delete") {
    // RLS scopes the delete to the owner; no body to return.
    const { error } = await supabase.from("inspections").delete().eq("id", body.entityId);
    if (error) return new Response(error.message, { status: 400 });
    return new Response(null, { status: 204 });
  }

  // Strip the local-only `synced` flag (no DB column). Stamp owner_id from the
  // session — RLS `with check (owner_id = auth.uid())` rejects anything else, so
  // any client-sent ownerId is overwritten here. camel → snake at this boundary;
  // scalar columns only (no jsonb yet), so the top-level transform is sufficient.
  const { synced: _synced, ...row } = body.payload ?? {};

  // Server-trust guard: reject the oversized / cross-field-invalid bands the client
  // blocks (Risk #6). Runs on the camelCase row, before snakecasing, so a curl/devtools
  // bypass cannot persist what the browser validators would have stopped.
  const validation = validateSyncPayload(row);
  if (!validation.ok) return new Response(validation.message, { status: 400 });

  const payload = snakecaseKeys({ ...row, ownerId: user.id });

  const { data, error } = await supabase
    .from("inspections")
    .upsert(payload as never)
    .select()
    .single();

  if (error) return new Response(error.message, { status: 400 });
  // snake → camel: hand the authoritative row (incl. server-stamped updatedAt) back.
  return Response.json(camelcaseKeys(data, { deep: true }));
};
