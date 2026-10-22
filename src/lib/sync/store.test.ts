import { describe, expect, it } from "vitest";
import { Store, type StorageLike } from "./store";
import { MemoryServer } from "./memoryBackend";

const memStorage = (): StorageLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
};
let t = 1000;
const clock = () => ++t;
const device = (opts = {}) => new Store({ versioned: ["village"], localOnly: ["sheet"], now: clock, flushDelay: 1e9, ...opts });
type Village = { gold: number; hours: number };
const earn = (g: number) => (v: Village | undefined): Village => ({ gold: (v?.gold ?? 0) + g, hours: (v?.hours ?? 0) + 1 });

describe("sync store", () => {
  it("merges plain rows from two devices, newest edit wins", async () => {
    const server = new MemoryServer(), phone = device(), laptop = device();
    await phone.connect(server.backend());
    await laptop.connect(server.backend());
    phone.set("status", "job1", { s: "applied" });
    laptop.set("status", "job2", { s: "saved" });
    await phone.flush(); await laptop.flush();
    laptop.set("status", "job1", { s: "hidden" });     // later edit of the same row
    await laptop.flush();
    await phone.sync(); await laptop.sync();
    for (const d of [phone, laptop]) {
      expect(d.get("status", "job1")).toEqual({ s: "hidden" });
      expect(d.get("status", "job2")).toEqual({ s: "saved" });
    }
  });

  it("an older offline edit doesn't overwrite a newer one", async () => {
    const server = new MemoryServer(), phone = device(), laptop = device();
    await phone.connect(server.backend()); await laptop.connect(server.backend());
    phone.set("solved", "200", { d: "2026-10-01" });    // made first, pushed last
    laptop.set("solved", "200", { d: "2026-10-02" });
    await laptop.flush(); await phone.flush(); await phone.sync();
    expect(phone.get("solved", "200")).toEqual({ d: "2026-10-02" });
    expect(phone.pendingCount).toBe(0);
  });

  it("deletes sync as tombstones", async () => {
    const server = new MemoryServer(), a = device(), b = device();
    await a.connect(server.backend()); await b.connect(server.backend());
    a.set("solved", "1", { d: "x" }); await a.flush(); await b.sync();
    expect(b.get("solved", "1")).toBeTruthy();
    a.delete("solved", "1"); await a.flush(); await b.sync();
    expect(b.get("solved", "1")).toBeUndefined();
    expect(b.entries("solved")).toEqual([]);
  });

  it("versioned rows replay on conflict instead of double counting", async () => {
    const server = new MemoryServer(), a = device(), b = device();
    await a.connect(server.backend()); await b.connect(server.backend());
    a.mutate("village", "state", earn(10)); await a.flush();
    await b.sync();
    expect(b.get<Village>("village", "state")).toEqual({ gold: 10, hours: 1 });
    // both earn while out of touch
    a.mutate("village", "state", earn(5)); await a.flush();
    b.mutate("village", "state", earn(7)); await b.flush();     // rejected, rebased on a's copy
    await b.flush();
    await a.sync(); await b.sync();
    const want = { gold: 22, hours: 3 };
    expect(a.get("village", "state")).toEqual(want);
    expect(b.get("village", "state")).toEqual(want);
    expect(server.rows.get("village\u0000state")!.value).toEqual(want);
  });

  it("a change accepted mid-flight is not replayed again", async () => {
    const server = new MemoryServer(), a = device(), b = device();
    await a.connect(server.backend()); await b.connect(server.backend());
    a.mutate("village", "state", earn(1));
    const inflight = a.flush();
    a.mutate("village", "state", earn(2));          // edited while the first push is out
    await inflight;
    b.mutate("village", "state", earn(100));        // based on version 0, but a's first change landed
    await a.flush();                                // a's second change lands on top of its first
    await b.sync();                                 // b is rejected, replays +100 once on a's copy
    await a.sync();
    expect(a.get<Village>("village", "state")!.gold).toBe(103);
    expect(b.get<Village>("village", "state")!.gold).toBe(103);
  });

  it("rows made before signing in are pushed on connect; a local village loses to the server's", async () => {
    const server = new MemoryServer(), laptop = device();
    await laptop.connect(server.backend());
    laptop.mutate("village", "state", earn(50)); await laptop.flush();
    const phone = device();                     // used signed out first
    phone.set("status", "jobX", { s: "applied" });
    phone.mutate("village", "state", earn(1));
    await phone.connect(server.backend());
    await phone.flush();
    expect(phone.get<Village>("village", "state")!.gold).toBe(50);
    expect(server.rows.get("status\u0000jobX")!.value).toEqual({ s: "applied" });
  });

  it("local-only namespaces never leave the device", async () => {
    const server = new MemoryServer(), a = device();
    await a.connect(server.backend());
    a.set("sheet", "rows", [1, 2, 3]); await a.flush();
    expect(server.rows.size).toBe(0);
  });

  it("a different account on the same browser starts clean", async () => {
    const storage = memStorage(), server = new MemoryServer();
    const a = device({ storage });
    await a.connect(server.backend("alice"));
    a.set("status", "j", { s: "applied" }); a.saveNow();
    const again = device({ storage });
    await again.connect(server.backend("bob"));
    expect(again.get("status", "j")).toBeUndefined();
  });

  it("survives a reload with unsent changes", async () => {
    const storage = memStorage(), server = new MemoryServer();
    const a = device({ storage });
    await a.connect(server.backend());
    a.set("status", "j", { s: "saved" }); a.saveNow();          // closed before it could push
    const reloaded = device({ storage });
    expect(reloaded.get("status", "j")).toEqual({ s: "saved" });
    expect(reloaded.pendingCount).toBe(1);
    await reloaded.connect(server.backend());
    expect(server.rows.get("status\u0000j")!.value).toEqual({ s: "saved" });
  });

  it("live updates from another device arrive without a pull", async () => {
    const server = new MemoryServer(), a = device(), b = device();
    await a.connect(server.backend("u1", { live: true })); await b.connect(server.backend("u1", { live: true }));
    let seen = 0;
    b.subscribe(() => seen++);
    a.set("clear", "2026-10-19", 1); await a.flush();
    expect(b.get("clear", "2026-10-19")).toBe(1);
    expect(seen).toBeGreaterThan(0);
  });

  it("a failed background push shows as a sync error and keeps the change for the next try", async () => {
    const server = new MemoryServer(), d = device(), ok = server.backend();
    let down = false;
    await d.connect({ ...ok, push: async rows => { if (down) throw new Error("network"); return ok.push(rows); } });
    down = true;
    d.set("status", "j1", { s: "applied" });
    await expect(d.flush()).rejects.toThrow("network");
    expect(d.syncState).toBe("error");
    expect(d.pendingCount).toBe(1);
    down = false;
    await d.sync();
    expect(d.syncState).toBe("idle");
    expect(d.pendingCount).toBe(0);
  });
});
