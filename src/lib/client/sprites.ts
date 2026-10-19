"use client";
/* Sprites for the village scene.
 *
 * public/sprites/manifest.json maps an actor id to frames in a sprite sheet:
 *   { "actors": { "hunter:graphs": { "src": "/sprites/hunters/graphs.png", "fw": 16, "fh": 16,
 *       "anims": { "idle": { "frames": [[0,0]], "fps": 2 }, "walk": { "frames": [[0,0],[0,1]], "fps": 8 } },
 *       "left": { "walk": { "frames": [[2,0],[2,1]], "fps": 8 } } } } }
 * Frames are [column, row] in units of fw×fh. "left" holds left-facing versions; without them the
 * right-facing frames are mirrored. Actor ids: hunter:<topic>, mob:<zone 1-9>:<0|1>, boss:<zone 1-9>,
 * bld:<inn|kitchen|forge|market>, npc:you. Anything not in the manifest is drawn as its emoji.     */

export interface Anim { frames: [number, number][]; fps: number }
export interface ActorDef { src: string; fw: number; fh: number; anims: Record<string, Anim>; left?: Record<string, Anim> }
interface Loaded { def: ActorDef; img: HTMLImageElement }

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
let actors: Record<string, Loaded> = {};
let loading: Promise<void> | null = null;

/** Load the manifest once. Missing manifest = emoji everywhere. */
export function loadSprites(): Promise<void> {
  return (loading ??= fetch("/sprites/manifest.json")
    .then(r => (r.ok ? r.json() : { actors: {} }))
    .then((m: { actors?: Record<string, ActorDef> }) => {
      const images = new Map<string, HTMLImageElement>();
      const out: Record<string, Loaded> = {};
      Object.entries(m.actors ?? {}).forEach(([id, def]) => {
        let img = images.get(def.src);
        if (!img) { img = new Image(); img.src = def.src; images.set(def.src, img); }
        out[id] = { def, img };
      });
      actors = out;
    })
    .catch(() => { actors = {}; }));
}
export const hasSprite = (id: string) => !!actors[id]?.img.complete && actors[id].img.naturalWidth > 0;

/** Draw an actor standing at (x, y) = bottom center, `size` px tall. */
export function drawActor(ctx: CanvasRenderingContext2D, id: string, emoji: string, anim: string, t: number,
                          x: number, y: number, size: number, faceLeft = false, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const a = actors[id];
  if (a && a.img.complete && a.img.naturalWidth) {
    const { def, img } = a;
    const own = faceLeft ? def.left?.[anim] : undefined;
    const seq = own ?? def.anims[anim] ?? def.anims.idle ?? Object.values(def.anims)[0];
    const [c, r] = seq.frames[Math.floor(t * seq.fps) % seq.frames.length];
    const h = size, w = size * def.fw / def.fh;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (faceLeft && !own) ctx.scale(-1, 1);
    ctx.drawImage(img, c * def.fw, r * def.fh, def.fw, def.fh, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h));
  } else {
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.translate(x, y);
    if (faceLeft) ctx.scale(-1, 1);
    ctx.fillText(emoji, 0, 0);
  }
  ctx.restore();
}
