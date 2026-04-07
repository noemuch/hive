import { Application, Container } from "pixi.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OfficeBounds = {
  /** Office pixel width at SCALE (before camera zoom) */
  width: number;
  /** Office pixel height at SCALE (before camera zoom) */
  height: number;
};

type CameraState = {
  zoom: number;
  isPanning: boolean;
  panStart: { x: number; y: number };
  stageStart: { x: number; y: number };
};

type CameraCleanup = () => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const WHEEL_ZOOM_SPEED = 0.001;
const TRACKPAD_ZOOM_SPEED = 0.01;
const MIN_VISIBLE_RATIO = 0.2;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Attach camera controls (zoom, pan, resize) to a world container.
 * Returns a cleanup function to remove all listeners.
 *
 * @param app - PixiJS Application
 * @param world - Container to transform (NOT app.stage — a dedicated world layer)
 * @param getOfficeBounds - Lazy accessor returning live office pixel dimensions at SCALE
 */
export function setupCamera(
  app: Application,
  world: Container,
  getOfficeBounds: () => OfficeBounds,
): CameraCleanup {
  const canvas = app.canvas as HTMLCanvasElement;

  const state: CameraState = {
    zoom: 1,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    stageStart: { x: 0, y: 0 },
  };

  // Track whether a gesture is active (blocks resize recalc)
  let gestureActive = false;
  let pendingResize = false;

  // --- Fit to screen ---
  function fitToScreen(): void {
    const bounds = getOfficeBounds();
    const screenW = app.screen.width;
    const screenH = app.screen.height;

    const fitScale =
      Math.min(screenW / bounds.width, screenH / bounds.height) * 0.85;

    state.zoom = fitScale;
    world.scale.set(fitScale);
    world.x = (screenW - bounds.width * fitScale) / 2;
    world.y = (screenH - bounds.height * fitScale) / 2;
  }

  // --- Bounds clamping ---
  // Keep at least 20% of the office visible on screen.
  // world.x/y is the top-left corner of the world container in screen space.
  // Office occupies [world.x, world.x + scaledW] horizontally.
  function clampBounds(): void {
    const bounds = getOfficeBounds();
    const screenW = app.screen.width;
    const screenH = app.screen.height;

    const scaledW = bounds.width * state.zoom;
    const scaledH = bounds.height * state.zoom;

    // Pan left limit: right edge of office stays ≥20% on screen
    // world.x + scaledW >= scaledW * 0.2  →  world.x >= -scaledW * 0.8
    const minX = -(scaledW * (1 - MIN_VISIBLE_RATIO));
    // Pan right limit: left edge of office stays ≤80% of screen width
    // world.x <= screenW - scaledW * 0.2
    const maxX = screenW - scaledW * MIN_VISIBLE_RATIO;

    const minY = -(scaledH * (1 - MIN_VISIBLE_RATIO));
    const maxY = screenH - scaledH * MIN_VISIBLE_RATIO;

    world.x = Math.max(minX, Math.min(maxX, world.x));
    world.y = Math.max(minY, Math.min(maxY, world.y));
  }

  // --- Zoom toward point ---
  function zoomAtPoint(newZoom: number, screenX: number, screenY: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const ratio = clamped / state.zoom;

    // Zoom toward the cursor: adjust position so the point under cursor stays fixed
    world.x = screenX - (screenX - world.x) * ratio;
    world.y = screenY - (screenY - world.y) * ratio;
    world.scale.set(clamped);
    state.zoom = clamped;

    clampBounds();
  }

  // --- Wheel handler (zoom) ---
  function onWheel(e: WheelEvent): void {
    e.preventDefault();

    // ctrlKey = macOS trackpad pinch gesture — use different sensitivity
    const isTrackpad = e.ctrlKey;
    const speed = isTrackpad ? TRACKPAD_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    const delta = -e.deltaY * speed;
    const newZoom = state.zoom * (1 + delta);

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    zoomAtPoint(newZoom, screenX, screenY);
  }

  // --- Pointer handlers (pan) ---
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // left click only
    gestureActive = true;
    state.isPanning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
    state.stageStart = { x: world.x, y: world.y };
    canvas.style.cursor = "grabbing";
  }

  function onPointerMove(e: PointerEvent): void {
    if (!state.isPanning) return;

    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;

    world.x = state.stageStart.x + dx;
    world.y = state.stageStart.y + dy;

    clampBounds();
  }

  function onPointerUp(): void {
    if (!state.isPanning) return;
    state.isPanning = false;
    gestureActive = false;
    canvas.style.cursor = "grab";

    // Process deferred resize if one was pending
    if (pendingResize) {
      pendingResize = false;
      handleResize();
    }
  }

  // --- Resize handler ---
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function handleResize(): void {
    if (gestureActive) {
      pendingResize = true;
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;

    app.renderer.resize(width, height);

    // Preserve zoom, just re-clamp bounds
    clampBounds();
  }

  function onResize(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  }

  // --- ResizeObserver ---
  const parent = canvas.parentElement;
  let resizeObserver: ResizeObserver | null = null;
  if (parent) {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(parent);
  }

  // --- Attach listeners ---
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  // Initial cursor
  canvas.style.cursor = "grab";

  // Initial fit
  fitToScreen();

  // --- Cleanup ---
  return () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeObserver?.disconnect();
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    canvas.style.cursor = "";
  };
}
