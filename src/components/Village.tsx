"use client";
import { useEffect, useRef, useState } from "react";
import { confetti, floatText, toast } from "@/lib/client/effects";
import { getScene } from "@/lib/client/scene";
import { faceUrl } from "@/lib/client/sprites";
import { logDA, setDARate } from "@/lib/game/da";
import { NS } from "@/lib/game/progress";
import { localDay, weekStart } from "@/lib/game/time";
import {
  BUILDINGS, CLASSES, COSMETICS, COS_KINDS, MATS, MAT_KEYS, RANK_AT, RANK_NAME, TIER_NAME, TRAITS, HUNTERS, armorFor, cosmetic, trophyCost, weaponFor,
  type BuildingKey, type CosDef, type CosKind, type Mats, type TraitKey,
} from "@/lib/game/village/defs";
import {
  applyFight, beds, bossLoot, burnRate, gearCap, bldCost, bossOf, buyBuilding, buyGearMany, claimRaid, daWage, efficiency, fightBoss, fillBeds, foodLeft, gearCost, gearOf,
  buyCosmetic, canPay, craftTrophy, matsBonus, matsNow, matsPerHour, payFor, setLook, setTheme,
  gearPlan, goldNow, hintZone, huntHours, hunterKeys, normalize, partyUnits, pickZone, powerHints, quirkInfo, raidState, rankOf, rowOf,
  settle, swapRow, toggleDuty, trained, trainingOf, traitLv, unitDps, unitOf, winChance, zoneDef, type Party, type Result, type VillageState,
} from "@/lib/game/village/engine";
import { fightRecap, type RecapRow, type Unit } from "@/lib/game/village/sim";
import { useGame, type Game } from "./GameContext";
import { Icon } from "./Icon";

import { fmtHrs, fmtN, holdFight, releaseFight, toggleDA, useLiveVillage, useScene } from "./GamePanel";
import { fmtClock, useNow } from "./useNow";
import { useUi } from "./UiContext";

const pct = (x: number) => Math.round(x * 100) + "%";
const hpCol = (f: number) => f > 0.6 ? "var(--teal)" : f > 0.3 ? "var(--ochre)" : "var(--brick)";
interface Recap { win: boolean; timeout: boolean; t: number; name: string; rows: RecapRow[] }
/** Hunters in the order the village lists them: on duty, resting, not recruited. */
function rosterOrder(g: Game, live: VillageState) {
  const keys = hunterKeys(g.data.topics);
  const party = live.party.filter(k => HUNTERS[k] && trained(g.ctx, k));
  return [...party, ...keys.filter(k => trained(g.ctx, k) && !party.includes(k)), ...keys.filter(k => !trained(g.ctx, k))];
}

/** Write a village change: settle first, then apply. Replayed on top of another device's copy if needed. */
function mutateVillage(g: Game, fn: (v: VillageState) => VillageState) {
  g.store.mutate<VillageState>(NS.village, "state", cur => fn(settle(normalize(cur), g.ctx, Date.now()).v));
}
function act(g: Game, live: VillageState, fn: (v: VillageState) => Result, after?: () => void) {
  const r = fn(live);
  if (!r.ok) return toast(r.error, true);
  mutateVillage(g, v => { const x = fn(v); return x.ok ? x.v : v; });
  after?.();
}

/* ═══ the village window ═══ */
export function VillageWindow() {
  const g = useGame();
  const { vil, setVil, setQp } = useUi();
  const now = useNow(1000);
  const live = useLiveVillage(g, now);
  const host = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const [recap, setRecap] = useState<Recap | null>(null);
  useScene(g, live, host, vil !== null);
  useEffect(() => { getScene().select(vil || ""); }, [vil]);
  useEffect(() => {
    if (vil === null) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVil(null); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [vil, setVil]);
  if (vil === null || !live) return null;
  const p = partyUnits(live, g.ctx), fed = huntHours(live, g.p) > 0;
  const doing = getScene().actions(), vitals = getScene().vitals();
  const sel = vil;
  const select = (k: string) => setVil(sel === k ? "" : k);
  const fight = () => {
    if (getScene().fighting) return;
    const out = fightBoss(live, g.ctx);
    if ("error" in out) return toast(out.error, true);
    const party = p, z = live.unlocked;
    holdFight(live, out.reward, out.win ? bossLoot(z) : { wood: 0, stone: 0, gems: 0 });
    mutateVillage(g, v => applyFight(v, z, out.win, out.reward, party));
    host.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const rows = fightRecap(p.units, out.log);
    getScene().playFight(p.units, { name: out.boss.name, hp: out.boss.hp, z }, out.log, out, () => {
      releaseFight();
      setRecap({ win: out.win, timeout: out.timeout, t: out.t, name: out.boss.name, rows });
      if (out.win) { toast(`You beat ${out.boss.name}. ${zoneDef(z + 1).name} is open, and you found ${fmtN(out.reward)} gold.`); confetti(120); }
      else toast(out.timeout ? `Time ran out against ${out.boss.name}. See "Get stronger" for what helps most.` : `${out.boss.name} won this time. See "Get stronger" for what helps most.`);
      force(x => x + 1);
    });
  };
  return (
    <div className="vil" role="dialog" aria-modal="true" aria-label="Your hunter village" onClick={e => { if (e.target === e.currentTarget) setVil(null); }}>
      <div className="vil-box">
        <div className="vil-top">
          <div className="vil-res">
            {[["Gold", fmtN(goldNow(live, g.p)), ""], ["Food left", fed ? fmtHrs(huntHours(live, g.p)) : "None", fed ? "" : "low"],
              ["Materials", <span key="m" className="mats-row">{MAT_KEYS.map(m => <span key={m} title={MATS[m].name}><Icon id={MATS[m].sprite} size={18} />{fmtN(matsNow(live)[m])}</span>)}</span>, ""], ["Party power", fmtN(p.power), ""]].map(([l, v, c]) =>
              <div key={String(l)}><div className="l">{l}</div><div className={"v " + c}>{v}</div></div>)}
          </div>
          <div className="vil-top-side">
            <HitmarkerToggle />
            <button className="mini" onClick={() => setVil(null)}>Close</button>
          </div>
        </div>
        <div className="vscene big" ref={host} />
        <div className="vil-grid">
          <div className="vil-col">
            {sel && HUNTERS[sel] && <HunterDetail g={g} live={live} k={sel} doing={doing[sel]} vital={vitals[sel]} close={() => setVil("")} go={k => setVil(k)} />}
            <HuntersCard g={g} live={live} p={p} sel={sel} select={select} doing={doing} vitals={vitals} />
          </div>
          <div className="vil-col">
            <Grounds g={g} live={live} p={p} onFight={fight} now={now} recap={recap} />
            <Hints g={g} live={live} openQp={() => { setVil(null); setQp(true); }} close={() => setVil(null)} />
            <Buildings g={g} live={live} p={p} />
            <Workshop g={g} live={live} />
            <Trophies g={g} live={live} />
            <Raid g={g} live={live} />
            <DACard g={g} live={live} now={now} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HunterCard({ g, live, k, sel, select, doing, vital }: { g: Game; live: VillageState; k: string; sel: string; select: (k: string) => void; doing?: string; vital?: number }) {
  const h = HUNTERS[k], c = trainingOf(g.ctx, k), r = rankOf(c), duty = live.party.includes(k), label = g.data.topics[k].label;
  const u = c ? unitOf(live, g.ctx, k) : undefined;
  const canUp = !!c && (gearPlan(live, g.p, k, "w", 1).n > 0 || gearPlan(live, g.p, k, "a", 1).n > 0);
  if (!c) return (
    <button className={"hcard locked" + (sel === k ? " sel" : "")} onClick={() => select(k)} title={`Solve any ${label} problem to recruit`}>
      <span className={`tier tier${h.tier}`} /><Icon id={"hunter:" + k} /><div className="nm">{h.name}</div><div className="rk">Trains on {label}</div>
    </button>);
  return (
    <button className={"hcard" + (duty ? " duty" : "") + (sel === k ? " sel" : "")} onClick={() => select(k)} title={`${h.name}, ${CLASSES[h.cls].name}`}>
      <span className={`tier tier${h.tier}`} />{duty && <span className="rowtag">{rowOf(live, k) === "front" ? "FRONT" : "BACK"}</span>}
      {canUp && <span className="upbadge" title="You have the gold for a gear upgrade">UP</span>}
      <div className="face-gear"><Icon id={"hunter:" + k} /><GearIcon cls={h.cls} lv={gearOf(live, k).w} rim={armorFor(gearOf(live, k).a).color} /></div>
      <div className="nm">{h.name}</div><div className="rk">Rank {RANK_NAME[r]}, {label}</div>
      {u && <div className="hstats"><span title="Damage per hit">Dmg <b>{fmtN(u.atk)}</b></span><span title="Max HP">HP <b>{fmtN(u.hp)}</b></span></div>}
      {duty && vital !== undefined && <div className="hpmini" title={`Health in the field: ${pct(vital)}`}><div style={{ width: pct(vital), background: hpCol(vital) }} /></div>}
      {doing && <div className="doing">{doing}</div>}
      <div className="pips">{[1, 2, 3, 4].map(i => <i key={i} className={i <= r ? "on" : ""} />)}</div>
    </button>);
}

function HuntersCard({ g, live, p, sel, select, doing, vitals }: { g: Game; live: VillageState; p: Party; sel: string; select: (k: string) => void; doing: Record<string, string>; vitals: Record<string, number> }) {
  const keys = hunterKeys(g.data.topics);
  const party = live.party.filter(k => HUNTERS[k] && trained(g.ctx, k));
  const bench = keys.filter(k => trained(g.ctx, k) && !party.includes(k)), locked = keys.filter(k => !trained(g.ctx, k));
  const traits = (Object.entries(TRAITS) as [TraitKey, typeof TRAITS[TraitKey]][]).map(([t, T]) => {
    const n = p.tc[t] || 0, lv = traitLv(t, n);
    if (!n) return null;
    const next = T.at.find(a => a > n);
    const tip = (lv ? T.what.replace("{}", pct(T.fx[lv - 1])) : `Needs ${T.at[0]} on duty`) + (next ? `. Next level at ${next}.` : "");
    return <span key={t} className={"trait" + (lv ? " on" : "")} title={tip}>{T.name} {n}/{next || T.at[T.at.length - 1]}</span>;
  }).filter(Boolean);
  return (
    <div className="vcard"><h3>On duty <span>{party.length} of {beds(live)} beds
        {party.length < beds(live) && bench.length > 0 && <> <button className="mini primary" onClick={() => act(g, live, v => fillBeds(v, g.ctx), () => toast("Your strongest resting hunters are on duty"))}>Fill empty beds</button></>}</span></h3>
      <div className="lead" style={{ marginTop: -4 }}>Click a hunter here or on the map to see their stats and upgrades. Click a monster on the map to send hunters after it.</div>
      <div className="hgrid">
        {party.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} doing={doing[k]} vital={vitals[k]} />)}
        {Array.from({ length: Math.max(0, beds(live) - party.length) }, (_, i) => <div key={i} className="empty-bed">Empty bed</div>)}
      </div>
      <div className="traits">{traits.length ? traits : <span className="lead">Hunters who share a trait boost each other. Hover a trait to see what it does.</span>}</div>
      {bench.length > 0 && <><h4>Resting in the village</h4><div className="hgrid">{bench.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} />)}</div></>}
      {locked.length > 0 && <><h4>Not recruited yet. Solve one problem in the topic to recruit them.</h4>
        <div className="hgrid">{locked.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} />)}</div></>}
    </div>
  );
}

type StatRow = [string, (x: Unit) => number, (n: number) => string];
const STAT_ROWS: StatRow[] = [
  ["Damage per hit", x => x.atk, fmtN], ["Max HP", x => x.hp, fmtN], ["Attacks a second", x => x.spd, n => n.toFixed(2)],
  ["Crit chance", x => x.crit, pct], ["Damage a second", unitDps, fmtN],
];
/** The change an upgrade would make to one stat: "+12" in green, or "same". */
function Delta({ now, next, f, fmt }: { now: Unit; next?: Unit; f: (x: Unit) => number; fmt: (n: number) => string }) {
  if (!next) return <span className="nochg">n/a</span>;
  const d = f(next) - f(now);
  return Math.abs(d) < 1e-6 ? <span className="nochg">same</span> : <span className="up">+{fmt(d)}</span>;
}

function HunterDetail({ g, live, k, close, go, doing, vital }: { g: Game; live: VillageState; k: string; close: () => void; go: (k: string) => void; doing?: string; vital?: number }) {
  const h = HUNTERS[k], C = CLASSES[h.cls], c = trainingOf(g.ctx, k), r = rankOf(c), duty = live.party.includes(k);
  const u = unitOf(live, g.ctx, k);
  const gear = gearOf(live, k), cap = gearCap(live), gold = goldNow(live, g.p), nextAt = RANK_AT[r];
  const today = localDay();
  const order = rosterOrder(g, live), at = order.indexOf(k);
  const step = (d: number) => go(order[(at + d + order.length) % order.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const solve = (n: number) => import("@/lib/game/progress").then(m => {
    const on = m.toggleSolved(g.store, n);
    floatText(on ? "+20 XP" : "-20 XP", on ? undefined : "var(--ink-3)");
    if (on) floatText("+2h food", "var(--warn)", 22);
  });
  // what each upgrade would do: this hunter's stats, and the party's odds against the frontier boss
  const next = {
    w: gear.w < cap ? unitOf(live, g.ctx, k, { w: gear.w + 1 }) : undefined,
    a: gear.a < cap ? unitOf(live, g.ctx, k, { a: gear.a + 1 }) : undefined,
    r: c && nextAt ? unitOf(live, g.ctx, k, { train: nextAt }) : undefined,
  };
  const z = live.unlocked, odds = (v: VillageState, over: Record<string, number> = {}) => winChance(partyUnits(v, g.ctx, live.party, over).units, z);
  const withGear = (slot: "w" | "a") => ({ ...live, gear: { ...live.gear, [k]: { ...gear, [slot]: gear[slot] + 1 } } });
  const win = duty && c ? { now: odds(live), w: next.w ? odds(withGear("w")) : 0, a: next.a ? odds(withGear("a")) : 0, r: next.r ? odds(live, { [k]: nextAt }) : 0 } : null;
  const gearRow = (slot: "w" | "a", what: string) => {
    const lv = gear[slot], one = gearCost(lv), many = gearPlan(live, g.p, k, slot), after = slot === "w" ? next.w : next.a;
    const buy = (n: number) => act(g, live, v => buyGearMany(v, g.p, k, slot, n), () => {
      floatText(`+${n} ${slot === "w" ? "weapon" : "armor"} level${n > 1 ? "s" : ""}`, "var(--teal-text)"); getScene().celebrate(k);
    });
    const gain = u && after ? (slot === "w" ? `+${fmtN(after.atk - u.atk)} damage per hit` : `+${fmtN(after.hp - u.hp)} max HP`) : "";
    return <>
      <span className="gear-name"><GearIcon cls={h.cls} lv={slot === "w" ? lv : 0} rim={slot === "a" ? armorFor(lv).color || "var(--border2)" : ""} armor={slot === "a"} />
        <span><b>{slot === "w" ? weaponFor(h.cls, lv)[1] : armorFor(lv).name}</b>, level {lv} of {cap}<br />
          <span className="sub2">{gain ? <>Next level: <span className="up">{gain}</span></> : what}</span></span></span>
      <span className="gear-btns">
        {lv >= cap ? <button className="mini" disabled title="Upgrade the Forge">Max for Forge {live.bld.forge}</button>
          : <button className={"mini" + (gold >= one ? " primary" : "")} onClick={() => buy(1)}>Upgrade, {fmtN(one)} gold</button>}
        {many.n >= 2 && <button className="mini" onClick={() => buy(many.n)} title={`Buy ${many.n} levels for ${fmtN(many.cost)} gold`}>All {many.n}, {fmtN(many.cost)}</button>}
      </span>
    </>;
  };
  return (
    <div className="vcard">
      <h3>{c ? "Hunter" : "Not recruited yet"} <span className="hnav">
        <button className="mini" onClick={() => step(-1)} aria-label="Previous hunter" title="Previous (left arrow)">‹</button>
        <button className="mini" onClick={() => step(1)} aria-label="Next hunter" title="Next (right arrow)">›</button>
        <button className="mini" onClick={close}>Close</button></span></h3>
      <div className="hdet"><Icon id={"hunter:" + k} size={64} /><div>
        <b style={{ fontSize: 16 }}>{h.name}</b>
        <div className="sub2">{TIER_NAME[h.tier]} {C.name}. {C.note} Traits: {TRAITS[h.origin].name} and {TRAITS[h.cls].name}.</div>
        {c && u ? <>
          {doing && <p className="doing big">{doing}</p>}
          {duty && vital !== undefined && <>
            <div style={{ marginTop: 8 }}>Health in the field <b>{fmtN(u.hp * vital)}</b> of {fmtN(u.hp)}</div>
            <div className="meter"><div style={{ width: pct(vital), background: hpCol(vital) }} /></div>
          </>}
          <div style={{ marginTop: 8 }}>Rank <b>{RANK_NAME[r]}</b>. Training {c}{nextAt ? ` of ${nextAt} for rank ${RANK_NAME[r + 1]}` : ", max rank"}.</div>
          <div className="meter gold"><div style={{ width: (nextAt ? Math.round(c / nextAt * 100) : 100) + "%" }} /></div>
          <div className="stat-wrap"><table className="stat-table">
            <thead><tr><th>Stat</th><th>Now</th><th>Weapon +1</th><th>Armor +1</th><th>{nextAt ? `Rank ${RANK_NAME[r + 1]}` : "Rank"}</th></tr></thead>
            <tbody>
              {STAT_ROWS.map(([l, f, fmt]) => <tr key={l}><td>{l}</td><td><b>{fmt(f(u))}</b></td>
                {[next.w, next.a, next.r].map((x, i) => <td key={i}><Delta now={u} next={x} f={f} fmt={fmt} /></td>)}</tr>)}
              {win && <tr><td>Boss win chance</td><td><b>{pct(win.now)}</b></td>
                {([[next.w, win.w], [next.a, win.a], [next.r, win.r]] as const).map(([x, w], i) => <td key={i}>{!x ? <span className="nochg">n/a</span>
                  : w - win.now >= 0.005 ? <span className="up">{pct(w)}</span> : <span className="nochg">{pct(w)}</span>}</td>)}</tr>}
            </tbody>
          </table></div>
          {next.r && <div className="lead">Ranking up multiplies damage and HP by 1.6. It takes {nextAt - c} more {g.data.topics[k].label} {nextAt - c > 1 ? "solves or reviews" : "solve or review"}.</div>}
          <div className="hbtns">
            <button className={"mini" + (duty ? "" : " primary")} onClick={() => act(g, live, v => toggleDuty(v, k))}>{duty ? "Send to rest" : "Put on duty"}</button>
            <button className="mini" onClick={() => mutateVillage(g, v => swapRow(v, k))} title="The boss attacks the front row first">Stands in the {rowOf(live, k)} row. Swap</button>
          </div>
          <h4>Gear (paid with gold, you have {fmtN(gold)})</h4>
          <div className="gear">{gearRow("w", "Each level adds 8% damage")}{gearRow("a", "Each level adds 8% HP")}</div>
          <h4>Looks (cosmetic, from the Workshop)</h4>
          <div className="looks">{(["aura", "pennant"] as const).map(slot => {
            const owned = COSMETICS.filter(c => c.kind === slot && live.cos[c.id]), cur = live.look[k]?.[slot] ?? "";
            return <label key={slot} className="look">{slot === "aura" ? "Aura" : "Pennant"}
              <select value={cur} onChange={e => act(g, live, v => setLook(v, k, slot, e.target.value))} disabled={!owned.length}>
                <option value="">{owned.length ? "None" : "Make one in the Workshop"}</option>
                {owned.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {cur && <span className="swatch" style={{ background: cosmetic(cur)?.color }} />}
            </label>;
          })}</div>
        </> : <div className="lead" style={{ marginTop: 8 }}>Solve any problem below to recruit {h.name}.</div>}
      </div></div>
      <h4>Training: {g.data.topics[k].label} problems. Each solve counts 1, and each spaced review counts 1 more.</h4>
      <ul className="plist">{g.data.topics[k].problems.map(([n, name, url]) => {
        const due = g.p.solved[n] && g.p.rev[n]?.due && g.p.rev[n].due! <= today;
        return <li key={n} className={g.p.solved[n] ? "solved" : ""}>
          <input type="checkbox" checked={!!g.p.solved[n]} onChange={() => solve(n)} aria-label={`Mark #${n} solved`} />
          <a href={url} target="_blank" rel="noopener">#{n} {name}</a>{due && <span className="due">Review due</span>}
        </li>;
      })}</ul>
    </div>
  );
}

function Grounds({ g, live, p, onFight, now, recap }: { g: Game; live: VillageState; p: Party; onFight: () => void; now: number; recap: Recap | null }) {
  const resting = live.bossReadyAt && live.bossReadyAt > now ? live.bossReadyAt - now : 0;
  const n = Math.max(live.unlocked + 1, 3), eff = efficiency(p, live.zone), fed = huntHours(live, g.p) > 0;
  const boss = bossOf(live.unlocked), quirks = boss.quirks.map(quirkInfo), wc = winChance(p.units, live.unlocked);
  const note = !p.units.length ? "Nobody is on duty." : eff >= 0.95 ? "Your party clears this zone easily."
    : eff >= 0.6 ? "Your party handles this zone, with some retreats to heal." : "This zone is rough. Hunters keep retreating. Pick an easier zone or train up.";
  return (
    <div className="vcard"><h3>Hunting grounds <span>{zoneDef(live.zone).name}</span></h3>
      <div className="zmap">{Array.from({ length: n }, (_, i) => {
        const z = i + 1, d = zoneDef(z), lock = z > live.unlocked;
        const cls = z === live.zone ? "here" : z === live.unlocked + 1 ? "next locked" : lock ? "locked" : "";
        return <button key={z} className={"znode " + cls} title={d.name + (lock ? " (beat the boss before it to unlock)" : "")}
          onClick={() => { if (!lock && z !== live.zone) mutateVillage(g, v => pickZone(v, z)); }}>
          <div className="dot"><Icon id={`mob:${((z - 1) % 9) + 1}:0`} size={28} /></div>{d.name}</button>;
      })}</div>
      <div>Hunting efficiency <b>{pct(eff)}</b></div>
      <div className={"meter " + (eff >= 0.6 ? "good" : "red")}><div style={{ width: pct(eff) }} /></div>
      <div className="lead">{note} {p.units.length ? (fed ? <>Gathering about {matsLine(matsPerHour(p, live.zone), matsBonus(p))} an hour, for cosmetics in the Workshop.</>
        : <b>Hunters are asleep with no food. One application feeds them for 4 hours.</b>) : null}</div>
      <div className="boss"><Icon id={`boss:${((live.unlocked - 1) % 9) + 1}${Math.floor((live.unlocked - 1) / 9) % 2 ? ":alt" : ""}`} size={48} /><div>
        <b>{boss.name}</b>, the zone {live.unlocked} boss
        {quirks.map(([ql, qd, qc]) => <div key={ql}>
          <div className="q">{ql}. {qd}</div>
          <div className="q" style={{ color: "var(--ink-3)" }}>Strong against it: {qc}.</div>
        </div>)}
      </div></div>
      <button className="fight-btn" onClick={onFight} disabled={!p.units.length || !!resting}>
        {resting ? `The boss is resting. Back in ${fmtClock(resting)}` : `Fight the boss. ${pct(wc)} chance to win`}</button>
      <div className="lead" style={{ marginTop: 6 }}>Free to fight. After a loss, the boss rests for an hour. Tap the map to skip a fight.</div>
      {recap && <FightRecap r={recap} />}
    </div>
  );
}

/** Who did what in the last boss fight, and what that suggests. */
function FightRecap({ r }: { r: Recap }) {
  const top = Math.max(1, ...r.rows.map(x => x.dealt)), total = r.rows.reduce((a, x) => a + x.dealt, 0) || 1;
  const allDown = r.rows.every(x => x.down);
  const tip = r.win ? "" : r.timeout ? "You ran out of time. More damage helps most: weapons, Strikers, or rank ups."
    : allDown ? "Your party fell. More HP helps most: armor, or Guardians in the front row." : "";
  return (
    <div className="recap">
      <h4>Last fight: {r.win ? "won" : "lost"} against {r.name} in {r.t.toFixed(1)}s</h4>
      {r.rows.slice().sort((a, b) => b.dealt - a.dealt).map(x => {
        const h = HUNTERS[x.k];
        return <div className="recap-row" key={x.k}>
          <Icon id={"hunter:" + x.k} size={24} />
          <div><div className="recap-top"><b>{h.name.split(" ")[0]}</b><span>{fmtN(x.dealt)} damage, {pct(x.dealt / total)}</span></div>
            <div className="meter"><div style={{ width: pct(x.dealt / top) }} /></div>
            <div className="sub2">{x.hits} hits, {x.crits} crits{x.misses ? `, ${x.misses} missed` : ""}. Took {fmtN(x.taken)}{x.down ? ". Knocked out" : ""}.</div></div>
        </div>;
      })}
      {tip && <div className="lead">{tip}</div>}
    </div>
  );
}

function Hints({ g, live, openQp, close }: { g: Game; live: VillageState; openQp: () => void; close: () => void }) {
  const hs = powerHints(live, g.ctx), food = huntHours(live, g.p), fed = food > 0, pay = payFor(live);
  const target = bossOf(hintZone(live, partyUnits(live, g.ctx)));
  const solve = (n: number) => import("@/lib/game/progress").then(m => { m.toggleSolved(g.store, n); floatText("+20 XP"); floatText("+2h food", "var(--warn)", 22); });
  return (
    <div className="vcard"><h3>Get stronger with real work <span>Aiming at {target.name}</span></h3>
      <div className="paylist" aria-label="Gold each real action pays today">
        <span className="lead">Gold only comes from real work. Today it pays:</span>
        {([["Application", pay.app], ["LeetCode solve", pay.solve], ["Review", pay.review], ["Outreach or follow-up", pay.outreach],
           ["All quests done", pay.questClear], ["DataAnnotation hour", pay.daHour]] as const).map(([l, n]) =>
          <span className="pay" key={l}>{l} <b>{fmtN(n)}</b></span>)}
      </div>
      {food < 12 && <div className="hint">
        <span className="txt">{fed ? `Food runs out in ${fmtHrs(food)}.` : "Your hunters are out of food and asleep."} Each application feeds them for 4 more hours.</span>
        <span className="gain">+4h food<br />+{fmtN(pay.app)} gold</span>
        <div className="btns"><button className="mini primary" onClick={openQp}>Quick Play</button><button className="mini" onClick={close}>Browse jobs</button></div></div>}
      {hs.map(h => (
        <div className="hint" key={h.k + h.text}><span className="txt">{h.text}</span>
          <span className="gain">{!h.bench && h.dw > 0.004 && <>+{pct(h.dw)} to win</>}{!h.bench && h.prob && <><br />+{fmtN(h.prob.review ? pay.review : pay.solve)} gold</>}</span>
          <div className="btns">
            {h.bench ? <button className="mini primary" onClick={() => act(g, live, v => toggleDuty(v, h.k))}>Put on duty</button>
              : h.prob && <>
                <a className="mini primary" href={h.prob.url} target="_blank" rel="noopener">{h.prob.review ? "Review" : "Open"} #{h.prob.n} {h.prob.name}</a>
                {!h.prob.review && <button className="mini ok" onClick={() => solve(h.prob!.n)}>✓ I solved it</button>}
              </>}
          </div>
        </div>))}
      {!hs.length && food >= 12 && <div className="lead">Your party is in good shape. Keep applying to keep them fed, and upgrade gear with gold.</div>}
    </div>
  );
}

function Buildings({ g, live }: { g: Game; live: VillageState; p: Party }) {
  const gold = goldNow(live, g.p);
  const up = (b: BuildingKey): VillageState => ({ ...live, bld: { ...live.bld, [b]: live.bld[b] + 1 } });
  /** What the next level changes, as numbers you can compare. */
  const preview = (b: BuildingKey): [string, string, string] => {
    const n = up(b), food = Math.max(0, foodLeft(live, g.p));
    switch (b) {
      case "inn": return ["Beds", String(beds(live)), String(beds(n))];
      case "kitchen": return ["Food on hand lasts", fmtHrs(food / burnRate(live)), fmtHrs(food / burnRate(n))];
      case "forge": return ["Gear level cap", String(gearCap(live)), String(gearCap(n))];
      case "market": return ["Gold per application", fmtN(payFor(live).app), fmtN(payFor(n).app)];
    }
  };
  return (
    <div className="vcard"><h3>Buildings <span>Paid with gold</span></h3><div className="blds">
      {(Object.entries(BUILDINGS) as [BuildingKey, typeof BUILDINGS[BuildingKey]][]).map(([b, B]) => {
        const lv = live.bld[b], max = lv >= B.max, cost = max ? 0 : bldCost(b, lv);
        return <div className="bld" key={b}>
          <div className="t"><span className="bld-name"><Icon id={"bld:" + b} size={28} />{B.name}</span><span>Level {lv}</span></div>
          <div className="d">{B.what(lv)}.</div>
          {!max && (() => { const [l, a, b2] = preview(b); return <div className="bld-delta">{l}: {a} <span aria-hidden>→</span> <b className="up">{b2}</b></div>; })()}
          {max ? <button className="mini" disabled>Max level</button>
            : <button className={"mini" + (gold >= cost ? " primary" : "")} onClick={() => act(g, live, v => buyBuilding(v, g.p, b),
                () => toast(`${B.name} is now level ${lv + 1}. ${B.what(lv + 1)}.`))}>Upgrade, {fmtN(cost)} gold</button>}
        </div>;
      })}
    </div></div>
  );
}

/** The sprite a cosmetic shows in the Workshop. Auras and pennants show their color instead. */
const THEME_ICON: Record<string, string> = { autumn: "prop:autumntree", blossom: "prop:pinktree", snow: "prop:snowtree", night: "icon:moon" };
const cosIcon = (c: CosDef) => c.sprite ?? THEME_ICON[c.id] ?? "deco:" + c.id;
const matsLine = (m: Mats, k = 1) => MAT_KEYS.map(x => `${(m[x] * k).toFixed(m[x] * k < 10 ? 1 : 0)} ${MATS[x].name.toLowerCase()}`).join(", ");
/** A cost as material chips, dimmed when you can't cover that part yet. */
function Cost({ live, cost }: { live: VillageState; cost: Partial<Mats> }) {
  const have = matsNow(live);
  return <span className="cost">{MAT_KEYS.filter(m => cost[m]).map(m =>
    <span key={m} className={have[m] >= cost[m]! ? "" : "short"} title={`${MATS[m].name}: you have ${Math.floor(have[m])}`}><Icon id={MATS[m].sprite} size={16} />{cost[m]}</span>)}</span>;
}

/** Cosmetics bought with materials hunting gathers. Looks only: no gear, no stats. */
function Workshop({ g, live }: { g: Game; live: VillageState }) {
  const [kind, setKind] = useState<CosKind>("deco");
  const have = matsNow(live);
  const items = COSMETICS.filter(c => c.kind === kind);
  return (
    <div className="vcard"><h3>Workshop <span>Cosmetics, paid with materials</span></h3>
      <div className="mats">{MAT_KEYS.map(m => <span key={m} className="mat"><Icon id={MATS[m].sprite} size={18} /> {MATS[m].name} <b>{fmtN(have[m])}</b></span>)}</div>
      <div className="lead">Hunters gather materials while they hunt, and zone bosses drop some. They only buy looks, never gear or stats.</div>
      <div className="seg" role="tablist" aria-label="Kind of cosmetic">
        {(Object.keys(COS_KINDS) as CosKind[]).map(k => <button key={k} role="tab" aria-selected={kind === k} className={"seg-btn" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>{COS_KINDS[k]}</button>)}
      </div>
      <div className="cos-grid">{items.map(c => {
        const owned = !!live.cos[c.id], using = c.kind === "theme" && live.theme === c.id;
        return <div className={"cos" + (owned ? " owned" : "")} key={c.id}>
          <div className="cos-ico" style={c.color ? { background: c.color } : undefined}>{!c.color && <Icon id={cosIcon(c)} size={30} />}</div>
          <div className="cos-nm">{c.name}</div>
          {c.note && <div className="sub2">{c.note}</div>}
          {!owned ? <>
            <Cost live={live} cost={c.cost} />
            <button className={"mini" + (canPay(live, c.cost) ? " primary" : "")} onClick={() => act(g, live, v => buyCosmetic(v, c.id), () => {
              toast(c.kind === "deco" ? `${c.name} now stands in your village.` : c.kind === "theme" ? `Your village now looks like ${c.name.toLowerCase()}.`
                : `${c.name} unlocked. Give it to a hunter from their card.`);
              confetti(40);
            })}>Make it</button>
          </> : c.kind === "theme" ? <button className={"mini" + (using ? " ok" : "")} onClick={() => act(g, live, v => setTheme(v, using ? "" : c.id))}>{using ? "In use. Turn off" : "Use"}</button>
            : <span className="tag good">{c.kind === "deco" ? "In the village" : "Unlocked"}</span>}
        </div>;
      })}</div>
    </div>
  );
}

/** A shelf for every boss you've beaten. Craft its trophy with stone and gems. */
function Trophies({ g, live }: { g: Game; live: VillageState }) {
  const beaten = Array.from({ length: live.unlocked - 1 }, (_, i) => i + 1);
  if (!beaten.length) return null;
  const made = beaten.filter(z => live.trophies[z]).length;
  return (
    <div className="vcard"><h3>Trophy shelf <span>{made} of {beaten.length}</span></h3>
      <div className="shelf">{beaten.map(z => {
        const b = bossOf(z), id = `boss:${((z - 1) % 9) + 1}${Math.floor((z - 1) / 9) % 2 ? ":alt" : ""}`, has = !!live.trophies[z], cost = trophyCost(z);
        return <div className={"trophy" + (has ? " on" : "")} key={z} title={b.name}>
          <Icon id={id} size={40} />
          <div className="sub2">Zone {z}</div>
          {has ? <span className="tag good">On the shelf</span> : <>
            <Cost live={live} cost={cost} />
            <button className={"mini" + (canPay(live, cost) ? " primary" : "")} onClick={() => act(g, live, v => craftTrophy(v, z), () => toast(`${b.name}'s trophy is on the shelf.`))}>Craft</button>
          </>}
        </div>;
      })}</div>
    </div>
  );
}

function Raid({ g, live }: { g: Game; live: VillageState }) {
  const R = raidState(live, g.p), done = R.dmg >= R.hp, left = Math.max(0, R.hp - R.dmg);
  return (
    <div className="vcard"><h3>Weekly world boss <span>Resets Monday</span></h3>
      <div className="raid"><div className="spr"><Icon id={R.boss[0]} size={56} /></div><div>
        <b>{R.boss[1]}</b>
        <div>{done ? "Defeated this week!" : `${fmtN(left)} of ${fmtN(R.hp)} HP left`}</div>
        <div className="stackbar">
          {R.parts.filter(x => x[2]).map(([l, per, n, col]) => <span key={l} title={`${l}: ${n} for ${per * n} damage`} style={{ flex: Math.min(per * n, R.hp), background: col }} />)}
          {!done && <span style={{ flex: left }} />}
        </div>
      </div></div>
      <details className="usual"><summary>How to hurt it</summary>
        <div className="lead">{R.parts.map(([l, per, n]) => <div key={l}>{l}: <b>{per}</b> each{n ? `, ${n} so far` : ""}</div>)}</div>
      </details>
      {done && (R.claimed ? <div className="lead">Chest claimed. Next week&apos;s boss is 15% tougher.</div>
        : <button className="fight-btn" style={{ background: "linear-gradient(135deg,#eda100,#eb6834)" }}
            onClick={() => act(g, live, v => claimRaid(v, g.p), () => { toast("Chest opened: gold and 8 hours of food."); confetti(110); })}>Claim the chest</button>)}
    </div>
  );
}

function DACard({ g, live, now }: { g: Game; live: VillageState; now: number }) {
  const [min, setMin] = useState("");
  const run = g.p.daRun.run, wk = weekStart(), today = localDay();
  const sess = g.p.da.filter(([, s]) => s.d >= wk).sort((a, b) => b[1].d.localeCompare(a[1].d));
  const running = run ? Math.floor((now - run) / 60000) : 0;
  const minToday = g.p.da.filter(([, s]) => s.d === today).reduce((a, [, s]) => a + s.m, 0) + running;
  const minWeek = sess.reduce((a, [, s]) => a + s.m, 0) + running;
  const rate = parseFloat(g.p.daRun.rate);
  const add = () => {
    const m = Math.round(+min);
    if (!(m > 0 && m <= 720)) return toast("Enter minutes between 1 and 720", true);
    const r = logDA(g.store, live, today, m);
    floatText(`+${fmtN(r.g)} gold`, "var(--ochre)"); setMin("");
    toast(`Added ${fmtHrs(m / 60)} of DataAnnotation`);
  };
  return (
    <div className="vcard"><h3>DataAnnotation <span>Work as long as you like</span></h3>
      <div className="lead">An hour of work pays <b>{fmtN(daWage(live))}</b> gold and an hour of food.</div>
      <div className="da-big" style={run ? {} : { color: "var(--ink-3)", fontSize: 18 }}>{run ? fmtClock(now - run) : "Timer is off"}</div>
      {run > 0 && <div className="lead">So far this session: about {fmtN((now - run) / 3600e3 * daWage(live))} gold</div>}
      <div className="da-row">
        <button className={"mini " + (run ? "ok" : "primary")} onClick={() => toggleDA(g.store, live)}>{run ? "■ Stop and log it" : "▶ Start the timer"}</button>
        <span>or add</span><input type="number" min={1} max={720} placeholder="minutes" value={min} onChange={e => setMin(e.target.value)} />
        <button className="mini" onClick={add}>Add</button>
      </div>
      <div className="kv2">
        <div><div className="l">Today</div><div className="v">{fmtHrs(minToday / 60)}</div></div>
        <div><div className="l">This week</div><div className="v">{fmtHrs(minWeek / 60)}</div></div>
        <div><div className="l">Week pay</div><div className="v">{rate > 0 ? "$" + Math.round(minWeek / 60 * rate) : "—"}</div></div>
      </div>
      <div className="da-row"><span>Your hourly rate in $</span>
        <input type="number" min={0} step={0.5} defaultValue={g.p.daRun.rate} onBlur={e => setDARate(g.store, e.target.value)} placeholder="optional" /></div>
      {sess.length > 0 && <><h4>This week</h4><div className="fu-list">{sess.slice(0, 8).map(([id, s]) => (
        <div className="fu" key={id}><div><b>{fmtHrs(s.m / 60)}</b> on {s.d}<div className="sub2">{fmtN(s.g || 0)} gold</div></div>
          <div className="btns"><button className="mini" onClick={() => { if (confirm("Remove this session and the gold it earned?")) g.store.delete(NS.da, id); }}>Remove</button></div></div>
      ))}</div></>}
    </div>
  );
}

/** A hunter's weapon at its current tier, with their armor's colour as a rim. */
function GearIcon({ cls, lv, rim, armor }: { cls: keyof typeof CLASSES; lv: number; rim?: string; armor?: boolean }) {
  const [sprite, name] = weaponFor(cls, lv), src = faceUrl("weapon:" + sprite);
  return (
    <span className={"gear-icon" + (armor ? " armor" : "")} title={armor ? "Armor" : name} style={rim ? { boxShadow: `0 0 0 2px ${rim}` } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {!armor && src && <img src={src} alt="" />}
    </span>
  );
}

/** Damage numbers and hit marks over the art. Some people find them busy, so they can be turned off. */
export function HitmarkerToggle() {
  const { store } = useGame();
  const on = store.get<boolean>(NS.pref, "hitmarkers") !== false;
  return <button className={"mini" + (on ? " on" : "")} role="switch" aria-checked={on}
    onClick={() => store.set(NS.pref, "hitmarkers", !on)}>Hit markers {on ? "on" : "off"}</button>;
}
