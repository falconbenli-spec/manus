/* Native employee portal: contained artwork, no global pointer effect. */
(() => {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false;
  try {
    paused = localStorage.getItem("people36t-motion-paused") === "true";
  } catch {}
  const scenes = [...document.querySelectorAll("[data-athar-scene]")].map(
    (host) => {
      const canvas = host.querySelector("canvas"),
        ctx = canvas.getContext("2d"),
        button = host.querySelector("[data-athar-pause]");
      let w = 0,
        h = 0,
        x = 0,
        y = 0,
        tx = 0,
        ty = 0,
        frame = 0,
        last = 0,
        visible = false;
      const paint = () => {
        ctx.clearRect(0, 0, w, h);
        const size = Math.min(w, h),
          cx = w * 0.5 + x,
          cy = h * 0.48 + y;
        ctx.lineWidth = Math.max(0.8, size / 520);
        for (let i = 0; i < 17; i++) {
          const t = i / 16,
            r = size * (0.15 + t * 0.33);
          ctx.beginPath();
          ctx.ellipse(
            cx,
            cy,
            r * 1.16,
            r * 0.64,
            -0.55 + t * 0.26,
            0,
            Math.PI * 2,
          );
          ctx.strokeStyle = `rgba(232,255,244,${0.18 + t * 0.2})`;
          ctx.stroke();
        }
        [
          [-0.42, 0.18],
          [0.42, -0.2],
          [0.02, -0.34],
        ].forEach(([dx, dy], i) => {
          ctx.beginPath();
          ctx.arc(cx + dx * size, cy + dy * size, 6 - i, 0, Math.PI * 2);
          ctx.fillStyle = i === 1 ? "#dcf6aa" : "#eafff5";
          ctx.fill();
        });
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        frame = 0;
      };
      const tick = (time) => {
        frame = 0;
        const dt = Math.min((time - (last || time)) / 1000, 0.05);
        last = time;
        const a = 1 - Math.exp(-11 * dt);
        x += (tx - x) * a;
        y += (ty - y) * a;
        paint();
        if (
          Math.abs(tx - x) + Math.abs(ty - y) > 0.06 &&
          visible &&
          !document.hidden &&
          !paused &&
          !media.matches
        )
          frame = requestAnimationFrame(tick);
      };
      const wake = () => {
        if (
          !frame &&
          visible &&
          !document.hidden &&
          !paused &&
          !media.matches
        ) {
          last = 0;
          frame = requestAnimationFrame(tick);
        }
      };
      const resize = () => {
        const box = host.getBoundingClientRect();
        w = box.width;
        h = box.height;
        const dpr = Math.min(devicePixelRatio || 1, 1.75);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint();
      };
      new ResizeObserver(resize).observe(host);
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible) stop();
        else {
          paint();
          wake();
        }
      }).observe(host);
      const move = (e) => {
        if (paused || media.matches || !w || !h) return;
        const box = host.getBoundingClientRect();
        tx = ((e.clientX - box.left) / w - 0.5) * 26;
        ty = ((e.clientY - box.top) / h - 0.5) * 20;
        wake();
      };
      host.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "touch") move(e);
      });
      host.addEventListener("pointerdown", move);
      host.addEventListener("pointerleave", () => {
        tx = ty = 0;
        wake();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
        else wake();
      });
      const update = () => {
        stop();
        x = y = tx = ty = 0;
        paint();
        button.setAttribute("aria-pressed", String(paused));
        button.textContent = paused ? "تشغيل الحركة" : "إيقاف الحركة";
      };
      media.addEventListener("change", update);
      button.addEventListener("click", () => {
        paused = !paused;
        try {
          localStorage.setItem("people36t-motion-paused", String(paused));
        } catch {}
        scenes.forEach((s) => s.update());
      });
      resize();
      update();
      return { update };
    },
  );
  // Existing div tabs retain routing and permission visibility, with keyboard activation.
  document.querySelectorAll(".nav-tab[data-tab]").forEach((tab) => {
    tab.setAttribute("role", "button");
    tab.tabIndex = 0;
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tab.click();
      }
    });
  });
})();
