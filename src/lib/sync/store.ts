/* A small local-first key/value store that syncs across devices.
 *
 * Everything you track is a row: (namespace, key) → JSON value. Rows live in
 * memory, are cached in localStorage so the app works offline, and are pushed
 * to a backend (Supabase) when you're signed in.
 *
 * Merging:
 *  - Plain rows: newest edit wins, by the editing device's clock. Fine for a
 *    single person; two devices rarely edit the same row in the same second.
 *  - Versioned namespaces (the village): a write only lands if it was based on
 *    the server's latest version. If another device wrote first, we take the
 *    server's copy and replay our pending changes on top of it, so gold and
 *    food that accrue over time are never counted twice.
 */

export interface Row {
  value: unknown;
  deleted: boolean;
  updatedAt: number;   // ms, editing device's clock
  version: number;     // server version this copy is based on (0 = never synced)
}

export interface Wire {
  ns: string;
  key: string;
  value?: unknown;
  deleted?: boolean;
  updated_at?: number;
  version?: number;
  server_at?: string;
  accepted?: boolean;
  missing?: boolean;
  base_version?: number | null;
}

export interface Backend {
  userId: string;
  pull(since: string | null): Promise<Wire[]>;
  push(rows: Wire[]): Promise<Wire[]>;
  subscribe?(onRows: (rows: Wire[]) => void): () => void;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

type Transform = (current: unknown) => unknown;

const SEP = "\u0000";
const id = (ns: string, key: string) => ns + SEP + key;
const split = (k: string) => k.split(SEP) as [string, string];

export interface StoreOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  versioned?: string[];     // namespaces merged by version check
  localOnly?: string[];     // namespaces that never leave this device
  now?: () => number;
  flushDelay?: number;
}

export type SyncState = "local" | "idle" | "syncing" | "offline" | "error";

export class Store {
  private data = new Map<string, Map<string, Row>>();
  private outbox = new Set<string>();
  private pending = new Map<string, Transform[]>();   // versioned rows: changes not yet accepted
  private listeners = new Set<() => void>();
  private backend: Backend | null = null;
  private unsub: (() => void) | null = null;
  private cursor: string | null = null;
  private owner: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly opts: Required<Omit<StoreOptions, "storage">> & { storage: StorageLike | null };
  rev = 0;
  syncState: SyncState = "local";
  lastError = "";

  constructor(opts: StoreOptions = {}) {
    this.opts = {
      storage: opts.storage ?? null,
      storageKey: opts.storageKey ?? "jh-store-v1",
      versioned: opts.versioned ?? [],
      localOnly: opts.localOnly ?? [],
      now: opts.now ?? Date.now,
      flushDelay: opts.flushDelay ?? 800,
    };
    this.load();
  }

  /* ── reading ─────────────────────────────────────────────── */
  get<T = unknown>(ns: string, key: string): T | undefined {
    const r = this.data.get(ns)?.get(key);
    return r && !r.deleted ? (r.value as T) : undefined;
  }
  /** Live (not deleted) entries of a namespace. */
  entries<T = unknown>(ns: string): [string, T][] {
    const m = this.data.get(ns);
    if (!m) return [];
    const out: [string, T][] = [];
    m.forEach((r, k) => { if (!r.deleted) out.push([k, r.value as T]); });
    return out;
  }
  row(ns: string, key: string): Row | undefined { return this.data.get(ns)?.get(key); }
  get pendingCount() { return this.outbox.size; }
  get userId() { return this.owner; }

  /* ── writing ─────────────────────────────────────────────── */
  set(ns: string, key: string, value: unknown) { this.write(ns, key, value, false); }
  delete(ns: string, key: string) { if (this.row(ns, key) && !this.row(ns, key)!.deleted) this.write(ns, key, null, true); }
  /** Set many rows with one notification (imports). */
  batch(fn: () => void) {
    const quiet = this.quiet;
    this.quiet = true;
    try { fn(); } finally { this.quiet = quiet; }
    if (!quiet) this.changed();
  }
  private quiet = false;

  /** Change a versioned row by a transform, so it can be replayed if another device wrote first. */
  mutate<T>(ns: string, key: string, fn: (current: T | undefined) => T) {
    const cur = this.get<T>(ns, key);
    const next = fn(cur);
    const k = id(ns, key);
    if (this.backend && this.isVersioned(ns)) this.pending.set(k, [...(this.pending.get(k) || []), fn as Transform]);
    this.write(ns, key, next, false);
  }

  private write(ns: string, key: string, value: unknown, deleted: boolean) {
    const m = this.data.get(ns) ?? new Map<string, Row>();
    this.data.set(ns, m);
    const prev = m.get(key);
    const updatedAt = Math.max(this.opts.now(), (prev?.updatedAt ?? 0) + 1);
    m.set(key, { value, deleted, updatedAt, version: prev?.version ?? 0 });
    if (!this.opts.localOnly.includes(ns)) this.outbox.add(id(ns, key));
    if (!this.quiet) this.changed();
  }

  private isVersioned(ns: string) { return this.opts.versioned.includes(ns); }

  /* ── change notification (React: useSyncExternalStore) ──── */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getRev = () => this.rev;
  private changed() {
    this.rev++;
    this.listeners.forEach(fn => fn());
    this.scheduleSave();
    this.scheduleFlush();
  }

  /* ── persistence ─────────────────────────────────────────── */
  private load() {
    const s = this.opts.storage;
    if (!s) return;
    try {
      const raw = s.getItem(this.opts.storageKey);
      if (!raw) return;
      const j = JSON.parse(raw);
      this.owner = j.owner ?? null;
      this.cursor = j.cursor ?? null;
      for (const [ns, key, r] of j.rows ?? []) {
        if (!this.data.has(ns)) this.data.set(ns, new Map());
        this.data.get(ns)!.set(key, r);
      }
      (j.outbox ?? []).forEach((k: string) => this.outbox.add(k));
    } catch { /* corrupt cache: start empty, the server copy will refill it */ }
  }
  saveNow() {
    const s = this.opts.storage;
    if (!s) return;
    const rows: [string, string, Row][] = [];
    this.data.forEach((m, ns) => m.forEach((r, key) => rows.push([ns, key, r])));
    try {
      s.setItem(this.opts.storageKey, JSON.stringify({ owner: this.owner, cursor: this.cursor, rows, outbox: [...this.outbox] }));
    } catch { /* storage full or blocked: keep working in memory */ }
  }
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 250);
  }

  /* ── sync ────────────────────────────────────────────────── */
  /** Connect a signed-in backend. Local-only rows made before signing in are pushed to it. */
  async connect(backend: Backend) {
    if (this.owner && this.owner !== backend.userId) {
      // a different account used this browser before: don't mix their data in
      this.data.clear(); this.outbox.clear(); this.pending.clear(); this.cursor = null;
    }
    if (this.owner !== backend.userId) {
      // first time this account syncs here: everything local is new to the server
      this.data.forEach((m, ns) => {
        if (this.opts.localOnly.includes(ns)) return;
        m.forEach((_, key) => this.outbox.add(id(ns, key)));
      });
    }
    this.owner = backend.userId;
    this.backend = backend;
    this.unsub?.();
    this.unsub = backend.subscribe?.(rows => { this.applyRemote(rows); this.changed(); }) ?? null;
    this.saveNow();
    await this.sync();
  }
  disconnect() {
    this.unsub?.(); this.unsub = null; this.backend = null; this.pending.clear();
    this.syncState = "local";
    this.changed();
  }

  /** Pull what other devices wrote, then push ours. */
  async sync() {
    if (!this.backend) return;
    this.setState("syncing");
    try {
      const rows = await this.backend.pull(this.cursor);
      this.applyRemote(rows);
      // a rejected versioned row is rebased and queued again: give it a few rounds to land
      for (let i = 0; i < 3 && this.outbox.size; i++) await this.flush();
      this.setState("idle");
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
    }
    this.changed();
  }

  private setState(s: SyncState) { this.syncState = s; this.listeners.forEach(fn => fn()); }

  private scheduleFlush() {
    if (!this.backend || !this.outbox.size) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush().catch(() => {}); }, this.opts.flushDelay);
  }

  /** Push the outbox. Safe to call any time; concurrent calls share one push. */
  flush(): Promise<void> {
    if (!this.backend || !this.outbox.size) return this.flushing ?? Promise.resolve();
    if (this.flushing) return this.flushing.then(() => this.flush());
    const keys = [...this.outbox];
    const sentFns = keys.map(k => (this.pending.get(k) || []).length);
    const wire: Wire[] = keys.map(k => {
      const [ns, key] = split(k);
      const r = this.row(ns, key)!;
      return {
        ns, key, value: r.value, deleted: r.deleted, updated_at: r.updatedAt,
        base_version: this.isVersioned(ns) ? r.version : null,
      };
    });
    const backend = this.backend;
    this.flushing = (async () => {
      try {
        const results = await backend.push(wire);
        keys.forEach((k, i) => {
          const [ns, key] = split(k);
          const sent = wire[i], res = results[i];
          const local = this.row(ns, key)!;
          const editedSince = local.updatedAt !== sent.updated_at;
          if (!res) return;
          if (res.accepted) {
            local.version = res.version ?? local.version + 1;
            // changes that just landed must never be replayed again
            const rest = (this.pending.get(k) || []).slice(sentFns[i]);
            if (rest.length) this.pending.set(k, rest); else this.pending.delete(k);
            if (!editedSince) this.outbox.delete(k);
          } else if (this.isVersioned(ns)) {
            this.rebase(ns, key, res);
          } else if (!editedSince) {
            // the server had a newer edit: take it
            this.take(ns, key, res);
            this.outbox.delete(k);
          }
        });
        this.setState("idle");
      } catch (e) {
        // the outbox is kept: the next sync (focus, back online, or the 5-minute timer) retries it
        this.lastError = e instanceof Error ? e.message : String(e);
        this.setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
        throw e;
      } finally {
        this.flushing = null;
      }
      this.saveNow();
      this.rev++; this.listeners.forEach(fn => fn());
      if (this.outbox.size) this.scheduleFlush();
    })();
    return this.flushing;
  }

  /** Versioned row lost the race: start from the server's copy, replay our changes. */
  private rebase(ns: string, key: string, server: Wire) {
    const k = id(ns, key);
    const fns = this.pending.get(k) || [];
    let value: unknown = server.missing ? undefined : server.value;
    for (const fn of fns) value = fn(value);
    const m = this.data.get(ns)!;
    const version = server.missing ? 0 : (server.version ?? 0);
    if (!fns.length) {
      // nothing of ours to replay (e.g. made before signing in): the server's copy wins
      m.set(key, { value: server.value, deleted: !!server.deleted, updatedAt: server.updated_at ?? this.opts.now(), version });
      this.outbox.delete(k);
      return;
    }
    m.set(key, { value, deleted: false, updatedAt: Math.max(this.opts.now(), (server.updated_at ?? 0) + 1), version });
    this.outbox.add(k);
  }

  private take(ns: string, key: string, w: Wire) {
    if (!this.data.has(ns)) this.data.set(ns, new Map());
    this.data.get(ns)!.set(key, { value: w.value, deleted: !!w.deleted, updatedAt: w.updated_at ?? 0, version: w.version ?? 0 });
  }

  /** Rows from the server (a pull or a live update). */
  applyRemote(rows: Wire[]) {
    for (const w of rows) {
      if (w.server_at && (!this.cursor || w.server_at > this.cursor)) this.cursor = w.server_at;
      const local = this.row(w.ns, w.key), k = id(w.ns, w.key);
      if (!local) { this.take(w.ns, w.key, w); continue; }
      if (this.isVersioned(w.ns)) {
        // ours is pending: the push will be rejected and rebased; otherwise take any newer version
        if (!this.outbox.has(k) && (w.version ?? 0) > local.version) this.take(w.ns, w.key, w);
        continue;
      }
      if ((w.updated_at ?? 0) > local.updatedAt) { this.take(w.ns, w.key, w); this.outbox.delete(k); }
      else if ((w.updated_at ?? 0) === local.updatedAt) local.version = Math.max(local.version, w.version ?? 0);
    }
    this.saveNow();
  }
}
