import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Test-only Supabase helpers. The harness reuses these across later slices.
//
// Two client kinds:
//   - adminClient(): service_role key — bypasses RLS, used ONLY to seed and tear
//     down users. Never used in app code; never in the astro:env schema.
//   - signInAs(): anon key + a real user session — carries the user's JWT so
//     auth.uid() resolves and RLS applies, exactly like the SSR app client.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Is local Supabase running (npx supabase start)?`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const ANON_KEY = requireEnv("SUPABASE_KEY");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// Don't let test clients persist sessions to disk or refresh tokens in the background.
const testClientOptions = { auth: { autoRefreshToken: false, persistSession: false } } as const;

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, testClientOptions);
}

export async function createConfirmedUser(email: string, password: string): Promise<string> {
  // email_confirm: true skips the email round-trip (mirrors config.toml's
  // enable_confirmations = false), so the user is immediately usable.
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

export async function signInAs(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, testClientOptions);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function deleteUser(id: string): Promise<void> {
  // Cascade FK on inspections.owner_id clears the user's rows automatically.
  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error) throw error;
}
