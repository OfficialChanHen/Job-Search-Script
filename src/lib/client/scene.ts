"use client";
/* The village, seen from above. The town (inn, kitchen, forge, market) sits on
   the left; the hunting ground fills the right. Hunters walk out, fight the
   zone's monsters, go back to the inn to rest, and sleep there when there's no
   food. Boss fights replay a simulation log on the field. One canvas, moved
   between wherever the village is shown. Pixel art from the Ninja Adventure
   pack (CC0), drawn through sprites.ts; emoji stand in for anything missing. */
import { BUILDINGS, HUNTERS, MOB_NAMES, armorFor, weaponFor, type BuildingKey } from "@/lib/game/village/defs";
import type { FightEvent, Unit } from "@/lib/game/village/sim";
import { actorSize, animLength, drawActor, drawGround, loadSprites, type Dir } from "./sprites";

export interface SceneInput {
  units: Record<string, Unit>;
  fed: boolean; eff: number; dps: number;
  zone: { z: number; name: string; mobs: string[] };
  bld: Record<BuildingKey, number>;
  daRunning: boolean;
  anyTrained: boolean;
  gear: Record<string, { w: number; a: number }>;
  hitmarkers: boolean;       // damage numbers and hit marks over the art (a setting)
}
type Pt = { x: number; y: number };
interface Walker extends Pt { tx: number; ty: number; dir: Dir; speed: number; moving: boolean }
interface Hunter extends Walker {
  k: string; state: "walk" | "fight" | "gather" | "rest" | "sleep"; cd: number; lunge: number; flash: number; rest: number; wait: number;
  target: Mob | null; slot: number;
  gather: number;            // index into props while chopping or mining, else -1
  swings: number;            // swings left on the current tree or rock
  knock: number; kx: number; ky: number; hitAt: number;   // being hit: knockback timer and direction, last hit time
}
interface Mob extends Walker { ico: string; i: number; hp: number; max: number; flash: number; dead: number; think: number; cd: number; lunge: number; lx: number; ly: number }
interface Fx { x: number; y: number; text?: string; actor?: string; mark?: boolean; ring?: string; color?: string; size: number; life: number; max: number; vy: number }
interface Fight {
  units: Unit[]; boss: { ico: string; name: string; hp: number; z: number }; log: FightEvent[]; win: boolean; timeout: boolean;
  t: number; i: number; speed: number; bhp: number; hp: number[]; lunge: number[]; flash: number[]; bflash: number; end: number; onDone: () => void;
}

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
const PLATE = { bg: "rgba(255,253,249,0.94)", border: "rgba(31,27,22,0.16)", text: "#1F1B16", good: "#2E6B4E", bad: "#9C4A46" };
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
  private fight: Fight | null = null;
  private raf = 0; private last = 0; private spawn = 0; private shake = 0; private clock = 0;
  private input: SceneInput | null = null;
  private visible = true;
  private ro: ResizeObserver | null = null;
  private ink = { text: "#1f1b16", good: "#3f6b55", crit: "#9c4a46", warn: "#c4603f" };

  constructor() {
    this.cv = document.createElement("canvas");
    this.cv.setAttribute("role", "img");
    this.cv.addEventListener("click", () => { if (this.fight && !this.fight.end) this.fight.t = Infinity; });   // skip a fight
    document.addEventListener("visibilitychange", () => this.wake());
    window.addEventListener("resize", () => this.resize());
    loadSprites().then(() => { this.groundKey = ""; });
  }
  get fighting() { return !!this.fight; }

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
    this.ink = { text: v("--text", "#1f1b16"), good: v("--teal", "#3f6b55"), crit: v("--brick", "#9c4a46"), warn: v("--moment", "#c4603f") };
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
    const key = `${this.W}x${this.H}@${this.S}:${zi}`;
    if (key === this.groundKey && this.ground) return;
    this.groundKey = key;
    const dpr = window.devicePixelRatio || 1, g = this.ground ?? document.createElement("canvas");
    g.width = this.cv.width; g.height = this.cv.height;
    const c = g.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGround(c, "grass", 0, 0, L.town + 4 * L.S, L.H, L.S, "#9db04a", 7);
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
    const border = zi === 5 ? "snowpine" : "pine";      // the town's tree line stays trees whatever the zone
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
        : h.state === "fight" && h.target ? `Attacking a ${names[h.target.i] ?? "monster"}`
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
      if (this.hs[k]) return;
      this.hs[k] = { k, x: inn.x + (i % 3 - 1) * 10 * this.S, y: inn.y + 4 * this.S, tx: inn.x, ty: inn.y, dir: "down", speed: 26 + Math.random() * 10,
                     moving: false, state: "walk", cd: Math.random(), lunge: 0, flash: 0, rest: 25 + Math.random() * 30, wait: 0, target: null, slot: i,
                     gather: -1, swings: 0, knock: 0, kx: 0, ky: 0, hitAt: -9 };
    });
  }
  private spawnMob() {
    const inp = this.input!, i = Math.floor(Math.random() * inp.zone.mobs.length), p = this.fieldPoint();
    const hp = Math.max(30, (inp.dps || 30) * 2.4 / Math.max(inp.eff || 0.2, 0.15));
    this.mobs.push({ ico: inp.zone.mobs[i], i, ...p, tx: p.x, ty: p.y, dir: "down", speed: 9 + Math.random() * 6, moving: false,
                     hp, max: hp, flash: 0, dead: 0, think: Math.random() * 3, cd: 1 + Math.random(), lunge: 0, lx: 0, ly: 0 });
  }

  private step(dt: number) {
    const inp = this.input!;
    this.fx.forEach(f => { f.life += dt; f.y += f.vy * dt; });
    this.fx = this.fx.filter(f => f.life < f.max);
    if (this.shake > 0) this.shake -= dt;
    if (this.fight) return this.fightStep(dt);
    this.sync();
    const hunters = Object.values(this.hs);
    const want = inp.fed ? Math.min(2 + Math.ceil(hunters.length / 2), 6) : 3;
    this.spawn -= dt;
    if (this.mobs.filter(m => !m.dead).length < want && this.spawn <= 0) { this.spawnMob(); this.spawn = 1 + Math.random() * 1.5; }
    // monsters wander, and hit back at whoever is fighting them
    this.mobs.forEach(m => {
      if (m.flash > 0) m.flash -= dt;
      if (m.lunge > 0) m.lunge -= dt;
      if (m.dead) { m.dead += dt; return; }
      const foe = hunters.find(h => h.state === "fight" && h.target === m);
      if (foe) {
        m.tx = m.x; m.ty = m.y; m.moving = false; m.dir = dirTo(foe.x - m.x, foe.y - m.y);
        m.cd -= dt;
        if (m.cd <= 0) this.mobHits(m, foe);
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
      if (h.state === "rest") { h.wait -= dt; if (h.wait <= 0) { h.state = "walk"; h.rest = 25 + Math.random() * 30; } return; }
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
      const side = (h.slot % 2 ? 1 : -1) * (h.x < m.x ? 1 : -1);
      h.tx = m.x - side * 13 * this.S; h.ty = m.y + ((h.slot % 3) - 1) * 3 * this.S;
      if (h.knock <= 0 && !this.walk(h, dt)) { h.state = "walk"; return; }
      h.state = "fight"; h.dir = dirTo(m.x - h.x, m.y - h.y); h.cd -= dt;
      if (h.cd > 0 || !u) return;
      h.cd = 1 / u.spd; h.lunge = 0.18; m.flash = 0.12;
      const crit = Math.random() < u.crit, dmg = u.atk * (crit ? u.cdmg : 1) * (0.9 + 0.2 * Math.random());
      m.hp -= dmg;
      this.addActorFx(m.x, m.y + 2 * this.S, "fx:slash");
      this.addMark(m.x + (Math.random() - 0.5) * 6 * this.S, m.y - 8 * this.S, crit);
      this.addText(m.x + (Math.random() - 0.5) * 8 * this.S, m.y - 18 * this.S, fmtN(dmg), crit ? NUM.crit : NUM.hit, crit ? 14 : 12);
      if (m.hp <= 0) {
        m.dead = 0.001; h.target = null;
        this.addActorFx(m.x, m.y, "fx:smoke");
        this.addActorFx(m.x, m.y - 8 * this.S, "fx:coin", -22);
        if (Math.random() < 0.3) this.startGather(h, hunters);     // between fights, gather a little
      }
    });
  }

  /** A monster strikes the hunter fighting it: it lunges, the hunter flashes and is knocked back. */
  private mobHits(m: Mob, h: Hunter) {
    m.cd = 1.3 + Math.random() * 0.9; m.lunge = 0.18;
    const dx = h.x - m.x, dy = h.y - m.y, d = Math.hypot(dx, dy) || 1;
    m.lx = dx / d; m.ly = dy / d;
    h.flash = 0.22; h.knock = 0.16; h.kx = dx / d; h.ky = dy / d; h.hitAt = this.clock;
    const u = this.input!.units[h.k], dmg = (u?.hp ?? 100) * (0.03 + Math.random() * 0.05);
    this.addMark(h.x, h.y - 8 * this.S, false);
    this.addText(h.x + (Math.random() - 0.5) * 6 * this.S, h.y - 20 * this.S, "-" + fmtN(dmg), NUM.hurt, 11);
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

  private sprite(id: string, emoji: string, x: number, y: number, anim = "idle", dir: Dir = "down", alpha = 1, scale = 1, t = this.clock) {
    drawActor(this.ctx!, id, emoji, x, y, { anim, dir, t, scale: this.S * scale, alpha });
  }
  private font(size: number) { return `700 ${size}px "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif`; }
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
    c.fillStyle = "rgba(31,27,22,0.45)"; c.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
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
    this.props.forEach(p => list.push({ y: p.y, draw: () => this.sprite(p.id, "🌳", p.x, p.y) }));
    BLD_SLOTS.forEach(b => {
      const p = this.bldPos(b);
      list.push({ y: p.y, draw: () => this.sprite("bld:" + b, BUILDINGS[b].ico, p.x, p.y) });
    });
    if (inp.daRunning) {
      const m = this.door("market");
      list.push({ y: m.y + 3 * this.S, draw: () => {
        this.sprite("npc:you", "🧑‍💻", m.x + 12 * this.S, m.y + 3 * this.S, "walk", "down", 1, 1, this.clock * 0.5);
        this.sprite("emote:star", "💼", m.x + 12 * this.S, m.y - 14 * this.S);
      } });
    }
    if (this.fight) this.collectFight(list, zi, alt);
    else {
      this.mobs.forEach(m => list.push({ y: m.y, draw: () => {
        const id = `mob:${zi}:${m.i}${alt ? ":alt" : ""}`;
        const ml = m.lunge > 0 ? 4 * this.S : 0;
        this.sprite(id, m.ico, m.x + m.lx * ml, m.y + m.ly * ml, m.moving || m.lunge > 0 ? "walk" : "idle", m.dir, m.dead ? Math.max(0, 1 - m.dead * 2.4) : 1);
        if (m.flash > 0) this.flashAt(m.x, m.y, "rgba(255,255,255,0.55)");
        if (!m.dead && m.hp < m.max) this.hpBar(m.x, m.y - 19 * this.S, 14 * this.S, m.hp / m.max, this.ink.crit);
      } }));
      Object.values(this.hs).forEach(h => list.push({ y: h.y, draw: () => {
        const sleeping = h.state === "sleep" || h.state === "rest";
        const anim = h.lunge > 0 ? "attack" : h.moving ? "walk" : "idle";
        const kb = h.knock > 0 ? (h.knock / 0.16) * 4 * this.S : 0;
        const lx = (h.lunge > 0 ? ({ left: -3, right: 3, up: 0, down: 0 }[h.dir]) * this.S : 0) + h.kx * kb;
        const ly = (h.lunge > 0 ? ({ up: -3, down: 3, left: 0, right: 0 }[h.dir]) * this.S : 0) + h.ky * kb;
        this.drawHunter(h.k, h.x + lx, h.y + ly, anim, h.dir, h.lunge > 0, 1, this.clock + h.slot * 0.13);
        if (h.flash > 0) this.flashAt(h.x, h.y, "rgba(156,74,70,0.4)");
        if (sleeping) this.sprite(h.state === "sleep" ? "emote:sleep" : "emote:heart", h.state === "sleep" ? "💤" : "❤️",
                                  h.x + 6 * this.S, h.y - 16 * this.S - (REDUCED ? 0 : Math.abs(Math.sin(this.clock * 2 + h.slot)) * 2 * this.S));
      } }));
    }
    list.sort((a, b) => a.y - b.y).forEach(d => d.draw());
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
        ctx.beginPath(); ctx.ellipse(f.x, f.y - this.S, (7 + f.life * 16) * this.S, (2.6 + f.life * 6) * this.S, 0, 0, 7); ctx.stroke(); ctx.restore();
      } else if (f.actor) drawActor(ctx, f.actor, "✨", f.x, f.y, { t: f.life, scale: this.S, once: true, alpha: f.actor === "fx:coin" ? a : 1 });
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
    const drawWeapon = () => drawActor(c, "weapon:" + weapon, "", wx, wy, { scale: S * 0.72, rotate: rot, alpha, flip: side < 0 });
    if (behind) drawWeapon();
    this.sprite("hunter:" + k, h?.ico ?? "🧍", x, y, anim, dir, alpha, 1, t);
    if (!behind) drawWeapon();
  }
  private flashAt(x: number, y: number, col: string) {
    const c = this.ctx!;
    c.fillStyle = col; c.beginPath(); c.ellipse(x, y - 8 * this.S, 8 * this.S, 9 * this.S, 0, 0, 7); c.fill();
  }

  /* ── boss fights ── */
  playFight(units: Unit[], boss: Fight["boss"], log: FightEvent[], res: { win: boolean; timeout: boolean; t: number }, onDone: () => void) {
    this.fight = { units, boss, log, win: res.win, timeout: res.timeout, t: 0, i: 0, speed: Math.max(1, res.t / 8), bhp: boss.hp,
                   hp: units.map(u => u.hp), lunge: units.map(() => 0), flash: units.map(() => 0), bflash: 0, end: 0, onDone };
    this.wake();
  }
  private bossAt(): Pt { const L = this.lay(); return { x: L.f0 + (L.f1 - L.f0) * 0.74, y: L.H * 0.8 }; }
  /** Bosses are drawn smaller when the map is short, so their name and health always fit above them. */
  private bossScale(id: string) { return Math.min(1, (this.H * 0.52) / (actorSize(id).h * this.S)); }
  private fightPos(i: number): Pt {
    const L = this.lay(), f = this.fight!, u = f.units[i];
    const row = f.units.filter(x => x.row === u.row), j = row.indexOf(u), n = row.length;
    const fw = L.f1 - L.f0, b = this.bossAt();
    const x = L.f0 + fw * (u.row === "front" ? 0.42 : 0.2);
    const span = Math.min(L.H - 40 * L.S, n * 18 * L.S);
    return { x: x - (j % 2) * 4 * L.S, y: b.y - span / 2 + (n > 1 ? j * span / (n - 1) : span / 2) };
  }
  private fightStep(dt: number) {
    const f = this.fight!, b = this.bossAt(), bid = `boss:${zoneIdx(f.boss.z)}`, bh = actorSize(bid).h * this.S * this.bossScale(bid);
    f.lunge = f.lunge.map(x => Math.max(0, x - dt)); f.flash = f.flash.map(x => Math.max(0, x - dt)); f.bflash = Math.max(0, f.bflash - dt);
    if (f.end) { f.end -= dt; if (f.end <= 0) { this.fight = null; f.onDone(); } return; }
    f.t += dt * f.speed;
    while (f.i < f.log.length && f.log[f.i].t <= f.t) {
      const e = f.log[f.i++];
      if (e.a === "hit") {
        f.lunge[e.i] = 0.15; f.bhp = e.bhp; f.hp[e.i] = e.hp;
        if (!e.miss) {
          f.bflash = 0.15;
          const mx = b.x + (Math.random() - 0.5) * 16 * this.S, my = b.y - bh * (0.25 + Math.random() * 0.3);
          this.addActorFx(mx, my + 8 * this.S, "fx:slash");
          this.addMark(mx, my, e.crit);
        }
        this.addText(b.x + (Math.random() - 0.5) * 30 * this.S, b.y - bh - 2 * this.S - Math.random() * 8 * this.S,
                     e.miss ? "miss" : fmtN(e.dmg), e.miss ? NUM.miss : e.crit ? NUM.crit : NUM.hit, e.crit ? 15 : 12);
      } else if (e.a === "boss") {
        f.hp[e.i] = e.hp; f.flash[e.i] = 0.25;
        const p = this.fightPos(e.i);
        this.addText(p.x, p.y - 18 * this.S, "-" + fmtN(e.dmg), NUM.hurt, 12);
      } else {
        f.hp = e.hps.slice(); f.flash = f.flash.map(() => 0.3); this.shake = 0.3;
        f.units.forEach((_, i) => { const p = this.fightPos(i); this.addActorFx(p.x, p.y, "fx:smoke"); });
      }
    }
    if (f.i >= f.log.length) f.end = 2.4;
  }
  private collectFight(list: { y: number; draw: () => void }[], zi: number, alt: boolean) {
    const f = this.fight!, b = this.bossAt(), id = `boss:${zi}${alt ? ":alt" : ""}`, bs = this.bossScale(id), bh = actorSize(id).h * this.S * bs;
    list.push({ y: b.y, draw: () => {
      this.sprite(id, f.boss.ico, b.x, b.y, f.bflash > 0 ? "hurt" : "idle", "down", f.end && f.win ? Math.max(0, f.end / 2.4) : 1, bs);
      this.hpBar(b.x, b.y - bh - 6 * this.S, 44 * this.S, f.bhp / f.boss.hp, this.ink.crit);
      this.label(f.boss.name, b.x, b.y - bh - 14 * this.S, 11);
    } });
    f.units.forEach((u, i) => {
      const p = this.fightPos(i), dead = f.hp[i] <= 0;
      list.push({ y: p.y, draw: () => {
        this.drawHunter(u.k, p.x + (f.lunge[i] > 0 ? 3 * this.S : 0), p.y, f.lunge[i] > 0 ? "attack" : "idle", "right", f.lunge[i] > 0, dead ? 0.3 : 1);
        if (f.flash[i] > 0 && !dead) this.flashAt(p.x, p.y, "rgba(156,74,70,0.4)");
        if (!dead) this.hpBar(p.x, p.y + 2 * this.S, 14 * this.S, f.hp[i] / u.hp, this.ink.good);
      } });
    });
    if (f.end) list.push({ y: 1e9, draw: () => {
      const L = this.lay();
      this.label(f.win ? "Victory" : f.timeout ? "Out of time" : "Defeated", (L.f0 + L.f1) / 2, L.H * 0.24, 20, f.win ? PLATE.good : PLATE.bad);
    } });
  }
}

let scene: VillageScene | null = null;
export const getScene = () => (scene ??= new VillageScene());
