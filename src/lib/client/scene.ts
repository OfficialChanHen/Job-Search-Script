"use client";
/* The village, seen from above. The town (inn, kitchen, forge, market) sits on
   the left; the hunting ground fills the right. Hunters walk out, fight the
   zone's monsters, go back to the inn to rest, and sleep there when there's no
   food. Boss fights replay a simulation log on the field. One canvas, moved
   between wherever the village is shown. Pixel art from the Ninja Adventure
   pack (CC0), drawn through sprites.ts. */
import { HUNTERS, MOB_NAMES, armorFor, cosmetic, gearTier, weaponFor, type BuildingKey } from "@/lib/game/village/defs";
import type { FightEvent, Unit } from "@/lib/game/village/sim";
import { actorSize, animLength, drawActor, drawGround, loadSprites, type Dir } from "./sprites";

export interface SceneInput {
  units: Record<string, Unit>;
  fed: boolean; eff: number; dps: number;
  zone: { z: number; name: string };
  bld: Record<BuildingKey, number>;
  daRunning: boolean;
  anyTrained: boolean;
  gear: Record<string, { w: number; a: number }>;
  hitmarkers: boolean;       // damage numbers and hit marks over the art (a setting)
  look?: Record<string, { aura?: string; pennant?: string }>;   // cosmetics on each hunter
  theme?: string;            // a bought map theme, or "" for the village as it comes
  decos?: string[];          // decorations standing in town
}
interface Flake { x: number; y: number; vx: number; vy: number; r: number; spin: number }
type Pt = { x: number; y: number };
interface Walker extends Pt { tx: number; ty: number; dir: Dir; speed: number; moving: boolean }
interface Hunter extends Walker {
  k: string; state: "walk" | "fight" | "gather" | "rest" | "sleep"; cd: number; lunge: number; flash: number; rest: number; wait: number;
  target: Mob | null; slot: number;
  gather: number;            // index into props while chopping or mining, else -1
  swings: number;            // swings left on the current tree or rock
  knock: number; kx: number; ky: number; hitAt: number;   // being hit: knockback timer and direction, last hit time
  hp: number; max: number;   // field health: low health sends them back to the inn to heal
  side: number; sideFor: Mob | null;   // which side of its target it stands on, picked once per target
}
interface Mob extends Walker { i: number; hp: number; max: number; flash: number; dead: number; think: number; cd: number; lunge: number; lx: number; ly: number; turn: number }
interface Fx { x: number; y: number; text?: string; actor?: string; mark?: boolean; ring?: string; color?: string; size: number; life: number; max: number; vy: number }
/** Something flying: an arrow or spell from a sniper, or a monster's or boss's shot. It lands after `dur`. */
interface Shot { x0: number; y0: number; to: () => Pt; t: number; dur: number; kind: "arrow" | "bolt" | "orb"; color: string; land: () => void }
interface Fight {
  units: Unit[]; boss: { name: string; hp: number; z: number }; log: FightEvent[]; win: boolean; timeout: boolean;
  t: number; i: number; speed: number; bhp: number; hp: number[]; lunge: number[]; flash: number[]; bflash: number; end: number; onDone: () => void;
  dash: number[];            // melee hunters run in to strike: time left on each dash
  blunge: number; btarget: number;   // the boss winding up at one hunter
}
export type Pick = { kind: "hunter"; k: string } | { kind: "mob" } | null;
const DASH = 0.34, RANGE_MELEE = 13, RANGE_SHOT = 34;
const isRanged = (k: string) => HUNTERS[k]?.cls === "sniper";

const REDUCED = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const fmtN = (x: number) => { x = Math.floor(x); return Math.abs(x) < 10000 ? x.toLocaleString() : Math.abs(x) < 1e6 ? (x / 1000).toFixed(x < 1e5 ? 1 : 0) + "k" : (x / 1e6).toFixed(1) + "M"; };
const zoneIdx = (z: number) => ((z - 1) % 9) + 1;
const lapAlt = (z: number) => Math.floor((z - 1) / 9) % 2 === 1;
// each zone's ground and the trees and rocks that grow there
const ZONE_LOOK: [string, string, string[]][] = [
  ["grass", "#9db04a", ["tree", "roundtree", "stump"]],
  ["darkgrass", "#6b9a3a", ["deadtree", "pine", "stump"]],
  ["stone", "#a88f7a", ["rocks", "greyrock", "rock"]],
  ["sand", "#f3a25c", ["rock", "stump", "rocks"]],
  ["snow", "#ece6ea", ["snowtree", "snowpine", "greyrock"]],
  ["pinksand", "#f3c7a3", ["rocks", "deadtree", "rock"]],
  ["darkgrass", "#6b9a3a", ["roundtree", "stump", "pine"]],
  ["stone", "#a88f7a", ["greyrocks", "pine", "greyrock"]],
  ["grass", "#9db04a", ["pinktree", "tree", "oliveTree"]],
];
const BLD_SLOTS: BuildingKey[] = ["inn", "kitchen", "forge", "market"];
// Floating numbers: light fill with a dark outline, the classic game style that reads on any ground.
const NUM = { hit: "#FFFDF9", crit: "#FFD166", hurt: "#FF9A8B", miss: "#D9D3C7", outline: "rgba(24,20,16,0.92)" };
// Words (messages, boss names, results) sit on a solid paper plate instead of floating over the art.
const PLATE = { bg: "rgba(252,247,234,0.95)", border: "rgba(122,92,30,0.55)", text: "#2A2118", good: "#2F5D3A", bad: "#983A33" };
// map themes: a wash over the town, and what drifts through the air
const THEME_TINT: Record<string, string> = { autumn: "rgba(214,120,40,0.16)", blossom: "rgba(240,150,190,0.12)", night: "" };
const FLAKE: Record<string, { col: string; n: number; fall: number }> = {
  autumn: { col: "#E08A3C", n: 1, fall: 14 }, blossom: { col: "#F6B6CF", n: 1.2, fall: 10 }, snow: { col: "#FFFFFF", n: 2, fall: 18 },
};
const LIGHTS = new Set(["lantern", "campfire"]);
const hpColor = (f: number) => f > 0.6 ? "#5FBF7F" : f > 0.3 ? "#E8BE4E" : "#E0675A";
const dirTo = (dx: number, dy: number): Dir => Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");

export class VillageScene {
  readonly cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0; private H = 0; private S = 2;
  private ground: HTMLCanvasElement | null = null; private groundKey = "";
  private props: { id: string; x: number; y: number }[] = [];
  private hs: Record<string, Hunter> = {};
  private mobs: Mob[] = [];
  private fx: Fx[] = [];
  private shots: Shot[] = [];
  private flakes: Flake[] = [];
  private slots: { key: string; pts: Pt[] } = { key: "", pts: [] };
  private fight: Fight | null = null;
  private selected = ""; private hover = "";
  /** Called when someone clicks a hunter on the map. */
  onSelect: ((k: string) => void) | null = null;
  private raf = 0; private last = 0; private spawn = 0; private shake = 0; private clock = 0;
  private input: SceneInput | null = null;
  private visible = true;
  private ro: ResizeObserver | null = null;
  private ink = { text: "#2a2118", good: "#3e6e4e", crit: "#983a33", warn: "#b5482a" };
  private fontFam = `"Pixelify Sans", ui-monospace, monospace`;

  constructor() {
    this.cv = document.createElement("canvas");
    this.cv.setAttribute("role", "img");
    this.cv.addEventListener("click", e => {
      if (this.fight) { if (!this.fight.end) this.fight.t = Infinity; e.stopPropagation(); return; }   // skip a fight
      const hit = this.pickAt(e);
      if (hit?.kind === "hunter") { this.selected = hit.k; this.onSelect?.(hit.k); e.stopPropagation(); }
      else if (hit?.kind === "mob") e.stopPropagation();
    });
    this.cv.addEventListener("mousemove", e => {
      const hit = this.fight ? null : this.pickAt(e, true);
      this.hover = hit?.kind === "hunter" ? hit.k : "";
      this.cv.style.cursor = this.fight ? "pointer" : hit ? "pointer" : "";
    });
    this.cv.addEventListener("mouseleave", () => { this.hover = ""; });
    document.addEventListener("visibilitychange", () => this.wake());
    window.addEventListener("resize", () => this.resize());
    loadSprites().then(() => { this.groundKey = ""; });
  }
  get fighting() { return !!this.fight; }
  /** Highlight a hunter on the map ("" for nobody). */
  select(k: string) { this.selected = k; }
  /** Each hunter's field health, 0 to 1, for the hunter cards. */
  vitals(): Record<string, number> {
    return Object.fromEntries(Object.values(this.hs).map(h => [h.k, h.max ? Math.max(0, h.hp / h.max) : 1]));
  }

  /** What's under the pointer. Clicking a monster sends the nearest free hunters after it. */
  private pickAt(e: MouseEvent, peek = false): Pick {
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, S = this.S;
    const near = (p: Pt, w: number, h: number) => Math.abs(x - p.x) < w * S && y > p.y - h * S && y < p.y + 3 * S;
    const h = Object.values(this.hs).filter(h => near(h, 9, 20)).sort((a, b) => b.y - a.y)[0];
    if (h) return { kind: "hunter", k: h.k };
    const m = this.mobs.find(m => !m.dead && near(m, 10, 18));
    if (!m) return null;
    if (!peek) this.rally(m);
    return { kind: "mob" };
  }
  private rally(m: Mob) {
    const free = Object.values(this.hs).filter(h => h.state !== "sleep" && h.state !== "rest" && h.rest > 0 && h.hp > h.max * 0.3)
      .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y)).slice(0, 3);
    free.forEach(h => { h.gather = -1; if (h.target !== m) { h.target = m; this.addEmote(h, "emote:alert"); } });
    m.flash = 0.2;
    this.fx.push({ x: m.x, y: m.y, ring: "#FFD166", size: 1, life: 0, max: 0.6, vy: 0 });
    if (!free.length) this.addText(m.x, m.y - 24 * this.S, "Nobody free", NUM.miss, 11);
  }

  mount(host: HTMLElement) {
    if (this.cv.parentNode !== host) host.prepend(this.cv);
    // re-measure whenever the host changes size, including going from hidden (a phone tab) to shown
    this.ro?.disconnect();
    if ("ResizeObserver" in window) { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); }
    this.resize();
    this.wake();
  }
  setVisible(v: boolean) { this.visible = v; this.wake(); }
  update(input: SceneInput) {
    if (this.input?.zone.z !== input.zone.z) { this.mobs = []; this.groundKey = ""; }
    this.input = input;
    this.cv.setAttribute("aria-label", `Your village, seen from above. ${Object.keys(input.units).length} hunters on duty in ${input.zone.name}. ${input.fed ? "They have food." : "They're out of food and asleep."}`);
  }

  /* ── layout, in canvas pixels ── */
  private resize() {
    const host = this.cv.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    const oldW = this.W, oldH = this.H;
    this.W = r.width; this.H = r.height;
    // a sprite pixel is 2 to 3 screen pixels: big enough to read, small enough to fit a party
    this.S = Math.max(1.5, Math.min(3, Math.round(Math.min(this.W / 210, this.H / 130) * 2) / 2));
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.ctx = this.cv.getContext("2d");
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    this.ink = { text: v("--text", "#2a2118"), good: v("--teal", "#3e6e4e"), crit: v("--brick", "#983a33"), warn: v("--moment", "#b5482a") };
    const pf = v("--font-pixel", "");      // next/font's name for Pixelify Sans
    this.fontFam = `${pf ? pf + ", " : ""}"Pixelify Sans", ui-monospace, monospace`;
    this.groundKey = "";
    if (oldW && (oldW !== this.W || oldH !== this.H)) {
      const kx = this.W / oldW, ky = this.H / oldH;
      [...Object.values(this.hs), ...this.mobs].forEach(e => { e.x *= kx; e.tx *= kx; e.y *= ky; e.ty *= ky; });
    }
  }
  private lay() {
    const S = this.S, W = this.W, H = this.H;
    const town = Math.min(Math.max(W * 0.4, 128 * S * 0.9), 150 * S);
    return { S, W, H, town, f0: town + 10 * S, f1: W - 10 * S, top: 22 * S, bottom: H - 6 * S };
  }
  /** Where each building stands (bottom center), in a 2×2 block with a path between. */
  private bldPos(b: BuildingKey): Pt {
    const L = this.lay(), i = BLD_SLOTS.indexOf(b);
    const colW = L.town / 2, rowH = Math.min((L.H - 8 * L.S) / 2, 64 * L.S);
    return { x: colW * (i % 2) + colW / 2, y: 6 * L.S + rowH * (Math.floor(i / 2) + 1) };
  }
  private door(b: BuildingKey): Pt { const p = this.bldPos(b); return { x: p.x, y: p.y + 6 * this.S }; }

  /** Ground, path and border trees are drawn once into an offscreen canvas per size and zone. */
  private paintGround() {
    const inp = this.input!, L = this.lay(), zi = zoneIdx(inp.zone.z), [field, fill, kinds] = ZONE_LOOK[zi - 1];
    const theme = inp.theme ?? "", key = `${this.W}x${this.H}@${this.S}:${zi}:${theme}`;
    if (key === this.groundKey && this.ground) return;
    this.groundKey = key;
    const dpr = window.devicePixelRatio || 1, g = this.ground ?? document.createElement("canvas");
    g.width = this.cv.width; g.height = this.cv.height;
    const c = g.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGround(c, theme === "snow" ? "snow" : "grass", 0, 0, L.town + 4 * L.S, L.H, L.S, theme === "snow" ? "#ece6ea" : "#9db04a", 7);
    const tint = THEME_TINT[theme];
    if (tint) { c.fillStyle = tint; c.fillRect(0, 0, L.town + 4 * L.S, L.H); }
    drawGround(c, field, L.town + 4 * L.S, 0, L.W, L.H, L.S, fill, zi * 31);
    // the path out of town
    c.fillStyle = "rgba(160,110,60,0.28)";
    c.fillRect(L.town * 0.5 - 6 * L.S, 0, 12 * L.S, L.H);
    c.fillRect(L.town * 0.5, this.bldPos("inn").y + 8 * L.S, L.town * 0.5 + 6 * L.S, 10 * L.S);
    this.ground = g;
    // props: a row of trees on the border, a scatter in the field, seeded by zone
    let r = zi * 977 + 13;
    const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
    this.props = [];
    const border = theme === "blossom" ? "pinktree" : theme === "snow" || zi === 5 ? "snowpine" : theme === "autumn" ? "roundtree" : "pine";   // the town's tree line
    for (let y = 18 * L.S; y < L.H + 30 * L.S; y += 26 * L.S) this.props.push({ id: "prop:" + border, x: L.town + 2 * L.S, y });
    const n = Math.round((L.f1 - L.f0) * (L.H) / (2600 * L.S * L.S));
    for (let i = 0; i < n; i++) {
      const edge = rnd() < 0.5;
      this.props.push({ id: "prop:" + kinds[Math.floor(rnd() * kinds.length)], x: L.f0 + rnd() * (L.f1 - L.f0),
                        y: edge ? (rnd() < 0.5 ? 14 * L.S + rnd() * 10 * L.S : L.H + 4 * L.S) : 30 * L.S + rnd() * (L.H - 40 * L.S) });
    }
  }

  /* ── loop: only animate while someone can see it ── */
  wake() {
    const run = !document.hidden && this.visible && !!this.cv.parentNode;
    if (run && !this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.loop); }
    else if (!run && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }
  private loop = (ts: number) => {
    this.raf = 0;
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016);
    this.last = ts; this.clock += dt;
    if (this.input && this.W) { this.step(dt); this.draw(); }
    if (!document.hidden && this.visible) this.raf = requestAnimationFrame(this.loop);
  };

  private addText(x: number, y: number, text: string, color: string, size = 11) {
    if (this.input?.hitmarkers === false) return;
    this.fx.push({ x, y, text, color, size, life: 0, max: 1.1, vy: -26 });
  }
  /** The little X where a hit lands. */
  private addMark(x: number, y: number, crit: boolean) {
    if (this.input?.hitmarkers === false) return;
    this.fx.push({ x, y, mark: true, color: crit ? NUM.crit : NUM.hit, size: crit ? 1.4 : 1, life: 0, max: 0.2, vy: 0 });
  }
  /** Sparkles and a ring on a hunter who just got better gear. */
  celebrate(k: string) {
    const h = this.hs[k];
    if (!h) return;
    const tier = armorFor((this.input?.gear[k] ?? { a: 0 }).a).color || "#FFD166";
    this.fx.push({ x: h.x, y: h.y, ring: tier, size: 1, life: 0, max: 0.9, vy: 0 });
    this.addActorFx(h.x, h.y - 4 * this.S, "fx:spark");
    this.addActorFx(h.x + 6 * this.S, h.y - 12 * this.S, "fx:spark");
  }
  /** What each hunter is doing right now, for the hunter cards. */
  actions(): Record<string, string> {
    const out: Record<string, string> = {}, inp = this.input;
    if (!inp) return out;
    const names = MOB_NAMES[zoneIdx(inp.zone.z) - 1];
    if (this.fight) { Object.keys(inp.units).forEach(k => { out[k] = "Fighting the zone boss"; }); return out; }
    Object.values(this.hs).forEach(h => {
      out[h.k] = h.state === "sleep" ? "Asleep. Out of food."
        : h.state === "rest" ? "Resting at the inn"
        : h.state === "gather" ? (/rock/.test(this.props[h.gather]?.id ?? "") ? "Mining stone" : "Chopping wood")
        : h.gather >= 0 ? "Heading to gather"
        : h.state === "fight" && h.target && this.clock - h.hitAt < 0.9 ? `Taking a hit from a ${names[h.target.i] ?? "monster"}`
        : h.state === "fight" && h.target ? `${isRanged(h.k) ? "Shooting" : "Attacking"} a ${names[h.target.i] ?? "monster"}`
        : h.rest <= 0 && h.hp < h.max * 0.5 ? "Hurt. Going back to the inn to heal"
        : h.rest <= 0 ? "Heading back to the inn"
        : h.target ? `Going after a ${names[h.target.i] ?? "monster"}` : `Scouting ${inp.zone.name}`;
    });
    return out;
  }
  private addActorFx(x: number, y: number, actor: string, rise = 0) { this.fx.push({ x, y, actor, size: 1, life: 0, max: Math.max(0.35, animLength(actor)), vy: rise }); }

  private walk(e: Walker, dt: number) {
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    e.moving = d > 1.5;
    if (!e.moving) return true;
    const step = Math.min(d, e.speed * this.S * dt);
    e.x += dx / d * step; e.y += dy / d * step; e.dir = dirTo(dx, dy);
    return false;
  }
  private fieldPoint(): Pt {
    const L = this.lay();
    return { x: L.f0 + 16 * L.S + Math.random() * (L.f1 - L.f0 - 32 * L.S), y: L.top + 20 * L.S + Math.random() * (L.bottom - L.top - 26 * L.S) };
  }
  private sync() {
    const units = this.input!.units, inn = this.door("inn");
    Object.keys(this.hs).forEach(k => { if (!units[k]) delete this.hs[k]; });
    Object.keys(units).forEach((k, i) => {
      const h = this.hs[k], max = units[k].hp;
      if (h) {               // gear or rank changed: keep the same share of health
        if (h.max !== max) { h.hp = h.hp / (h.max || max) * max; h.max = max; }
        return;
      }
      this.hs[k] = { k, x: inn.x + (i % 3 - 1) * 10 * this.S, y: inn.y + 4 * this.S, tx: inn.x, ty: inn.y, dir: "down", speed: 26 + Math.random() * 10,
                     moving: false, state: "walk", cd: Math.random(), lunge: 0, flash: 0, rest: 25 + Math.random() * 30, wait: 0, target: null, slot: i,
                     gather: -1, swings: 0, knock: 0, kx: 0, ky: 0, hitAt: -9, hp: max, max, side: 1, sideFor: null };
    });
  }
  private spawnMob() {
    const inp = this.input!, i = Math.floor(Math.random() * 2), p = this.fieldPoint();
    const hp = Math.max(30, (inp.dps || 30) * 2.4 / Math.max(inp.eff || 0.2, 0.15));
    this.mobs.push({ i, ...p, tx: p.x, ty: p.y, dir: "down", speed: 9 + Math.random() * 6, moving: false,
                     hp, max: hp, flash: 0, dead: 0, think: Math.random() * 3, cd: 1 + Math.random(), lunge: 0, lx: 0, ly: 0, turn: 0 });
  }

  private step(dt: number) {
    const inp = this.input!;
    this.fx.forEach(f => { f.life += dt; f.y += f.vy * dt; });
    this.fx = this.fx.filter(f => f.life < f.max);
    this.stepFlakes(dt);
    this.shots.forEach(s => { s.t += dt; if (s.t >= s.dur) s.land(); });
    this.shots = this.shots.filter(s => s.t < s.dur);
    if (this.shake > 0) this.shake -= dt;
    if (this.fight) return this.fightStep(dt);
    this.sync();
    const hunters = Object.values(this.hs);
    const want = inp.fed ? Math.min(2 + Math.ceil(hunters.length / 2), 6) : 3;
    this.spawn -= dt;
    if (this.mobs.filter(m => !m.dead).length < want && this.spawn <= 0) { this.spawnMob(); this.spawn = 1 + Math.random() * 1.5; }
    // monsters wander, and hit back at every hunter fighting them, taking turns
    this.mobs.forEach(m => {
      if (m.flash > 0) m.flash -= dt;
      if (m.lunge > 0) m.lunge -= dt;
      if (m.dead) { m.dead += dt; return; }
      const foes = hunters.filter(h => h.state === "fight" && h.target === m);
      if (foes.length) {
        const foe = foes[m.turn % foes.length];
        m.tx = m.x; m.ty = m.y; m.moving = false; m.dir = dirTo(foe.x - m.x, foe.y - m.y);
        m.cd -= dt;
        if (m.cd <= 0) { m.turn++; this.mobHits(m, foe); }
        return;
      }
      m.think -= dt;
      if (m.think <= 0) { const p = this.fieldPoint(); m.tx = m.x + (p.x - m.x) * 0.35; m.ty = m.y + (p.y - m.y) * 0.35; m.think = 2 + Math.random() * 3; }
      this.walk(m, dt);
    });
    this.mobs = this.mobs.filter(m => m.dead < 0.45);
    const inn = this.door("inn");
    hunters.forEach(h => {
      const u = inp.units[h.k];
      if (h.lunge > 0) h.lunge -= dt;
      if (h.flash > 0) h.flash -= dt;
      if (h.knock > 0) h.knock -= dt;
      const bed = { x: inn.x + ((h.slot % 4) - 1.5) * 9 * this.S, y: inn.y + (4 + Math.floor(h.slot / 4) * 9) * this.S };
      if (!inp.fed) { h.target = null; h.gather = -1; h.tx = bed.x; h.ty = bed.y; h.state = this.walk(h, dt) ? "sleep" : "walk"; if (h.state === "sleep") h.dir = "down"; return; }
      if (h.state === "rest") {            // heal up at the inn, then head back out
        h.wait -= dt; h.hp = Math.min(h.max, h.hp + h.max * 0.3 * dt);
        if (h.wait <= 0 && h.hp >= h.max) { h.state = "walk"; h.rest = 25 + Math.random() * 30; }
        return;
      }
      if (h.state !== "fight") h.hp = Math.min(h.max, h.hp + h.max * 0.01 * dt);   // catching their breath
      h.rest -= dt;
      if (h.rest <= 0) {       // a breather at the inn, like hunters in Evil Hunter Tycoon
        h.target = null; h.gather = -1; h.tx = bed.x; h.ty = bed.y;
        if (this.walk(h, dt)) { h.state = "rest"; h.dir = "down"; h.wait = 2.5 + Math.random() * 2; } else h.state = "walk";
        return;
      }
      if (h.gather >= 0) return this.gatherStep(h, dt);
      if (!h.target || h.target.dead) {
        const load = (m: Mob) => hunters.filter(o => o.target === m).length;
        const free = this.mobs.filter(m => !m.dead && load(m) < 2);
        // no monster worth chasing (or a breather between fights): gather from a tree or rock instead
        if (!free.length || (h.target === null && Math.random() < 0.004)) { if (this.startGather(h, hunters)) return; }
        const next = free.sort((a, b) => load(a) - load(b) || Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0] || null;
        if (next && next !== h.target) this.addEmote(h, "emote:alert");
        h.target = next;
      }
      const m = h.target;
      if (!m) { h.state = "walk"; if (this.walk(h, dt)) { const p = this.fieldPoint(); h.tx = p.x; h.ty = p.y; } return; }
      // melee hunters stand next to the monster; snipers keep their distance and shoot
      const ranged = isRanged(h.k), reach = (ranged ? RANGE_SHOT : RANGE_MELEE) * this.S;
      // pick a side once per target (re-picking every frame made hunters cross back and forth over it forever):
      // the near side, unless a teammate already stands there
      const L = this.lay();
      if (h.sideFor !== m) {
        const near = h.x < m.x ? -1 : 1, taken = hunters.some(o => o !== h && o.target === m && o.sideFor === m && o.side === near);
        h.side = taken ? -near : near; h.sideFor = m;
      }
      const spot = (sd: number) => m.x + sd * reach, inField = (x: number) => x > L.f0 + 6 * this.S && x < L.f1 - 6 * this.S;
      if (!inField(spot(h.side)) && inField(spot(-h.side))) h.side = -h.side;    // no room on that side: stand on the other
      h.tx = spot(h.side);
      h.ty = m.y + ((h.slot % 3) - 1) * 3 * this.S;
      if (h.knock <= 0 && !this.walk(h, dt)) { h.state = "walk"; return; }
      h.state = "fight"; h.dir = dirTo(m.x - h.x, m.y - h.y); h.cd -= dt;
      if (h.cd > 0 || !u) return;
      h.cd = 1 / u.spd; h.lunge = 0.18;
      const crit = Math.random() < u.crit, dmg = u.atk * (crit ? u.cdmg : 1) * (0.9 + 0.2 * Math.random());
      if (!ranged) return this.hitMob(h, m, dmg, crit, hunters);
      const tier = gearTier(this.input?.gear[h.k]?.w ?? 0);
      this.shots.push({ x0: h.x, y0: h.y - 9 * this.S, to: () => ({ x: m.x, y: m.y - 8 * this.S }), t: 0, dur: 0.28,
                        kind: tier >= 2 ? "bolt" : "arrow", color: tier >= 2 ? "#B79CFF" : "#F3E3C2",
                        land: () => { if (!m.dead) this.hitMob(h, m, dmg, crit, hunters); } });
    });
  }

  /** A hunter's blow (or arrow) lands on a monster. */
  private hitMob(h: Hunter, m: Mob, dmg: number, crit: boolean, hunters: Hunter[]) {
    m.flash = 0.12; m.hp -= dmg;
    this.addActorFx(m.x, m.y + 2 * this.S, "fx:slash");
    this.addMark(m.x + (Math.random() - 0.5) * 6 * this.S, m.y - 8 * this.S, crit);
    this.addText(m.x + (Math.random() - 0.5) * 8 * this.S, m.y - 18 * this.S, fmtN(dmg), crit ? NUM.crit : NUM.hit, crit ? 14 : 12);
    if (m.hp > 0) return;
    m.dead = 0.001;
    hunters.forEach(o => { if (o.target === m) o.target = null; });
    this.addActorFx(m.x, m.y, "fx:smoke");
    const drop = Math.random() < 0.15 ? "res:gem" : Math.random() < 0.5 ? "res:stone" : "res:herb";
    this.addActorFx(m.x, m.y - 8 * this.S, drop, -22);
    if (Math.random() < 0.3) this.startGather(h, hunters);     // between fights, gather a little
  }

  /** A monster strikes a hunter fighting it: up close it lunges, at range it spits a shot. Hurt hunters go heal. */
  private mobHits(m: Mob, h: Hunter) {
    m.cd = 1.3 + Math.random() * 0.9; m.lunge = 0.18;
    const dx = h.x - m.x, dy = h.y - m.y, d = Math.hypot(dx, dy) || 1;
    m.lx = dx / d; m.ly = dy / d;
    const eff = Math.min(1, this.input!.eff || 0.2), dmg = h.max * (0.04 + Math.random() * 0.04) * (1.5 - eff);
    const land = () => {
      h.flash = 0.22; h.knock = 0.16; h.kx = m.lx; h.ky = m.ly; h.hitAt = this.clock;
      h.hp = Math.max(1, h.hp - dmg);
      this.addMark(h.x, h.y - 8 * this.S, false);
      this.addText(h.x + (Math.random() - 0.5) * 6 * this.S, h.y - 20 * this.S, "-" + fmtN(dmg), NUM.hurt, 11);
      if (h.hp < h.max * 0.3 && h.rest > 0) { h.rest = 0; h.target = null; this.addEmote(h, "emote:heart"); }
    };
    if (d < (RANGE_MELEE + 6) * this.S) return land();
    this.shots.push({ x0: m.x, y0: m.y - 7 * this.S, to: () => ({ x: h.x, y: h.y - 8 * this.S }), t: 0, dur: 0.35, kind: "orb", color: "#FF8A7A", land });
  }

  /** Pick the nearest tree or rock in the field nobody else is working on. */
  private startGather(h: Hunter, hunters: Hunter[]) {
    const L = this.lay(), taken = new Set(hunters.filter(o => o !== h).map(o => o.gather));
    const options = this.props.map((p, i) => ({ p, i })).filter(({ p, i }) => p.x > L.f0 && p.y > L.top && p.y < L.bottom + 4 * L.S && !taken.has(i));
    if (!options.length) return false;
    const { i } = options.sort((a, b) => Math.hypot(a.p.x - h.x, a.p.y - h.y) - Math.hypot(b.p.x - h.x, b.p.y - h.y))[0];
    h.gather = i; h.swings = 4 + Math.floor(Math.random() * 3); h.target = null; h.cd = 0.3;
    return true;
  }
  /** Walk up to the tree or rock, swing at it, and bring home wood, stone or the odd gem. */
  private gatherStep(h: Hunter, dt: number) {
    const p = this.props[h.gather], rock = /rock/.test(p.id), stump = /stump/.test(p.id);
    const sideX = h.slot % 2 ? 1 : -1;
    h.tx = p.x + sideX * 12 * this.S; h.ty = p.y + 3 * this.S;
    if (!this.walk(h, dt)) { h.state = "walk"; return; }
    h.state = "gather"; h.dir = sideX > 0 ? "left" : "right";
    h.cd -= dt;
    if (h.cd > 0) return;
    h.cd = 0.6; h.lunge = 0.18; h.swings--;
    this.addActorFx(p.x + (Math.random() - 0.5) * 6 * this.S, p.y - 6 * this.S, rock ? "fx:rock" : stump ? "fx:wood" : "fx:leaf");
    if (h.swings > 0) return;
    const res = rock ? (Math.random() < 0.12 ? "res:gem" : "res:stone") : "res:wood";
    this.addActorFx(p.x, p.y - 14 * this.S, res, -18);
    this.addText(p.x, p.y - 30 * this.S, rock ? (res === "res:gem" ? "+gem" : "+stone") : "+wood", NUM.crit, 11);
    h.gather = -1;
  }
  private addEmote(h: Hunter, id: string) { this.fx.push({ x: h.x + 6 * this.S, y: h.y - 16 * this.S, actor: id, size: 1, life: 0, max: 0.8, vy: -6 }); }

  private sprite(id: string, x: number, y: number, anim = "idle", dir: Dir = "down", alpha = 1, scale = 1, t = this.clock) {
    drawActor(this.ctx!, id, x, y, { anim, dir, t, scale: this.S * scale, alpha });
  }
  private font(size: number) { return `600 ${size}px ${this.fontFam}`; }
  /** A floating number: light fill, crisp dark outline. */
  private num(s: string, x: number, y: number, color: string, size = 12) {
    const c = this.ctx!;
    c.font = this.font(size);
    c.textAlign = "center"; c.textBaseline = "bottom"; c.lineJoin = "round"; c.miterLimit = 2;
    c.lineWidth = 3.5; c.strokeStyle = NUM.outline; c.strokeText(s, x, y);
    c.fillStyle = color; c.fillText(s, x, y);
  }
  /** Words on a solid rounded plate, centered on (x, y). */
  private label(s: string, x: number, y: number, size = 12, color = PLATE.text) {
    const c = this.ctx!;
    c.font = this.font(size);
    const w = c.measureText(s).width + size * 1.4, h = size * 2;
    const x0 = Math.max(4, Math.min(this.W - w - 4, x - w / 2)), y0 = y - h / 2;
    c.fillStyle = PLATE.bg; c.strokeStyle = PLATE.border; c.lineWidth = 1;
    c.beginPath(); c.roundRect(x0, y0, w, h, h / 2); c.fill(); c.stroke();
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = color;
    c.fillText(s, x0 + w / 2, y0 + h / 2 + 0.5);
  }
  /** A label that wraps onto two plates when it's wider than `max`. */
  private wrapLabel(s: string, x: number, y: number, max: number) {
    const c = this.ctx!;
    c.font = this.font(12);
    if (c.measureText(s).width + 17 <= max) return this.label(s, x, y);
    const words = s.split(" "); let a = "";
    while (words.length && c.measureText(a + " " + words[0]).width + 17 <= max) a = (a ? a + " " : "") + words.shift();
    this.label(a, x, y - 14); this.label(words.join(" "), x, y + 14);
  }
  private hpBar(x: number, y: number, w: number, frac: number, col: string) {
    const c = this.ctx!;
    c.fillStyle = "rgba(24,20,16,0.72)"; c.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 4);
  }

  private draw() {
    const ctx = this.ctx!, inp = this.input!, L = this.lay(), zi = zoneIdx(inp.zone.z), alt = lapAlt(inp.zone.z);
    this.paintGround();
    ctx.save();
    ctx.clearRect(0, 0, L.W, L.H);
    if (this.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3);
    if (this.ground) ctx.drawImage(this.ground, 0, 0, L.W, L.H);
    // everything that stands on the ground is drawn back to front
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    this.props.forEach(p => list.push({ y: p.y, draw: () => this.sprite(p.id, p.x, p.y) }));
    BLD_SLOTS.forEach(b => {
      const p = this.bldPos(b);
      list.push({ y: p.y, draw: () => this.sprite("bld:" + b, p.x, p.y) });
    });
    const slots = this.decoSlots();
    (inp.decos ?? []).forEach((id, i) => {
      const c = cosmetic(id), p = slots[i % Math.max(1, slots.length)];
      if (!c || !p) return;
      const big = c.sprite?.startsWith("bld:");
      list.push({ y: p.y, draw: () => this.sprite(c.sprite ?? "deco:" + id, p.x, p.y, "idle", "down", 1, big ? 0.6 : 0.85) });
    });
    if (inp.daRunning) {
      const m = this.door("market");
      list.push({ y: m.y + 3 * this.S, draw: () => {
        this.sprite("npc:you", m.x + 12 * this.S, m.y + 3 * this.S, "walk", "down", 1, 1, this.clock * 0.5);
        this.sprite("emote:star", m.x + 12 * this.S, m.y - 14 * this.S);
      } });
    }
    if (this.fight) this.collectFight(list);
    else {
      this.mobs.forEach(m => list.push({ y: m.y, draw: () => {
        const id = `mob:${zi}:${m.i}${alt ? ":alt" : ""}`;
        const ml = m.lunge > 0 ? 4 * this.S : 0;
        this.sprite(id, m.x + m.lx * ml, m.y + m.ly * ml, m.moving || m.lunge > 0 ? "walk" : "idle", m.dir, m.dead ? Math.max(0, 1 - m.dead * 2.4) : 1);
        if (m.flash > 0) this.flashAt(m.x, m.y, "rgba(255,255,255,0.55)");
        if (!m.dead) this.hpBar(m.x, m.y - 19 * this.S, 14 * this.S, m.hp / m.max, this.ink.crit);
      } }));
      Object.values(this.hs).forEach(h => list.push({ y: h.y, draw: () => {
        const sleeping = h.state === "sleep" || h.state === "rest";
        if (h.k === this.selected || h.k === this.hover) this.ring(h.x, h.y, h.k === this.selected ? "#FFD166" : "rgba(255,253,249,0.8)");
        if (h.state !== "sleep") this.drawAura(h.k, h.x, h.y);
        const anim = h.lunge > 0 ? "attack" : h.moving ? "walk" : "idle";
        const kb = h.knock > 0 ? (h.knock / 0.16) * 4 * this.S : 0;
        const lx = (h.lunge > 0 ? ({ left: -3, right: 3, up: 0, down: 0 }[h.dir]) * this.S : 0) + h.kx * kb;
        const ly = (h.lunge > 0 ? ({ up: -3, down: 3, left: 0, right: 0 }[h.dir]) * this.S : 0) + h.ky * kb;
        this.drawHunter(h.k, h.x + lx, h.y + ly, anim, h.dir, h.lunge > 0, 1, this.clock + h.slot * 0.13);
        if (h.flash > 0) this.flashAt(h.x, h.y, "rgba(156,74,70,0.4)");
        if (h.state !== "sleep") this.hpBar(h.x, h.y + 2 * this.S, 14 * this.S, h.hp / h.max, hpColor(h.hp / h.max));
        if (sleeping) this.sprite(h.state === "sleep" ? "emote:sleep" : "emote:heart",
                                  h.x + 6 * this.S, h.y - 16 * this.S - (REDUCED ? 0 : Math.abs(Math.sin(this.clock * 2 + h.slot)) * 2 * this.S));
      } }));
    }
    list.sort((a, b) => a.y - b.y).forEach(d => d.draw());
    this.drawTheme(slots);
    this.shots.forEach(s => this.drawShot(s));
    // name and health over the hunter you point at or picked
    if (!this.fight) [this.hover, this.selected].filter((k, i, a) => k && a.indexOf(k) === i).forEach(k => {
      const h = this.hs[k], u = inp.units[k];
      if (!h || !u) return;
      this.label(`${HUNTERS[k].name.split(" ")[0]}  ${fmtN(h.hp)} / ${fmtN(h.max)} HP`, h.x, h.y - 30 * this.S, 11);
    });
    this.fx.forEach(f => {
      const a = Math.max(0, 1 - f.life / f.max);
      if (f.mark) {
        const r = (3 + f.life * 22) * this.S * 0.5 * f.size, g = 3 * this.S * f.size * 0.5;
        ctx.save(); ctx.lineCap = "round";
        for (const [w, col] of [[4, NUM.outline], [2, f.color!]] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
          for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { ctx.moveTo(f.x + dx * g, f.y + dy * g); ctx.lineTo(f.x + dx * (g + r), f.y + dy * (g + r)); }
          ctx.stroke();
        }
        ctx.restore();
      } else if (f.ring) {
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = f.ring; ctx.lineWidth = 2 * this.S;
        ctx.beginPath(); ctx.ellipse(f.x, f.y - this.S, (7 + f.life * 16) * this.S * f.size, (2.6 + f.life * 6) * this.S * f.size, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f.actor) drawActor(ctx, f.actor, f.x, f.y, { t: f.life, scale: this.S, once: true, alpha: f.actor === "fx:coin" || f.actor.startsWith("res:") ? a : 1 });
      else if (f.text) { ctx.save(); ctx.globalAlpha = a; this.num(f.text, f.x, f.y, f.color ?? NUM.hit, f.size); ctx.restore(); }
    });
    if (!this.fight) {
      const msg = !Object.keys(this.hs).length
        ? (inp.anyTrained ? "Nobody is on duty. Open the village to send hunters out." : "Solve a LeetCode problem to recruit your first hunter.")
        : !inp.fed ? "Out of food. One application wakes them up." : "";
      if (msg) {
        ctx.fillStyle = "rgba(20,24,40,0.18)"; ctx.fillRect(L.town + 4 * L.S, 0, L.W, L.H);
        this.wrapLabel(msg, (L.f0 + L.f1) / 2, L.H / 2, L.f1 - L.f0 - 12);
      }
    }
    ctx.restore();
  }
  /** A hunter with their armor's rim under their feet and their weapon in hand (it swings on a hit). */
  private drawHunter(k: string, x: number, y: number, anim: string, dir: Dir, swing: boolean, alpha: number, t = this.clock) {
    const c = this.ctx!, S = this.S, g = this.input?.gear[k] ?? { w: 0, a: 0 }, h = HUNTERS[k];
    const rim = armorFor(g.a).color;
    if (rim) {
      c.save(); c.globalAlpha = 0.85 * alpha; c.strokeStyle = rim; c.lineWidth = Math.max(1.5, S * 0.9);
      c.beginPath(); c.ellipse(x, y - S, 7 * S, 2.6 * S, 0, 0, 7); c.stroke(); c.restore();
    }
    const [weapon] = h ? weaponFor(h.cls, g.w) : ["Stick"];
    const side = dir === "left" ? -1 : 1, behind = dir === "up";
    const wx = x + (dir === "up" ? -5 : dir === "down" ? 6 : 6 * side) * S, wy = y - 4 * S;
    const rot = (swing ? 1.1 : 0.35) * side;
    const drawWeapon = () => drawActor(c, "weapon:" + weapon, wx, wy, { scale: S * 0.72, rotate: rot, alpha, flip: side < 0 });
    const pen = cosmetic(this.input?.look?.[k]?.pennant ?? "")?.color;
    if (pen) {          // a little flag on the hunter's back, waving
      const px = x - (dir === "left" ? -5 : 5) * S, top = y - 23 * S, wave = REDUCED ? 0 : Math.sin(this.clock * 6 + x) * 1.2 * S;
      c.save(); c.globalAlpha = alpha;
      c.strokeStyle = "#5A4632"; c.lineWidth = Math.max(1.2, S * 0.6); c.beginPath(); c.moveTo(px, y - 6 * S); c.lineTo(px, top); c.stroke();
      c.fillStyle = pen; c.strokeStyle = "rgba(24,20,16,0.6)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(px, top); c.lineTo(px + 8 * S, top + 2.5 * S + wave); c.lineTo(px, top + 5 * S); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    if (behind) drawWeapon();
    this.sprite("hunter:" + k, x, y, anim, dir, alpha, 1, t);
    if (!behind) drawWeapon();
  }
  /** A soft glow under a hunter wearing an aura. */
  private drawAura(k: string, x: number, y: number) {
    const col = cosmetic(this.input?.look?.[k]?.aura ?? "")?.color;
    if (!col) return;
    const c = this.ctx!, S = this.S, pulse = REDUCED ? 1 : 1 + Math.sin(this.clock * 3 + x) * 0.08;
    const g = c.createRadialGradient(x, y - S, 0, x, y - S, 11 * S * pulse);
    g.addColorStop(0, col + "AA"); g.addColorStop(1, col + "00");
    c.save(); c.fillStyle = g; c.beginPath(); c.ellipse(x, y - S, 11 * S * pulse, 4.5 * S * pulse, 0, 0, 7); c.fill(); c.restore();
  }
  /** Open spots for decorations: in town away from buildings and the path, then along the field's edges. */
  private decoSlots(): Pt[] {
    const L = this.lay(), S = L.S, key = `${L.W}x${L.H}@${S}`;
    if (this.slots.key === key) return this.slots.pts;
    const blds = BLD_SLOTS.map(b => ({ ...this.bldPos(b), ...actorSize("bld:" + b) }));
    const pts: Pt[] = [], cx = L.town * 0.5, inn = this.bldPos("inn");
    for (let y = 22 * S; y < L.H - 4 * S; y += 14 * S) for (let x = 9 * S; x < L.town - 6 * S; x += 14 * S) {
      if (Math.abs(x - cx) < 11 * S) continue;                                                 // the path
      if (x > cx && Math.abs(y - inn.y - 13 * S) < 9 * S) continue;                               // the path out to the field
      if (blds.some(b => Math.abs(x - b.x) < (b.w * S) / 2 + 6 * S && y > b.y - b.h * S - 2 * S && y < b.y + 12 * S)) continue;
      pts.push({ x, y });
    }
    // mix them up (the same way every time) so the first few aren't all in one corner
    pts.sort((a, b) => ((a.x * 7 + a.y * 13) % 97) - ((b.x * 7 + b.y * 13) % 97));
    // town fills up fast: then a row along the bottom of the field (monsters keep to the middle), then the top
    for (let x = L.f0 + 22 * S; x < L.f1 - 8 * S; x += 20 * S) pts.push({ x, y: L.H - 3 * S });
    for (let x = L.f0 + 32 * S; x < L.f1 - 8 * S; x += 24 * S) pts.push({ x, y: L.top - 2 * S });
    this.slots = { key, pts };
    return pts;
  }
  private stepFlakes(dt: number) {
    const f = FLAKE[this.input?.theme ?? ""];
    if (!f || REDUCED) { this.flakes = []; return; }
    const want = Math.round(this.W * this.H / 9000 * f.n);
    while (this.flakes.length < want) this.flakes.push({ x: Math.random() * this.W, y: Math.random() * this.H, vx: 4 + Math.random() * 8, vy: f.fall * (0.6 + Math.random() * 0.8), r: 1 + Math.random() * 1.4, spin: Math.random() * 6 });
    this.flakes.forEach(k => {
      k.x += (k.vx + Math.sin(this.clock + k.spin) * 6) * dt; k.y += k.vy * dt; k.spin += dt;
      if (k.y > this.H + 4) { k.y = -4; k.x = Math.random() * this.W; }
      if (k.x > this.W + 4) k.x = -4;
    });
  }
  /** Night darkens everything but lights; the others drift leaves, petals or snow. */
  private drawTheme(slots: Pt[]) {
    const c = this.ctx!, inp = this.input!, S = this.S, theme = inp.theme ?? "";
    if (theme === "night") {
      c.save(); c.fillStyle = "rgba(16,20,56,0.42)"; c.fillRect(0, 0, this.W, this.H);
      c.globalCompositeOperation = "lighter";
      const glow = (x: number, y: number, r: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,190,100,0.42)"); g.addColorStop(1, "rgba(255,190,100,0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      };
      BLD_SLOTS.forEach(b => { const d = this.door(b); glow(d.x, d.y - 10 * S, 26 * S); });
      (inp.decos ?? []).forEach((id, i) => { const p = slots[i % Math.max(1, slots.length)]; if (p && LIGHTS.has(id)) glow(p.x, p.y - 6 * S, 22 * S); });
      c.restore();
    }
    const f = FLAKE[theme];
    if (!f) return;
    c.save(); c.fillStyle = f.col; c.globalAlpha = 0.85;
    this.flakes.forEach(k => {
      c.beginPath();
      if (theme === "snow") c.arc(k.x, k.y, k.r * S * 0.6, 0, 7);
      else c.ellipse(k.x, k.y, k.r * S * 0.9, k.r * S * 0.45, k.spin, 0, 7);
      c.fill();
    });
    c.restore();
  }
  /** A ring on the ground under someone you've picked or are pointing at. */
  private ring(x: number, y: number, col: string) {
    const c = this.ctx!, S = this.S;
    c.save(); c.strokeStyle = col; c.lineWidth = Math.max(1.5, S * 0.8); c.setLineDash([3 * S, 2 * S]);
    c.lineDashOffset = -this.clock * 12 * S;
    c.beginPath(); c.ellipse(x, y - S, 10 * S, 3.6 * S, 0, 0, 7); c.stroke(); c.restore();
  }
  private drawShot(s: Shot) {
    const c = this.ctx!, S = this.S, k = Math.min(1, s.t / s.dur), to = s.to(), lift = (s.kind === "arrow" ? 6 : 2) * S;
    const at = (q: number) => [s.x0 + (to.x - s.x0) * q, s.y0 + (to.y - s.y0) * q - Math.sin(q * Math.PI) * lift];
    const [x, y] = at(k), [nx, ny] = at(Math.min(1, k + 0.05));
    c.save();
    if (s.kind === "arrow") {
      c.translate(x, y); c.rotate(Math.atan2(ny - y, nx - x));
      c.lineCap = "round";
      c.strokeStyle = NUM.outline; c.lineWidth = 3; c.beginPath(); c.moveTo(-5 * S, 0); c.lineTo(3 * S, 0); c.stroke();
      c.strokeStyle = s.color; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-5 * S, 0); c.lineTo(3 * S, 0); c.stroke();
      c.fillStyle = s.color; c.beginPath(); c.moveTo(4.5 * S, 0); c.lineTo(2 * S, -1.6 * S); c.lineTo(2 * S, 1.6 * S); c.fill();
    } else {
      const r = (s.kind === "orb" ? 2.6 : 2.2) * S;
      c.fillStyle = s.color; c.globalAlpha = 0.35; c.beginPath(); c.arc(x, y, r * 2, 0, 7); c.fill();
      c.globalAlpha = 1; c.strokeStyle = NUM.outline; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
    }
    c.restore();
  }
  private flashAt(x: number, y: number, col: string) {
    const c = this.ctx!;
    c.fillStyle = col; c.beginPath(); c.ellipse(x, y - 8 * this.S, 8 * this.S, 9 * this.S, 0, 0, 7); c.fill();
  }

  /* ── boss fights ── */
  playFight(units: Unit[], boss: Fight["boss"], log: FightEvent[], res: { win: boolean; timeout: boolean; t: number }, onDone: () => void) {
    this.shots = [];
    this.fight = { units, boss, log, win: res.win, timeout: res.timeout, t: 0, i: 0, speed: Math.max(1, res.t / 8), bhp: boss.hp,
                   hp: units.map(u => u.hp), lunge: units.map(() => 0), flash: units.map(() => 0), bflash: 0, end: 0, onDone,
                   dash: units.map(() => 0), blunge: 0, btarget: 0 };
    this.wake();
  }
  private bossAt(): Pt { const L = this.lay(); return { x: L.f0 + (L.f1 - L.f0) * 0.74, y: L.H * 0.8 }; }
  private bossId(z: number) { return `boss:${zoneIdx(z)}${lapAlt(z) ? ":alt" : ""}`; }
  /** Bosses are drawn smaller when the map is short, so their name and health always fit above them. */
  private bossScale(id: string) { return Math.min(1, (this.H * 0.52) / (actorSize(id).h * this.S)); }
  private bossBox(f: Fight) {
    const id = this.bossId(f.boss.z), bs = this.bossScale(id), sz = actorSize(id);
    return { id, bs, w: sz.w * this.S * bs, h: sz.h * this.S * bs };
  }
  private fightPos(i: number): Pt {
    const L = this.lay(), f = this.fight!, u = f.units[i];
    const row = f.units.filter(x => x.row === u.row), j = row.indexOf(u), n = row.length;
    const fw = L.f1 - L.f0, b = this.bossAt();
    const x = L.f0 + fw * (u.row === "front" ? 0.42 : 0.2);
    const span = Math.min(L.H - 40 * L.S, n * 18 * L.S);
    return { x: x - (j % 2) * 4 * L.S, y: b.y - span / 2 + (n > 1 ? j * span / (n - 1) : span / 2) };
  }
  /** Where a hunter is drawn this frame: home, or partway through a dash to the boss and back. */
  private fighterAt(i: number): Pt {
    const f = this.fight!, home = this.fightPos(i), d = f.dash[i];
    if (d <= 0) return home;
    const b = this.bossAt(), box = this.bossBox(f), k = Math.sin((1 - d / DASH) * Math.PI);
    const strike = { x: b.x - box.w * 0.42 - 6 * this.S, y: b.y - (home.y < b.y - 4 * this.S ? 6 : 0) * this.S };
    return { x: home.x + (strike.x - home.x) * k, y: home.y + (strike.y - home.y) * k };
  }
  private fightStep(dt: number) {
    const f = this.fight!, b = this.bossAt(), box = this.bossBox(f);
    f.lunge = f.lunge.map(x => Math.max(0, x - dt)); f.flash = f.flash.map(x => Math.max(0, x - dt)); f.bflash = Math.max(0, f.bflash - dt);
    f.dash = f.dash.map(x => Math.max(0, x - dt)); f.blunge = Math.max(0, f.blunge - dt);
    if (f.end) { f.end -= dt; if (f.end <= 0) { this.fight = null; this.shots = []; f.onDone(); } return; }
    const skipping = f.t === Infinity;
    f.t += dt * f.speed;
    const onBoss = () => ({ x: b.x + (Math.random() - 0.5) * box.w * 0.4, y: b.y - box.h * (0.3 + Math.random() * 0.3) });
    while (f.i < f.log.length && f.log[f.i].t <= f.t) {
      const e = f.log[f.i++];
      if (e.a === "hit") {
        const i = e.i, thorns = f.hp[i] - e.hp;
        f.lunge[i] = 0.15; f.bhp = e.bhp; f.hp[i] = e.hp;
        const land = () => {
          if (!e.miss) {
            f.bflash = 0.15;
            const at = onBoss();
            this.addActorFx(at.x, at.y + 8 * this.S, "fx:slash");
            this.addMark(at.x, at.y, e.crit);
          }
          this.addText(b.x + (Math.random() - 0.5) * 30 * this.S, b.y - box.h - 2 * this.S - Math.random() * 8 * this.S,
                       e.miss ? "miss" : fmtN(e.dmg), e.miss ? NUM.miss : e.crit ? NUM.crit : NUM.hit, e.crit ? 15 : 12);
          if (thorns > 0.5) { const p = this.fightPos(i); this.addText(p.x, p.y - 22 * this.S, "-" + fmtN(thorns) + " thorns", NUM.hurt, 10); }
        };
        if (skipping) continue;
        if (isRanged(f.units[i].k)) {
          const p = this.fightPos(i), tier = gearTier(this.input?.gear[f.units[i].k]?.w ?? 0), at = onBoss();
          this.shots.push({ x0: p.x + 6 * this.S, y0: p.y - 9 * this.S, to: () => at, t: 0, dur: 0.22,
                            kind: tier >= 2 ? "bolt" : "arrow", color: tier >= 2 ? "#B79CFF" : "#F3E3C2", land });
        } else {
          if (f.dash[i] <= 0) f.dash[i] = DASH;
          land();
        }
      } else if (e.a === "boss") {
        const i = e.i, hp = e.hp;
        f.blunge = 0.3; f.btarget = i;
        const land = () => {
          f.hp[i] = hp; f.flash[i] = 0.25;
          const p = this.fightPos(i);
          this.addMark(p.x, p.y - 8 * this.S, false);
          this.addText(p.x, p.y - 18 * this.S, "-" + fmtN(e.dmg), NUM.hurt, 12);
          if (hp <= 0) this.addActorFx(p.x, p.y, "fx:smoke");
        };
        if (skipping) { f.hp[i] = hp; continue; }
        const p = this.fightPos(i);
        this.shots.push({ x0: b.x - box.w * 0.3, y0: b.y - box.h * 0.5, to: () => ({ x: p.x, y: p.y - 8 * this.S }), t: 0, dur: 0.3, kind: "orb", color: "#FF8A7A", land });
      } else {
        f.hp = e.hps.slice(); f.flash = f.flash.map(() => 0.3);
        if (skipping) continue;
        this.shake = 0.3; f.blunge = 0.3;
        this.fx.push({ x: b.x, y: b.y, ring: "#FF8A7A", size: 4, life: 0, max: 0.7, vy: 0 });
        f.units.forEach((_, i) => { const p = this.fightPos(i); this.addActorFx(p.x, p.y, "fx:smoke"); this.addText(p.x, p.y - 18 * this.S, "-" + fmtN(e.dmg), NUM.hurt, 12); });
      }
    }
    if (f.i >= f.log.length) { f.end = 2.4; this.shots.forEach(s => s.land()); this.shots = []; }
  }
  private collectFight(list: { y: number; draw: () => void }[]) {
    const f = this.fight!, b = this.bossAt(), { id, bs, h: bh } = this.bossBox(f);
    const tp = this.fightPos(f.btarget), bl = f.blunge > 0 ? Math.sin((1 - f.blunge / 0.3) * Math.PI) * 8 * this.S : 0;
    const bd = Math.hypot(tp.x - b.x, tp.y - b.y) || 1;
    list.push({ y: b.y, draw: () => {
      this.sprite(id, b.x + (tp.x - b.x) / bd * bl, b.y + (tp.y - b.y) / bd * bl * 0.4, f.bflash > 0 ? "hurt" : "idle", "down", f.end && f.win ? Math.max(0, f.end / 2.4) : 1, bs);
      this.hpBar(b.x, b.y - bh - 6 * this.S, 44 * this.S, f.bhp / f.boss.hp, this.ink.crit);
      this.label(`${f.boss.name}  ${fmtN(Math.max(0, f.bhp))} HP`, b.x, b.y - bh - 14 * this.S, 11);
    } });
    f.units.forEach((u, i) => {
      const p = this.fighterAt(i), dead = f.hp[i] <= 0, frac = f.hp[i] / u.hp;
      list.push({ y: p.y, draw: () => {
        const moving = f.dash[i] > 0;
        if (!dead) this.drawAura(u.k, p.x, p.y);
        this.drawHunter(u.k, p.x + (f.lunge[i] > 0 && !moving ? 3 * this.S : 0), p.y, moving ? "walk" : f.lunge[i] > 0 ? "attack" : "idle", "right", f.lunge[i] > 0, dead ? 0.3 : 1);
        if (f.flash[i] > 0 && !dead) this.flashAt(p.x, p.y, "rgba(156,74,70,0.4)");
        if (!dead) this.hpBar(p.x, p.y + 2 * this.S, 16 * this.S, frac, hpColor(frac));
      } });
    });
    list.push({ y: 1e9, draw: () => {
      const L = this.lay();
      if (f.end) this.label(f.win ? "Victory" : f.timeout ? "Out of time" : "Defeated", (L.f0 + L.f1) / 2, L.H * 0.24, 20, f.win ? PLATE.good : PLATE.bad);
      else {
        const left = f.units.filter((_, i) => f.hp[i] > 0).length;
        this.label(`${left} of ${f.units.length} standing. Tap to skip`, (L.f0 + L.f1) / 2, 12 * this.S, 10);
      }
    } });
  }
}

let scene: VillageScene | null = null;
export const getScene = () => (scene ??= new VillageScene());
