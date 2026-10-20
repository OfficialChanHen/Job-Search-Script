"use client";
import { useEffect, useRef, useState } from "react";
import { actorFrame, faceUrl, loadSprites } from "@/lib/client/sprites";

/** A pixel icon from the sprite pack: a portrait or item when the pack has one, else an actor's first frame. */
export function Icon({ id, size = 38, className = "" }: { id: string; size?: number; className?: string }) {
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let on = true; loadSprites().then(() => on && setReady(true)); return () => { on = false; }; }, []);
  const src = ready ? faceUrl(id) : undefined;
  useEffect(() => {
    const c = canvas.current, f = ready && !src ? actorFrame(id) : undefined;
    if (!c || !f) return;
    let on = true;
    f.img.decode().catch(() => {}).then(() => {
      const ctx = c.getContext("2d");
      if (!on || !ctx || !f.img.naturalWidth) return;
      const dpr = window.devicePixelRatio || 1, px = size * dpr, k = Math.min(px / f.sw, px / f.sh);
      c.width = c.height = px;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(f.img, f.sx, f.sy, f.sw, f.sh, Math.round((px - f.sw * k) / 2), Math.round((px - f.sh * k) / 2), Math.round(f.sw * k), Math.round(f.sh * k));
    });
    return () => { on = false; };
  }, [id, size, ready, src]);
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img className={"face " + className} src={src} alt="" width={size} height={size} />;
  return <canvas ref={canvas} className={"face " + className} aria-hidden style={{ width: size, height: size }} />;
}
