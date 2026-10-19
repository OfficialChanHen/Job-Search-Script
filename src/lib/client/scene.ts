"use client";
/* The village scene: hunters walk out to the field, fight monsters, rest at the
   inn, and sleep in town when there's no food. Boss fights replay a simulation
   log. One canvas, moved between the main-page strip and the village window. */
import { BUILDING_ORDER, BUILDINGS, HUNTERS, type BuildingKey } from "@/lib/game/village/defs";
import type { FightEvent, Unit } from "@/lib/game/village/sim";
import { drawActor } from "./sprites";

export interface SceneInput {
  units: Record<string, Unit>;
  fed: boolean; eff: number; dps: number;
  zone: { z: number; name: string; mobs: string[] };
  bld: Record<BuildingKey, number>;
  daRunning: boolean;
  anyTrained: boolean;
}
interface Hunter { k: string; x: number; tx: number; lane: number; speed: number; state: "walk" | "fight" | "rest" | "sleep"; cd: number; lunge: number; flash: number; rest: number; wait: number; dir: number; target: Mob | null }
interface Mob { ico: string; i: number; x: number; lane: number; hp: number; max: number; flash: number; cd: number; bob: number; dead: number }
interface Fx { x: number; y: number; text: string; color?: string; size: number; life: number; max: number; vy: number }
interface Fight {
  units: Unit[]; boss: { ico: string; name: string; hp: number; z: number }; log: FightEvent[]; win: boolean; timeout: boolean;
  t: number; i: number; speed: number; bhp: number; hp: number[]; lunge: number[]; flash: number[]; bflash: number; end: number; onDone: () => void;
}
type Colors = Record<"sky" | "ground" | "line" | "ink" | "ink2" | "ink3" | "good" | "crit" | "warn", string>;

const REDUCED = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const fmtN = (x: number) => { x = Math.floor(x); return Math.abs(x) < 10000 ? x.toLocaleString() : Math.abs(x) < 1e6 ? (x / 1000).toFixed(x < 1e5 ? 1 : 0) + "k" : (x / 1e6).toFixed(1) + "M"; };
const ZONE_IDX = (z: number) => ((z - 1) % 9) + 1;

export class VillageScene {
  readonly cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0; private H = 0;
  private hs: Record<string, Hunter> = {};
  private mobs: Mob[] = [];
  private fx: Fx[] = [];
  private fight: Fight | null = null;
  private col: Colors | null = null;
  private raf = 0; private last = 0; private spawn = 0; private shake = 0;
  private input: SceneInput | null = null;
  private visible = true;

  constructor() {
    this.cv = document.createElement("canvas");
    this.cv.setAttribute("role", "img");
    this.cv.addEventListener("click", () => { if (this.fight && !this.fight.end) this.fight.t = Infinity; });   // skip a fight
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { this.col = null; });
    document.addEventListener("visibilitychange", () => this.wake());
    window.addEventListener("resize", () => this.resize());
  }
  get fighting() { return !!this.fight; }

  mount(host: HTMLElement) {
    if (this.cv.parentNode !== host) host.append(this.cv);
    this.resize();
    this.wake();
  }
  setVisible(v: boolean) { this.visible = v; this.wake(); }
  update(input: SceneInput) {
    this.input = input;
    this.cv.setAttribute("aria-label", `Your village. ${Object.keys(input.units).length} hunters on duty in ${input.zone.name}. ${input.fed ? "They have food." : "They're out of food."}`);
  }

  private resize() {
    const host = this.cv.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    const oldW = this.W;
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.ctx = this.cv.getContext("2d");
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.col = null;
    if (oldW && oldW !== this.W) {        // keep sprites in proportion
      const k = this.W / oldW;
      Object.values(this.hs).forEach(h => { h.x *= k; h.tx *= k; });
      this.mobs.forEach(m => { m.x *= k; });
    }
  }
  private colors(): Colors {
    const cs = getComputedStyle(document.documentElement), v = (n: string) => cs.getPropertyValue(n).trim();
    return { sky: v("--surface-2"), ground: v("--grid"), line: v("--baseline"), ink: v("--ink-1"), ink2: v("--ink-2"), ink3: v("--ink-3"),
             good: v("--good-mark"), crit: v("--crit"), warn: v("--warn") };
  }
  private lay() {
    const W = this.W, H = this.H, town = Math.min(W * 0.36, 320);
    return { W, H, town, ground: H * 0.8, f0: town + 28, f1: W - 14 };
  }
  private bldX(b: BuildingKey) { return this.lay().town * (0.13 + 0.25 * BUILDING_ORDER.indexOf(b)); }
  private laneY(lane: number) { const L = this.lay(); return L.ground - 4 - lane * Math.min(12, this.H * 0.07); }

  /* ── loop: only animate while someone can see it ── */
  wake() {
    const run = !document.hidden && this.visible && !!this.cv.parentNode;
    if (run && !this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.loop); }
    else if (!run && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }
  private loop = (ts: number) => {
    this.raf = 0;
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016);
    this.last = ts;
    if (!this.col) this.col = this.colors();
    if (this.input) { this.step(dt); this.draw(ts / 1000); }
    if (!document.hidden && this.visible) this.raf = requestAnimationFrame(this.loop);
  };

  private addFx(x: number, y: number, text: string, color?: string, size = 13) { this.fx.push({ x, y, text, color, size, life: 0, max: 1.1, vy: -28 }); }

  private sync() {
    const L = this.lay(), units = this.input!.units;
    Object.keys(this.hs).forEach(k => { if (!units[k]) delete this.hs[k]; });
    Object.keys(units).forEach((k, i) => {
      if (this.hs[k]) return;
      const x = L.town + 4 + i * 16;
      this.hs[k] = { k, x, tx: x, lane: i % 3, speed: 58 + Math.random() * 26, state: "walk", cd: Math.random(), lunge: 0, flash: 0,
                     rest: 25 + Math.random() * 30, wait: 0, dir: 1, target: null };
    });
  }
  private spawnMob() {
    const L = this.lay(), inp = this.input!, i = Math.floor(Math.random() * inp.zone.mobs.length);
    const hp = Math.max(30, (inp.dps || 30) * 2.4 / Math.max(inp.eff || 0.2, 0.15));
    this.mobs.push({ ico: inp.zone.mobs[i], i, x: L.f0 + 40 + Math.random() * (L.f1 - L.f0 - 60), lane: Math.floor(Math.random() * 3),
                     hp, max: hp, flash: 0, cd: 1 + Math.random() * 2, bob: Math.random() * 6, dead: 0 });
  }

  private step(dt: number) {
    const L = this.lay(), inp = this.input!;
    this.fx.forEach(f => { f.life += dt; f.y += f.vy * dt; });
    this.fx = this.fx.filter(f => f.life < f.max);
    if (this.shake > 0) this.shake -= dt;
    if (this.fight) return this.fightStep(dt);
    this.sync();
    const want = inp.fed ? Math.min(2 + Math.ceil(Object.keys(this.hs).length / 2), 5) : 2;
    this.spawn -= dt;
    if (this.mobs.filter(m => !m.dead).length < want && this.spawn <= 0) { this.spawnMob(); this.spawn = 1.2 + Math.random() * 1.5; }
    const hunters = Object.values(this.hs);
    this.mobs.forEach(m => {
      m.bob += dt; if (m.flash > 0) m.flash -= dt;
      if (m.dead) { m.dead += dt; return; }
      const near = hunters.find(h => h.state === "fight" && h.target === m);
      if (near) { m.cd -= dt; if (m.cd <= 0) { m.cd = 1.6 + Math.random(); near.flash = 0.18; } }
    });
    this.mobs = this.mobs.filter(m => m.dead < 0.4);
    hunters.forEach(h => {
      const u = inp.units[h.k];
      if (h.lunge > 0) h.lunge -= dt;
      if (h.flash > 0) h.flash -= dt;
      const innSpot = this.bldX("inn") + 8 + h.lane * 13;
      if (!inp.fed) { h.target = null; h.tx = innSpot; h.state = Math.abs(h.x - h.tx) < 3 ? "sleep" : "walk"; }
      else if (h.state === "rest") { h.wait -= dt; if (h.wait <= 0) { h.state = "walk"; h.rest = 25 + Math.random() * 30; } }
      else {
        h.rest -= dt;
        if (h.rest <= 0) {        // back to the inn for a breather, like hunters in Evil Hunter Tycoon
          h.target = null; h.tx = innSpot;
          if (Math.abs(h.x - h.tx) < 3) { h.state = "rest"; h.wait = 2.5 + Math.random() * 2; } else h.state = "walk";
        } else {
          if (!h.target || h.target.dead) {
            const load = (m: Mob) => hunters.filter(o => o.target === m).length;
            h.target = this.mobs.filter(m => !m.dead).sort((a, b) => load(a) - load(b) || Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0] || null;
          }
          const m = h.target;
          if (m) {
            const side = h.x < m.x ? -1 : 1;
            h.tx = m.x + side * (20 + h.lane * 4);
            if (Math.abs(h.x - h.tx) < 3) {
              h.state = "fight"; h.dir = -side; h.cd -= dt;
              if (h.cd <= 0 && u) {
                h.cd = 1 / u.spd; h.lunge = 0.16;
                const crit = Math.random() < u.crit, dmg = u.atk * (crit ? u.cdmg : 1) * (0.9 + 0.2 * Math.random());
                m.hp -= dmg; m.flash = 0.12;
                this.addFx(m.x + (Math.random() - 0.5) * 10, this.laneY(m.lane) - 30, (crit ? "💥" : "") + fmtN(dmg), crit ? this.col!.warn : this.col!.ink2, crit ? 15 : 12);
                if (m.hp <= 0) {
                  m.dead = 0.001; h.target = null;
                  this.addFx(m.x, this.laneY(m.lane) - 22, "🪙", undefined, 16);
                  this.addFx(m.x + 9, this.laneY(m.lane) - 14, "🪙", undefined, 12);
                }
              }
            } else h.state = "walk";
          } else { h.state = "walk"; if (Math.abs(h.x - h.tx) < 3) h.tx = L.f0 + Math.random() * (L.f1 - L.f0); }
        }
      }
      const dx = h.tx - h.x;
      if (Math.abs(dx) > 1) { h.x += Math.sign(dx) * Math.min(Math.abs(dx), h.speed * dt); h.dir = Math.sign(dx); }
    });
  }

  private hpBar(x: number, y: number, w: number, frac: number, col: string) {
    const ctx = this.ctx!;
    ctx.fillStyle = this.col!.ground; ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 4);
  }
  private text(s: string, x: number, y: number, opts: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline } = {}) {
    const ctx = this.ctx!;
    ctx.font = `${opts.weight ?? 600} ${opts.size ?? 11}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = opts.color ?? this.col!.ink3; ctx.textAlign = opts.align ?? "center"; ctx.textBaseline = opts.base ?? "top";
    ctx.fillText(s, x, y);
  }

  private draw(t: number) {
    const ctx = this.ctx, C = this.col!, L = this.lay(), inp = this.input!;
    if (!ctx || !this.W) return;
    ctx.save();
    if (this.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4);
    ctx.fillStyle = C.sky; ctx.fillRect(-10, -10, L.W + 20, L.H + 20);
    ctx.fillStyle = C.ground; ctx.fillRect(-10, L.ground, L.W + 20, L.H - L.ground + 10);
    [[0.18, 0.22, 26], [0.62, 0.14, 20], [0.9, 0.3, 16]].forEach(([fx, fy, sz], i) => {
      const drift = REDUCED ? 0 : (t * (4 + i * 2)) % (L.W + 80);
      drawActor(ctx, "decor:cloud", "☁️", "idle", t, ((fx * L.W + drift) % (L.W + 80)) - 40, L.H * fy + sz, sz, false, 0.55);
    });
    if (!inp.fed && !this.fight) {
      drawActor(ctx, "decor:moon", "🌙", "idle", t, L.W - 40, L.H * 0.34, 18, false, 0.8);
      ctx.fillStyle = "rgba(20,24,60,0.10)"; ctx.fillRect(L.town + 8, 0, L.W, L.ground);
    }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(L.town + 8, L.ground - 26); ctx.lineTo(L.town + 8, L.ground); ctx.stroke(); ctx.setLineDash([]);
    this.text("YOUR VILLAGE", 10, 8, { align: "left" });
    this.text(this.fight ? "BOSS FIGHT" : inp.zone.name.toUpperCase(), L.W - 10, 8, { align: "right" });
    BUILDING_ORDER.forEach(b => {
      const x = this.bldX(b);
      drawActor(ctx, "bld:" + b, BUILDINGS[b].ico, "idle", t, x, L.ground - 2, Math.min(34, L.H * 0.24, L.town / 4.8));
      this.text("Lv " + inp.bld[b], x, L.ground + 3, { size: 10 });
    });
    if (inp.daRunning) drawActor(ctx, "npc:you", "🧑‍💻", "work", t, this.bldX("market") + 18, L.ground - 2 - (REDUCED ? 0 : Math.abs(Math.sin(t * 3)) * 2), 20);
    if (this.fight) this.drawFight(t);
    else {
      for (let i = 0; i < 6; i++) drawActor(ctx, "decor:grass", "🌿", "idle", t, L.f0 + (i + 0.5) * (L.f1 - L.f0) / 6, L.ground + 12, 11, false, 0.5);
      const zi = ZONE_IDX(inp.zone.z);
      const ents: { y: number; m?: Mob; h?: Hunter }[] = [...this.mobs.map(m => ({ y: this.laneY(m.lane), m })), ...Object.values(this.hs).map(h => ({ y: this.laneY(h.lane), h }))].sort((a, b) => a.y - b.y);
      ents.forEach(({ y, m, h }) => {
        if (m) {
          const by = REDUCED ? 0 : Math.sin(m.bob * 2) * 1.5;
          drawActor(ctx, `mob:${zi}:${m.i}`, m.ico, m.flash > 0 ? "hurt" : "idle", t + m.bob, m.x, y + by, 22, false, m.dead ? Math.max(0, 1 - m.dead * 2.5) : 1);
          if (m.flash > 0) { ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.arc(m.x, y - 11, 11, 0, 7); ctx.fill(); }
          if (!m.dead && m.hp < m.max) this.hpBar(m.x, y - 30, 22, m.hp / m.max, C.crit);
        } else if (h) {
          const sleeping = h.state === "sleep" || h.state === "rest";
          const bob = h.state === "walk" && !REDUCED ? Math.abs(Math.sin(t * 9 + h.lane)) * 3 : 0;
          const anim = h.lunge > 0 ? "attack" : h.state === "walk" ? "walk" : "idle";
          drawActor(ctx, "hunter:" + h.k, HUNTERS[h.k]?.ico ?? "🧍", anim, t + h.lane, h.x + (h.lunge > 0 ? h.dir * 6 : 0), y - bob, 22, h.dir < 0, sleeping ? 0.75 : 1);
          if (h.flash > 0) { ctx.fillStyle = "rgba(208,59,59,0.35)"; ctx.beginPath(); ctx.arc(h.x, y - 11, 11, 0, 7); ctx.fill(); }
          if (sleeping) this.text(h.state === "sleep" ? "z z" : "♥", h.x + 8, y - 32 - (REDUCED ? 0 : Math.sin(t * 2 + h.lane) * 2), { size: 10, align: "left" });
        }
      });
      const msg = !Object.keys(this.hs).length
        ? (inp.anyTrained ? "Nobody on duty. Open the village to send hunters out." : "Solve a LeetCode problem to recruit your first hunter.")
        : !inp.fed ? "Out of food. Apply to a job to wake them up." : "";
      if (msg) this.text(msg, (L.f0 + L.f1) / 2, L.H * 0.36, { size: 12, color: C.ink2, base: "middle" });
    }
    this.fx.forEach(f => {
      const a = Math.max(0, 1 - f.life / f.max);
      if (/^\p{Extended_Pictographic}/u.test(f.text) && f.text.length <= 3) drawActor(ctx, "fx:" + f.text, f.text, "idle", t, f.x, f.y, f.size, false, a);
      else { ctx.save(); ctx.globalAlpha = a; this.text(f.text, f.x, f.y, { size: f.size, weight: 700, color: f.color ?? C.ink, base: "bottom" }); ctx.restore(); }
    });
    ctx.restore();
  }

  /* ── boss fights ── */
  playFight(units: Unit[], boss: Fight["boss"], log: FightEvent[], res: { win: boolean; timeout: boolean; t: number }, onDone: () => void) {
    this.fight = { units, boss, log, win: res.win, timeout: res.timeout, t: 0, i: 0, speed: Math.max(1, res.t / 8), bhp: boss.hp,
                   hp: units.map(u => u.hp), lunge: units.map(() => 0), flash: units.map(() => 0), bflash: 0, end: 0, onDone };
    this.wake();
  }
  private fightPos(i: number) {
    const L = this.lay(), f = this.fight!, u = f.units[i];
    const row = f.units.filter(x => x.row === u.row), j = row.indexOf(u);
    const fw = L.f1 - L.f0, gap = Math.min(30, fw * 0.07);
    return { x: L.f0 + fw * (u.row === "front" ? 0.5 : 0.24) - j * gap, y: this.laneY(j % 3) + 6 };
  }
  private fightStep(dt: number) {
    const f = this.fight!, L = this.lay(), bx = L.f0 + (L.f1 - L.f0) * 0.8, by = L.ground - 4, bsize = Math.min(64, L.H * 0.42);
    f.lunge = f.lunge.map(x => Math.max(0, x - dt)); f.flash = f.flash.map(x => Math.max(0, x - dt)); f.bflash = Math.max(0, f.bflash - dt);
    if (f.end) { f.end -= dt; if (f.end <= 0) { this.fight = null; f.onDone(); } return; }
    f.t += dt * f.speed;
    while (f.i < f.log.length && f.log[f.i].t <= f.t) {
      const e = f.log[f.i++];
      if (e.a === "hit") {
        f.lunge[e.i] = 0.15; f.bhp = e.bhp; f.hp[e.i] = e.hp;
        if (!e.miss) f.bflash = 0.1;
        this.addFx(bx - 10 + (Math.random() - 0.5) * 34, by - bsize * 0.55 - Math.random() * 12, e.miss ? "miss" : (e.crit ? "💥" : "") + fmtN(e.dmg),
                   e.miss ? this.col!.ink3 : e.crit ? this.col!.warn : this.col!.ink, e.crit ? 16 : 12);
      } else if (e.a === "boss") {
        f.hp[e.i] = e.hp; f.flash[e.i] = 0.25;
        const p = this.fightPos(e.i);
        this.addFx(p.x, p.y - 26, "-" + fmtN(e.dmg), this.col!.crit, 13);
      } else {
        f.hp = e.hps.slice(); f.flash = f.flash.map(() => 0.3); this.shake = 0.3;
        this.addFx(bx, by - 80, "SLAM", this.col!.crit, 16);
      }
    }
    if (f.i >= f.log.length) f.end = 2.4;
  }
  private drawFight(t: number) {
    const ctx = this.ctx!, f = this.fight!, C = this.col!, L = this.lay();
    const bx = L.f0 + (L.f1 - L.f0) * 0.8, by = L.ground - 4, bsize = Math.min(64, L.H * 0.42);
    drawActor(ctx, `boss:${ZONE_IDX(f.boss.z)}`, f.boss.ico, f.bflash > 0 ? "hurt" : "idle", t, bx + (f.bflash > 0 ? 3 : 0), by, bsize, true,
              f.end && f.win ? Math.max(0, f.end / 2.4) : 1);
    this.hpBar(bx, by - bsize - 12, 90, f.bhp / f.boss.hp, C.crit);
    this.text(f.boss.name, bx, by - bsize - 15, { color: C.ink2, base: "bottom" });
    f.units.forEach((u, i) => {
      const p = this.fightPos(i), dead = f.hp[i] <= 0;
      drawActor(ctx, "hunter:" + u.k, HUNTERS[u.k]?.ico ?? "🧍", f.lunge[i] > 0 ? "attack" : "idle", t + i, p.x + (f.lunge[i] > 0 ? 8 : 0), p.y, 24, false, dead ? 0.25 : 1);
      if (f.flash[i] > 0 && !dead) { ctx.fillStyle = "rgba(208,59,59,0.35)"; ctx.beginPath(); ctx.arc(p.x, p.y - 12, 12, 0, 7); ctx.fill(); }
      if (!dead) this.hpBar(p.x, p.y + 2, 24, f.hp[i] / u.hp, C.good);
    });
    if (f.end) this.text(f.win ? "VICTORY" : f.timeout ? "OUT OF TIME" : "DEFEAT", (L.f0 + L.f1) / 2, L.H * 0.22,
                         { size: Math.min(28, L.H * 0.16), weight: 800, color: f.win ? C.good : C.crit, base: "middle" });
  }
}

let scene: VillageScene | null = null;
export const getScene = () => (scene ??= new VillageScene());
