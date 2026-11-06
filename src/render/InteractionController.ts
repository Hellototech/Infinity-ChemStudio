import { Burner } from '../core/apparatus/Burner';
import { Vessel } from '../core/apparatus/Vessel';
import { WorkbenchState } from '../core/apparatus/WorkbenchState';
import { StageManager } from './StageManager';

export interface InteractionCallbacks {
  onSelectVessel?: (vesselId: string | null) => void;
  onWorkbenchMutated?: () => void;
}

/**
 * Handles pointer drag-and-drop in world coordinates, bench/burner snapping,
 * Q/E, A/D, and Shift+Wheel vessel rotation (-115 deg to +115 deg),
 * double-click upright tweening, Bunsen burner ignition toggling,
 * and air-collar scrolling/dragging (0.0 safety flame to 1.0 roaring blue flame).
 */
export class InteractionController {
  public static readonly MAX_TILT_RAD = (115 * Math.PI) / 180;
  public static readonly ROTATION_SPEED_RAD_PER_SEC = 1.65;

  private stageManager: StageManager;
  private workbench: WorkbenchState;
  private callbacks: InteractionCallbacks;

  private selectedVesselId: string | null = null;
  private hoveredVesselId: string | null = null;
  private hoveredBurner: Burner | null = null;
  private draggedVessel: Vessel | null = null;
  private draggedBurner: Burner | null = null;
  private adjustingCollarBurner: Burner | null = null;
  private collarStartClientX: number = 0;
  private collarStartRatio: number = 1.0;

  private dragOffsetWorld: { x: number; y: number } = { x: 0, y: 0 };
  private pointerDownWorld: { x: number; y: number } = { x: 0, y: 0 };
  private cursorWorldPos: { x: number; y: number } = { x: 0, y: 0 };

  private activeKeys: Set<string> = new Set();
  private uprightTweens: Set<string> = new Set();

  constructor(
    stageManager: StageManager,
    workbench: WorkbenchState,
    callbacks: InteractionCallbacks = {}
  ) {
    this.stageManager = stageManager;
    this.workbench = workbench;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  public getSelectedVesselId(): string | null {
    return this.selectedVesselId;
  }

  public setSelectedVesselId(id: string | null): void {
    this.selectedVesselId = id;
    this.callbacks.onSelectVessel?.(id);
  }

  public getHoveredVesselId(): string | null {
    return this.hoveredVesselId;
  }

  public getCursorWorldPosition(): { x: number; y: number } {
    return this.cursorWorldPos;
  }

  public uprightVessel(vesselId: string): void {
    const vessel = this.workbench.getVessel(vesselId);
    if (!vessel) return;
    this.uprightTweens.add(vessel.id);
    this.callbacks.onWorkbenchMutated?.();
  }

  /**
   * Per-frame update for smooth keyboard rotation (Q/E or A/D) and double-click upright tweens.
   */
  public update(dt: number): void {
    const targetId = this.hoveredVesselId ?? this.selectedVesselId;
    if (targetId) {
      const vessel = this.workbench.getVessel(targetId);
      if (vessel) {
        let rotDelta = 0;
        if (this.activeKeys.has('KeyQ') || this.activeKeys.has('KeyA')) {
          rotDelta -= InteractionController.ROTATION_SPEED_RAD_PER_SEC * dt;
        }
        if (this.activeKeys.has('KeyE') || this.activeKeys.has('KeyD')) {
          rotDelta += InteractionController.ROTATION_SPEED_RAD_PER_SEC * dt;
        }
        if (rotDelta !== 0) {
          this.uprightTweens.delete(vessel.id);
          vessel.rotationRad = Math.max(
            -InteractionController.MAX_TILT_RAD,
            Math.min(
              InteractionController.MAX_TILT_RAD,
              vessel.rotationRad + rotDelta
            )
          );
        }
      }
    }

    // Smoothly tween double-clicked vessels back to 0 rad (upright)
    for (const vesselId of Array.from(this.uprightTweens)) {
      const vessel = this.workbench.getVessel(vesselId);
      if (!vessel) {
        this.uprightTweens.delete(vesselId);
        continue;
      }
      const diff = 0 - vessel.rotationRad;
      if (Math.abs(diff) < 0.005) {
        vessel.rotationRad = 0;
        this.uprightTweens.delete(vesselId);
      } else {
        vessel.rotationRad += diff * Math.min(1, 12 * dt);
      }
    }
  }

  private hitTestVessel(worldX: number, worldY: number): Vessel | null {
    const vessels = this.workbench.getAllVessels();
    for (let i = vessels.length - 1; i >= 0; i--) {
      const v = vessels[i];
      const halfW = Math.max(v.spec.width, v.spec.baseWidth ?? v.spec.width) / 2 + 10;
      const halfH = v.spec.height / 2 + 10;
      if (
        worldX >= v.x - halfW &&
        worldX <= v.x + halfW &&
        worldY >= v.y - halfH &&
        worldY <= v.y + halfH
      ) {
        return v;
      }
    }
    return null;
  }

  private hitTestBurner(
    worldX: number,
    worldY: number
  ): { burner: Burner; isCollarZone: boolean } | null {
    for (const burner of this.workbench.getAllBurners()) {
      if (
        worldX >= burner.x - 36 &&
        worldX <= burner.x + 36 &&
        worldY >= burner.y + 8 &&
        worldY <= burner.y + 60
      ) {
        // Air collar ring is around local y = 32..45
        const isCollarZone =
          Math.abs(worldX - burner.x) <= 16 &&
          worldY >= burner.y + 30 &&
          worldY <= burner.y + 45;
        return { burner, isCollarZone };
      }
    }
    return null;
  }

  private bindEvents(): void {
    const canvas = this.stageManager.app.canvas;

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || this.stageManager.isSpacePanningActive()) return;

      const world = this.stageManager.screenToWorld(e.clientX, e.clientY);
      this.pointerDownWorld = { ...world };

      // Check burner hit first if clicking below the tripod gauze (y > burner.y + 8)
      const burnerHit = this.hitTestBurner(world.x, world.y);
      if (burnerHit) {
        if (burnerHit.isCollarZone) {
          this.adjustingCollarBurner = burnerHit.burner;
          this.collarStartClientX = e.clientX;
          this.collarStartRatio = burnerHit.burner.airHoleOpenRatio;
        } else {
          this.draggedBurner = burnerHit.burner;
          this.dragOffsetWorld = {
            x: burnerHit.burner.x - world.x,
            y: burnerHit.burner.y - world.y,
          };
        }
        return;
      }

      const hitVessel = this.hitTestVessel(world.x, world.y);
      if (hitVessel) {
        this.draggedVessel = hitVessel;
        hitVessel.isDragged = true;
        hitVessel.isAgitated = true;
        this.dragOffsetWorld = {
          x: hitVessel.x - world.x,
          y: hitVessel.y - world.y,
        };
        this.setSelectedVesselId(hitVessel.id);
      }
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      const world = this.stageManager.screenToWorld(e.clientX, e.clientY);
      this.cursorWorldPos = world;

      if (this.adjustingCollarBurner) {
        const deltaX = e.clientX - this.collarStartClientX;
        this.adjustingCollarBurner.airHoleOpenRatio = Math.max(
          0,
          Math.min(1, this.collarStartRatio + deltaX * 0.015)
        );
        this.callbacks.onWorkbenchMutated?.();
        return;
      }

      if (this.draggedVessel) {
        this.draggedVessel.x = world.x + this.dragOffsetWorld.x;
        this.draggedVessel.y = world.y + this.dragOffsetWorld.y;
        return;
      }

      if (this.draggedBurner) {
        this.draggedBurner.x = world.x + this.dragOffsetWorld.x;
        this.draggedBurner.y = StageManager.BENCH_HORIZON_Y;
        return;
      }

      if (e.target !== canvas) {
        this.hoveredBurner = null;
        this.hoveredVesselId = null;
        return;
      }

      const bHit = this.hitTestBurner(world.x, world.y);
      this.hoveredBurner = bHit ? bHit.burner : null;

      const hovered = this.hitTestVessel(world.x, world.y);
      this.hoveredVesselId = hovered ? hovered.id : null;
    });

    window.addEventListener('pointerup', (e: PointerEvent) => {
      const world = this.stageManager.screenToWorld(e.clientX, e.clientY);

      if (this.adjustingCollarBurner) {
        const distMoved = Math.hypot(
          world.x - this.pointerDownWorld.x,
          world.y - this.pointerDownWorld.y
        );
        // If user clicked without dragging, also toggle ignition
        if (distMoved < 4) {
          this.adjustingCollarBurner.isLit = !this.adjustingCollarBurner.isLit;
          this.callbacks.onWorkbenchMutated?.();
        }
        this.adjustingCollarBurner = null;
      }

      if (this.draggedVessel) {
        const v = this.draggedVessel;
        v.isDragged = false;
        v.isAgitated = false;

        // Check if released near a Bunsen burner tripod stand
        let snappedToBurner = false;
        for (const burner of this.workbench.getAllBurners()) {
          const standY = burner.y - 60; // Tripod platform 60px above burner datum (y = 190)
          if (
            Math.abs(v.x - burner.x) < 42 &&
            Math.abs(v.y - standY) < 55
          ) {
            v.x = burner.x;
            v.y = standY;
            v.snappedToId = burner.id;
            snappedToBurner = true;
            break;
          }
        }

        // Snap smoothly to bench surface (y = 250) when released near the bench horizon
        if (!snappedToBurner) {
          v.snappedToId = undefined;
          if (Math.abs(v.y - StageManager.BENCH_HORIZON_Y) < 48) {
            v.y = StageManager.BENCH_HORIZON_Y;
          }
        }

        this.draggedVessel = null;
        this.callbacks.onWorkbenchMutated?.();
      }

      if (this.draggedBurner) {
        const distMoved = Math.hypot(
          world.x - this.pointerDownWorld.x,
          world.y - this.pointerDownWorld.y
        );
        // Click on burner base toggles ignition (isLit)
        if (distMoved < 6) {
          this.draggedBurner.isLit = !this.draggedBurner.isLit;
          this.callbacks.onWorkbenchMutated?.();
        }
        this.draggedBurner = null;
      }
    });

    // Double-click tilted vessel to smoothly tween back to 0 rad (upright)
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const world = this.stageManager.screenToWorld(e.clientX, e.clientY);
      const hitVessel = this.hitTestVessel(world.x, world.y);
      if (hitVessel) {
        this.uprightTweens.add(hitVessel.id);
      }
    });

    // Wheel over burner adjusts airHoleOpenRatio; Shift + Wheel over vessel rotates vessel
    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (this.hoveredBurner && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const step = e.deltaY < 0 ? 0.08 : -0.08;
          this.hoveredBurner.airHoleOpenRatio = Math.max(
            0,
            Math.min(1, this.hoveredBurner.airHoleOpenRatio + step)
          );
          this.callbacks.onWorkbenchMutated?.();
          return;
        }

        if (!e.shiftKey) return;
        const targetId = this.hoveredVesselId ?? this.selectedVesselId;
        if (!targetId) return;
        const vessel = this.workbench.getVessel(targetId);
        if (!vessel) return;

        e.preventDefault();
        this.uprightTweens.delete(vessel.id);
        const stepRad = (e.deltaY > 0 ? 5 : -5) * (Math.PI / 180);
        vessel.rotationRad = Math.max(
          -InteractionController.MAX_TILT_RAD,
          Math.min(
            InteractionController.MAX_TILT_RAD,
            vessel.rotationRad + stepRad
          )
        );
        this.callbacks.onWorkbenchMutated?.();
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.activeKeys.add(e.code);
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.activeKeys.delete(e.code);
    });
  }
}
