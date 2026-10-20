/* ═══ 🏰 HUNTER VILLAGE — an idle game that only real work can feed ════
   Hunters are LeetCode topics. Solve a problem in a topic to recruit that
   hunter; more solves and spaced reviews rank it up (I to IV). Hunters on
   duty hunt by themselves, even while the app is closed, but they eat:
   food comes from applications, solves, reviews, outreach, follow-ups,
   cleared quests and DataAnnotation hours.
   Gold (for gear and buildings) only comes from that same real work: each
   action pays wages at the rate of the day you did it. Hunting never earns
   gold. It gathers wood, stone and gems, which only buy cosmetics. Food and
   gold are derived from real progress, so un-marking something takes both
   back. Each zone ends in a boss fight that plays out on its own.

   Every function here is pure: it takes a VillageState and returns a new
   one. The sync store relies on that to replay changes when another device
   wrote first.                                                          */
import type { Topic } from "@/lib/data/types";
import type { Progress } from "../progress";
import { DAY_MS, localDay, weekStart } from "../time";
import {
  BUILDINGS, CLASSES, FOOD, HUNTERS, LAP_NAMES, MARKET_STEP, MAT_KEYS, MAT_RATE, QUIRKS, RAID_BOSSES, RANK_AT, RANK_MULT, RANK_NAME, TRAITS, ZONES,
  cosmetic, trophyCost, type BuildingKey, type ClassKey, type CosKind, type HunterDef, type Mats, type Quirk, type TraitKey,
} from "./defs";
import { simulate, type Boss, type Unit } from "./sim";

export interface VillageState {
  born: string;
  last: number;                      // ms: hunting has been settled up to here
  eaten: number; bossFood: number; bonusFood: number;
  hunted: number;                    // gold hunting earned before it stopped paying gold (kept, never grows)
  raidGold: number; spent: number;
  wageFrom: string;                  // day real work started paying gold ("" = always); earlier work already paid through hunting
  wage: Record<string, number>;      // day → gold an hour of wages paid that day
  mats: Mats; matSpent: Mats;        // materials gathered by hunting, and spent on cosmetics
  cos: Record<string, 1>;            // cosmetics owned
  look: Record<string, { aura?: string; pennant?: string }>;
  theme: string;                     // "" = the village as it comes
  trophies: Record<string, 1>;       // zone number → trophy crafted
  party: string[];
  row: Record<string, "front" | "back">;
  gear: Record<string, { w: number; a: number }>;
  bld: Record<BuildingKey, number>;
  zone: number; unlocked: number;
  seen: Record<string, number>;      // rank last announced per hunter
  raids: Record<string, 1>;          // weeks whose chest was claimed
  raidNote: string;
  boss: { tries: number; wins: number };
  bossReadyAt?: number;              // ms: after a loss the boss can be fought again from here
}

/** Everything outside the village that the village reads. */
export interface Ctx {
  p: Progress;
  topics: Record<string, Topic>;
  topicOf: Record<string, string>;   // problem number → topic
  cmd: number;                       // 1 + 2% per XP level
}

const noMats = (): Mats => ({ wood: 0, stone: 0, gems: 0 });
export const emptyVillage = (): VillageState => ({
  born: "", last: 0, eaten: 0, bossFood: 0, bonusFood: 0, hunted: 0, raidGold: 0, spent: 0,
  wageFrom: "", wage: {}, mats: noMats(), matSpent: noMats(), cos: {}, look: {}, theme: "", trophies: {},
  party: [], row: {}, gear: {}, bld: { inn: 1, kitchen: 1, forge: 1, market: 1 },
  zone: 1, unlocked: 1, seen: {}, raids: {}, raidNote: "", boss: { tries: 0, wins: 0 },
});
/** Fill in fields an older save didn't have. */
export const normalize = (v: Partial<VillageState> | undefined): VillageState => {
  const e = emptyVillage();
  // a save from before work paid gold: work up to today was already paid through hunting
  const wageFrom = v?.wageFrom ?? (v?.born ? localDay() : "");
  return { ...e, ...v, wageFrom, bld: { ...e.bld, ...(v?.bld || {}) }, boss: { ...e.boss, ...(v?.boss || {}) },
           mats: { ...e.mats, ...(v?.mats || {}) }, matSpent: { ...e.matSpent, ...(v?.matSpent || {}) } } as VillageState;
};

export const hunterKeys = (topics: Record<string, Topic>) => Object.keys(HUNTERS).filter(k => topics[k]);
export const hunter = (k: string): HunterDef => ({ k, ...HUNTERS[k] });
export function topicIndex(topics: Record<string, Topic>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(topics).forEach(([t, x]) => x.problems.forEach(([n]) => { out[n] = t; }));
  return out;
}

export const beds = (v: VillageState) => 2 + v.bld.inn;
export const burnRate = (v: VillageState) => 1 / (1 + 0.25 * (v.bld.kitchen - 1));   // food per hour of hunting
export const gearOf = (v: VillageState, k: string) => v.gear[k] || { w: 0, a: 0 };
export const rowOf = (v: VillageState, k: string) => v.row[k] || (HUNTERS[k].cls === "guardian" ? "front" : "back");
export const bldCost = (b: BuildingKey, lv: number) => Math.round(BUILDINGS[b].base * Math.pow(BUILDINGS[b].g, lv - 1));
/* Gear multiplies (×1.08 a level) and each level costs ×1.12 more. Zone difficulty grows ×1.4 a zone
   but wages only ×1.3, so keeping up costs about a quarter more real work each zone (about 8× more
   per lap of 9): endless, slowing steadily, and paced by real work. */
export const GEAR_STEP = 1.08;
export const gearCost = (lv: number) => Math.round(10 * Math.pow(1.12, lv));
export const gearCap = (v: VillageState) => 8 * v.bld.forge;
export const rankOf = (c: number) => RANK_AT.filter(a => c >= a).length;

/** Solves plus reviews in a topic. */
export function trainingOf(ctx: Ctx, k: string): number {
  let c = 0;
  for (const n in ctx.p.solved) if (ctx.topicOf[n] === k) c += 1 + (ctx.p.rev[n]?.s || 0);
  return c;
}
export const trained = (ctx: Ctx, k: string) => trainingOf(ctx, k) > 0;

/* ── food and gold ─────────────────────────────────────────── */
const daMinutes = (p: Progress) => p.da.reduce((a, [, s]) => a + s.m, 0);
export function foodEarned(p: Progress): number {
  const apps = Object.values(p.status).filter(v => v.s === "applied").length;
  return apps * FOOD.app + Object.keys(p.solved).length * FOOD.solve + p.reviews * FOOD.review +
    Object.keys(p.outreach).length * FOOD.outreach +
    Object.values(p.followed).filter(f => f.how === "done").length * FOOD.followUp +
    Object.keys(p.clears).length * FOOD.questClear + daMinutes(p) / 60 * FOOD.daHour;
}
export const foodLeft = (v: VillageState, p: Progress) => foodEarned(p) + v.bonusFood - v.eaten - v.bossFood;
export const huntHours = (v: VillageState, p: Progress) => Math.max(0, foodLeft(v, p)) / burnRate(v);

/** Gold an hour of wages pays today: it grows with the zones you've opened, so pay keeps up with prices. */
export const wageNow = (v: VillageState) => Math.round(zoneNeed(v.unlocked).gph * (1 + MARKET_STEP * (v.bld.market - 1)));
/** Remember today's wage (the best seen today), so later raises don't re-pay old work. */
export function recordWage(v: VillageState, day: string): VillageState {
  const w = wageNow(v);
  return (v.wage[day] ?? 0) >= w ? v : { ...v, wage: { ...v.wage, [day]: w } };
}
/** Gold your real work has paid: each action is worth its food hours in wages, at its day's rate. */
export function workGold(v: VillageState, p: Progress): number {
  const now = wageNow(v);
  let g = 0;
  const pay = (day: string | undefined, hours: number) => {
    const d = day || "";
    if (v.wageFrom && d < v.wageFrom) return;
    g += hours * (v.wage[d] ?? now);
  };
  Object.values(p.status).forEach(x => { if (x.s === "applied") pay(x.t, FOOD.app); });
  Object.values(p.solved).forEach(d => pay(d, FOOD.solve));
  Object.entries(p.revDays).forEach(([d, n]) => pay(d, FOOD.review * n));
  Object.values(p.outreach).forEach(d => pay(d, FOOD.outreach));
  Object.values(p.followed).forEach(f => { if (f.how === "done") pay(f.d, FOOD.followUp); });
  Object.keys(p.clears).forEach(d => pay(d, FOOD.questClear));
  return g;
}
export const goldNow = (v: VillageState, p: Progress) =>
  v.hunted + v.raidGold + workGold(v, p) + p.da.reduce((a, [, s]) => a + (s.g || 0), 0) - v.spent;
/** Gold one of each real action pays today. */
export const payFor = (v: VillageState) => Object.fromEntries(Object.entries(FOOD).map(([k, h]) => [k, Math.round(h * wageNow(v))])) as Record<keyof typeof FOOD, number>;

/* ── materials (cosmetics only) ────────────────────────────── */
export const matsNow = (v: VillageState): Mats =>
  Object.fromEntries(MAT_KEYS.map(m => [m, Math.max(0, v.mats[m] - v.matSpent[m])])) as Mats;
export const canPay = (v: VillageState, cost: Partial<Mats>) => MAT_KEYS.every(m => matsNow(v)[m] >= (cost[m] ?? 0) - 1e-9);
const payMats = (v: VillageState, cost: Partial<Mats>): VillageState =>
  ({ ...v, matSpent: Object.fromEntries(MAT_KEYS.map(m => [m, v.matSpent[m] + (cost[m] ?? 0)])) as Mats });
/** Materials an hour of hunting gathers: better efficiency and harder zones gather more. */
export function matsPerHour(party: Party, z: number): Mats {
  const k = efficiency(party, z) * (1 + 0.1 * (z - 1));
  return Object.fromEntries(MAT_KEYS.map(m => [m, MAT_RATE[m] * k])) as Mats;
}
export const matsScore = (m: Mats) => m.wood + 1.5 * m.stone + 12 * m.gems;

/* ── party math ────────────────────────────────────────────── */
export const traitLv = (t: TraitKey, n: number) => TRAITS[t].at.filter(a => n >= a).length;
export const traitFx = (t: TraitKey, tc: Partial<Record<TraitKey, number>>) => {
  const lv = traitLv(t, tc[t] || 0);
  return lv ? TRAITS[t].fx[lv - 1] : 0;
};
export function traitCounts(party: string[]) {
  const tc: Partial<Record<TraitKey, number>> = {};
  party.forEach(k => { const h = HUNTERS[k]; tc[h.origin] = (tc[h.origin] || 0) + 1; tc[h.cls] = (tc[h.cls] || 0) + 1; });
  return tc;
}

export interface Party { units: Unit[]; tc: Partial<Record<TraitKey, number>>; dps: number; hp: number; power: number }
/** Average damage a second, counting crits. */
export const unitDps = (u: Unit) => u.atk * u.spd * (1 + u.crit * (u.cdmg - 1));

/** One hunter's stats as they'd stand in the party (joining it if they're resting).
    `what` asks "what if": other gear levels, or this much training. */
export function unitOf(v: VillageState, ctx: Ctx, k: string, what: { w?: number; a?: number; train?: number } = {}): Unit | undefined {
  const g = gearOf(v, k);
  const v2 = what.w !== undefined || what.a !== undefined ? { ...v, gear: { ...v.gear, [k]: { w: what.w ?? g.w, a: what.a ?? g.a } } } : v;
  const party = v.party.includes(k) ? v.party : [...v.party, k];
  return partyUnits(v2, ctx, party, what.train !== undefined ? { [k]: what.train } : {}).units.find(u => u.k === k);
}

/** Stats of a party. `over` asks "what if this topic had this much training?" */
export function partyUnits(v: VillageState, ctx: Ctx, party: string[] = v.party, over: Record<string, number> = {}): Party {
  const train = (k: string) => over[k] !== undefined ? over[k] : trainingOf(ctx, k);
  const members = party.filter(k => HUNTERS[k] && train(k) > 0);
  const tc = traitCounts(members);
  const units: Unit[] = members.map(k => {
    const h = HUNTERS[k], c = CLASSES[h.cls], r = rankOf(train(k)), g = gearOf(v, k);
    const fx = (t: TraitKey) => traitFx(t, tc);
    const m = RANK_MULT[r] * (1 + 0.25 * (h.tier - 1)) * ctx.cmd;
    return {
      k, cls: h.cls as ClassKey, rank: r, row: rowOf(v, k),
      atk: 22 * c.atk * m * Math.pow(GEAR_STEP, g.w) * (1 + fx("arrays") + (h.cls === "striker" ? fx("striker") : 0)),
      hp: 160 * c.hp * m * Math.pow(GEAR_STEP, g.a) * (1 + fx("structs") + (h.cls === "guardian" ? fx("guardian") : 0)),
      spd: 0.85 * c.spd * (1 + fx("text") + (h.cls === "swift" ? fx("swift") : 0)),
      crit: Math.min(0.9, 0.1 + c.crit + fx("recursion")),
      cdmg: 1.5 + (h.cls === "sniper" ? fx("sniper") : 0),
    };
  });
  const dps = units.reduce((a, u) => a + unitDps(u), 0);
  const hp = units.reduce((a, u) => a + u.hp, 0);
  return { units, tc, dps, hp, power: Math.round(Math.sqrt(dps * hp)) };
}

/* ── zones ─────────────────────────────────────────────────── */
/** Zones repeat in laps of 9. Each lap is harder and its boss brings a second trick. */
export function zoneDef(z: number) {
  const i = (z - 1) % ZONES.length, lap = Math.floor((z - 1) / ZONES.length);
  const suf = lap ? " " + (LAP_NAMES[lap] || String(lap + 1)) : "";
  const d = ZONES[i], extra = ZONES[(i + 3 + lap) % ZONES.length].boss.quirk;
  const quirks: Quirk[] = lap && extra !== d.boss.quirk ? [d.boss.quirk, extra] : [d.boss.quirk];
  return { z, lap, name: d.name + suf, boss: { name: d.boss.name + suf, quirks } };
}
/** What a zone asks of a party, and what it pays an efficient one per hour. */
export function zoneNeed(z: number) {
  const g = Math.pow(1.4, z - 1);
  return { dps: 25 * g, hp: 350 * g, gph: 24 * Math.pow(1.3, z - 1) };
}
export function bossOf(z: number): Boss & { z: number; name: string } {
  const d = zoneDef(z), n = zoneNeed(z);
  return { ...d.boss, z, hp: n.dps * 26, atk: n.hp * 0.08, spd: 0.7 };
}
/** Every boss has a good or bad day, but only a little: retrying can't carry a weak party. */
export const rollBoss = <B extends Boss>(b: B, rnd = Math.random): B =>
  ({ ...b, hp: b.hp * (0.88 + 0.24 * rnd()), atk: b.atk * (0.92 + 0.16 * rnd()) });

export function efficiency(party: Party, z: number) {
  if (!party.units.length) return 0;
  const n = zoneNeed(z);
  return Math.max(0.05, Math.pow(Math.min(1, party.dps / n.dps), 0.8) * Math.pow(Math.min(1, party.hp / n.hp), 0.5));
}
/** Gold-free: the Data trait now makes hunters gather more materials. */
export const matsBonus = (party: Party) => 1 + traitFx("data", party.tc);

/* ── time passing ──────────────────────────────────────────── */
export interface Settled { v: VillageState; hrs: number; h: number; mats: Mats; starved: number }
/** Hunt from v.last up to now, as long as there's food: hunters eat and gather materials. No gold. */
export function settle(v: VillageState, ctx: Ctx, now: number): Settled {
  v = recordWage(v, localDay(new Date(now)));
  if (!v.last || now <= v.last) return { v: { ...v, last: Math.max(v.last, now) }, hrs: 0, h: 0, mats: noMats(), starved: 0 };
  const hrs = (now - v.last) / 3600e3;
  const party = partyUnits(v, ctx);
  if (!party.units.length) return { v: { ...v, last: now }, hrs, h: 0, mats: noMats(), starved: 0 };
  const h = Math.max(0, Math.min(hrs, huntHours(v, ctx.p))), rate = matsPerHour(party, v.zone), bonus = matsBonus(party);
  const got = Object.fromEntries(MAT_KEYS.map(m => [m, h * rate[m] * bonus])) as Mats;
  const mats = Object.fromEntries(MAT_KEYS.map(m => [m, v.mats[m] + got[m]])) as Mats;
  return { v: { ...v, last: now, eaten: v.eaten + h * burnRate(v), mats }, hrs, h, mats: got, starved: hrs - h };
}

/** First visit: a day of food and your strongest hunters on duty. */
export function newVillage(ctx: Ctx, now: number): VillageState {
  const v = emptyVillage();
  const earned = foodEarned(ctx.p);
  v.born = localDay(new Date(now)); v.last = now;
  v.wageFrom = "";        // a new village: all real work pays gold
  v.eaten = Math.max(0, earned - 24);
  v.bonusFood = Math.max(0, 24 - earned);
  const keys = hunterKeys(ctx.topics);
  keys.forEach(k => { v.seen[k] = rankOf(trainingOf(ctx, k)); });
  const strength = (k: string) => RANK_MULT[rankOf(trainingOf(ctx, k))] * (1 + 0.25 * (HUNTERS[k].tier - 1));
  v.party = keys.filter(k => trained(ctx, k)).sort((a, b) => strength(b) - strength(a)).slice(0, beds(v));
  return v;
}

/** New recruits join empty beds; returns what to announce. */
export function review(v: VillageState, ctx: Ctx): { v: VillageState; news: string[] } {
  const party = v.party.filter((k, i, a) => HUNTERS[k] && trained(ctx, k) && a.indexOf(k) === i).slice(0, beds(v));
  const seen = { ...v.seen }, news: string[] = [];
  hunterKeys(ctx.topics).forEach(k => {
    const r = rankOf(trainingOf(ctx, k)), was = seen[k] || 0;
    if (r > was) {
      if (!was && party.length < beds(v)) party.push(k);
      const h = HUNTERS[k];
      news.push(was ? `${h.name} reached rank ${RANK_NAME[r]}.` : `${h.name} joined your village.`);
    }
    seen[k] = r;
  });
  return { v: { ...v, party, seen }, news };
}

/* ── player actions (each returns a new state, or an error to show) ── */
export type Result = { ok: true; v: VillageState } | { ok: false; error: string };

export function toggleDuty(v: VillageState, k: string): Result {
  if (v.party.includes(k)) return { ok: true, v: { ...v, party: v.party.filter(x => x !== k) } };
  if (v.party.length >= beds(v)) return { ok: false, error: `All ${beds(v)} beds are taken. Upgrade the Inn or bench someone first.` };
  return { ok: true, v: { ...v, party: [...v.party, k] } };
}
export function swapRow(v: VillageState, k: string): VillageState {
  return { ...v, row: { ...v.row, [k]: rowOf(v, k) === "front" ? "back" : "front" } };
}
export function buyGear(v: VillageState, p: Progress, k: string, slot: "w" | "a"): Result {
  const g = gearOf(v, k), lv = g[slot], cap = gearCap(v), cost = gearCost(lv);
  if (lv >= cap) return { ok: false, error: `Gear is capped at level ${cap}. Upgrade the Forge to go higher.` };
  if (goldNow(v, p) < cost) return { ok: false, error: `You need ${cost.toLocaleString()} gold for that` };
  return { ok: true, v: { ...v, spent: v.spent + cost, gear: { ...v.gear, [k]: { ...g, [slot]: lv + 1 } } } };
}
/** How many gear levels you can afford in a row (up to n), and what they cost together. */
export function gearPlan(v: VillageState, p: Progress, k: string, slot: "w" | "a", n = Infinity) {
  const cap = gearCap(v), gold = goldNow(v, p);
  let lv = gearOf(v, k)[slot], cost = 0, count = 0;
  while (count < n && lv < cap && gold - cost >= gearCost(lv)) { cost += gearCost(lv); lv++; count++; }
  return { n: count, cost };
}
export function buyGearMany(v: VillageState, p: Progress, k: string, slot: "w" | "a", n: number): Result {
  let cur = v;
  for (let i = 0; i < n; i++) {
    const r = buyGear(cur, p, k, slot);
    if (!r.ok) { if (!i) return r; break; }
    cur = r.v;
  }
  return { ok: true, v: cur };
}
/** Fill empty beds with the strongest resting hunters. */
export function fillBeds(v: VillageState, ctx: Ctx): Result {
  const free = beds(v) - v.party.length;
  const bench = hunterKeys(ctx.topics).filter(k => trained(ctx, k) && !v.party.includes(k));
  if (free <= 0) return { ok: false, error: "Every bed is taken" };
  if (!bench.length) return { ok: false, error: "Nobody is resting. Solve a problem in a new topic to recruit someone." };
  const power = (k: string) => { const u = unitOf(v, ctx, k); return u ? unitDps(u) * u.hp : 0; };
  return { ok: true, v: { ...v, party: [...v.party, ...bench.sort((a, b) => power(b) - power(a)).slice(0, free)] } };
}
export function buyBuilding(v: VillageState, p: Progress, b: BuildingKey): Result {
  const lv = v.bld[b];
  if (lv >= BUILDINGS[b].max) return { ok: false, error: "Already at max level" };
  const cost = bldCost(b, lv);
  if (goldNow(v, p) < cost) return { ok: false, error: `You need ${cost.toLocaleString()} gold for that` };
  return { ok: true, v: { ...v, spent: v.spent + cost, bld: { ...v.bld, [b]: lv + 1 } } };
}
export function pickZone(v: VillageState, z: number): VillageState {
  return z <= v.unlocked ? { ...v, zone: z } : v;
}

/** What a zone boss drops the first time you beat it, besides its gold bonus. */
export const bossLoot = (z: number): Mats => ({ wood: 10 + 4 * z, stone: 8 + 3 * z, gems: 2 + Math.floor(z / 2) });
const addMats = (a: Mats, b: Mats): Mats => Object.fromEntries(MAT_KEYS.map(m => [m, a[m] + b[m]])) as Mats;

export interface FightOutcome { v: VillageState; boss: ReturnType<typeof bossOf>; log: import("./sim").FightEvent[]; win: boolean; timeout: boolean; t: number; reward: number }
export const BOSS_COOLDOWN_MS = 60 * 60_000;
/** Gold for beating a zone boss the first time: an hour of that zone's wages. */
export const bossReward = (z: number) => Math.round(zoneNeed(z).gph);
/** Fight the frontier boss. Free; after a loss it can be tried again in an hour. Winning opens the next zone. */
export function fightBoss(v: VillageState, ctx: Ctx, rnd = Math.random, now = Date.now()): FightOutcome | { error: string } {
  const party = partyUnits(v, ctx);
  if (!party.units.length) return { error: "Put at least one hunter on duty first" };
  if (v.bossReadyAt && now < v.bossReadyAt) return { error: `The boss is resting. Try again in ${Math.ceil((v.bossReadyAt - now) / 60_000)} min.` };
  const z = v.unlocked, boss = rollBoss(bossOf(z), rnd), log: import("./sim").FightEvent[] = [];
  const res = simulate(party.units, boss, rnd, log);
  let next: VillageState = { ...v, boss: { tries: v.boss.tries + 1, wins: v.boss.wins + (res.win ? 1 : 0) }, bossReadyAt: res.win ? 0 : now + BOSS_COOLDOWN_MS };
  let reward = 0;
  if (res.win) {
    reward = bossReward(z);
    next = { ...next, unlocked: z + 1, raidGold: next.raidGold + reward, mats: addMats(next.mats, bossLoot(z)) };
    // move up when it pays better
    if (matsScore(matsPerHour(party, z + 1)) >= matsScore(matsPerHour(party, v.zone))) next.zone = z + 1;
  }
  return { v: next, boss, log, win: res.win, timeout: !!res.timeout, t: res.t, reward };
}

/** Apply a fight's result to any copy of the village (used when replaying after a sync conflict). */
export function applyFight(v: VillageState, z: number, win: boolean, reward: number, party: Party, now = Date.now()): VillageState {
  let next: VillageState = { ...v, boss: { tries: v.boss.tries + 1, wins: v.boss.wins + (win ? 1 : 0) }, bossReadyAt: win ? 0 : now + BOSS_COOLDOWN_MS };
  if (win && v.unlocked <= z) {
    next = { ...next, unlocked: z + 1, raidGold: next.raidGold + reward, mats: addMats(next.mats, bossLoot(z)) };
    if (matsScore(matsPerHour(party, z + 1)) >= matsScore(matsPerHour(party, v.zone))) next.zone = z + 1;
  }
  return next;
}

/* ── cosmetics: bought with materials, never change stats ── */
export function buyCosmetic(v: VillageState, id: string): Result {
  const c = cosmetic(id);
  if (!c) return { ok: false, error: "Unknown item" };
  if (v.cos[id]) return { ok: false, error: "You already have that" };
  if (!canPay(v, c.cost)) return { ok: false, error: `You need ${costText(c.cost)} for that` };
  const next = { ...payMats(v, c.cost), cos: { ...v.cos, [id]: 1 as const } };
  return { ok: true, v: c.kind === "theme" ? { ...next, theme: id } : next };
}
export function setTheme(v: VillageState, id: string): Result {
  if (id && (cosmetic(id)?.kind !== "theme" || !v.cos[id])) return { ok: false, error: "Buy that theme first" };
  return { ok: true, v: { ...v, theme: id } };
}
export function setLook(v: VillageState, k: string, slot: Extract<CosKind, "aura" | "pennant">, id: string): Result {
  if (id && (cosmetic(id)?.kind !== slot || !v.cos[id])) return { ok: false, error: "Buy that look first" };
  const cur = { ...(v.look[k] || {}) };
  if (id) cur[slot] = id; else delete cur[slot];
  return { ok: true, v: { ...v, look: { ...v.look, [k]: cur } } };
}
export function craftTrophy(v: VillageState, z: number): Result {
  if (z >= v.unlocked) return { ok: false, error: "Beat that boss first" };
  if (v.trophies[z]) return { ok: false, error: "That trophy is already on the shelf" };
  const cost = trophyCost(z);
  if (!canPay(v, cost)) return { ok: false, error: `You need ${costText(cost)} for that` };
  return { ok: true, v: { ...payMats(v, cost), trophies: { ...v.trophies, [z]: 1 } } };
}
const MAT_WORD: Record<keyof Mats, string> = { wood: "wood", stone: "stone", gems: "gems" };
export const costText = (cost: Partial<Mats>) => MAT_KEYS.filter(m => cost[m]).map(m => `${cost[m]} ${MAT_WORD[m]}`).join(" and ");

/* ── win chance (memoized: it's a Monte Carlo estimate) ────── */
const winMemo = new Map<string, number>();
export function winChance(units: Unit[], z: number, n = 80, rnd = Math.random): number {
  if (!units.length) return 0;
  const key = z + "|" + units.map(u => [u.k, u.row, Math.round(u.atk), Math.round(u.hp), u.spd.toFixed(2), u.crit.toFixed(2), u.cdmg].join(",")).join(";");
  const hit = winMemo.get(key);
  if (hit !== undefined) return hit;
  const boss = bossOf(z);
  let w = 0;
  for (let i = 0; i < n; i++) if (simulate(units, rollBoss(boss, rnd), rnd).win) w++;
  if (winMemo.size > 400) winMemo.clear();
  winMemo.set(key, w / n);
  return w / n;
}

/* ── what real work would help most right now ─────────────── */
export function nextProblem(ctx: Ctx, k: string) {
  const ps = ctx.topics[k].problems;
  const fresh = ps.find(([n]) => !ctx.p.solved[n]);
  if (fresh) return { n: fresh[0], name: fresh[1], url: fresh[2], review: false };
  const due = ps.filter(([n]) => ctx.p.rev[n]?.due).sort((a, b) => ctx.p.rev[a[0]].due!.localeCompare(ctx.p.rev[b[0]].due!))[0];
  return due ? { n: due[0], name: due[1], url: due[2], review: true } : null;
}
/** The first boss you can't reliably beat yet: that's what training should aim at. */
export function hintZone(v: VillageState, party: Party) {
  let z = v.unlocked;
  while (z < v.unlocked + 3 && winChance(party.units, z) >= 0.9) z++;
  return z;
}
export interface Hint { k: string; text: string; dw: number; prob?: ReturnType<typeof nextProblem>; bench?: boolean }
export function powerHints(v: VillageState, ctx: Ctx): Hint[] {
  const base = partyUnits(v, ctx), z = hintZone(v, base), w0 = winChance(base.units, z);
  const gain = (p: Party) => ({ dw: winChance(p.units, z) - w0 });
  const out: Hint[] = [];
  v.party.forEach(k => {
    const c = trainingOf(ctx, k), r = rankOf(c);
    if (r >= RANK_AT.length) return;
    const need = RANK_AT[r] - c, h = HUNTERS[k], label = ctx.topics[k].label;
    out.push({ k, ...gain(partyUnits(v, ctx, v.party, { [k]: RANK_AT[r] })), prob: nextProblem(ctx, k),
      text: `${need} more ${label} ${need > 1 ? "solves or reviews" : "solve or review"} ranks ${h.name} up to ${RANK_NAME[r + 1]}` });
  });
  const free = v.party.length < beds(v);
  const weakest = base.units.slice().sort((a, b) => a.atk * a.hp - b.atk * b.hp)[0];
  hunterKeys(ctx.topics).filter(k => !trained(ctx, k)).forEach(k => {
    const party = free ? [...v.party, k] : v.party.map(x => x === weakest?.k ? k : x);
    const p = partyUnits(v, ctx, party, { [k]: 1 });
    const h = HUNTERS[k];
    const newTrait = ([h.origin, h.cls] as TraitKey[]).find(t => traitLv(t, p.tc[t] || 0) > traitLv(t, base.tc[t] || 0));
    out.push({ k, ...gain(p), prob: nextProblem(ctx, k),
      text: `Solve one ${ctx.topics[k].label} problem to recruit ${h.name}` +
        (newTrait ? `. That turns on ${TRAITS[newTrait].name}` : "") +
        (!free && weakest ? ` (swap out ${HUNTERS[weakest.k].name})` : "") });
  });
  const bench = hunterKeys(ctx.topics).filter(k => trained(ctx, k) && !v.party.includes(k));
  if (free && bench.length) out.push({ k: bench[0], dw: 1, bench: true, text: `You have an empty bed. Put ${HUNTERS[bench[0]].name} on duty, it's free.` });
  return out.filter(h => h.dw > 0.004).sort((a, b) => b.dw - a.dw).slice(0, 4);
}

/* ── weekly world boss: only real work damages it ──────────── */
export function raidState(v: VillageState, p: Progress, now: Date = new Date()) {
  const wk = weekStart(now), inWk = (iso: string | undefined) => !!iso && iso >= wk;
  const perDay = (m: Record<string, number>) => Object.entries(m).filter(([d]) => inWk(d)).reduce((a, [, n]) => a + n, 0);
  const parts: [string, number, number, string][] = [
    ["Applications", 10, Object.values(p.status).filter(x => x.s === "applied" && inWk(x.t)).length, "var(--good-mark)"],
    ["LeetCode solves", 8, Object.values(p.solved).filter(inWk).length, "var(--series-1)"],
    ["Reviews", 4, perDay(p.revDays), "#8b5cf6"],
    ["Outreach and follow-ups", 6, perDay(p.outDays) + perDay(p.fuDays), "#eb6834"],
    ["Daily quests cleared", 10, Object.keys(p.clears).filter(inWk).length, "#e87ba4"],
    ["DataAnnotation half-hours", 3, Math.floor(p.da.filter(([, s]) => inWk(s.d)).reduce((a, [, s]) => a + s.m, 0) / 30), "var(--warn)"],
  ];
  const prior = Object.keys(v.raids).filter(w => w < wk).length;
  const hp = Math.round(220 * Math.pow(1.15, prior));
  const dmg = parts.reduce((a, x) => a + x[1] * x[2], 0);
  const idx = Math.floor(new Date(wk + "T12:00:00").getTime() / (7 * DAY_MS)) % RAID_BOSSES.length;
  return { week: wk, parts, hp, dmg, boss: RAID_BOSSES[idx], claimed: !!v.raids[wk] };
}
export function claimRaid(v: VillageState, p: Progress, now: Date = new Date()): Result {
  const R = raidState(v, p, now);
  if (R.dmg < R.hp) return { ok: false, error: "The boss isn't down yet" };
  if (R.claimed) return { ok: false, error: "Already claimed this week" };
  const gold = Math.round(zoneNeed(v.unlocked).gph * 6);
  return { ok: true, v: { ...v, raids: { ...v.raids, [R.week]: 1 }, raidGold: v.raidGold + gold, bonusFood: v.bonusFood + 8 } };
}

/** Gold per hour of DataAnnotation: one hour of wages. */
export const daWage = (v: VillageState) => wageNow(v);
export const quirkInfo = (q: Quirk) => QUIRKS[q];
export { RANK_NAME };
