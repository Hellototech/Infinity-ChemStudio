import { Burner } from './core/apparatus/Burner';
import { Vessel } from './core/apparatus/Vessel';
import { ApparatusTypeId, WorkbenchSnapshot } from './core/apparatus/types';
import { WorkbenchState } from './core/apparatus/WorkbenchState';
import { CompoundDefinition } from './core/chemistry/types';
import { BurnerRenderer } from './render/BurnerRenderer';
import { GlasswareRenderer } from './render/GlasswareRenderer';
import { InteractionController } from './render/InteractionController';
import { LiquidRenderer } from './render/LiquidRenderer';
import { BubbleEmitter } from './render/particles/BubbleEmitter';
import { PrecipitateEmitter } from './render/particles/PrecipitateEmitter';
import { SteamEmitter } from './render/particles/SteamEmitter';
import { StageManager } from './render/StageManager';
import { StreamRenderer } from './render/StreamRenderer';
import { PresetManager } from './ui/PresetManager';
import { SimSpeedMultiplier, StudioShell } from './ui/StudioShell';

/**
 * Populates the default sandbox laboratory bench:
 * - Beaker 1 (x: -155, y: 250): 100 mL of 0.2 M CuSO4 (pale cyan-blue)
 * - Beaker 2 (x: 0, y: 250): 100 mL of 0.4 M NaOH (colorless)
 * - Conical Flask (x: 155, y: 250): 80 mL of 0.1 M AgNO3 (colorless)
 * - Test Tube (x: 280, y: 250): 30 mL of 0.2 M NaCl (colorless)
 * - Beaker 3 (x: -300, y: 190, on tripod above lit Bunsen Burner): 120 mL of 0.5 M Na2CO3
 * - Bunsen Burner (x: -300, y: 250): Lit roaring blue flame heating Beaker 3
 */
export function seedDefaultPhase3Workbench(workbench: WorkbenchState): {
  beaker1: Vessel;
  beaker2: Vessel;
  beaker3: Vessel;
  conicalFlask: Vessel;
  testTube: Vessel;
  burner: Burner;
} {
  PresetManager.loadPreset(workbench, 'preset_01_default_sandbox');
  const vessels = workbench.getAllVessels();
  const burners = workbench.getAllBurners();
  return {
    beaker3: vessels[0],
    beaker1: vessels[1],
    beaker2: vessels[2],
    conicalFlask: vessels[3],
    testTube: vessels[4],
    burner: burners[0],
  };
}

export interface CoordinatorSubscriber {
  onFrameSnapshot?: (
    snapshot: WorkbenchSnapshot,
    selectedVesselId: string | null,
    activeParticlesCount: number
  ) => void;
}

/**
 * Final Phase 5 Application Coordinator binding the Master CAD StudioShell,
 * ReagentShelf, TelemetryInspector, PresetManager, and ReactionToastLog
 * to the headless WorkbenchState and Pixi.js v8 WebGL StageManager.
 */
export class InfinityChemStudioCoordinator {
  public readonly workbench: WorkbenchState;
  public readonly stageManager: StageManager;
  public studioShell!: StudioShell;
  private burnerRenderer!: BurnerRenderer;
  private liquidRenderer!: LiquidRenderer;
  private glasswareRenderer!: GlasswareRenderer;
  private streamRenderer!: StreamRenderer;
  private bubbleEmitter!: BubbleEmitter;
  private precipitateEmitter!: PrecipitateEmitter;
  private steamEmitter!: SteamEmitter;
  public interactionController!: InteractionController;

  private subscriber: CoordinatorSubscriber;
  private elapsedTimeSec: number = 0;
  private isPaused: boolean = false;
  private speedMultiplier: SimSpeedMultiplier = 1.0;
  private spawnSequenceIndex: number = 4;
  private isInitialized: boolean = false;

  private keydownHandler = (e: KeyboardEvent) => this.handleGlobalKeydown(e);

  constructor(subscriber: CoordinatorSubscriber = {}) {
    this.workbench = new WorkbenchState();
    this.stageManager = new StageManager();
    this.subscriber = subscriber;

    seedDefaultPhase3Workbench(this.workbench);
  }

  /**
   * Mounts the complete CAD StudioShell + Pixi.js v8 WebGL viewport into hostElement.
   */
  public async mount(hostElement: HTMLElement): Promise<void> {
    if (this.isInitialized) return;

    // 1. Construct the Master CAD StudioShell (Top Bar, Left Dock, Center Viewport, Right Dock, Status Bar)
    this.studioShell = new StudioShell(hostElement, {
      onSelectPreset: (presetId) => this.handleSelectPreset(presetId),
      onTogglePause: () => this.togglePause(),
      onSetSpeedMultiplier: (spd) => this.setSpeedMultiplier(spd),
      onStepOneTick: () => this.stepOneTick(),
      onEmptySelectedVessel: () => this.emptySelectedVessel(),
      onClearBench: () => this.clearBench(),
      onResetCamera: () => this.stageManager.centerCamera(),
      onExportJson: () => PresetManager.exportToJson(this.workbench),
      onImportJson: (jsonText) => this.handleImportJson(jsonText),
      onDispenseReagent: (comp, volMl, mol) =>
        this.dispenseReagent(comp, volMl, mol),
      onDispenseWater: (volMl) => this.dispenseWater(volMl),
      onSpawnApparatus: (type) => this.spawnApparatus(type),
      onUprightVessel: (id) => this.uprightVessel(id),
      onEmptyVessel: (id) => this.emptyVesselById(id),
      onDeleteVessel: (id) => this.deleteVesselById(id),
      onSetVesselRotationDeg: (id, deg) => {
        const v = this.workbench.getVessel(id);
        if (v) v.setRotationDeg(deg);
      },
      onSetBuretteStopcock: (id, ratio) => {
        const v = this.workbench.getVessel(id);
        if (v) v.stopcockOpenRatio = ratio;
      },
      onSelectIndicator: (id, indId) => {
        const v = this.workbench.getVessel(id);
        if (v) {
          v.setIndicator(indId);
          this.studioShell.toastLog.pushLog(
            this.workbench.getSnapshot().simTimeSeconds,
            'REACTION',
            `Indicator set to ${indId ? indId.toUpperCase() : 'NONE'} in ${id.toUpperCase()}`
          );
        }
      },
      onSelectVesselTab: (id) => {
        this.interactionController.setSelectedVesselId(id);
      },
    });

    // 2. Initialize Pixi.js v8 WebGL Stage inside studioShell.pixiViewportHost
    await this.stageManager.init(this.studioShell.pixiViewportHost);

    this.burnerRenderer = new BurnerRenderer(this.stageManager.burnerLayer);
    this.liquidRenderer = new LiquidRenderer();
    this.glasswareRenderer = new GlasswareRenderer(
      this.stageManager.vesselLayer,
      this.liquidRenderer
    );
    this.streamRenderer = new StreamRenderer(this.stageManager.streamLayer);

    this.bubbleEmitter = new BubbleEmitter(2048);
    this.precipitateEmitter = new PrecipitateEmitter(2048);
    this.steamEmitter = new SteamEmitter(this.stageManager.overlayLayer, 1024);

    this.interactionController = new InteractionController(
      this.stageManager,
      this.workbench,
      {
        onSelectVessel: () => this.emitSnapshot(),
        onWorkbenchMutated: () => this.emitSnapshot(),
      }
    );

    this.interactionController.setSelectedVesselId('beaker_01');
    this.studioShell.toastLog.seedBaselineFromSnapshot(
      this.workbench.getSnapshot()
    );

    // 3. Bind Global Keyboard Shortcuts (Space, R, Delete/Backspace, /)
    window.addEventListener('keydown', this.keydownHandler);

    // 4. Connect 60fps Pixi.js v8 Ticker Loop
    this.stageManager.app.ticker.add((ticker) => {
      const rawDt = Math.min(0.05, ticker.deltaMS / 1000);
      const simDt = this.isPaused ? 0 : rawDt * this.speedMultiplier;

      this.elapsedTimeSec += rawDt;

      this.interactionController.update(rawDt);
      if (simDt > 0) {
        this.workbench.tick(simDt);
      }

      this.renderFrame(rawDt, simDt, ticker.deltaMS, ticker.FPS);
    });

    this.isInitialized = true;
    this.emitSnapshot();
  }

  private renderFrame(
    visualDt: number,
    simDt: number,
    frameTimeMs: number,
    fps: number
  ): void {
    const allVessels = this.workbench.getAllVessels();
    const allBurners = this.workbench.getAllBurners();
    const activeStreams = this.workbench.getActivePourStreams();

    // 1. Render Procedural Bunsen Burners & Multi-Zone Flames
    this.burnerRenderer.syncBurners(
      allBurners,
      allVessels,
      this.elapsedTimeSec
    );

    // 2. Render Glassware, Masked Liquid & Settled Precipitate Layers
    this.glasswareRenderer.syncVessels(
      allVessels,
      this.interactionController.getSelectedVesselId(),
      this.interactionController.getHoveredVesselId(),
      this.elapsedTimeSec,
      (vesselId, pptId, actualMass) =>
        this.precipitateEmitter.getVisualSettledMassGrams(
          vesselId,
          pptId,
          actualMass
        )
    );

    // 3. Step & Render Zero-Allocation Particle Emitters
    const particleDt = this.isPaused ? 0 : visualDt;
    if (particleDt > 0) {
      this.precipitateEmitter.updateAndRender(
        allVessels,
        this.glasswareRenderer.getCrystalGraphicsMap(),
        particleDt
      );
      this.bubbleEmitter.updateAndRender(
        allVessels,
        this.glasswareRenderer.getBubbleGraphicsMap(),
        particleDt
      );
      this.steamEmitter.updateAndRender(allVessels, particleDt);
    }

    // 4. Render Active Bezier Pouring Streams
    this.streamRenderer.renderStreams(
      activeStreams,
      allVessels,
      this.elapsedTimeSec
    );

    // 5. Update 60Hz Telemetry Inspector, Toast Event Log, and Bottom Status Bar
    const snapshot = this.workbench.getSnapshot();
    const cursorWorld = this.interactionController.getCursorWorldPosition();
    const cam = this.stageManager.getCameraState();

    this.studioShell.updateFrameTelemetry({
      snapshot,
      selectedVesselId: this.interactionController.getSelectedVesselId(),
      hoveredVesselId: this.interactionController.getHoveredVesselId(),
      cursorWorldX: cursorWorld.x,
      cursorWorldY: cursorWorld.y,
      zoom: cam.zoom,
      activeParticlesCount: this.getTotalActiveParticles(),
      frameTimeMs,
      fps,
      dt: simDt > 0 ? simDt : visualDt,
    });

    this.emitSnapshot(snapshot);
  }

  private handleGlobalKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const isInputFocused =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT');

    if (e.key === 'Escape' && isInputFocused) {
      target.blur();
      return;
    }

    if (isInputFocused) return;

    // '/' focuses Reagent Shelf Search Input
    if (e.key === '/') {
      e.preventDefault();
      this.studioShell.reagentShelf.focusSearchInput();
      return;
    }

    // 'Space' toggles Play / Pause
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
      return;
    }

    // 'R' uprights selected vessel to 0°
    if (e.code === 'KeyR') {
      e.preventDefault();
      const selId = this.interactionController.getSelectedVesselId();
      if (selId) {
        this.uprightVessel(selId);
      }
      return;
    }

    // 'Delete' or 'Backspace' deletes selected apparatus
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      const selId = this.interactionController.getSelectedVesselId();
      if (selId) {
        this.deleteVesselById(selId);
      }
    }
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
    this.studioShell.syncTransportState(this.isPaused, this.speedMultiplier);
  }

  public setSpeedMultiplier(speed: SimSpeedMultiplier): void {
    this.speedMultiplier = speed;
    this.studioShell.syncTransportState(this.isPaused, this.speedMultiplier);
  }

  public stepOneTick(): void {
    if (!this.isPaused) return;
    const dt = 1 / 60;
    this.elapsedTimeSec += dt;
    this.workbench.tick(dt);

    const allVessels = this.workbench.getAllVessels();
    this.precipitateEmitter.updateAndRender(
      allVessels,
      this.glasswareRenderer.getCrystalGraphicsMap(),
      dt
    );
    this.bubbleEmitter.updateAndRender(
      allVessels,
      this.glasswareRenderer.getBubbleGraphicsMap(),
      dt
    );
    this.steamEmitter.updateAndRender(allVessels, dt);

    this.renderFrame(dt, dt, 16.6, 60);
  }

  private handleSelectPreset(presetId: string): void {
    this.clearAllParticlePools();
    const preset = PresetManager.loadPreset(this.workbench, presetId);
    this.interactionController.setSelectedVesselId(
      preset.defaultSelectedVesselId
    );
    this.stageManager.centerCamera();
    const snap = this.workbench.getSnapshot();
    this.studioShell.toastLog.seedBaselineFromSnapshot(snap);
    this.studioShell.toastLog.pushLog(
      snap.simTimeSeconds,
      'SYSTEM',
      `Loaded ${preset.code}`
    );
  }

  private handleImportJson(jsonText: string): void {
    this.clearAllParticlePools();
    const firstId = PresetManager.importFromJson(this.workbench, jsonText);
    this.interactionController.setSelectedVesselId(firstId);
    const snap = this.workbench.getSnapshot();
    this.studioShell.toastLog.seedBaselineFromSnapshot(snap);
    this.studioShell.toastLog.pushLog(
      snap.simTimeSeconds,
      'SYSTEM',
      `Restored workbench state from JSON (${snap.vessels.length} vessels)`
    );
  }

  private dispenseReagent(
    compound: CompoundDefinition,
    volumeMl: number,
    molarity: number
  ): void {
    let targetVessel = this.getActiveVessel();

    // Spawn a new 250 mL Beaker if no vessel is currently selected
    if (!targetVessel) {
      this.spawnSequenceIndex += 1;
      const newId = `beaker_0${this.spawnSequenceIndex}`;
      targetVessel = this.workbench.addVessel({
        id: newId,
        type: 'beaker_250',
        label: `${newId.toUpperCase()} · ${compound.formula}`,
        x: 0,
        y: StageManager.BENCH_HORIZON_Y,
      });
      this.interactionController.setSelectedVesselId(targetVessel.id);
    }

    targetVessel.addSolution(compound.id, volumeMl, molarity);

    this.studioShell.toastLog.pushLog(
      this.workbench.getSnapshot().simTimeSeconds,
      'REACTION',
      `Dispensed ${volumeMl.toFixed(0)}mL of ${molarity.toFixed(2)}M ${compound.formula} into ${targetVessel.id.toUpperCase()}`
    );
  }

  private dispenseWater(volumeMl: number): void {
    const targetVessel = this.getActiveVessel();
    if (!targetVessel) return;
    targetVessel.addWater(volumeMl);
    this.studioShell.toastLog.pushLog(
      this.workbench.getSnapshot().simTimeSeconds,
      'REACTION',
      `Added ${volumeMl.toFixed(0)}mL H₂O(l) to ${targetVessel.id.toUpperCase()}`
    );
  }

  private spawnApparatus(type: ApparatusTypeId | 'bunsen_burner'): void {
    this.spawnSequenceIndex += 1;
    const offsetJitter = ((this.spawnSequenceIndex % 5) - 2) * 55;

    if (type === 'bunsen_burner') {
      const burnerId = `burner_0${this.spawnSequenceIndex}`;
      this.workbench.addBurner({
        id: burnerId,
        x: offsetJitter,
        y: StageManager.BENCH_HORIZON_Y,
        isLit: true,
        airHoleOpenRatio: 1.0,
        thermalPowerWatts: 450,
      });
      this.studioShell.toastLog.pushLog(
        this.workbench.getSnapshot().simTimeSeconds,
        'SYSTEM',
        `Spawned Bunsen Burner (${burnerId.toUpperCase()})`
      );
      return;
    }

    const prefix =
      type === 'beaker_250'
        ? 'beaker'
        : type === 'erlenmeyer_250'
        ? 'flask'
        : type === 'test_tube_50'
        ? 'tube'
        : 'burette';
    const vesselId = `${prefix}_0${this.spawnSequenceIndex}`;

    const vessel = this.workbench.addVessel({
      id: vesselId,
      type,
      label: vesselId.toUpperCase(),
      x: offsetJitter,
      y: StageManager.BENCH_HORIZON_Y,
    });
    this.interactionController.setSelectedVesselId(vessel.id);

    this.studioShell.toastLog.pushLog(
      this.workbench.getSnapshot().simTimeSeconds,
      'SYSTEM',
      `Spawned ${vessel.spec.name} (${vesselId.toUpperCase()})`
    );
  }

  private getActiveVessel(): Vessel | undefined {
    const selId = this.interactionController?.getSelectedVesselId();
    if (selId) {
      const found = this.workbench.getVessel(selId);
      if (found) return found;
    }
    return this.workbench.getAllVessels()[0];
  }

  private uprightVessel(vesselId: string): void {
    this.interactionController.uprightVessel(vesselId);
  }

  private emptySelectedVessel(): void {
    const v = this.getActiveVessel();
    if (v) {
      this.emptyVesselById(v.id);
    }
  }

  private emptyVesselById(vesselId: string): void {
    const vessel = this.workbench.getVessel(vesselId);
    if (!vessel) return;
    vessel.reset();
    this.bubbleEmitter.getPool().clearVesselParticles(vesselId);
    this.precipitateEmitter.getPool().clearVesselParticles(vesselId);
    this.steamEmitter.getPool().clearVesselParticles(vesselId);
    this.studioShell.toastLog.pushLog(
      this.workbench.getSnapshot().simTimeSeconds,
      'SYSTEM',
      `Emptied ${vesselId.toUpperCase()}`
    );
  }

  private deleteVesselById(vesselId: string): void {
    const removed = this.workbench.removeVessel(vesselId);
    if (!removed) return;
    this.bubbleEmitter.getPool().clearVesselParticles(vesselId);
    this.precipitateEmitter.getPool().clearVesselParticles(vesselId);
    this.steamEmitter.getPool().clearVesselParticles(vesselId);

    const remaining = this.workbench.getAllVessels();
    this.interactionController.setSelectedVesselId(
      remaining[0]?.id ?? null
    );
    this.studioShell.toastLog.pushLog(
      this.workbench.getSnapshot().simTimeSeconds,
      'SYSTEM',
      `Removed ${vesselId.toUpperCase()} from bench`
    );
  }

  private clearBench(): void {
    this.clearAllParticlePools();
    this.workbench.reset();
    this.interactionController.setSelectedVesselId(null);
    this.studioShell.toastLog.resetTracking(0);
    this.studioShell.toastLog.pushLog(
      0,
      'SYSTEM',
      'Cleared all apparatus from laboratory bench'
    );
  }

  private clearAllParticlePools(): void {
    if (this.bubbleEmitter) this.bubbleEmitter.getPool().clearAll();
    if (this.precipitateEmitter) this.precipitateEmitter.getPool().clearAll();
    if (this.steamEmitter) this.steamEmitter.getPool().clearAll();
  }

  public getTotalActiveParticles(): number {
    if (!this.isInitialized) return 0;
    return (
      this.bubbleEmitter.getPool().getActiveCount() +
      this.precipitateEmitter.getPool().getActiveCount() +
      this.steamEmitter.getPool().getActiveCount()
    );
  }

  public emitSnapshot(precomputed?: WorkbenchSnapshot): void {
    if (!this.subscriber.onFrameSnapshot) return;
    const selectedId = this.interactionController
      ? this.interactionController.getSelectedVesselId()
      : 'beaker_01';
    this.subscriber.onFrameSnapshot(
      precomputed ?? this.workbench.getSnapshot(),
      selectedId,
      this.getTotalActiveParticles()
    );
  }

  public resetToDefaultScene(): void {
    this.handleSelectPreset('preset_01_default_sandbox');
  }

  public destroy(): void {
    if (!this.isInitialized) return;
    window.removeEventListener('keydown', this.keydownHandler);
    this.stageManager.destroy();
    this.isInitialized = false;
  }
}
