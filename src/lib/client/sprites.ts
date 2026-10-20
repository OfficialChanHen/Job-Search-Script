"use client";
/* Pixel-art sprites for the village (Ninja Adventure pack, CC0). public/sprites/manifest.json is
   written by tools/build_sprites.py. Frames are [col, row] cells of fw×fh, or [x, y, w, h] pixel
   rects. Characters have walk_/idle_/attack_ + down|up|left|right; bosses have idle and hurt
   strips with their own image. Anything missing is simply not drawn. */

type Frame = [number, number] | [number, number, number, number];
interface Anim { frames: Frame[]; fps: number; src?: string; fw?: number; fh?: number }
interface ActorDef { src: string; fw: number; fh: number; anims: Record<string, Anim> }
interface Manifest {
  ground?: Record<string, { src: string; rects: [number, number, number, number][] }>;
  actors?: Record<string, ActorDef>;
  faces?: Record<string, string>;
}
export type Dir = "down" | "up" | "left" | "right";

let manifest: Manifest = {};
const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

function img(src: string) {
  let i = images.get(src);
  if (!i) { i = new Image(); i.decoding = "async"; i.src = src; images.set(src, i); }
  return i;
}
const ready = (i: HTMLImageElement | undefined) => !!i && i.complete && i.naturalWidth > 0;

/** Load the manifest and start decoding every image. Safe to call often. */
export function loadSprites(): Promise<void> {
  return (loading ??= fetch("/sprites/manifest.json")
    .then(r => (r.ok ? r.json() : {}))
    .then((m: Manifest) => {
      manifest = m;
      Object.values(m.actors ?? {}).forEach(a => { img(a.src); Object.values(a.anims).forEach(x => x.src && img(x.src)); });
      Object.values(m.ground ?? {}).forEach(g => img(g.src));
    })
    .catch(() => { manifest = {}; }));
}
export const faceUrl = (id: string) => manifest.faces?.[id];
export const hasActor = (id: string) => !!manifest.actors?.[id];
/** An actor's first idle frame, for drawing it as a still icon. */
export function actorFrame(id: string): { img: HTMLImageElement; sx: number; sy: number; sw: number; sh: number } | undefined {
  const a = manifest.actors?.[id], s = a && pick(a, "idle", "down");
  if (!a || !s) return;
  const f = s.frames[0], fw = s.fw ?? a.fw, fh = s.fh ?? a.fh;
  const [sx, sy, sw, sh] = f.length === 4 ? f : [f[0] * fw, f[1] * fh, fw, fh];
  return { img: img(s.src ?? a.src), sx, sy, sw, sh };
}

function pick(a: ActorDef, anim: string, dir: Dir): Anim | undefined {
  return a.anims[`${anim}_${dir}`] ?? a.anims[anim] ?? a.anims[`idle_${dir}`] ?? a.anims.idle ?? Object.values(a.anims)[0];
}
/** Native size of an actor's frame, in sprite pixels (before scaling). */
export function actorSize(id: string, anim = "idle", dir: Dir = "down"): { w: number; h: number } {
  const a = manifest.actors?.[id];
  if (!a) return { w: 16, h: 16 };
  const s = pick(a, anim, dir);
  const f = s?.frames[0];
  if (f && f.length === 4) return { w: f[2], h: f[3] };
  return { w: s?.fw ?? a.fw, h: s?.fh ?? a.fh };
}

export interface DrawOpts { anim?: string; dir?: Dir; t?: number; scale: number; alpha?: number; flip?: boolean; once?: boolean; rotate?: number }
/** Draw an actor standing at (x, y): bottom center, in canvas pixels. */
export function drawActor(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, o: DrawOpts) {
  const a = manifest.actors?.[id], s = a && pick(a, o.anim ?? "idle", o.dir ?? "down");
  const image = s ? img(s.src ?? a!.src) : undefined;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  if (a && s && ready(image)) {
    const n = s.frames.length, k = Math.floor((o.t ?? 0) * s.fps);
    const f = s.frames[o.once ? Math.min(k, n - 1) : k % n];
    const fw = s.fw ?? a.fw, fh = s.fh ?? a.fh;
    const [sx, sy, sw, sh] = f.length === 4 ? f : [f[0] * fw, f[1] * fh, fw, fh];
    const w = sw * o.scale, h = sh * o.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (o.rotate) ctx.rotate(o.rotate);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(image!, sx, sy, sw, sh, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h));
  }
  ctx.restore();
}
/** How many frames an animation has and its rate, for one-shot effects. */
export function animLength(id: string, anim = "idle"): number {
  const a = manifest.actors?.[id], s = a?.anims[anim];
  return s ? s.frames.length / s.fps : 0.4;
}

/** Tile a ground texture over a rect. Mostly the plain tile, with a seeded sprinkle of variants. */
export function drawGround(ctx: CanvasRenderingContext2D, kind: string, x0: number, y0: number, w: number, h: number, scale: number, fallback: string, seed = 1) {
  const g = manifest.ground?.[kind], image = g ? img(g.src) : undefined;
  if (!g || !ready(image)) { ctx.fillStyle = fallback; ctx.fillRect(x0, y0, w, h); return; }
  const t = 16 * scale;
  ctx.imageSmoothingEnabled = false;
  let r = seed;
  for (let y = y0; y < y0 + h; y += t) for (let x = x0; x < x0 + w; x += t) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    const rect = g.rects[(r >> 8) % 7 < 5 ? 0 : 1 + ((r >> 4) % (g.rects.length - 1))];
    ctx.drawImage(image!, rect[0], rect[1], 16, 16, Math.floor(x), Math.floor(y), Math.ceil(t) + 1, Math.ceil(t) + 1);
  }
}
export const spritesLoaded = () => Object.keys(manifest.actors ?? {}).length > 0;
