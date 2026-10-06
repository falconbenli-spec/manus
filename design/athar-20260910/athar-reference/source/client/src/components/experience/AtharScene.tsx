import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/** A contained, demand-driven illustration of paths converging into shared work. */
export default function AtharScene({ compact = false }: { compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem("people36t-motion-paused") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const el = canvas.current;
    const host = el?.parentElement;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !host) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      frame = 0,
      previous = 0,
      x = 0,
      y = 0,
      tx = 0,
      ty = 0,
      visible = true;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width, height),
        cx = width * 0.5 + x,
        cy = height * 0.48 + y;
      ctx.lineWidth = Math.max(0.75, scale / 520);
      const lines = compact ? 9 : 17;
      for (let i = 0; i < lines; i++) {
        const t = i / (lines - 1),
          radius = scale * (0.15 + t * 0.33);
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          radius * 1.16,
          radius * 0.64,
          -0.55 + t * 0.26,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = `rgba(232,255,244,${0.18 + t * 0.2})`;
        ctx.stroke();
      }
      const dots = [
        [-0.42, 0.18],
        [0.42, -0.2],
        [0.02, -0.34],
      ];
      dots.forEach(([dx, dy], i) => {
        ctx.beginPath();
        ctx.arc(
          cx + dx * scale,
          cy + dy * scale,
          compact ? 4 : 6 - i,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = i === 1 ? "#dcf6aa" : "#eafff5";
        ctx.fill();
      });
    };
    const tick = (time: number) => {
      frame = 0;
      const dt = Math.min((time - (previous || time)) / 1000, 0.05);
      previous = time;
      const blend = 1 - Math.exp(-11 * dt);
      x += (tx - x) * blend;
      y += (ty - y) * blend;
      draw();
      if (
        Math.abs(tx - x) + Math.abs(ty - y) > 0.06 &&
        visible &&
        !document.hidden &&
        !paused &&
        !reduced.matches
      )
        frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (
        !frame &&
        visible &&
        !document.hidden &&
        !paused &&
        !reduced.matches
      ) {
        previous = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const box = host.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const dpr = Math.min(devicePixelRatio || 1, 1.75);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const move = (event: PointerEvent) => {
      if (paused || reduced.matches || event.pointerType === "touch") return;
      const box = host.getBoundingClientRect();
      tx = ((event.clientX - box.left) / width - 0.5) * 26;
      ty = ((event.clientY - box.top) / height - 0.5) * 20;
      wake();
    };
    const reset = () => {
      tx = 0;
      ty = 0;
      wake();
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        draw();
        wake();
      }
    };
    const onReduced = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      x = y = tx = ty = 0;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        draw();
        wake();
      }
    });
    intersection.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", reset);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", onReduced);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", reset);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", onReduced);
    };
  }, [paused, compact]);
  const toggle = () =>
    setPaused((value) => {
      try {
        localStorage.setItem("people36t-motion-paused", String(!value));
      } catch {}
      return !value;
    });
  return (
    <div className={`athar-scene${compact ? " athar-scene--compact" : ""}`}>
      <canvas ref={canvas} aria-hidden="true" />
      {!compact && (
        <button
          type="button"
          className="athar-motion"
          onClick={toggle}
          aria-pressed={paused}
          aria-label={paused ? "تشغيل حركة المشهد" : "إيقاف حركة المشهد"}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          <span>{paused ? "تشغيل الحركة" : "إيقاف الحركة"}</span>
        </button>
      )}
    </div>
  );
}
