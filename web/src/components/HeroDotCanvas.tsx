"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { type Company } from "@/components/CompanyCard";

const STATUS_COLORS: Record<string, string> = {
  active: "#33CC66",
  forming: "#E89B1C",
  dissolved: "#686E82",
  struggling: "#686E82",
};

const MIN_RADIUS = 16;
const MAX_RADIUS = 48;
const CANVAS_HEIGHT = 200;
const LABEL_FONT = '11px Inter, system-ui, sans-serif';
const LABEL_GAP = 8;
const PULSE_DURATION = 2000;
const FADE_DURATION = 500;

type CircleData = {
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  companyId: string;
  pulses: boolean;
};

function computeCircles(companies: Company[], width: number): CircleData[] {
  if (companies.length === 0 || width === 0) return [];

  const circles: CircleData[] = companies.map((c) => {
    const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, 12 + c.agent_count * 4));
    return {
      x: 0,
      y: CANVAS_HEIGHT / 2 - LABEL_GAP,
      radius,
      color: STATUS_COLORS[c.status] || STATUS_COLORS.dissolved,
      name: c.name,
      companyId: c.id,
      pulses: c.messages_today > 0,
    };
  });

  // Horizontal layout: evenly spaced, centered
  const totalWidth = circles.reduce((sum, c) => sum + c.radius * 2, 0);
  const gap = Math.max(24, (width - totalWidth) / (circles.length + 1));
  let cursor = gap;
  for (const circle of circles) {
    circle.x = cursor + circle.radius;
    cursor += circle.radius * 2 + gap;
  }

  return circles;
}

function hitTest(circles: CircleData[], mx: number, my: number): CircleData | null {
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    const dx = mx - c.x;
    const dy = my - c.y;
    if (dx * dx + dy * dy <= c.radius * c.radius) return c;
  }
  return null;
}

export function HeroDotCanvas({ companies }: { companies: Company[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const circlesRef = useRef<CircleData[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const router = useRouter();

  // Resize + recompute circles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement!;
    const observer = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      circlesRef.current = computeCircles(companies, rect.width);
    });
    observer.observe(parent);

    return () => observer.disconnect();
  }, [companies]);

  // Animation loop — all draw logic lives inside the effect to avoid render-time impurity
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const startTime = performance.now();
    let raf = 0;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const now = performance.now();
      const elapsed = now - startTime;

      // Fade in
      const opacity = Math.min(1, elapsed / FADE_DURATION);
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.globalAlpha = opacity;

      const circles = circlesRef.current;
      const hovered = hoveredRef.current;

      for (const c of circles) {
        ctx.save();

        // Pulse animation
        let scale = 1;
        if (c.pulses) {
          const phase = ((now % PULSE_DURATION) / PULSE_DURATION) * Math.PI * 2;
          scale = 1 + 0.05 * (0.5 + 0.5 * Math.sin(phase));
        }

        // Glow on hover
        if (hovered === c.companyId) {
          ctx.shadowColor = c.color;
          ctx.shadowBlur = 16;
        }

        // Circle
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.radius * scale, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.restore();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.fillText(c.name, c.x, c.y + c.radius + LABEL_GAP + 11);
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mouse interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getMousePos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMove = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const hit = hitTest(circlesRef.current, pos.x, pos.y);
      hoveredRef.current = hit?.companyId ?? null;
      canvas.style.cursor = hit ? "pointer" : "default";
    };

    const onClick = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const hit = hitTest(circlesRef.current, pos.x, pos.y);
      if (hit) router.push(`/company/${hit.companyId}`);
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [router]);

  return (
    <div className="w-full mb-6">
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: CANVAS_HEIGHT }}
        aria-label="Company activity map"
        role="img"
      />
    </div>
  );
}
