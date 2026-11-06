import { WorkbenchSnapshot } from '../core/apparatus/types';

export type TechnicalLogCategory =
  | 'PRECIPITATION'
  | 'GAS EVOLUTION'
  | 'THERMAL'
  | 'REACTION'
  | 'SYSTEM';

export interface TechnicalLogItem {
  id: string;
  simTimeSec: number;
  category: TechnicalLogCategory;
  message: string;
}

/**
 * Compact, non-intrusive bottom-left technical event log (#090A0C/90, 1px solid #22262E, max 5 lines)
 * in the canvas viewport that logs timestamped chemical & thermal events in tabular monospace.
 */
export class ReactionToastLog {
  public static readonly MAX_VISIBLE_LINES = 5;

  private rootEl: HTMLElement;
  private listEl: HTMLElement;
  private entries: TechnicalLogItem[] = [];

  // Per-vessel tracking state to detect new precipitates, gas evolution, and boiling transitions
  private knownPrecipitateMass: Map<string, Map<string, number>> = new Map();
  private knownGasVolumeMl: Map<string, Map<string, number>> = new Map();
  private boilingLoggedVessels: Set<string> = new Set();
  private lastKnownTemp: Map<string, number> = new Map();

  constructor(parentViewport: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'ics-toast-log';
    this.rootEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    const headerEl = document.createElement('div');
    headerEl.style.display = 'flex';
    headerEl.style.alignItems = 'center';
    headerEl.style.justifyContent = 'space-between';
    headerEl.style.borderBottom = '1px solid #22262E';
    headerEl.style.paddingBottom = '3px';
    headerEl.style.marginBottom = '3px';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ics-section-title';
    titleSpan.textContent = 'EVENT TELEMETRY LOG // REAL-TIME';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ics-btn';
    clearBtn.style.height = '16px';
    clearBtn.style.padding = '0 5px';
    clearBtn.style.fontSize = '9px';
    clearBtn.textContent = 'CLEAR';
    clearBtn.addEventListener('click', () => {
      this.entries = [];
      this.render();
    });

    headerEl.appendChild(titleSpan);
    headerEl.appendChild(clearBtn);

    this.listEl = document.createElement('div');
    this.rootEl.appendChild(headerEl);
    this.rootEl.appendChild(this.listEl);

    parentViewport.appendChild(this.rootEl);

    this.pushLog(
      0,
      'SYSTEM',
      'Solver initialized // 60Hz Stoichiometric Ksp + Charge-Balance pH ready'
    );
  }

  public formatTimestamp(simTimeSec: number): string {
    const mins = Math.floor(simTimeSec / 60);
    const secs = simTimeSec % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = secs.toFixed(2).padStart(5, '0');
    return `[${mm}:${ss}]`;
  }

  public pushLog(
    simTimeSec: number,
    category: TechnicalLogCategory,
    message: string
  ): void {
    this.entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simTimeSec,
      category,
      message,
    });

    if (this.entries.length > ReactionToastLog.MAX_VISIBLE_LINES) {
      this.entries.splice(
        0,
        this.entries.length - ReactionToastLog.MAX_VISIBLE_LINES
      );
    }

    this.render();
  }

  public resetTracking(simTimeSec: number = 0, presetTitle?: string): void {
    this.knownPrecipitateMass.clear();
    this.knownGasVolumeMl.clear();
    this.boilingLoggedVessels.clear();
    this.lastKnownTemp.clear();
    if (presetTitle) {
      this.pushLog(simTimeSec, 'SYSTEM', `Loaded preset // ${presetTitle}`);
    }
  }

  /**
   * Seed baseline state after loading a preset so pre-existing vessel contents
   * do not trigger spurious delta alerts until a reaction occurs.
   */
  public seedBaselineFromSnapshot(snapshot: WorkbenchSnapshot): void {
    this.knownPrecipitateMass.clear();
    this.knownGasVolumeMl.clear();
    this.boilingLoggedVessels.clear();
    this.lastKnownTemp.clear();

    for (const v of snapshot.vessels) {
      this.lastKnownTemp.set(v.id, v.temperatureC);
      if (v.temperatureC >= 99.8) {
        this.boilingLoggedVessels.add(v.id);
      }

      const pptMap = new Map<string, number>();
      for (const [pptId, rec] of Object.entries(v.chemistryState.precipitates)) {
        pptMap.set(pptId, rec.massGrams);
      }
      this.knownPrecipitateMass.set(v.id, pptMap);

      const gasMap = new Map<string, number>();
      for (const [gasId, rec] of Object.entries(v.chemistryState.evolvedGases)) {
        gasMap.set(gasId, rec.volumeMl);
      }
      this.knownGasVolumeMl.set(v.id, gasMap);
    }
  }

  /**
   * Inspects the latest WorkbenchSnapshot and emits technical log lines whenever:
   * - A solid precipitate forms or increases significantly in mass
   * - A gas evolves via Henry's Law supersaturation
   * - A vessel reaches its boiling point (100.0 °C) or undergoes an exothermic spike
   */
  public inspectSnapshot(snapshot: WorkbenchSnapshot): void {
    const t = snapshot.simTimeSeconds;

    for (const v of snapshot.vessels) {
      const upperVesselId = v.id.toUpperCase();

      // 1. Check Precipitate formation
      let pptMap = this.knownPrecipitateMass.get(v.id);
      if (!pptMap) {
        pptMap = new Map<string, number>();
        this.knownPrecipitateMass.set(v.id, pptMap);
      }

      for (const [pptId, rec] of Object.entries(v.chemistryState.precipitates)) {
        const prevMass = pptMap.get(pptId) ?? 0;
        if (rec.massGrams - prevMass >= 0.015) {
          pptMap.set(pptId, rec.massGrams);
          this.pushLog(
            t,
            'PRECIPITATION',
            `${pptId}(s) formed (${rec.massGrams.toFixed(3)}g) in ${upperVesselId}`
          );
        }
      }

      // 2. Check Gas Evolution
      let gasMap = this.knownGasVolumeMl.get(v.id);
      if (!gasMap) {
        gasMap = new Map<string, number>();
        this.knownGasVolumeMl.set(v.id, gasMap);
      }

      for (const [gasId, rec] of Object.entries(v.chemistryState.evolvedGases)) {
        const prevVol = gasMap.get(gasId) ?? 0;
        if (rec.volumeMl - prevVol >= 1.5) {
          gasMap.set(gasId, rec.volumeMl);
          this.pushLog(
            t,
            'GAS EVOLUTION',
            `${gasId}(g) effervescence (${rec.volumeMl.toFixed(1)} mL) in ${upperVesselId}`
          );
        }
      }

      // 3. Check Boiling Point (100.0 °C) & Exothermic ΔT Spikes
      const prevTemp = this.lastKnownTemp.get(v.id) ?? v.temperatureC;
      if (v.temperatureC - prevTemp >= 2.2 && v.temperatureC < 98.0) {
        this.pushLog(
          t,
          'THERMAL',
          `Exothermic spike (+${(v.temperatureC - prevTemp).toFixed(1)} °C -> ${v.temperatureC.toFixed(1)} °C) in ${upperVesselId}`
        );
      }
      this.lastKnownTemp.set(v.id, v.temperatureC);

      if (v.temperatureC >= 99.8 && v.currentVolumeMl > 0.5) {
        if (!this.boilingLoggedVessels.has(v.id)) {
          this.boilingLoggedVessels.add(v.id);
          this.pushLog(
            t,
            'THERMAL',
            `${upperVesselId} reached boiling point (${v.temperatureC.toFixed(1)} °C)`
          );
        }
      } else if (v.temperatureC < 96.0) {
        this.boilingLoggedVessels.delete(v.id);
      }
    }
  }

  private getCategoryColor(cat: TechnicalLogCategory): string {
    switch (cat) {
      case 'PRECIPITATION':
        return '#38BDF8';
      case 'GAS EVOLUTION':
        return '#10B981';
      case 'THERMAL':
        return '#E5A93C';
      case 'REACTION':
        return '#ECEFF4';
      default:
        return '#7A828E';
    }
  }

  private render(): void {
    this.listEl.innerHTML = '';

    if (this.entries.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'ics-toast-line';
      emptyEl.style.color = '#7A828E';
      emptyEl.textContent = '[--:--.--] STANDBY // Awaiting chemical or thermal event...';
      this.listEl.appendChild(emptyEl);
      return;
    }

    for (const item of this.entries) {
      const row = document.createElement('div');
      row.className = 'ics-toast-line';

      const timeSpan = document.createElement('span');
      timeSpan.style.color = '#7A828E';
      timeSpan.textContent = this.formatTimestamp(item.simTimeSec);

      const catSpan = document.createElement('span');
      catSpan.style.color = this.getCategoryColor(item.category);
      catSpan.style.fontWeight = '600';
      catSpan.textContent = `${item.category} //`;

      const msgSpan = document.createElement('span');
      msgSpan.style.color = '#ECEFF4';
      msgSpan.textContent = item.message;

      row.appendChild(timeSpan);
      row.appendChild(catSpan);
      row.appendChild(msgSpan);
      this.listEl.appendChild(row);
    }
  }
}
