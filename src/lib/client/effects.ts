"use client";
/* Small bits of game feel: toasts, floating "+50 XP" numbers, confetti. */

type ToastFn = (msg: string, isErr?: boolean) => void;
let toastImpl: ToastFn = () => {};
export const setToastImpl = (fn: ToastFn) => { toastImpl = fn; };
export const toast: ToastFn = (msg, isErr) => toastImpl(msg, isErr);

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let lastPt = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  lastPt = { x: innerWidth / 2, y: innerHeight / 2 };
  document.addEventListener("pointerdown", e => { lastPt = { x: e.clientX, y: e.clientY }; }, true);
}

export function floatText(text: string, color = "var(--good-mark)", dy = 0) {
  const el = document.createElement("div");
  el.className = "xp-float";
  el.textContent = text;
  el.style.color = color;
  el.style.left = lastPt.x + "px";
  el.style.top = lastPt.y - 12 + dy + "px";
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}
export const floatXP = (n: number) => { if (n) floatText((n > 0 ? "+" : "") + n + " XP", n < 0 ? "var(--ink-3)" : undefined); };
export const floatFood = (h: number) => floatText(`+${h}h 🍖`, "var(--warn)", 22);

const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];
type Bit = { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; life: number };
let bits: Bit[] = [], raf = 0;
export function confetti(n: number) {
  if (reduced()) return;
  const cv = document.getElementById("confetti") as HTMLCanvasElement | null, ctx = cv?.getContext("2d");
  if (!cv || !ctx) return;
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  for (let i = 0; i < n; i++) bits.push({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: COLORS[i % COLORS.length], life: 0,
  });
  if (raf) return;
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits.forEach(p => {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - p.life / 140); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    bits = bits.filter(p => p.life < 140 && p.y < innerHeight + 40);
    raf = bits.length ? requestAnimationFrame(tick) : (ctx.clearRect(0, 0, innerWidth, innerHeight), 0);
  };
  raf = requestAnimationFrame(tick);
}

export function copyText(text: string, msg = "📋 Copied") {
  const done = () => toast(msg);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => toast("Copy failed", true));
  else toast("Copy needs a secure (https) page", true);
}
