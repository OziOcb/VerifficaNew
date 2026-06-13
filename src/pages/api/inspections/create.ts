import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

// Server-authoritative create of ONE draft inspection (S-02). The client sends
// no trusted fields: owner_id comes from the session, status is 'draft', and the
// name is an auto placeholder (real auto-naming from Make/Model — FR-006 — arrives
// in S-03 once Part 1 columns exist). The 2-per-owner cap is enforced by the
// BEFORE INSERT trigger (enforce_inspection_limit); its distinctive
// 'inspection_limit_reached' message is mapped to 409 so the dashboard can show
// the limit pop-up (match on message, not SQLSTATE). Mirrors the structure of
// /api/inspections/sync: server client null-check -> 503; session -> 401.
//
// No camel/snake transform: the row is built server-side from scalars, so this
// endpoint never crosses the casing boundary the sync endpoint owns.

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return new Response("Supabase not configured", { status: 503 });

  const user = context.locals.user; // cookie session, set by src/middleware.ts
  if (!user) return new Response("Unauthorized", { status: 401 });

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data, error } = await supabase
    .from("inspections")
    .insert({ owner_id: user.id, status: "draft", name: `Draft inspection — ${today}` })
    .select("id")
    .single();

  if (error) {
    // The limit trigger raises this distinctive message — surface it as 409.
    if (error.message.includes("inspection_limit_reached")) {
      return new Response("inspection_limit_reached", { status: 409 });
    }
    return new Response(error.message, { status: 400 });
  }

  return Response.json({ id: data.id }, { status: 201 });
};
