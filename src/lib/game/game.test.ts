import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Job, Topic } from "@/lib/data/types";
import { Store } from "@/lib/sync/store";
import { importLegacy } from "@/lib/sync/importLegacy";
import { checkProgress } from "./check";
import { NS, setStatus, snapshot, toggleSolved } from "./progress";

import {
  bossOf, buyBuilding, buyGear, gearCap, applyFight, bldCost, gearCost, efficiency, fightBoss, foodLeft, goldNow, goldPerHour, huntHours, newVillage,
  normalize, partyUnits, raidState, review, settle, topicIndex, trainingOf, winChance, type Ctx, type VillageState,
} from "./village/engine";
import { mulberry32 } from "./village/sim";
import { gameStats, levelFor } from "./xp";

const root = path.resolve(__dirname, "../../..");
const jobs: Job[] = JSON.parse(readFileSync(path.join(root, "public/data/jobs.json"), "utf8"));
const topics: Record<string, Topic> = JSON.parse(readFileSync(path.join(root, "public/data/topics.json"), "utf8"));
const fx = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__/legacy-backup.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__/legacy-expected.json"), "utf8"));
const byId = new Map(jobs.map(j => [j.id, j]));
const topicOf = topicIndex(topics);
const NOW = new Date(fx.now);

function setup() {
  const store = new Store({ versioned: [NS.village], localOnly: [NS.sheet] });
  importLegacy(store, fx.backup.data);
  const v = () => normalize(store.get<VillageState>(NS.village, "state"));
  const facts = (c: Ctx) => ({ zones: v().unlocked, raidWins: Object.keys(v().raids).length, bldMax: Math.max(...Object.values(v().bld)),
                               hunters: Object.keys(topics).filter(k => trainingOf(c, k) > 0).length });
  const ctx = (): Ctx => {
    const p = snapshot(store, NOW);
    const base: Ctx = { p, topics, topicOf, cmd: 1 };
    const s = gameStats(p, byId, facts(base), NOW);
    return { ...base, cmd: 1 + 0.02 * (levelFor(s.xp) - 1) };
  };
  const stats = () => { const c = ctx(); return gameStats(c.p, byId, facts(c), NOW); };
  return { store, v, ctx, stats };
}

describe("parity with the old dashboard", () => {
  it("imports a backup and gets the same XP, streak and quests", () => {
    const { store, stats } = setup();
    checkProgress(store, stats, NOW);          // the old page unlocked earned badges on load too
    const s = stats();
    expect(s.xp).toBe(expected.xp);
    expect(s.streak).toBe(expected.streak);
    expect(s.quests).toEqual(expected.quests);
    expect([s.applied, s.direct, s.onsite, s.cats, s.interviews, s.daHours, s.triaged])
      .toEqual([expected.applied, expected.direct, expected.onsite, expected.cats, expected.interviews, expected.daHours, expected.triaged]);
  });

  // damage and HP changed on purpose (gear multiplies now, for endless progression); food, gold,
  // training, hunting time and the world boss still match the old page exactly
  it("gets the same food, gold, training and 3 hours of hunting", () => {
    const { store, v, ctx, stats } = setup();
    checkProgress(store, stats, NOW);
    const c = ctx(), p = partyUnits(v(), c);
    const training = Object.fromEntries(Object.keys(topics).map(k => [k, trainingOf(c, k)]).filter(([, n]) => n));
    expect(training).toEqual(expected.training);
    expect(foodLeft(v(), c.p)).toBeCloseTo(expected.before.food, 6);
    expect(goldNow(v(), c.p)).toBeCloseTo(expected.before.gold, 6);
    expect(efficiency(p, v().zone)).toBeCloseTo(expected.before.eff, 6);
    expect(goldPerHour(v(), p)).toBeCloseTo(expected.before.gph, 6);
    expect(huntHours(v(), c.p)).toBeCloseTo(expected.before.hunt, 6);
    const r = settle({ ...v(), last: NOW.getTime() - 3 * 3600e3 }, c, NOW.getTime());
    expect(r.h).toBeCloseTo(expected.settled.h, 6);
    expect(r.gold).toBeCloseTo(expected.settled.g, 6);
    expect(goldNow(r.v, c.p)).toBeCloseTo(expected.settled.gold, 6);
    expect(foodLeft(r.v, c.p)).toBeCloseTo(expected.settled.food, 6);
    const raid = raidState(v(), c.p, NOW);
    expect([raid.dmg, raid.hp]).toEqual([expected.raid.dmg, expected.raid.hp]);
  });
});

describe("village rules", () => {
  it("a new village starts with a day of food and the strongest hunters", () => {
    const { ctx } = setup();
    const c = ctx(), v = newVillage({ ...c, p: { ...c.p, status: {}, outreach: {}, followed: {}, clears: {}, da: [], reviews: 0, solved: { 70: "x", 200: "x" } } }, NOW.getTime());
    expect(v.party).toEqual(["graphs", "dp"]);
  });

  it("hunting stops when food runs out, and un-marking work takes food back", () => {
    const { store, v, ctx } = setup();
    const c = ctx(), hours = huntHours(v(), c.p);
    const r = settle({ ...v(), last: NOW.getTime() - 100 * 3600e3 }, c, NOW.getTime());
    expect(r.h).toBeCloseTo(hours, 6);
    expect(r.starved).toBeCloseTo(100 - hours, 6);
    expect(huntHours(r.v, c.p)).toBeCloseTo(0, 6);
    const applied = Object.entries(c.p.status).find(([, x]) => x.s === "applied")![0];
    const before = foodLeft(v(), c.p);
    setStatus(store, applied, "", NOW);
    expect(foodLeft(v(), ctx().p)).toBeCloseTo(before - 4, 6);
  });

  it("solving a new topic recruits a hunter into a free bed", () => {
    const { store, v, ctx } = setup();
    const start = { ...v(), bld: { ...v().bld, inn: 3 }, seen: Object.fromEntries(Object.keys(topics).map(k => [k, 0])) };
    const seeded = review(start, ctx()).v;      // announce what's already trained
    toggleSolved(store, 704, NOW);              // binary search
    const { v: next, news } = review(seeded, ctx());
    expect(next.party).toContain("binary_search");
    expect(news.join()).toMatch(/Lyra the Scout joined/);
  });

  it("gear and buildings cost gold and respect the caps", () => {
    const { v, ctx } = setup();
    const c = ctx();
    const rich: VillageState = { ...v(), hunted: 1e6 };
    let s = rich;
    for (let i = 0; i < gearCap(rich); i++) { const r = buyGear(s, c.p, "dp", "w"); expect(r.ok).toBe(true); if (r.ok) s = r.v; }
    const capped = buyGear(s, c.p, "dp", "w");
    expect(capped.ok).toBe(false);
    const forge = buyBuilding(s, c.p, "forge");
    expect(forge.ok && buyGear(forge.v, c.p, "dp", "w").ok).toBe(true);
    expect(buyBuilding({ ...v(), hunted: 0, spent: 0 }, { ...c.p, da: [] }, "inn").ok).toBe(false);
  });

  it("boss fights are repeatable with a seed, cost food, and winning opens the next zone", () => {
    const { v, ctx } = setup();
    const c = ctx(), strong: VillageState = { ...v(), unlocked: 1, gear: { graphs: { w: 5, a: 5 }, dp: { w: 5, a: 5 }, hashing: { w: 5, a: 5 } } };
    const a = fightBoss(strong, c, mulberry32(7)), b = fightBoss(strong, c, mulberry32(7));
    expect(a).toEqual(b);
    if ("error" in a) throw new Error(a.error);
    expect(a.win).toBe(true);
    expect(a.v.unlocked).toBe(2);
    expect(a.v.bossReadyAt).toBe(0);
    expect(a.log.length).toBeGreaterThan(5);
  });

  it("win chance rises with power and drops for harder bosses", () => {
    const { v, ctx } = setup();
    const c = ctx(), p = partyUnits(v(), c), rnd = mulberry32(1);
    const weak = winChance(p.units, 6, 200, rnd), here = winChance(p.units, 2, 200, rnd);
    expect(here).toBeGreaterThan(weak);
    const geared = partyUnits({ ...v(), gear: { graphs: { w: 10, a: 10 }, dp: { w: 10, a: 10 }, hashing: { w: 10, a: 10 } } }, c);
    expect(winChance(geared.units, 4, 200, rnd)).toBeGreaterThan(winChance(p.units, 4, 200, rnd));
    expect(bossOf(3).hp).toBeGreaterThan(bossOf(2).hp);
  });
});

describe("endless progression", () => {
  /* A steady player for 300 days: 3 applications, 2 solves and a review a day, clears quests every
     other day. The village hunts, spends greedily, and fights the next boss when the odds are good.
     Zones must keep coming at a steady pace: no wall, no runaway. */
  it("keeps unlocking zones at a steady pace for months", () => {
    const store = new Store({ versioned: [NS.village], localOnly: [NS.sheet] });
    const pool = Object.values(topics).flatMap(t => t.problems.map(([n]) => n));
    let v = normalize({ born: "x", last: 1, bonusFood: 24 });
    const rnd = mulberry32(42), zoneOn: number[] = [];
    let solved = 0;
    for (let day = 0; day < 300; day++) {
      const now = new Date(2027, 0, 1 + day, 20);
      for (let a = 0; a < 3; a++) store.set(NS.status, `job-${day}-${a}`, { s: "applied", t: "x" });
      for (let k = 0; k < 2 && solved < pool.length; k++) toggleSolved(store, pool[solved++], now);
      Object.keys(snapshot(store, now).rev).slice(0, 1).forEach(n => store.set(NS.rev, n, { s: (store.get<{ s: number }>(NS.rev, n)?.s ?? 0) + 1, due: null }));
      if (day % 2) store.set(NS.clear, "d" + day, 1);
      const p = snapshot(store, now), ctx: Ctx = { p, topics, topicOf, cmd: 1.1 };
      v = { ...review(v, ctx).v };
      v = settle({ ...v, last: now.getTime() - 24 * 3600e3 }, ctx, now.getTime()).v;
      // spend: beds while there are hunters waiting, then the forge when gear is capped, then the cheapest gear
      for (let guard = 0; guard < 400; guard++) {
        const party = partyUnits(v, ctx);
        const bench = Object.keys(topics).filter(k => trainingOf(ctx, k) > 0 && !v.party.includes(k));
        if (bench.length && v.party.length < 2 + v.bld.inn) { v = { ...v, party: [...v.party, bench[0]] }; continue; }
        const buys: [number, () => ReturnType<typeof buyGear>][] = [];
        if (bench.length) buys.push([bldCost("inn", v.bld.inn), () => buyBuilding(v, p, "inn")]);
        party.units.forEach(u => (["w", "a"] as const).forEach(slot => {
          const lv = (v.gear[u.k] || { w: 0, a: 0 })[slot];
          buys.push(lv >= gearCap(v) ? [bldCost("forge", v.bld.forge), () => buyBuilding(v, p, "forge")] : [gearCost(lv), () => buyGear(v, p, u.k, slot)]);
        }));
        buys.sort((a, b) => a[0] - b[0]);
        const r = buys.length ? buys[0][1]() : null;
        if (!r || !r.ok) break;
        v = r.v;
      }
      for (let f = 0; f < 30; f++) {
        const party = partyUnits(v, ctx);
        if (winChance(party.units, v.unlocked, 40, rnd) < 0.5) break;
        const out = fightBoss({ ...v, bossReadyAt: 0 }, ctx, rnd, now.getTime());
        if ("error" in out) break;
        v = applyFight(v, v.unlocked, out.win, out.reward, party, now.getTime());
      }
      zoneOn.push(v.unlocked);
    }
    const gained = (a: number, b: number) => zoneOn[b] - zoneOn[a];
    if (process.env.SIM_LOG) console.log(zoneOn.filter((_, i) => i % 10 === 9).join(" "), "gold", Math.round(goldNow(v, snapshot(store))), "forge", v.bld.forge, "inn", v.bld.inn, "gear", JSON.stringify(v.gear).slice(0, 200), "party", v.party.length);
    expect(zoneOn[29]).toBeGreaterThanOrEqual(5);              // a good first month
    expect(gained(100, 199)).toBeGreaterThanOrEqual(8);        // still climbing months later
    expect(gained(200, 299)).toBeGreaterThanOrEqual(8);        // and later still: no wall
    expect(gained(200, 299)).toBeLessThanOrEqual(80);          // but no runaway either
    expect(gained(200, 299)).toBeLessThan(gained(100, 199));   // it slows gently instead
  }, 60_000);
});
