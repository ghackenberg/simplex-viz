import type { CameraController, CameraState, Point2D } from './types';

/**
 * 2D affine camera managing zoom, pan, and screen/world coordinate transforms.
 */
export class SimplexCamera implements CameraController {
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private readonly minZoom = 0.25;
  private readonly maxZoom = 6;
  private readonly onChange?: () => void;

  constructor(onChange?: () => void) {
    this.onChange = onChange;
  }

  getState(): CameraState {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  setState(next: Partial<CameraState>): void {
    if (next.zoom !== undefined && Number.isFinite(next.zoom)) {
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, next.zoom));
    }
    if (next.panX !== undefined && Number.isFinite(next.panX)) {
      this.panX = next.panX;
    }
    if (next.panY !== undefined && Number.isFinite(next.panY)) {
      this.panY = next.panY;
    }
    this.onChange?.();
  }

  zoomToCursor(screenX: number, screenY: number, zoomFactor: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY);
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
    this.zoom = nextZoom;
    this.panX = screenX - worldBefore.x * nextZoom;
    this.panY = screenY - worldBefore.y * nextZoom;
    this.onChange?.();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.onChange?.();
  }

  reset(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.onChange?.();
  }

  screenToWorld(screenX: number, screenY: number): Point2D {
    return {
      x: (screenX - this.panX) / this.zoom,
      y: (screenY - this.panY) / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): Point2D {
    return {
      x: worldX * this.zoom + this.panX,
      y: worldY * this.zoom + this.panY,
    };
  }
}
