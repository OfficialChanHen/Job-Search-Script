// @vitest-environment jsdom
/* The map's combat runs without drawing: give the canvas a size, feed it a party, and step time forward. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Unit } from "@/lib/game/village/sim";
import { VillageScene } from "./scene";

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  HTMLCanvasElement.prototype.getContext = (() => null) as never;     // jsdom has no canvas; the scene skips drawing without one
  vi.stubGlobal("requestAnimationFrame", () => 0);
});
afterAll(() => vi.unstubAllGlobals());

const unit = (k: string, cls: Unit["cls"], row: Unit["row"]): Unit => ({ k, cls, rank: 1, row, atk: 30, hp: 300, spd: 1.2, crit: 0.1, cdmg: 1.5 });
// slot 0 is a guardian (Sir Aldric): even-slot hunters used to cross back and forth over their target forever
const PARTY = [unit("hashing", "guardian", "front"), unit("two_pointers", "striker", "back"), unit("binary_search", "swift", "back"),
               unit("intervals", "sniper", "back"), unit("stack", "guardian", "front")];

type Inner = {
  hs: Record<string, { state: string; hp: number; max: number }>;
  hitMob: (h: { k: string }, ...rest: unknown[]) => void;
  mobHits: (m: unknown, h: { k: string }) => void;
  step: (dt: number) => void;
  fight: unknown;
};
function sizedScene() {
  const host = document.createElement("div");
  host.getBoundingClientRect = () => ({ width: 820, height: 360, top: 0, left: 0, right: 820, bottom: 360, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(host);
  const s = new VillageScene();
  s.mount(host);
  s.update({ units: Object.fromEntries(PARTY.map(u => [u.k, u])), fed: true, eff: 0.6, dps: 150, zone: { z: 1, name: "Fields" },
             bld: { inn: 3, kitchen: 1, forge: 1, market: 1 }, daRunning: false, anyTrained: true, gear: {}, hitmarkers: true });
  return { s, inner: s as unknown as Inner };
}

describe("field combat on the map", () => {
  it("every hunter on duty lands hits, and monsters hit every hunter back", () => {
    const { inner } = sizedScene();
    const dealt: Record<string, number> = {}, taken: Record<string, number> = {};
    const hitMob = inner.hitMob.bind(inner), mobHits = inner.mobHits.bind(inner);
    inner.hitMob = (h, ...rest) => { dealt[h.k] = (dealt[h.k] || 0) + 1; hitMob(h, ...rest); };
    inner.mobHits = (m, h) => { taken[h.k] = (taken[h.k] || 0) + 1; mobHits(m, h); };
    for (let t = 0; t < 90; t += 0.05) inner.step(0.05);
    for (const u of PARTY) {
      expect(dealt[u.k], `${u.k} never hit a monster`).toBeGreaterThan(0);
      expect(taken[u.k], `nothing ever attacked ${u.k}`).toBeGreaterThan(0);
    }
  });

  it("hunters lose health when hit and go back to the inn to heal", () => {
    const { inner } = sizedScene();
    let lowest = 1, rested = false;
    for (let t = 0; t < 120; t += 0.05) {
      inner.step(0.05);
      Object.values(inner.hs).forEach(h => { lowest = Math.min(lowest, h.hp / h.max); if (h.state === "rest") rested = true; });
    }
    expect(lowest).toBeLessThan(1);
    expect(rested).toBe(true);
    Object.values(inner.hs).forEach(h => expect(h.hp).toBeGreaterThan(0));
  });

  it("a boss fight replays to the end: melee hunters dash in, snipers shoot, and the boss strikes back", () => {
    const { s, inner } = sizedScene();
    const log = [
      { t: 0.5, a: "hit" as const, i: 0, dmg: 40, crit: false, miss: false, bhp: 960, hp: 300 },
      { t: 0.6, a: "hit" as const, i: 3, dmg: 50, crit: true, miss: false, bhp: 910, hp: 300 },
      { t: 1.0, a: "boss" as const, i: 0, dmg: 60, hp: 240 },
      { t: 1.5, a: "slam" as const, dmg: 30, hps: [210, 270, 270, 270, 270] },
    ];
    let done = false;
    s.playFight(PARTY, { name: "Gatekeeper", hp: 1000, z: 1 }, log, { win: false, timeout: true, t: 2 }, () => { done = true; });
    const f = () => inner.fight as { dash: number[]; hp: number[]; blunge: number } | null;
    let dashed = false, shot = false, bossSwung = false;
    for (let t = 0; t < 8 && !done; t += 0.02) {
      inner.step(0.02);
      const x = f();
      if (x?.dash[0]) dashed = true;
      if ((s as unknown as { shots: unknown[] }).shots.length) shot = true;
      if (x?.blunge) bossSwung = true;
    }
    expect(dashed && shot && bossSwung).toBe(true);
    expect(done).toBe(true);
  });
});
