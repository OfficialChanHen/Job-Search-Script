import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Job, Topic } from "@/lib/data/types";
import { Store } from "@/lib/sync/store";
import { importLegacy } from "@/lib/sync/importLegacy";
import { checkProgress } from "./check";
import { NS, setStatus, snapshot, toggleSolved } from "./progress";

import {
  bossOf, buyBuilding, buyGear, buyGearMany, fillBeds, gearPlan, unitOf, beds, gearCap, applyFight, bldCost, gearCost, efficiency, fightBoss, foodLeft, goldNow, huntHours, newVillage, workGold, recordWage, matsNow, buyCosmetic, setLook, setTheme, craftTrophy, wageNow, payFor,
  normalize, partyUnits, raidState, review, settle, topicIndex, trainingOf, winChance, type Ctx, type VillageState,
} from "./village/engine";
import { localDay } from "./time";
import { fightRecap, mulberry32 } from "./village/sim";
import { applicationOf, pushToSheet, sheetRow } from "@/lib/jobs/sheet";
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

  // damage and HP changed on purpose (gear multiplies now, for endless progression), and hunting
  // gathers materials instead of gold now; food, gold on hand, training, hunting time and the world
  // boss still match the old page exactly
  it("gets the same food, gold, training and 3 hours of hunting", () => {
    const { store, v, ctx, stats } = setup();
    checkProgress(store, stats, NOW);
    const c = ctx(), p = partyUnits(v(), c);
    const training = Object.fromEntries(Object.keys(topics).map(k => [k, trainingOf(c, k)]).filter(([, n]) => n));
    expect(training).toEqual(expected.training);
    expect(foodLeft(v(), c.p)).toBeCloseTo(expected.before.food, 6);
    expect(goldNow(v(), c.p)).toBeCloseTo(expected.before.gold, 6);
    expect(efficiency(p, v().zone)).toBeCloseTo(expected.before.eff, 6);
    expect(huntHours(v(), c.p)).toBeCloseTo(expected.before.hunt, 6);
    const r = settle({ ...v(), last: NOW.getTime() - 3 * 3600e3 }, c, NOW.getTime());
    expect(r.h).toBeCloseTo(expected.settled.h, 6);
    expect(goldNow(r.v, c.p)).toBeCloseTo(expected.before.gold, 6);      // hunting no longer pays gold
    expect(r.mats.wood).toBeGreaterThan(0);
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

  it("buying several gear levels matches buying them one at a time, and previews show the gain", () => {
    const { v, ctx } = setup();
    const c = ctx(), rich: VillageState = { ...v(), hunted: 1e6 };
    const plan = gearPlan(rich, c.p, "dp", "w");
    expect(plan.n).toBe(gearCap(rich) - (rich.gear.dp?.w ?? 0));
    const many = buyGearMany(rich, c.p, "dp", "w", plan.n);
    let one = rich;
    for (let i = 0; i < plan.n; i++) { const r = buyGear(one, c.p, "dp", "w"); if (r.ok) one = r.v; }
    expect(many.ok && many.v).toEqual(one);
    expect(many.ok && many.v.spent - rich.spent).toBe(plan.cost);
    const now = unitOf(rich, c, "dp")!, next = unitOf(rich, c, "dp", { w: (rich.gear.dp?.w ?? 0) + 1 })!;
    expect(next.atk / now.atk).toBeCloseTo(1.08, 5);
    expect(next.hp).toBe(now.hp);
    expect(buyGearMany({ ...rich, hunted: 0, raidGold: 0, spent: 0 }, { ...c.p, da: [] }, "dp", "w", 3).ok).toBe(false);
  });

  it("fill empty beds puts the strongest resting hunters on duty", () => {
    const { v, ctx } = setup();
    const c = ctx(), roomy: VillageState = { ...v(), party: [], bld: { ...v().bld, inn: 20 } };
    const r = fillBeds(roomy, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.v.party.length).toBe(Math.min(beds(roomy), Object.keys(topics).filter(k => trainingOf(c, k) > 0).length));
    expect(fillBeds(r.v, c).ok).toBe(false);
  });

  it("the fight recap adds up to the fight log", () => {
    const { v, ctx } = setup();
    const c = ctx(), out = fightBoss({ ...v(), unlocked: 1 }, c, mulberry32(3));
    if ("error" in out) throw new Error(out.error);
    const units = partyUnits({ ...v(), unlocked: 1 }, c).units, rows = fightRecap(units, out.log);
    const dealt = out.log.reduce((a, e) => a + (e.a === "hit" ? e.dmg : 0), 0);
    expect(rows.reduce((a, r) => a + r.dealt, 0)).toBe(dealt);
    expect(rows.every(r => r.hits > 0)).toBe(true);           // every hunter lands blows
    expect(rows.every(r => r.taken <= units.find(u => u.k === r.k)!.hp + 1e-6)).toBe(true);
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

describe("gold comes only from real work", () => {
  it("hunting gathers materials but never gold", () => {
    const { v, ctx } = setup();
    const c = ctx(), start = { ...v(), bonusFood: 500 };
    const r = settle({ ...start, last: NOW.getTime() - 48 * 3600e3 }, c, NOW.getTime());
    expect(r.h).toBeGreaterThan(40);
    expect(goldNow(r.v, c.p)).toBeCloseTo(goldNow(start, c.p), 6);
    expect(r.v.hunted).toBe(start.hunted);                      // what hunting earned before stays, and stops growing
    expect(matsNow(r.v).wood).toBeGreaterThan(matsNow(start).wood);
  });

  it("each action pays its food hours in wages at that day's rate, and un-marking takes it back", () => {
    const store = new Store({ versioned: [NS.village], localOnly: [NS.sheet] });
    let v = normalize({ born: "2027-01-01", wageFrom: "" });
    const day1 = new Date(2027, 0, 1, 12), day2 = new Date(2027, 0, 2, 12);
    v = recordWage(v, localDay(day1));
    const w1 = wageNow(v);
    setStatus(store, "job-a", "applied", day1);
    toggleSolved(store, 1, day1);
    expect(workGold(v, snapshot(store, day1))).toBeCloseTo(w1 * (4 + 2), 6);
    // a raise later (a new zone) doesn't re-pay yesterday's work, but pays today's at the new rate
    v = recordWage({ ...v, unlocked: 3 }, localDay(day2));
    setStatus(store, "job-b", "applied", day2);
    const w2 = wageNow(v);
    expect(w2).toBeGreaterThan(w1);
    expect(workGold(v, snapshot(store, day2))).toBeCloseTo(w1 * 6 + w2 * 4, 6);
    setStatus(store, "job-a", "", day2);
    expect(workGold(v, snapshot(store, day2))).toBeCloseTo(w1 * 2 + w2 * 4, 6);
    expect(payFor(v).app).toBe(Math.round(4 * w2));
  });

  it("work from before the change was already paid through hunting, so it pays nothing again", () => {
    const { v, ctx } = setup();
    const old = normalize({ ...v(), wageFrom: undefined } as never);
    expect(old.wageFrom).toBe(localDay());
    expect(workGold(old, ctx().p)).toBe(0);
  });

  it("cosmetics cost materials, change no stats, and must be owned to use", () => {
    const { v, ctx } = setup();
    const c = ctx(), poor = { ...v(), mats: { wood: 0, stone: 0, gems: 0 }, matSpent: { wood: 0, stone: 0, gems: 0 } };
    expect(buyCosmetic(poor, "flowers").ok).toBe(false);
    expect(setLook(poor, "dp", "aura", "aura-gold").ok).toBe(false);
    expect(setTheme(poor, "night").ok).toBe(false);
    const rich = { ...poor, mats: { wood: 999, stone: 999, gems: 99 }, unlocked: 3 };
    const before = partyUnits(rich, c);
    let s = rich;
    for (const id of ["flowers", "aura-gold", "night"]) { const r = buyCosmetic(s, id); expect(r.ok).toBe(true); if (r.ok) s = r.v; }
    expect(s.theme).toBe("night");
    expect(matsNow(s).wood).toBe(999 - 8 - 50);
    const looked = setLook(s, "dp", "aura", "aura-gold");
    expect(looked.ok).toBe(true);
    if (looked.ok) s = looked.v;
    expect(buyCosmetic(s, "flowers").ok).toBe(false);          // already owned
    expect(partyUnits(s, c)).toEqual(before);                  // looks never change stats
    expect(goldNow(s, c.p)).toBeCloseTo(goldNow(rich, c.p), 6); // nor gold
    expect(craftTrophy(s, 3).ok).toBe(false);                  // zone 3's boss isn't beaten yet
    const t = craftTrophy(s, 1);
    expect(t.ok && t.v.trophies[1]).toBe(1);
  });

  it("beating a boss pays its one-time gold bonus and drops materials", () => {
    const { v, ctx } = setup();
    const c = ctx(), start = { ...v(), unlocked: 1 }, party = partyUnits(start, c);
    const won = applyFight(start, 1, true, 500, party);
    expect(goldNow(won, c.p) - goldNow(start, c.p)).toBeCloseTo(500, 6);
    expect(matsNow(won).gems).toBeGreaterThan(matsNow(start).gems);
    const again = applyFight(won, 1, true, 500, party);       // an old zone pays nothing twice
    expect(goldNow(again, c.p)).toBeCloseTo(goldNow(won, c.p), 6);
  });
});

describe("endless progression", () => {
  /* A steady player for 300 days: 3 applications, 2 solves and a review a day, clears quests every
     other day. The village hunts, spends greedily, and fights the next boss when the odds are good.
     Zones must keep coming at a steady pace: no wall, no runaway. */
  it("keeps unlocking zones at a steady pace for months", () => {
    const store = new Store({ versioned: [NS.village], localOnly: [NS.sheet] });
    const pool = Object.values(topics).flatMap(t => t.problems.map(([n]) => n));
    let v = normalize({ born: "x", last: 1, bonusFood: 24, wageFrom: "" });
    const rnd = mulberry32(42), zoneOn: number[] = [];
    let solved = 0;
    for (let day = 0; day < 300; day++) {
      const now = new Date(2027, 0, 1 + day, 20);
      for (let a = 0; a < 3; a++) store.set(NS.status, `job-${day}-${a}`, { s: "applied", t: localDay(now) });
      for (let k = 0; k < 2 && solved < pool.length; k++) toggleSolved(store, pool[solved++], now);
      Object.keys(snapshot(store, now).rev).slice(0, 1).forEach(n => store.set(NS.rev, n, { s: (store.get<{ s: number }>(NS.rev, n)?.s ?? 0) + 1, due: null }));
      if (day % 2) store.set(NS.clear, localDay(now), 1);
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

describe("sheet export", () => {
  it("writes your six columns, with where you applied in Application", () => {
    const j = { company: "Acme", title: "SWE", location: "Remote", url: "https://www.linkedin.com/jobs/view/1", direct: "" } as Job;
    expect(sheetRow(j, "Applied", "2026-10-20")).toEqual(["2026-10-20", "Acme", "SWE", "Remote", "Applied", "LinkedIn"]);
    expect(applicationOf({ url: "https://www.adzuna.com/details/5", direct: "https://boards.greenhouse.io/acme/1" })).toBe("Company website");
    expect(applicationOf({ url: "https://www.indeed.com/viewjob?jk=1" })).toBe("Indeed");
  });
});

describe("sheet sync", () => {
  it("posts the row with today's date, the job and where you applied", async () => {
    const fetch = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetch);
    const j = { id: "x1", company: "Acme", title: "SWE", location: "NYC", url: "https://www.indeed.com/viewjob?jk=1", jobType: "Full-time" } as Job;
    await pushToSheet("https://script.google.com/macros/s/abc/exec", j, undefined);
    vi.unstubAllGlobals();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ company: "Acme", title: "SWE", location: "NYC", status: "Applied", application: "Indeed" });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ignores sheet rows dated 2026-10-01 through 10-19, in either date format", () => {
    const store = new Store({ versioned: [NS.village], localOnly: [NS.sheet] });
    const rows = [{ date: "2026-09-30", company: "A" }, { date: "2026-10-01", company: "B" }, { date: "10/19/2026", company: "C" }, { date: "2026-10-20", company: "D" }];
    store.set(NS.sheet, "rows", { rows, at: 0 });
    expect(snapshot(store).sheetRows.map(r => r.company)).toEqual(["A", "D"]);
  });
});
