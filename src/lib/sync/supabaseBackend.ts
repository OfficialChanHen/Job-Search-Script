import type { SupabaseClient } from "@supabase/supabase-js";
import type { Backend, Wire } from "./store";

const COLS = "ns,key,value,deleted,updated_at,version,server_at";
const PAGE = 1000;

export function supabaseBackend(sb: SupabaseClient, userId: string): Backend {
  return {
    userId,
    async pull(since) {
      // look back a little: a write that committed late can carry an earlier server_at
      const from = since ? new Date(new Date(since).getTime() - 10_000).toISOString() : null;
      const out: Wire[] = [];
      for (let page = 0; ; page++) {
        let q = sb.from("kv").select(COLS).order("server_at").range(page * PAGE, page * PAGE + PAGE - 1);
        if (from) q = q.gt("server_at", from);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        out.push(...(data as Wire[]));
        if (!data || data.length < PAGE) return out;
      }
    },
    async push(rows) {
      const out: Wire[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await sb.rpc("kv_put", { rows: rows.slice(i, i + 500) });
        if (error) throw new Error(error.message);
        out.push(...(data as Wire[]));
      }
      return out;
    },
    subscribe(onRows) {
      const ch = sb.channel("kv-" + userId)
        .on("postgres_changes", { event: "*", schema: "public", table: "kv", filter: `user_id=eq.${userId}` },
            p => { if (p.new && "ns" in p.new) onRows([p.new as Wire]); })
        .subscribe();
      return () => { sb.removeChannel(ch); };
    },
  };
}
