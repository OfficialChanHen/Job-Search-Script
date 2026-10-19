"use client";
import { useEffect, useRef, useState } from "react";
import { confetti, floatText, toast } from "@/lib/client/effects";
import { getScene } from "@/lib/client/scene";
import { faceUrl } from "@/lib/client/sprites";
import { logDA, setDARate } from "@/lib/game/da";
import { NS } from "@/lib/game/progress";
import { localDay, weekStart } from "@/lib/game/time";
import { BUILDINGS, CLASSES, RANK_AT, RANK_NAME, TIER_NAME, TRAITS, HUNTERS, armorFor, weaponFor, type BuildingKey, type TraitKey } from "@/lib/game/village/defs";
import {
  applyFight, beds, gearCap, bldCost, bossOf, buyBuilding, buyGear, claimRaid, daWage, efficiency, fightBoss, gearCost, gearOf, goldNow,
  goldPerHour, hintZone, huntHours, hunterKeys, normalize, partyUnits, pickZone, powerHints, quirkInfo, raidState, rankOf, rowOf,
  settle, swapRow, toggleDuty, trained, trainingOf, traitLv, winChance, zoneDef, type Party, type Result, type VillageState,
} from "@/lib/game/village/engine";
import { useGame, type Game } from "./GameContext";

/** A pixel portrait from the sprite pack, or the emoji while it loads. */
export function Face({ id, fallback, size = 38 }: { id: string; fallback: string; size?: number }) {
  const src = faceUrl(id);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="face" src={src} alt="" width={size} height={size} /> : <span className="face" aria-hidden style={{ fontSize: size * 0.7 }}>{fallback}</span>;
}
import { fmtHrs, fmtN, toggleDA, useLiveVillage, useScene } from "./GamePanel";
import { fmtClock, useNow } from "./useNow";
import { useUi } from "./UiContext";

const pct = (x: number) => Math.round(x * 100) + "%";

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
  useScene(g, live, host, vil !== null);
  useEffect(() => {
    if (vil === null) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVil(null); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [vil, setVil]);
  if (vil === null || !live) return null;
  const p = partyUnits(live, g.ctx), fed = huntHours(live, g.p) > 0;
  const doing = getScene().actions();
  const sel = vil;
  const select = (k: string) => setVil(sel === k ? "" : k);
  const fight = () => {
    if (getScene().fighting) return;
    const out = fightBoss(live, g.ctx);
    if ("error" in out) return toast(out.error, true);
    const party = p, z = live.unlocked;
    mutateVillage(g, v => applyFight(v, z, out.win, out.reward, party));
    host.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    getScene().playFight(p.units, { ico: out.boss.ico, name: out.boss.name, hp: out.boss.hp, z }, out.log, out, () => {
      if (out.win) { toast(`You beat ${out.boss.name}. ${zoneDef(z + 1).name} is open, and you found ${fmtN(out.reward)} gold.`); confetti(120); }
      else toast(out.timeout ? `⏱️ Time ran out against ${out.boss.name}. See "Get stronger" for what helps most.` : `💀 ${out.boss.name} won this time. See "Get stronger" for what helps most.`);
      force(x => x + 1);
    });
  };
  return (
    <div className="vil" role="dialog" aria-modal="true" aria-label="Your hunter village" onClick={e => { if (e.target === e.currentTarget) setVil(null); }}>
      <div className="vil-box">
        <div className="vil-top">
          <div className="vil-res">
            {[["Gold", fmtN(goldNow(live, g.p)), ""], ["Food left", fed ? fmtHrs(huntHours(live, g.p)) : "None", fed ? "" : "low"],
              ["Gold an hour", fed ? fmtN(goldPerHour(live, p)) : "0", ""], ["Party power", fmtN(p.power), ""]].map(([l, v, c]) =>
              <div key={l}><div className="l">{l}</div><div className={"v " + c}>{v}</div></div>)}
          </div>
          <div className="vil-top-side">
            <HitmarkerToggle />
            <button className="mini" onClick={() => setVil(null)}>Close</button>
          </div>
        </div>
        <div className="vscene big" ref={host} />
        <div className="vil-grid">
          <div className="vil-col">
            {sel && HUNTERS[sel] && <HunterDetail g={g} live={live} k={sel} doing={doing[sel]} close={() => setVil("")} />}
            <HuntersCard g={g} live={live} p={p} sel={sel} select={select} doing={doing} />
          </div>
          <div className="vil-col">
            <Grounds g={g} live={live} p={p} onFight={fight} />
            <Hints g={g} live={live} openQp={() => { setVil(null); setQp(true); }} close={() => setVil(null)} />
            <Buildings g={g} live={live} />
            <Raid g={g} live={live} />
            <DACard g={g} live={live} now={now} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HunterCard({ g, live, k, sel, select, doing }: { g: Game; live: VillageState; k: string; sel: string; select: (k: string) => void; doing?: string }) {
  const h = HUNTERS[k], c = trainingOf(g.ctx, k), r = rankOf(c), duty = live.party.includes(k), label = g.data.topics[k].label;
  if (!c) return (
    <button className={"hcard locked" + (sel === k ? " sel" : "")} onClick={() => select(k)} title={`Solve any ${label} problem to recruit`}>
      <span className={`tier tier${h.tier}`} /><Face id={"hunter:" + k} fallback={h.ico} /><div className="nm">{h.name}</div><div className="rk">Trains on {label}</div>
    </button>);
  return (
    <button className={"hcard" + (duty ? " duty" : "") + (sel === k ? " sel" : "")} onClick={() => select(k)} title={`${h.name}, ${CLASSES[h.cls].name}`}>
      <span className={`tier tier${h.tier}`} />{duty && <span className="rowtag">{rowOf(live, k) === "front" ? "FRONT" : "BACK"}</span>}
      <div className="face-gear"><Face id={"hunter:" + k} fallback={h.ico} /><GearIcon cls={h.cls} lv={gearOf(live, k).w} rim={armorFor(gearOf(live, k).a).color} /></div>
      <div className="nm">{h.name}</div><div className="rk">Rank {RANK_NAME[r]}, {label}</div>
      {doing && <div className="doing">{doing}</div>}
      <div className="pips">{[1, 2, 3, 4].map(i => <i key={i} className={i <= r ? "on" : ""} />)}</div>
    </button>);
}

function HuntersCard({ g, live, p, sel, select, doing }: { g: Game; live: VillageState; p: Party; sel: string; select: (k: string) => void; doing: Record<string, string> }) {
  const keys = hunterKeys(g.data.topics);
  const party = live.party.filter(k => HUNTERS[k] && trained(g.ctx, k));
  const bench = keys.filter(k => trained(g.ctx, k) && !party.includes(k)), locked = keys.filter(k => !trained(g.ctx, k));
  const traits = (Object.entries(TRAITS) as [TraitKey, typeof TRAITS[TraitKey]][]).map(([t, T]) => {
    const n = p.tc[t] || 0, lv = traitLv(t, n);
    if (!n) return null;
    const next = T.at.find(a => a > n);
    const tip = (lv ? T.what.replace("{}", pct(T.fx[lv - 1])) : `Needs ${T.at[0]} on duty`) + (next ? `. Next level at ${next}.` : "");
    return <span key={t} className={"trait" + (lv ? " on" : "")} title={tip}>{T.ico} {T.name} {n}/{next || T.at[T.at.length - 1]}</span>;
  }).filter(Boolean);
  return (
    <div className="vcard"><h3>On duty <span>{party.length} of {beds(live)} beds</span></h3>
      <div className="hgrid">
        {party.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} doing={doing[k]} />)}
        {Array.from({ length: Math.max(0, beds(live) - party.length) }, (_, i) => <div key={i} className="empty-bed">Empty bed</div>)}
      </div>
      <div className="traits">{traits.length ? traits : <span className="lead">Hunters who share a trait boost each other. Hover a trait to see what it does.</span>}</div>
      {bench.length > 0 && <><h4>Resting in the village</h4><div className="hgrid">{bench.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} />)}</div></>}
      {locked.length > 0 && <><h4>Not recruited yet. Solve one problem in the topic to recruit them.</h4>
        <div className="hgrid">{locked.map(k => <HunterCard key={k} g={g} live={live} k={k} sel={sel} select={select} />)}</div></>}
    </div>
  );
}

function HunterDetail({ g, live, k, close, doing }: { g: Game; live: VillageState; k: string; close: () => void; doing?: string }) {
  const h = HUNTERS[k], C = CLASSES[h.cls], c = trainingOf(g.ctx, k), r = rankOf(c), duty = live.party.includes(k);
  const u = partyUnits(live, g.ctx, duty ? live.party : [...live.party, k]).units.find(x => x.k === k);
  const gear = gearOf(live, k), cap = gearCap(live), gold = goldNow(live, g.p), nextAt = RANK_AT[r];
  const today = localDay();
  const solve = (n: number) => import("@/lib/game/progress").then(m => {
    const on = m.toggleSolved(g.store, n);
    floatText(on ? "+20 XP" : "-20 XP", on ? undefined : "var(--ink-3)");
    if (on) floatText("+2h 🍖", "var(--warn)", 22);
  });
  const gearRow = (slot: "w" | "a", ico: string, name: string, what: string) => {
    const lv = gear[slot];
    return <>
      <span className="gear-name"><GearIcon cls={h.cls} lv={slot === "w" ? lv : 0} rim={slot === "a" ? armorFor(lv).color || "var(--border2)" : ""} armor={slot === "a"} />
        <span><b>{slot === "w" ? weaponFor(h.cls, lv)[1] : armorFor(lv).name}</b>, level {lv}<br /><span className="sub2">{what}</span></span></span>
      {lv >= cap ? <button className="mini" disabled title="Upgrade the Forge">Max for Forge {live.bld.forge}</button>
        : <button className={"mini" + (gold >= gearCost(lv) ? " primary" : "")} onClick={() => act(g, live, v => buyGear(v, g.p, k, slot),
            () => { floatText(slot === "w" ? "+8% damage" : "+8% HP", "var(--teal-text)"); getScene().celebrate(k); })}>Upgrade, {fmtN(gearCost(lv))} gold</button>}
    </>;
  };
  return (
    <div className="vcard">
      <h3>{c ? "Hunter" : "Not recruited yet"} <span><button className="mini" onClick={close}>Close</button></span></h3>
      <div className="hdet"><Face id={"hunter:" + k} fallback={h.ico} size={64} /><div>
        <b style={{ fontSize: 16 }}>{h.name}</b>
        <div className="sub2">{TIER_NAME[h.tier]} {C.ico} {C.name}. {C.note} Traits: {TRAITS[h.origin].ico} {TRAITS[h.origin].name} and {TRAITS[h.cls].ico} {TRAITS[h.cls].name}.</div>
        {c && u ? <>
          {doing && <p className="doing big">{doing}</p>}
          <div style={{ marginTop: 8 }}>Rank <b>{RANK_NAME[r]}</b>. Training {c}{nextAt ? ` of ${nextAt} for rank ${RANK_NAME[r + 1]}` : ", max rank"}.</div>
          <div className="meter gold"><div style={{ width: (nextAt ? Math.round(c / nextAt * 100) : 100) + "%" }} /></div>
          <div className="kv2">
            <div><div className="l">Damage</div><div className="v">{fmtN(u.atk)}</div></div>
            <div><div className="l">HP</div><div className="v">{fmtN(u.hp)}</div></div>
            <div><div className="l">Attacks a second</div><div className="v">{u.spd.toFixed(2)}</div></div>
            <div><div className="l">Crit chance</div><div className="v">{pct(u.crit)}</div></div>
          </div>
          <div className="hbtns">
            <button className={"mini" + (duty ? "" : " primary")} onClick={() => act(g, live, v => toggleDuty(v, k))}>{duty ? "Send to rest" : "Put on duty"}</button>
            <button className="mini" onClick={() => mutateVillage(g, v => swapRow(v, k))} title="The boss attacks the front row first">Stands in the {rowOf(live, k)} row. Swap</button>
          </div>
          <h4>Gear (paid with gold)</h4>
          <div className="gear">{gearRow("w", "⚔️", "Weapon", "Each level adds 8% damage")}{gearRow("a", "🛡️", "Armor", "Each level adds 8% HP")}</div>
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

function Grounds({ g, live, p, onFight }: { g: Game; live: VillageState; p: Party; onFight: () => void }) {
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
          <div className="dot">{lock ? "🔒" : d.mobs[0]}</div>{d.name}</button>;
      })}</div>
      <div>Hunting efficiency <b>{pct(eff)}</b></div>
      <div className={"meter " + (eff >= 0.6 ? "good" : "red")}><div style={{ width: pct(eff) }} /></div>
      <div className="lead">{note} {p.units.length ? (fed ? <>Earning <b>{fmtN(goldPerHour(live, p))}</b> gold an hour.</> : <b>Hunters are asleep with no food. One application feeds them for 4 hours.</b>) : null}</div>
      <div className="boss"><Face id={`boss:${((live.unlocked - 1) % 9) + 1}${Math.floor((live.unlocked - 1) / 9) % 2 ? ":alt" : ""}`} fallback={boss.ico} size={48} /><div>
        <b>{boss.name}</b>, the zone {live.unlocked} boss
        {quirks.map(([ql, qd, qc]) => <div key={ql}>
          <div className="q">{ql}. {qd}</div>
          <div className="q" style={{ color: "var(--ink-3)" }}>Strong against it: {qc}.</div>
        </div>)}
      </div></div>
      <button className="fight-btn" onClick={onFight} disabled={!p.units.length}>Fight the boss. {pct(wc)} chance to win</button>
      <div className="lead" style={{ marginTop: 6 }}>Free to fight. After a loss, the boss rests for 20 minutes.</div>
    </div>
  );
}

function Hints({ g, live, openQp, close }: { g: Game; live: VillageState; openQp: () => void; close: () => void }) {
  const hs = powerHints(live, g.ctx), food = huntHours(live, g.p), fed = food > 0;
  const target = bossOf(hintZone(live, partyUnits(live, g.ctx)));
  const solve = (n: number) => import("@/lib/game/progress").then(m => { m.toggleSolved(g.store, n); floatText("+20 XP"); floatText("+2h 🍖", "var(--warn)", 22); });
  return (
    <div className="vcard"><h3>Get stronger with real work <span>Aiming at {target.ico} {target.name}</span></h3>
      {food < 12 && <div className="hint"><span className="ico">🍖</span>
        <span className="txt">{fed ? `Food runs out in ${fmtHrs(food)}.` : "Your hunters are out of food and asleep."} Each application feeds them for 4 more hours.</span>
        <span className="gain">+4h each</span>
        <div className="btns"><button className="mini primary" onClick={openQp}>🎮 Quick Play</button><button className="mini" onClick={close}>Browse jobs</button></div></div>}
      {hs.map(h => (
        <div className="hint" key={h.k + h.text}><span className="ico">{HUNTERS[h.k].ico}</span><span className="txt">{h.text}</span>
          <span className="gain">{!h.bench && h.dw > 0.004 && <>+{pct(h.dw)} to win<br /></>}{!h.bench && h.dg > 0.05 && <>+{fmtN(h.dg)} gold an hour</>}</span>
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

function Buildings({ g, live }: { g: Game; live: VillageState }) {
  const gold = goldNow(live, g.p);
  return (
    <div className="vcard"><h3>Buildings <span>Paid with gold</span></h3><div className="blds">
      {(Object.entries(BUILDINGS) as [BuildingKey, typeof BUILDINGS[BuildingKey]][]).map(([b, B]) => {
        const lv = live.bld[b], max = lv >= B.max, cost = max ? 0 : bldCost(b, lv);
        return <div className="bld" key={b}>
          <div className="t"><span>{B.ico} {B.name}</span><span>Level {lv}</span></div>
          <div className="d">{B.what(lv)}.{!max && <><br />Next: {B.what(lv + 1)}.</>}</div>
          {max ? <button className="mini" disabled>Max level</button>
            : <button className={"mini" + (gold >= cost ? " primary" : "")} onClick={() => act(g, live, v => buyBuilding(v, g.p, b),
                () => toast(`${B.name} is now level ${lv + 1}. ${B.what(lv + 1)}.`))}>Upgrade, {fmtN(cost)} gold</button>}
        </div>;
      })}
    </div></div>
  );
}

function Raid({ g, live }: { g: Game; live: VillageState }) {
  const R = raidState(live, g.p), done = R.dmg >= R.hp, left = Math.max(0, R.hp - R.dmg);
  return (
    <div className="vcard"><h3>Weekly world boss <span>Resets Monday</span></h3>
      <div className="raid"><div className="spr">{R.boss[0]}</div><div>
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
    toast(`💼 Added ${fmtHrs(m / 60)} of DataAnnotation`);
  };
  return (
    <div className="vcard"><h3>💼 DataAnnotation <span>Work as long as you like</span></h3>
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
