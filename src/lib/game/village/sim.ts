/* Boss fights: a deterministic-given-rnd simulation. The scene replays its log. */
import type { ClassKey, Quirk } from "./defs";

export interface Unit { k: string; cls: ClassKey; rank: number; row: "front" | "back"; atk: number; hp: number; spd: number; crit: number; cdmg: number }
export interface Boss { hp: number; atk: number; spd: number; quirk: Quirk }
export type FightEvent =
  | { t: number; a: "hit"; i: number; dmg: number; crit: boolean; miss: boolean; bhp: number; hp: number }
  | { t: number; a: "boss"; i: number; dmg: number; hp: number }
  | { t: number; a: "slam"; dmg: number; hps: number[] };

export function simulate(units: Unit[], boss: Boss, rnd: () => number, log?: FightEvent[]): { win: boolean; t: number; timeout?: boolean } {
  const us = units.map(u => ({ ...u, cur: u.hp, next: rnd() / u.spd * 0.6 }));
  const q = boss.quirk, limit = q === "enrage" ? 15 : 30, dt = 0.05, spdK = q === "frost" ? 0.7 : 1;
  let bhp = boss.hp, bnext = 1 / boss.spd, bn = 0, t = 0;
  const alive = () => us.filter(u => u.cur > 0);
  while (t < limit) {
    t += dt;
    if (q === "regen") bhp = Math.min(boss.hp, bhp + boss.hp * 0.025 * dt);
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.cur <= 0 || t < u.next) continue;
      u.next += 1 / (u.spd * spdK);
      const miss = q === "ghost" && u.cls !== "swift" && rnd() < 0.3;
      const crit = !miss && rnd() < u.crit;
      let dmg = miss ? 0 : u.atk * (crit ? u.cdmg : 1) * (0.9 + 0.2 * rnd());
      if (q === "armor" && !crit) dmg *= 0.6;
      bhp -= dmg;
      if (q === "thorns" && dmg) u.cur -= dmg * 0.2;
      log?.push({ t, a: "hit", i, dmg: Math.round(dmg), crit, miss, bhp: Math.max(0, bhp), hp: u.cur });
      if (bhp <= 0) return { win: true, t };
    }
    if (t >= bnext) {
      bnext += 1 / boss.spd; bn++;
      const live = alive();
      if (!live.length) return { win: false, t };
      if (bn % (q === "slam" ? 3 : 5) === 0) {
        live.forEach(u => { u.cur -= boss.atk * 0.6; });
        log?.push({ t, a: "slam", dmg: Math.round(boss.atk * 0.6), hps: us.map(u => u.cur) });
      } else {
        const front = live.filter(u => u.row === "front"), pool = front.length ? front : live;
        const tg = pool[Math.floor(rnd() * pool.length)], d = boss.atk * (0.9 + 0.2 * rnd());
        tg.cur -= d;
        log?.push({ t, a: "boss", i: us.indexOf(tg), dmg: Math.round(d), hp: tg.cur });
      }
      if (!alive().length) return { win: false, t };
    }
  }
  return { win: false, t, timeout: true };
}

/** Seeded random numbers, so tests and replays are repeatable. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
