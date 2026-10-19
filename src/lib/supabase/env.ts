// Supabase is optional: without these the app runs in local mode (saved in this browser only).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SYNC_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);
