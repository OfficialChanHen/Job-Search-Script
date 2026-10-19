"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, SYNC_ENABLED } from "./env";

let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  if (!SYNC_ENABLED) return null;
  return (client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY));
}
