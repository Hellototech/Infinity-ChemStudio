import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Burner } from '../core/apparatus/Burner';

export interface StageCameraState {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Pixi.js v8 Application bootstrap, procedural CAD background grid,
 * burner visual renderer, and pan/zoom camera controller.
 */
export class StageManager {
  public static readonly BENCH_HORIZON_Y = 250;
  public static readonly BENCH_DECK_Y = 305;
  public static readonly MIN_ZOOM = 0.5;
  public static readonly MAX_ZOOM = 2.5;

  public readonly app: Application;
  public readonly workbenchStage: Container;
  public readonly backgroundLayer: Container;
  public readonly burnerLayer: Container;
  public readonly vesselLayer: Container;
  public readonly streamLayer: Container;
  public readonly overlayLayer: Container;

  private gridGraphics: Graphics;
  private burnerVisuals: Map<
    string,
    { container: Container; body: Graphics; flame: Graphics; label: Text }
  > = new Map();

  private hostElement: HTMLElement | null = null;
  private isSpaceDown: boolean = false;
  private isPanning: boolean = false;
  private panStartClient: { x: number; y: number } = { x: 0, y: 0 };
  private stageStartPos: { x: number; y: number } = { x: 0, y: 0 };
  private currentZoom: number = 1.0;

  constructor() {
    this.app = new Application();
    this.workbenchStage = new Container();
    this.backgroundLayer = new Container();
    this.burnerLayer = new Container();
    this.vesselLayer = new Container();
    this.streamLayer = new Container();
    this.overlayLayer = new Container();
    this.gridGraphics = new Graphics();
  }

  /**
   * Asynchronously initializes the Pixi.js v8 WebGL Application and mounts the canvas.
   */
  public async init(hostElement?: HTMLElement): Promise<void> {
    this.hostElement = hostElement ?? document.body;

    await this.app.init({
      background: '#090A0C',
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: this.hostElement,
    });

    this.hostElement.appendChild(this.app.canvas);

    this.backgroundLayer.addChild(this.gridGraphics);
    this.workbenchStage.addChild(this.backgroundLayer);
    this.workbenchStage.addChild(this.burnerLayer);
    this.workbenchStage.addChild(this.vesselLayer);
    this.workbenchStage.addChild(this.streamLayer);
    this.workbenchStage.addChild(this.overlayLayer);

    this.app.stage.addChild(this.workbenchStage);

    this.centerCamera();
    this.drawCadBackgroundGrid();
    this.bindCameraControls();
  }

  public centerCamera(): void {
    const width = this.app.screen.width || window.innerWidth;
    const height = this.app.screen.height || window.innerHeight;
    this.currentZoom = 1.0;
    this.workbenchStage.scale.set(this.currentZoom);
    this.workbenchStage.position.set(
      Math.round(width * 0.5),
      Math.round(height * 0.5 - 110)
    );
  }

  public getCameraState(): StageCameraState {
    return {
      panX: this.workbenchStage.x,
      panY: this.workbenchStage.y,
      zoom: this.currentZoom,
    };
  }

  public setZoom(nextZoom: number, pivotScreenX?: number, pivotScreenY?: number): void {
    const clamped = Math.max(
      StageManager.MIN_ZOOM,
      Math.min(StageManager.MAX_ZOOM, nextZoom)
    );
    const sx = pivotScreenX ?? this.app.screen.width * 0.5;
    const sy = pivotScreenY ?? this.app.screen.height * 0.5;

    const worldBeforeX = (sx - this.workbenchStage.x) / this.currentZoom;
    const worldBeforeY = (sy - this.workbenchStage.y) / this.currentZoom;

    this.currentZoom = clamped;
    this.workbenchStage.scale.set(this.currentZoom);
    this.workbenchStage.x = sx - worldBeforeX * this.currentZoom;
    this.workbenchStage.y = sy - worldBeforeY * this.currentZoom;
  }

  /**
   * Converts client/screen pixel coordinates into workbenchStage world coordinates.
   */
  public screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: (localX - this.workbenchStage.x) / this.currentZoom,
      y: (localY - this.workbenchStage.y) / this.currentZoom,
    };
  }

  /**
   * Draws the procedural Precision Lab Dark CAD Background Grid:
   * - Minor grid lines every 20px (#13161C, 1px)
   * - Major grid lines every 100px (#1C2029, 1px)
   * - Lab bench surface horizon line at y = 250 (#2A303C, 2px solid with hatched subsurface ticks)
   */
  public drawCadBackgroundGrid(): void {
    const g = this.gridGraphics;
    g.clear();

    const extent = 2400;
    const minorStep = 20;
    const majorStep = 100;

    // 1. Minor 20px grid lines (#13161C)
    for (let x = -extent; x <= extent; x += minorStep) {
      if (x % majorStep === 0) continue;
      g.moveTo(x, -extent).lineTo(x, extent);
    }
    for (let y = -extent; y <= extent; y += minorStep) {
      if (y % majorStep === 0) continue;
      g.moveTo(-extent, y).lineTo(extent, y);
    }
    g.stroke({ width: 1, color: 0x13161c, alpha: 1 });

    // 2. Major 100px grid lines (#1C2029)
    for (let x = -extent; x <= extent; x += majorStep) {
      g.moveTo(x, -extent).lineTo(x, extent);
    }
    for (let y = -extent; y <= extent; y += majorStep) {
      g.moveTo(-extent, y).lineTo(extent, y);
    }
    g.stroke({ width: 1, color: 0x1c2029, alpha: 1 });

    // 3. Origin crosshair axis tick at (0, 0)
    g.moveTo(-12, 0).lineTo(12, 0);
    g.moveTo(0, -12).lineTo(0, 12);
    g.stroke({ width: 1, color: 0x2a303c, alpha: 0.9 });

    // 4. Lab bench surface horizon line at y = 250 (#2A303C, 2px solid) + subsurface hatched ticks
    const horizonY = StageManager.BENCH_HORIZON_Y;
    const deckY = StageManager.BENCH_DECK_Y;

    // Subtle bench surface fill zone between datum y=250 and deck y=305
    g.rect(-extent, horizonY, extent * 2, deckY - horizonY).fill({
      color: 0x111317,
      alpha: 0.45,
    });

    // Primary horizon line at y = 250
    g.moveTo(-extent, horizonY).lineTo(extent, horizonY);
    // Lower deck line at y = 305 where vessel bases rest when vessel.y === 250
    g.moveTo(-extent, deckY).lineTo(extent, deckY);
    g.stroke({ width: 2, color: 0x2a303c, alpha: 1 });

    // Subtle diagonal hatched subsurface ticks along y = 250 and y = 305
    for (let x = -extent; x <= extent; x += 16) {
      g.moveTo(x, horizonY).lineTo(x - 6, horizonY + 8);
      g.moveTo(x, deckY).lineTo(x - 8, deckY + 10);
    }
    g.stroke({ width: 1, color: 0x22262e, alpha: 0.85 });
  }

  /**
   * Renders and updates procedural Bunsen burners and their heating tripod stands.
   */
  public syncBurners(burners: Burner[], elapsedTimeSec: number): void {
    const activeIds = new Set<string>();

    for (const burner of burners) {
      activeIds.add(burner.id);
      let visual = this.burnerVisuals.get(burner.id);

      if (!visual) {
        const container = new Container();
        const body = new Graphics();
        const flame = new Graphics();
        const label = new Text({
          text: 'BUNSEN-450W [CLICK TO IGNITE]',
          style: new TextStyle({
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            fill: 0x7a828e,
          }),
        });
        label.anchor.set(0.5, 0);
        label.position.set(0, 62);

        container.addChild(flame);
        container.addChild(body);
        container.addChild(label);
        this.burnerLayer.addChild(container);

        visual = { container, body, flame, label };
        this.burnerVisuals.set(burner.id, visual);
      }

      visual.container.position.set(burner.x, burner.y);

      // Redraw burner hardware & tripod heating stand
      const b = visual.body;
      b.clear();

      // Tripod heating stand legs & wire gauze platform at y = -5 (so a vessel at y = 190 rests its base on y = 245)
      b.moveTo(-42, 55)
        .lineTo(-30, -5)
        .lineTo(30, -5)
        .lineTo(42, 55)
        .stroke({ width: 1.5, color: 0x475569, alpha: 0.85 });

      // Ceramic wire gauze pad at y = -5
      b.moveTo(-34, -5)
        .lineTo(34, -5)
        .stroke({ width: 2.5, color: 0x94a3b8, alpha: 0.9 });

      // Heavy cast-iron burner base sitting on y = +55 (world y = 305)
      b.moveTo(-26, 55)
        .lineTo(-18, 46)
        .lineTo(18, 46)
        .lineTo(26, 55)
        .closePath()
        .fill({ color: 0x181b20 })
        .stroke({ width: 1.5, color: 0x64748b });

      // Vertical burner barrel / chimney
      b.rect(-6, 12, 12, 34)
        .fill({ color: 0x1e293b })
        .stroke({ width: 1.5, color: 0x94a3b8 });

      // Air collar ring indicator
      const collarColor = burner.isLit ? 0x38bdf8 : 0x7a828e;
      b.rect(-8, 36, 16, 6)
        .fill({ color: 0x111317 })
        .stroke({ width: 1, color: collarColor });

      // Dynamic flame cone
      const f = visual.flame;
      f.clear();
      if (burner.isLit) {
        const flicker = Math.sin(elapsedTimeSec * 28) * 2.2 + Math.cos(elapsedTimeSec * 19) * 1.5;
        const flameTopY = -6 + flicker * 0.4;
        const isBlue = burner.airHoleOpenRatio >= 0.4;
        const outerColor = isBlue ? 0x38bdf8 : 0xe5a93c;
        const innerColor = isBlue ? 0xe0f2fe : 0xfef08a;

        // Outer flame envelope
        f.moveTo(-7, 12)
          .quadraticCurveTo(-13, -1, 0, flameTopY)
          .quadraticCurveTo(13, -1, 7, 12)
          .closePath()
          .fill({ color: outerColor, alpha: 0.48 });

        // Inner high-temperature reducing cone
        f.moveTo(-4, 12)
          .quadraticCurveTo(-6, 4, 0, flameTopY + 7)
          .quadraticCurveTo(6, 4, 4, 12)
          .closePath()
          .fill({ color: innerColor, alpha: 0.78 });

        visual.label.text = `BURNER ON · ${Math.round(burner.flameTemperatureC)}°C (${Math.round(
          burner.thermalPowerWatts
        )}W)`;
        visual.label.style.fill = 0xe5a93c;
      } else {
        visual.label.text = 'BURNER OFF [CLICK TO IGNITE]';
        visual.label.style.fill = 0x7a828e;
      }
    }

    for (const [id, vis] of this.burnerVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.burnerLayer.removeChild(vis.container);
        vis.container.destroy({ children: true });
        this.burnerVisuals.delete(id);
      }
    }
  }

  private bindCameraControls(): void {
    const canvas = this.app.canvas;

    window.addEventListener('keydown', (e) => {
      if (e.altKey) {
        this.isSpaceDown = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!e.altKey) {
        this.isSpaceDown = false;
        this.isPanning = false;
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      // Middle mouse button (1), Right mouse button (2), or Alt + Left Click
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this.isPanning = true;
        this.panStartClient = { x: e.clientX, y: e.clientY };
        this.stageStartPos = {
          x: this.workbenchStage.x,
          y: this.workbenchStage.y,
        };
      }
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isPanning) return;
      const dx = e.clientX - this.panStartClient.x;
      const dy = e.clientY - this.panStartClient.y;
      this.workbenchStage.x = this.stageStartPos.x + dx;
      this.workbenchStage.y = this.stageStartPos.y + dy;
    });

    window.addEventListener('pointerup', () => {
      this.isPanning = false;
    });

    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.shiftKey) {
          // Ctrl/Meta + Wheel or standard Wheel zooms camera around cursor
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
            this.setZoom(this.currentZoom * zoomFactor, cursorX, cursorY);
          }
        }
      },
      { passive: false }
    );
  }

  public isSpacePanningActive(): boolean {
    return this.isSpaceDown || this.isPanning;
  }

  public destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
