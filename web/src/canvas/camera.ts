import { Application, Container } from "pixi.js";
import { Viewport } from "pixi-viewport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CameraCleanup = () => void;

export type ViewportState = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type CameraHandle = {
  getViewport: () => ViewportState;
  zoomIn: () => void;
  zoomOut: () => void;
  panTo: (worldX: number, worldY: number) => void;
  resetZoom: () => void;
};

let currentHandle: CameraHandle | null = null;

export function getCameraHandle(): CameraHandle | null {
  return currentHandle;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const FIT_MARGIN = 0.85;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Create a pixi-viewport camera that wraps the world container.
 * Supports: zoom (wheel + pinch), pan (drag), resize, bounds clamping.
 * Returns a cleanup function.
 */
export function setupCamera(
  app: Application,
  world: Container,
  getOfficeBounds: () => { width: number; height: number },
): CameraCleanup {
  const bounds = getOfficeBounds();

  const viewport = new Viewport({
    screenWidth: app.screen.width,
    screenHeight: app.screen.height,
    worldWidth: bounds.width,
    worldHeight: bounds.height,
    events: app.renderer.events,
  });

  // Move world's children into the viewport
  while (world.children.length > 0) {
    viewport.addChild(world.children[0]);
  }

  // Replace world in the stage with the viewport
  const parent = world.parent!;
  const index = parent.getChildIndex(world);
  parent.removeChild(world);
  parent.addChildAt(viewport, index);

  // Enable interactions
  viewport
    .drag()
    .pinch()
    .wheel()
    .clampZoom({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM });

  // Fit office to screen
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const fitScale = Math.min(screenW / bounds.width, screenH / bounds.height) * FIT_MARGIN;
  viewport.setZoom(fitScale, true);
  viewport.moveCenter(bounds.width / 2, bounds.height / 2);

  // Resize handler
  const resizeObserver = new ResizeObserver(() => {
    const canvas = app.canvas as HTMLCanvasElement;
    const parentEl = canvas.parentElement;
    if (!parentEl) return;
    const w = parentEl.clientWidth;
    const h = parentEl.clientHeight;
    if (w === 0 || h === 0) return;

    app.renderer.resize(w, h);
    viewport.resize(w, h);
  });

  const canvas = app.canvas as HTMLCanvasElement;
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement);
  }
  canvas.style.cursor = "grab";

  // Cursor feedback
  viewport.on("drag-start", () => { canvas.style.cursor = "grabbing"; });
  viewport.on("drag-end", () => { canvas.style.cursor = "grab"; });

  // Expose camera handle for React overlays
  currentHandle = {
    getViewport: () => ({
      x: viewport.left,
      y: viewport.top,
      width: viewport.screenWidth / viewport.scale.x,
      height: viewport.screenHeight / viewport.scale.y,
      scale: viewport.scale.x,
    }),
    zoomIn: () => {
      const newScale = Math.min(viewport.scale.x * 1.5, MAX_ZOOM);
      viewport.setZoom(newScale, true);
    },
    zoomOut: () => {
      const newScale = Math.max(viewport.scale.x * 0.67, MIN_ZOOM);
      viewport.setZoom(newScale, true);
    },
    panTo: (worldX: number, worldY: number) => {
      viewport.moveCenter(worldX, worldY);
    },
    resetZoom: () => {
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const fitScale = Math.min(screenW / bounds.width, screenH / bounds.height) * FIT_MARGIN;
      viewport.setZoom(fitScale, true);
      viewport.moveCenter(bounds.width / 2, bounds.height / 2);
    },
  };

  // Cleanup
  return () => {
    currentHandle = null;
    resizeObserver.disconnect();
    viewport.destroy({ children: false });
    canvas.style.cursor = "";
  };
}
