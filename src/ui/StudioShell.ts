import { ApparatusTypeId, WorkbenchSnapshot } from '../core/apparatus/types';
import { CompoundDefinition } from '../core/chemistry/types';
import { PresetManager } from './PresetManager';
import { ReactionToastLog } from './ReactionToastLog';
import { ReagentShelf } from './ReagentShelf';
import { TelemetryInspector } from './TelemetryInspector';

export type SimSpeedMultiplier = 0.5 | 1.0 | 2.0 | 5.0;

export interface StudioShellCallbacks {
  onSelectPreset: (presetId: string) => void;
  onTogglePause: () => void;
  onSetSpeedMultiplier: (speed: SimSpeedMultiplier) => void;
  onStepOneTick: () => void;
  onEmptySelectedVessel: () => void;
  onClearBench: () => void;
  onResetCamera: () => void;
  onExportJson: () => string;
  onImportJson: (jsonText: string) => void;
  onDispenseReagent: (
    compound: CompoundDefinition,
    volumeMl: number,
    molarity: number
  ) => void;
  onDispenseWater: (volumeMl: number) => void;
  onSpawnApparatus: (type: ApparatusTypeId | 'bunsen_burner') => void;
  onUprightVessel: (vesselId: string) => void;
  onEmptyVessel: (vesselId: string) => void;
  onDeleteVessel: (vesselId: string) => void;
  onSetVesselRotationDeg: (vesselId: string, degrees: number) => void;
  onSetBuretteStopcock: (vesselId: string, ratio: number) => void;
  onSelectIndicator: (vesselId: string, indicatorId: string | null) => void;
  onSelectVesselTab: (vesselId: string) => void;
}

/**
 * Master CAD Layout Shell (100vw x 100vh, overflow: hidden):
 * - Top Command Bar (38px): Brand mark, Preset Selector, Transport (Play/Pause/Speed/Step), Utility actions
 * - Central Grid: Left Dock (280px ReagentShelf) | Pixi.js Viewport + ReactionToastLog | Right Dock (300px TelemetryInspector)
 * - Bottom Status Bar (24px): Live world cursor X/Y, Zoom %, Vessel count, Particle count, Frame time & FPS
 */
export class StudioShell {
  private hostEl: HTMLElement;
  private callbacks: StudioShellCallbacks;

  public readonly pixiViewportHost: HTMLElement;
  public readonly reagentShelf: ReagentShelf;
  public readonly telemetryInspector: TelemetryInspector;
  public readonly toastLog: ReactionToastLog;

  private presetSelectEl!: HTMLSelectElement;
  private playPauseBtn!: HTMLButtonElement;
  private stepTickBtn!: HTMLButtonElement;
  private speedBtns: Map<SimSpeedMultiplier, HTMLButtonElement> = new Map();

  private statusCursorEl!: HTMLElement;
  private statusZoomEl!: HTMLElement;
  private statusVesselsEl!: HTMLElement;
  private statusParticlesEl!: HTMLElement;
  private statusFrameEl!: HTMLElement;

  private jsonModalEl!: HTMLElement;
  private jsonTextareaEl!: HTMLTextAreaElement;
  private jsonModalErrorEl!: HTMLElement;

  constructor(hostEl: HTMLElement, callbacks: StudioShellCallbacks) {
    this.hostEl = hostEl;
    this.callbacks = callbacks;

    this.hostEl.innerHTML = '';

    const shellEl = document.createElement('div');
    shellEl.className = 'ics-studio-shell';

    // 1. Top Command Bar (38px)
    const topBar = this.buildTopCommandBar();
    shellEl.appendChild(topBar);

    // 2. Central Workspace Grid
    const workspaceMain = document.createElement('div');
    workspaceMain.className = 'ics-workspace-main';

    const leftDock = document.createElement('aside');
    leftDock.className = 'ics-left-dock';

    const viewportStage = document.createElement('section');
    viewportStage.className = 'ics-viewport-stage';

    this.pixiViewportHost = document.createElement('div');
    this.pixiViewportHost.className = 'ics-pixi-host';
    viewportStage.appendChild(this.pixiViewportHost);

    // Bottom-Left Technical Event Log Overlay
    this.toastLog = new ReactionToastLog(viewportStage);

    // JSON State Export/Import Modal Overlay
    this.jsonModalEl = this.buildJsonModal();
    viewportStage.appendChild(this.jsonModalEl);

    const rightDock = document.createElement('aside');
    rightDock.className = 'ics-right-dock';

    workspaceMain.appendChild(leftDock);
    workspaceMain.appendChild(viewportStage);
    workspaceMain.appendChild(rightDock);
    shellEl.appendChild(workspaceMain);

    // 3. Bottom Status Bar (24px)
    const statusBar = this.buildBottomStatusBar();
    shellEl.appendChild(statusBar);

    this.hostEl.appendChild(shellEl);

    // Instantiate Left & Right Dock Controllers
    this.reagentShelf = new ReagentShelf(leftDock, {
      onDispenseReagent: (c, v, m) =>
        this.callbacks.onDispenseReagent(c, v, m),
      onDispenseWater: (v) => this.callbacks.onDispenseWater(v),
      onSpawnApparatus: (t) => this.callbacks.onSpawnApparatus(t),
    });

    this.telemetryInspector = new TelemetryInspector(rightDock, {
      onUprightVessel: (id) => this.callbacks.onUprightVessel(id),
      onEmptyVessel: (id) => this.callbacks.onEmptyVessel(id),
      onDeleteVessel: (id) => this.callbacks.onDeleteVessel(id),
      onSetVesselRotationDeg: (id, deg) =>
        this.callbacks.onSetVesselRotationDeg(id, deg),
      onSetBuretteStopcock: (id, ratio) =>
        this.callbacks.onSetBuretteStopcock(id, ratio),
      onSelectIndicator: (id, ind) =>
        this.callbacks.onSelectIndicator(id, ind),
      onSelectVesselTab: (id) => this.callbacks.onSelectVesselTab(id),
    });
  }

  private buildTopCommandBar(): HTMLElement {
    const bar = document.createElement('header');
    bar.className = 'ics-top-bar';
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    // LEFT: Brand Mark + Active Preset Dropdown + JSON State I/O
    const leftGroup = document.createElement('div');
    leftGroup.className = 'ics-top-group';

    const brand = document.createElement('div');
    brand.className = 'ics-brand-mark';
    brand.innerHTML = `<span class="ics-brand-dot"></span><span>INFINITY CHEMSTUDIO // v1.0</span>`;

    const div1 = document.createElement('div');
    div1.className = 'ics-divider-v';

    this.presetSelectEl = document.createElement('select');
    this.presetSelectEl.className = 'ics-select';
    this.presetSelectEl.style.width = '248px';
    for (const preset of PresetManager.PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.code;
      this.presetSelectEl.appendChild(opt);
    }
    this.presetSelectEl.addEventListener('change', () => {
      this.callbacks.onSelectPreset(this.presetSelectEl.value);
    });

    const jsonBtn = document.createElement('button');
    jsonBtn.type = 'button';
    jsonBtn.className = 'ics-btn';
    jsonBtn.textContent = 'STATE JSON';
    jsonBtn.title = 'Export or Import full workbench state as JSON';
    jsonBtn.addEventListener('click', () => this.openJsonModal());

    leftGroup.appendChild(brand);
    leftGroup.appendChild(div1);
    leftGroup.appendChild(this.presetSelectEl);
    leftGroup.appendChild(jsonBtn);

    // CENTER: Transport & Simulation Controls (Play/Pause, Speed 0.5x/1x/2x/5x, Step 1 Tick)
    const centerGroup = document.createElement('div');
    centerGroup.className = 'ics-top-group';

    this.playPauseBtn = document.createElement('button');
    this.playPauseBtn.type = 'button';
    this.playPauseBtn.className = 'ics-btn ics-btn-active';
    this.playPauseBtn.style.minWidth = '88px';
    this.playPauseBtn.textContent = 'RUNNING [SPC]';
    this.playPauseBtn.addEventListener('click', () =>
      this.callbacks.onTogglePause()
    );

    this.stepTickBtn = document.createElement('button');
    this.stepTickBtn.type = 'button';
    this.stepTickBtn.className = 'ics-btn';
    this.stepTickBtn.disabled = true;
    this.stepTickBtn.textContent = 'STEP +1/60s';
    this.stepTickBtn.title = 'Advance simulation by 1/60s tick (when paused)';
    this.stepTickBtn.addEventListener('click', () =>
      this.callbacks.onStepOneTick()
    );

    const speedWrap = document.createElement('div');
    speedWrap.style.display = 'flex';
    speedWrap.style.gap = '2px';

    const speeds: SimSpeedMultiplier[] = [0.5, 1.0, 2.0, 5.0];
    for (const spd of speeds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ics-btn ${spd === 1.0 ? 'ics-btn-active' : ''}`;
      btn.style.padding = '0 6px';
      btn.textContent = `${spd.toFixed(1)}x`;
      btn.addEventListener('click', () => {
        this.callbacks.onSetSpeedMultiplier(spd);
      });
      this.speedBtns.set(spd, btn);
      speedWrap.appendChild(btn);
    }

    centerGroup.appendChild(this.playPauseBtn);
    centerGroup.appendChild(this.stepTickBtn);
    centerGroup.appendChild(speedWrap);

    // RIGHT: Utility Actions (EMPTY SELECTED, CLEAR BENCH, RESET CAMERA)
    const rightGroup = document.createElement('div');
    rightGroup.className = 'ics-top-group';

    const emptySelBtn = document.createElement('button');
    emptySelBtn.type = 'button';
    emptySelBtn.className = 'ics-btn';
    emptySelBtn.textContent = 'EMPTY SELECTED';
    emptySelBtn.addEventListener('click', () =>
      this.callbacks.onEmptySelectedVessel()
    );

    const clearBenchBtn = document.createElement('button');
    clearBenchBtn.type = 'button';
    clearBenchBtn.className = 'ics-btn ics-btn-amber';
    clearBenchBtn.textContent = 'CLEAR BENCH';
    clearBenchBtn.addEventListener('click', () =>
      this.callbacks.onClearBench()
    );

    const resetCamBtn = document.createElement('button');
    resetCamBtn.type = 'button';
    resetCamBtn.className = 'ics-btn';
    resetCamBtn.textContent = 'RESET CAMERA';
    resetCamBtn.addEventListener('click', () =>
      this.callbacks.onResetCamera()
    );

    rightGroup.appendChild(emptySelBtn);
    rightGroup.appendChild(clearBenchBtn);
    rightGroup.appendChild(resetCamBtn);

    bar.appendChild(leftGroup);
    bar.appendChild(centerGroup);
    bar.appendChild(rightGroup);

    return bar;
  }

  private buildBottomStatusBar(): HTMLElement {
    const bar = document.createElement('footer');
    bar.className = 'ics-status-bar';
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    const leftCluster = document.createElement('div');
    leftCluster.className = 'ics-status-cluster';

    this.statusCursorEl = document.createElement('span');
    this.statusCursorEl.className = 'ics-status-item';
    this.statusCursorEl.innerHTML = `CURSOR <span class="ics-status-value">X: 000px Y: 000px</span>`;

    this.statusZoomEl = document.createElement('span');
    this.statusZoomEl.className = 'ics-status-item';
    this.statusZoomEl.innerHTML = `ZOOM <span class="ics-status-value">100%</span>`;

    const shortcutHint = document.createElement('span');
    shortcutHint.className = 'ics-status-item';
    shortcutHint.textContent =
      'KEYS: [SPACE] PAUSE · [Q/E] TILT · [R] UPRIGHT · [DEL] REMOVE · [/] SEARCH';

    leftCluster.appendChild(this.statusCursorEl);
    leftCluster.appendChild(this.statusZoomEl);
    leftCluster.appendChild(shortcutHint);

    const rightCluster = document.createElement('div');
    rightCluster.className = 'ics-status-cluster';

    this.statusVesselsEl = document.createElement('span');
    this.statusVesselsEl.className = 'ics-status-item';
    this.statusVesselsEl.innerHTML = `VESSELS <span class="ics-status-value">05</span>`;

    this.statusParticlesEl = document.createElement('span');
    this.statusParticlesEl.className = 'ics-status-item';
    this.statusParticlesEl.innerHTML = `PARTICLES <span class="ics-status-value">0000 / 5120</span>`;

    this.statusFrameEl = document.createElement('span');
    this.statusFrameEl.className = 'ics-status-item';
    this.statusFrameEl.innerHTML = `<span class="ics-status-value" style="color:#10B981;">16.6ms | 60 FPS</span>`;

    rightCluster.appendChild(this.statusVesselsEl);
    rightCluster.appendChild(this.statusParticlesEl);
    rightCluster.appendChild(this.statusFrameEl);

    bar.appendChild(leftCluster);
    bar.appendChild(rightCluster);

    return bar;
  }

  private buildJsonModal(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.backgroundColor = 'rgba(9, 10, 12, 0.82)';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '40';
    overlay.addEventListener('pointerdown', (e) => e.stopPropagation());

    const dialog = document.createElement('div');
    dialog.style.width = '540px';
    dialog.style.maxWidth = '92%';
    dialog.style.backgroundColor = '#111317';
    dialog.style.border = '1px solid #22262E';
    dialog.style.borderRadius = '2px';
    dialog.style.padding = '12px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const title = document.createElement('span');
    title.className = 'ics-section-title';
    title.style.color = '#ECEFF4';
    title.textContent = 'WORKBENCH STATE // JSON EXPORT & IMPORT';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ics-btn';
    closeBtn.textContent = 'CLOSE [ESC]';
    closeBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    this.jsonTextareaEl = document.createElement('textarea');
    this.jsonTextareaEl.className = 'ics-input';
    this.jsonTextareaEl.style.width = '100%';
    this.jsonTextareaEl.style.height = '260px';
    this.jsonTextareaEl.style.padding = '8px';
    this.jsonTextareaEl.style.resize = 'none';
    this.jsonTextareaEl.style.fontFamily = 'var(--font-mono)';
    this.jsonTextareaEl.style.fontSize = '10px';

    this.jsonModalErrorEl = document.createElement('div');
    this.jsonModalErrorEl.className = 'ics-mono';
    this.jsonModalErrorEl.style.fontSize = '10px';
    this.jsonModalErrorEl.style.color = '#EF4444';
    this.jsonModalErrorEl.style.marginTop = '6px';

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '6px';
    footer.style.marginTop = '8px';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ics-btn';
    copyBtn.textContent = 'COPY JSON';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(this.jsonTextareaEl.value);
      copyBtn.textContent = 'COPIED';
      setTimeout(() => {
        copyBtn.textContent = 'COPY JSON';
      }, 1200);
    });

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'ics-btn ics-btn-active';
    loadBtn.textContent = 'LOAD JSON INTO BENCH';
    loadBtn.addEventListener('click', () => {
      try {
        this.jsonModalErrorEl.textContent = '';
        this.callbacks.onImportJson(this.jsonTextareaEl.value);
        overlay.style.display = 'none';
      } catch (err) {
        this.jsonModalErrorEl.textContent =
          err instanceof Error ? err.message : 'Invalid JSON payload';
      }
    });

    footer.appendChild(copyBtn);
    footer.appendChild(loadBtn);

    dialog.appendChild(header);
    dialog.appendChild(this.jsonTextareaEl);
    dialog.appendChild(this.jsonModalErrorEl);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    return overlay;
  }

  public openJsonModal(): void {
    this.jsonModalErrorEl.textContent = '';
    this.jsonTextareaEl.value = this.callbacks.onExportJson();
    this.jsonModalEl.style.display = 'flex';
  }

  public syncTransportState(
    isPaused: boolean,
    speedMultiplier: SimSpeedMultiplier
  ): void {
    if (isPaused) {
      this.playPauseBtn.textContent = 'PAUSED [SPC]';
      this.playPauseBtn.classList.remove('ics-btn-active');
      this.playPauseBtn.classList.add('ics-btn-amber');
      this.stepTickBtn.disabled = false;
    } else {
      this.playPauseBtn.textContent = 'RUNNING [SPC]';
      this.playPauseBtn.classList.add('ics-btn-active');
      this.playPauseBtn.classList.remove('ics-btn-amber');
      this.stepTickBtn.disabled = true;
    }

    for (const [spd, btn] of this.speedBtns.entries()) {
      if (spd === speedMultiplier) {
        btn.classList.add('ics-btn-active');
      } else {
        btn.classList.remove('ics-btn-active');
      }
    }
  }

  public updateFrameTelemetry(params: {
    snapshot: WorkbenchSnapshot;
    selectedVesselId: string | null;
    hoveredVesselId: string | null;
    cursorWorldX: number;
    cursorWorldY: number;
    zoom: number;
    activeParticlesCount: number;
    frameTimeMs: number;
    fps: number;
    dt: number;
  }): void {
    // 1. Update Right Dock Telemetry Inspector
    this.telemetryInspector.update(
      params.snapshot,
      params.selectedVesselId,
      params.hoveredVesselId,
      params.dt
    );

    // 2. Inspect Snapshot for Bottom-Left Reaction Toast Log
    this.toastLog.inspectSnapshot(params.snapshot);

    // 3. Update Bottom Status Bar
    const cx = Math.round(params.cursorWorldX)
      .toString()
      .padStart(3, '0');
    const cy = Math.round(params.cursorWorldY)
      .toString()
      .padStart(3, '0');
    this.statusCursorEl.innerHTML = `CURSOR <span class="ics-status-value">X: ${cx}px Y: ${cy}px</span>`;

    const zoomPct = Math.round(params.zoom * 100);
    this.statusZoomEl.innerHTML = `ZOOM <span class="ics-status-value">${zoomPct}%</span>`;

    const vCount = String(params.snapshot.vessels.length).padStart(2, '0');
    this.statusVesselsEl.innerHTML = `VESSELS <span class="ics-status-value">${vCount}</span>`;

    const pCount = String(params.activeParticlesCount).padStart(4, '0');
    this.statusParticlesEl.innerHTML = `PARTICLES <span class="ics-status-value">${pCount} / 5120</span>`;

    const ft = params.frameTimeMs.toFixed(1).padStart(4, '0');
    const fpsInt = Math.min(60, Math.max(1, Math.round(params.fps)));
    this.statusFrameEl.innerHTML = `<span class="ics-status-value" style="color:#10B981;">${ft}ms | ${fpsInt} FPS</span>`;
  }
}
