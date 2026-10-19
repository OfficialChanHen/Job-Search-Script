import type { Backend, Wire } from "./store";

/** In-memory server with the same rules as supabase kv_put (for tests and offline demos). */
export class MemoryServer {
  rows = new Map<string, Required<Pick<Wire, "ns" | "key" | "updated_at" | "version" | "server_at">> & Wire>();
  private clock = 0;
  private subs = new Set<(rows: Wire[]) => void>();

  put(rows: Wire[]): Wire[] {
    const out = rows.map(r => {
      const k = r.ns + "\u0000" + r.key, cur = this.rows.get(k), base = r.base_version ?? null;
      if (!cur) {
        if (base !== null && base !== 0) return { ns: r.ns, key: r.key, accepted: false, missing: true };
        const row = { ns: r.ns, key: r.key, value: r.value, deleted: !!r.deleted, updated_at: r.updated_at!, version: 1, server_at: this.stamp() };
        this.rows.set(k, row);
        return { ...row, accepted: true };
      }
      if ((base !== null && cur.version !== base) || (base === null && cur.updated_at >= r.updated_at!)) return { ...cur, accepted: false };
      const row = { ...cur, value: r.value, deleted: !!r.deleted, updated_at: r.updated_at!, version: cur.version + 1, server_at: this.stamp() };
      this.rows.set(k, row);
      return { ...row, accepted: true };
    });
    const changed = out.filter(r => r.accepted).map(r => { const copy: Wire = { ...r }; delete copy.accepted; return copy; });
    if (changed.length) this.subs.forEach(fn => fn(changed));
    return out;
  }
  pull(since: string | null): Wire[] {
    return [...this.rows.values()].filter(r => !since || r.server_at > since).sort((a, b) => a.server_at.localeCompare(b.server_at));
  }
  private stamp() { return String(++this.clock).padStart(12, "0"); }
  backend(userId = "u1", opts: { live?: boolean } = {}): Backend {
    return {
      userId,
      pull: async since => this.pull(since),
      push: async rows => this.put(rows),
      subscribe: opts.live ? fn => { this.subs.add(fn); return () => { this.subs.delete(fn); }; } : undefined,
    };
  }
}
