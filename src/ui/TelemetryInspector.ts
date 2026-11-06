import { VesselSnapshot, WorkbenchSnapshot } from '../core/apparatus/types';
import { ReactionEngine } from '../core/chemistry/ReactionEngine';
import { IonDefinition } from '../core/chemistry/types';

export interface TelemetryInspectorCallbacks {
  onUprightVessel: (vesselId: string) => void;
  onEmptyVessel: (vesselId: string) => void;
  onDeleteVessel: (vesselId: string) => void;
  onSetVesselRotationDeg: (vesselId: string, degrees: number) => void;
  onSetBuretteStopcock: (vesselId: string, ratio: number) => void;
  onSelectIndicator: (vesselId: string, indicatorId: string | null) => void;
  onSelectVesselTab: (vesselId: string) => void;
}

/**
 * 300px docked right panel (#111317, left border 1px solid #22262E) that inspects
 * the currently selected (or hovered) vessel at 60Hz:
 * - Vessel Header & Quick Actions (UPRIGHT 0°, EMPTY, DELETE, Tilt Slider -115° to +115°)
 * - Primary 2x2 Telemetry Grid (VOLUME, TEMPERATURE, CONTINUOUS pH, THERMAL ENTHALPY)
 * - Aqueous Ionic Inventory Table (Ion, Moles mmol, Molarity M)
 * - Precipitate & Gas Evolution Readout (Formula, Mass g, Moles mmol, 10x10px swatch, CO2 mL & mmol)
 * - Active Indicator Selector (NONE, PHENOLPHTHALEIN, METHYL ORANGE, UNIVERSAL INDICATOR)
 */
export class TelemetryInspector {
  private rootEl: HTMLElement;
  private callbacks: TelemetryInspectorCallbacks;
  private ionCatalog: Map<string, IonDefinition> = new Map();

  // Cached DOM references for 60Hz zero-layout-thrash updates
  private vesselSelectorBar!: HTMLElement;
  private vesselIdEl!: HTMLElement;
  private vesselTypeEl!: HTMLElement;
  private tiltValueEl!: HTMLElement;
  private tiltSliderEl!: HTMLInputElement;
  private buretteStopcockRow!: HTMLElement;
  private buretteStopcockValueEl!: HTMLElement;
  private buretteStopcockSliderEl!: HTMLInputElement;

  private volReadoutEl!: HTMLElement;
  private volBarFillEl!: HTMLElement;
  private tempReadoutEl!: HTMLElement;
  private tempSubEl!: HTMLElement;
  private phReadoutEl!: HTMLElement;
  private phBarDotEl!: HTMLElement;
  private enthalpyReadoutEl!: HTMLElement;
  private enthalpyStatusBadgeEl!: HTMLElement;

  private indicatorButtons: Map<string, HTMLButtonElement> = new Map();
  private ionsTableBodyEl!: HTMLElement;
  private phaseSeparationContainerEl!: HTMLElement;

  private currentInspectedId: string | null = null;
  private prevEnthalpyByVessel: Map<string, number> = new Map();
  private smoothedHeatRateJs: Map<string, number> = new Map();
  private isDraggingTiltSlider: boolean = false;

  constructor(parentDock: HTMLElement, callbacks: TelemetryInspectorCallbacks) {
    this.rootEl = parentDock;
    this.callbacks = callbacks;

    const catalog = new ReactionEngine();
    for (const ion of catalog.getAllIons()) {
      this.ionCatalog.set(ion.id, ion);
    }

    this.buildDOM();
  }

  private getUniversalPhHex(pH: number): string {
    if (pH < 3.0) return '#EF4444';
    if (pH < 5.0) return '#F97316';
    if (pH < 6.5) return '#EAB308';
    if (pH <= 7.5) return '#10B981';
    if (pH < 9.5) return '#06B6D4';
    if (pH < 11.5) return '#3B82F6';
    return '#8B5CF6';
  }

  private buildDOM(): void {
    this.rootEl.innerHTML = '';
    this.rootEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Top Dock Title Header
    const dockHeader = document.createElement('div');
    dockHeader.style.display = 'flex';
    dockHeader.style.alignItems = 'center';
    dockHeader.style.justifyContent = 'space-between';
    dockHeader.style.height = '30px';
    dockHeader.style.padding = '0 10px';
    dockHeader.style.borderBottom = '1px solid #22262E';
    dockHeader.style.backgroundColor = '#090A0C';

    const headerTitle = document.createElement('span');
    headerTitle.className = 'ics-section-title';
    headerTitle.style.color = '#ECEFF4';
    headerTitle.textContent = 'LIVE TELEMETRY INSPECTOR // 60HZ';

    const rateBadge = document.createElement('span');
    rateBadge.className = 'ics-mono';
    rateBadge.style.fontSize = '9px';
    rateBadge.style.color = '#10B981';
    rateBadge.textContent = 'LOCKED';

    dockHeader.appendChild(headerTitle);
    dockHeader.appendChild(rateBadge);
    this.rootEl.appendChild(dockHeader);

    // Quick Vessel Switcher Bar
    this.vesselSelectorBar = document.createElement('div');
    this.vesselSelectorBar.style.display = 'flex';
    this.vesselSelectorBar.style.gap = '3px';
    this.vesselSelectorBar.style.padding = '6px 10px';
    this.vesselSelectorBar.style.borderBottom = '1px solid #22262E';
    this.vesselSelectorBar.style.overflowX = 'auto';
    this.vesselSelectorBar.style.backgroundColor = '#0D0F12';
    this.rootEl.appendChild(this.vesselSelectorBar);

    const scrollBody = document.createElement('div');
    scrollBody.className = 'ics-inspector-scroll';

    // ====================================================================
    // 1. VESSEL HEADER & QUICK ACTIONS + TILT SLIDER
    // ====================================================================
    const headerBlock = document.createElement('div');
    headerBlock.className = 'ics-inspector-block';

    const idRow = document.createElement('div');
    idRow.style.display = 'flex';
    idRow.style.alignItems = 'center';
    idRow.style.justifyContent = 'space-between';

    const idLeft = document.createElement('div');
    this.vesselIdEl = document.createElement('div');
    this.vesselIdEl.className = 'ics-mono';
    this.vesselIdEl.style.fontSize = '12px';
    this.vesselIdEl.style.fontWeight = '700';
    this.vesselIdEl.style.color = '#38BDF8';
    this.vesselIdEl.textContent = 'BEAKER_01';

    this.vesselTypeEl = document.createElement('div');
    this.vesselTypeEl.className = 'ics-mono';
    this.vesselTypeEl.style.fontSize = '9px';
    this.vesselTypeEl.style.color = '#7A828E';
    this.vesselTypeEl.textContent = '250 mL Beaker';

    idLeft.appendChild(this.vesselIdEl);
    idLeft.appendChild(this.vesselTypeEl);

    const actionGroup = document.createElement('div');
    actionGroup.style.display = 'flex';
    actionGroup.style.gap = '4px';

    const uprightBtn = document.createElement('button');
    uprightBtn.type = 'button';
    uprightBtn.className = 'ics-btn';
    uprightBtn.style.height = '20px';
    uprightBtn.style.padding = '0 6px';
    uprightBtn.textContent = 'UPRIGHT (0°)';
    uprightBtn.addEventListener('click', () => {
      if (this.currentInspectedId) {
        this.callbacks.onUprightVessel(this.currentInspectedId);
      }
    });

    const emptyBtn = document.createElement('button');
    emptyBtn.type = 'button';
    emptyBtn.className = 'ics-btn';
    emptyBtn.style.height = '20px';
    emptyBtn.style.padding = '0 6px';
    emptyBtn.textContent = 'EMPTY';
    emptyBtn.addEventListener('click', () => {
      if (this.currentInspectedId) {
        this.callbacks.onEmptyVessel(this.currentInspectedId);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ics-btn ics-btn-danger';
    deleteBtn.style.height = '20px';
    deleteBtn.style.padding = '0 6px';
    deleteBtn.textContent = 'DELETE';
    deleteBtn.addEventListener('click', () => {
      if (this.currentInspectedId) {
        this.callbacks.onDeleteVessel(this.currentInspectedId);
      }
    });

    actionGroup.appendChild(uprightBtn);
    actionGroup.appendChild(emptyBtn);
    actionGroup.appendChild(deleteBtn);

    idRow.appendChild(idLeft);
    idRow.appendChild(actionGroup);
    headerBlock.appendChild(idRow);

    // Precision Tilt Slider (-115° to +115°)
    const tiltBox = document.createElement('div');
    tiltBox.style.marginTop = '8px';

    const tiltLabelRow = document.createElement('div');
    tiltLabelRow.style.display = 'flex';
    tiltLabelRow.style.justifyContent = 'space-between';
    tiltLabelRow.style.marginBottom = '4px';

    const tiltTitle = document.createElement('span');
    tiltTitle.className = 'ics-section-title';
    tiltTitle.textContent = 'ANGULAR TILT (-115° .. +115°)';

    this.tiltValueEl = document.createElement('span');
    this.tiltValueEl.className = 'ics-mono';
    this.tiltValueEl.style.fontSize = '10px';
    this.tiltValueEl.style.color = '#ECEFF4';
    this.tiltValueEl.textContent = '0.0°';

    tiltLabelRow.appendChild(tiltTitle);
    tiltLabelRow.appendChild(this.tiltValueEl);

    this.tiltSliderEl = document.createElement('input');
    this.tiltSliderEl.type = 'range';
    this.tiltSliderEl.min = '-115';
    this.tiltSliderEl.max = '115';
    this.tiltSliderEl.step = '0.5';
    this.tiltSliderEl.value = '0';
    this.tiltSliderEl.className = 'ics-range-slider';
    this.tiltSliderEl.addEventListener('pointerdown', () => {
      this.isDraggingTiltSlider = true;
    });
    window.addEventListener('pointerup', () => {
      this.isDraggingTiltSlider = false;
    });
    this.tiltSliderEl.addEventListener('input', () => {
      if (this.currentInspectedId) {
        const deg = Number(this.tiltSliderEl.value);
        this.tiltValueEl.textContent = `${deg > 0 ? '+' : ''}${deg.toFixed(1)}°`;
        this.callbacks.onSetVesselRotationDeg(this.currentInspectedId, deg);
      }
    });

    tiltBox.appendChild(tiltLabelRow);
    tiltBox.appendChild(this.tiltSliderEl);
    headerBlock.appendChild(tiltBox);

    // Optional Burette Stopcock Valve Control (visible when burette_50 is inspected)
    this.buretteStopcockRow = document.createElement('div');
    this.buretteStopcockRow.style.marginTop = '8px';
    this.buretteStopcockRow.style.paddingTop = '6px';
    this.buretteStopcockRow.style.borderTop = '1px solid #22262E';
    this.buretteStopcockRow.style.display = 'none';

    const stopcockHeader = document.createElement('div');
    stopcockHeader.style.display = 'flex';
    stopcockHeader.style.justifyContent = 'space-between';
    stopcockHeader.style.marginBottom = '4px';

    const scTitle = document.createElement('span');
    scTitle.className = 'ics-section-title';
    scTitle.style.color = '#38BDF8';
    scTitle.textContent = 'BURETTE STOPCOCK VALVE';

    this.buretteStopcockValueEl = document.createElement('span');
    this.buretteStopcockValueEl.className = 'ics-mono';
    this.buretteStopcockValueEl.style.fontSize = '10px';
    this.buretteStopcockValueEl.textContent = 'CLOSED (0%)';

    stopcockHeader.appendChild(scTitle);
    stopcockHeader.appendChild(this.buretteStopcockValueEl);

    this.buretteStopcockSliderEl = document.createElement('input');
    this.buretteStopcockSliderEl.type = 'range';
    this.buretteStopcockSliderEl.min = '0';
    this.buretteStopcockSliderEl.max = '1';
    this.buretteStopcockSliderEl.step = '0.05';
    this.buretteStopcockSliderEl.value = '0';
    this.buretteStopcockSliderEl.className = 'ics-range-slider';
    this.buretteStopcockSliderEl.addEventListener('input', () => {
      if (this.currentInspectedId) {
        const ratio = Number(this.buretteStopcockSliderEl.value);
        this.callbacks.onSetBuretteStopcock(this.currentInspectedId, ratio);
      }
    });

    this.buretteStopcockRow.appendChild(stopcockHeader);
    this.buretteStopcockRow.appendChild(this.buretteStopcockSliderEl);
    headerBlock.appendChild(this.buretteStopcockRow);

    scrollBody.appendChild(headerBlock);

    // ====================================================================
    // 2. PRIMARY TELEMETRY GRID (2x2 HIGH-CONTRAST TABULAR CARDS)
    // ====================================================================
    const gridBlock = document.createElement('div');
    gridBlock.className = 'ics-inspector-block';

    const grid2x2 = document.createElement('div');
    grid2x2.className = 'ics-telemetry-grid-2x2';

    // Card 1: VOLUME (with 2px horizontal fill bar)
    const volCard = document.createElement('div');
    volCard.className = 'ics-telemetry-card';
    const volCardTitle = document.createElement('div');
    volCardTitle.className = 'ics-section-title';
    volCardTitle.textContent = 'VOLUME';
    this.volReadoutEl = document.createElement('div');
    this.volReadoutEl.className = 'ics-telemetry-readout';
    this.volReadoutEl.textContent = '0.0 / 250.0 mL';
    const volBarTrack = document.createElement('div');
    volBarTrack.style.width = '100%';
    volBarTrack.style.height = '2px';
    volBarTrack.style.backgroundColor = '#22262E';
    volBarTrack.style.marginTop = '6px';
    this.volBarFillEl = document.createElement('div');
    this.volBarFillEl.style.height = '100%';
    this.volBarFillEl.style.width = '0%';
    this.volBarFillEl.style.backgroundColor = '#38BDF8';
    volBarTrack.appendChild(this.volBarFillEl);
    volCard.appendChild(volCardTitle);
    volCard.appendChild(this.volReadoutEl);
    volCard.appendChild(volBarTrack);

    // Card 2: TEMPERATURE (shifts to #E5A93C above 50°C and #EF4444 at 100°C)
    const tempCard = document.createElement('div');
    tempCard.className = 'ics-telemetry-card';
    const tempCardTitle = document.createElement('div');
    tempCardTitle.className = 'ics-section-title';
    tempCardTitle.textContent = 'TEMPERATURE';
    this.tempReadoutEl = document.createElement('div');
    this.tempReadoutEl.className = 'ics-telemetry-readout';
    this.tempReadoutEl.textContent = '25.0 °C';
    this.tempSubEl = document.createElement('div');
    this.tempSubEl.className = 'ics-mono';
    this.tempSubEl.style.fontSize = '9px';
    this.tempSubEl.style.color = '#7A828E';
    this.tempSubEl.style.marginTop = '3px';
    this.tempSubEl.textContent = '298.15 K';
    tempCard.appendChild(tempCardTitle);
    tempCard.appendChild(this.tempReadoutEl);
    tempCard.appendChild(this.tempSubEl);

    // Card 3: CONTINUOUS pH (with 4px color-coded indicator bar)
    const phCard = document.createElement('div');
    phCard.className = 'ics-telemetry-card';
    const phCardTitle = document.createElement('div');
    phCardTitle.className = 'ics-section-title';
    phCardTitle.textContent = 'CONTINUOUS pH';
    this.phReadoutEl = document.createElement('div');
    this.phReadoutEl.className = 'ics-telemetry-readout';
    this.phReadoutEl.textContent = '7.00';
    const phSpectrumBar = document.createElement('div');
    phSpectrumBar.style.position = 'relative';
    phSpectrumBar.style.width = '100%';
    phSpectrumBar.style.height = '4px';
    phSpectrumBar.style.marginTop = '5px';
    phSpectrumBar.style.background =
      'linear-gradient(90deg, #EF4444 0%, #F97316 22%, #EAB308 38%, #10B981 50%, #06B6D4 68%, #3B82F6 84%, #8B5CF6 100%)';
    this.phBarDotEl = document.createElement('div');
    this.phBarDotEl.style.position = 'absolute';
    this.phBarDotEl.style.top = '-2px';
    this.phBarDotEl.style.width = '3px';
    this.phBarDotEl.style.height = '8px';
    this.phBarDotEl.style.backgroundColor = '#ECEFF4';
    this.phBarDotEl.style.left = '50%';
    phSpectrumBar.appendChild(this.phBarDotEl);
    phCard.appendChild(phCardTitle);
    phCard.appendChild(this.phReadoutEl);
    phCard.appendChild(phSpectrumBar);

    // Card 4: THERMAL ENTHALPY (live dH J/s + STABLE | EXOTHERMIC | BOILING)
    const enthCard = document.createElement('div');
    enthCard.className = 'ics-telemetry-card';
    const enthHeader = document.createElement('div');
    enthHeader.style.display = 'flex';
    enthHeader.style.alignItems = 'center';
    enthHeader.style.justifyContent = 'space-between';
    const enthTitle = document.createElement('span');
    enthTitle.className = 'ics-section-title';
    enthTitle.textContent = 'ENTHALPY dH';
    this.enthalpyStatusBadgeEl = document.createElement('span');
    this.enthalpyStatusBadgeEl.className = 'ics-badge';
    this.enthalpyStatusBadgeEl.textContent = 'STABLE';
    enthHeader.appendChild(enthTitle);
    enthHeader.appendChild(this.enthalpyStatusBadgeEl);

    this.enthalpyReadoutEl = document.createElement('div');
    this.enthalpyReadoutEl.className = 'ics-telemetry-readout';
    this.enthalpyReadoutEl.textContent = '0.0 J/s';
    enthCard.appendChild(enthHeader);
    enthCard.appendChild(this.enthalpyReadoutEl);

    grid2x2.appendChild(volCard);
    grid2x2.appendChild(tempCard);
    grid2x2.appendChild(phCard);
    grid2x2.appendChild(enthCard);
    gridBlock.appendChild(grid2x2);
    scrollBody.appendChild(gridBlock);

    // ====================================================================
    // 5. ACTIVE INDICATOR SELECTOR
    // ====================================================================
    const indBlock = document.createElement('div');
    indBlock.className = 'ics-inspector-block';

    const indTitle = document.createElement('div');
    indTitle.className = 'ics-section-title';
    indTitle.style.marginBottom = '6px';
    indTitle.textContent = 'ACTIVE INDICATOR (2 DROPS)';
    indBlock.appendChild(indTitle);

    const indGrid = document.createElement('div');
    indGrid.style.display = 'grid';
    indGrid.style.gridTemplateColumns = '1fr 1fr';
    indGrid.style.gap = '4px';

    const indicators: Array<{ id: string; label: string }> = [
      { id: 'none', label: 'NONE' },
      { id: 'phenolphthalein', label: 'PHENOLPHTHALEIN' },
      { id: 'methyl_orange', label: 'METHYL ORANGE' },
      { id: 'universal', label: 'UNIVERSAL IND' },
    ];

    for (const item of indicators) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ics-cat-pill';
      btn.style.height = '22px';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        if (!this.currentInspectedId) return;
        this.callbacks.onSelectIndicator(
          this.currentInspectedId,
          item.id === 'none' ? null : item.id
        );
      });
      this.indicatorButtons.set(item.id, btn);
      indGrid.appendChild(btn);
    }

    indBlock.appendChild(indGrid);
    scrollBody.appendChild(indBlock);

    // ====================================================================
    // 3. AQUEOUS IONIC INVENTORY TABLE
    // ====================================================================
    const ionsBlock = document.createElement('div');
    ionsBlock.className = 'ics-inspector-block';

    const ionsTitle = document.createElement('div');
    ionsTitle.className = 'ics-section-title';
    ionsTitle.style.marginBottom = '6px';
    ionsTitle.textContent = 'AQUEOUS IONIC INVENTORY';
    ionsBlock.appendChild(ionsTitle);

    const tableWrap = document.createElement('div');
    tableWrap.style.border = '1px solid #22262E';
    tableWrap.style.backgroundColor = '#090A0C';

    const table = document.createElement('table');
    table.className = 'ics-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>ION</th>
          <th style="text-align:right;">MOLES (mmol)</th>
          <th style="text-align:right;">MOLARITY (M)</th>
        </tr>
      </thead>
    `;
    this.ionsTableBodyEl = document.createElement('tbody');
    table.appendChild(this.ionsTableBodyEl);
    tableWrap.appendChild(table);
    ionsBlock.appendChild(tableWrap);
    scrollBody.appendChild(ionsBlock);

    // ====================================================================
    // 4. PRECIPITATE & GAS EVOLUTION READOUT
    // ====================================================================
    const phaseBlock = document.createElement('div');
    phaseBlock.className = 'ics-inspector-block';

    const phaseTitle = document.createElement('div');
    phaseTitle.className = 'ics-section-title';
    phaseTitle.style.marginBottom = '6px';
    phaseTitle.textContent = 'PRECIPITATES (s) & GAS EVOLUTION (g)';
    phaseBlock.appendChild(phaseTitle);

    this.phaseSeparationContainerEl = document.createElement('div');
    phaseBlock.appendChild(this.phaseSeparationContainerEl);
    scrollBody.appendChild(phaseBlock);

    this.rootEl.appendChild(scrollBody);
  }

  /**
   * Updates the Live Telemetry Inspector at 60Hz for the hovered or selected vessel.
   */
  public update(
    snapshot: WorkbenchSnapshot,
    selectedVesselId: string | null,
    hoveredVesselId: string | null,
    dt: number
  ): void {
    // Render quick vessel selector pills at top of dock
    this.syncVesselSelectorBar(snapshot.vessels, selectedVesselId, hoveredVesselId);

    const targetId = hoveredVesselId ?? selectedVesselId;
    const vessel =
      snapshot.vessels.find((v) => v.id === targetId) ??
      snapshot.vessels[0] ??
      null;

    if (!vessel) {
      this.currentInspectedId = null;
      this.vesselIdEl.textContent = 'NO ACTIVE VESSEL';
      this.vesselTypeEl.textContent = 'SPAWN APPARATUS FROM LEFT DOCK';
      return;
    }

    this.currentInspectedId = vessel.id;
    const chem = vessel.chemistryState;

    // 1. Header & Tilt
    this.vesselIdEl.textContent = `${vessel.id.toUpperCase()}${
      hoveredVesselId && hoveredVesselId !== selectedVesselId ? ' [HOVER]' : ''
    }`;
    this.vesselTypeEl.textContent = `${vessel.spec.name} // MAX ${vessel.maxVolumeMl} mL`;

    const deg = vessel.rotationDeg;
    this.tiltValueEl.textContent = `${deg > 0 ? '+' : ''}${deg.toFixed(1)}°`;
    if (!this.isDraggingTiltSlider) {
      this.tiltSliderEl.value = String(Math.round(deg * 2) / 2);
    }

    if (vessel.type === 'burette_50') {
      this.buretteStopcockRow.style.display = 'block';
      const pct = Math.round(vessel.stopcockOpenRatio * 100);
      this.buretteStopcockValueEl.textContent =
        pct === 0 ? 'CLOSED (0%)' : `OPEN (${pct}%)`;
      this.buretteStopcockSliderEl.value = String(vessel.stopcockOpenRatio);
    } else {
      this.buretteStopcockRow.style.display = 'none';
    }

    // 2. Primary 2x2 Telemetry Cards
    // VOLUME
    const fillPct = Math.max(
      0,
      Math.min(100, (vessel.currentVolumeMl / Math.max(1, vessel.maxVolumeMl)) * 100)
    );
    this.volReadoutEl.textContent = `${vessel.currentVolumeMl.toFixed(
      1
    )} / ${vessel.maxVolumeMl.toFixed(0)} mL`;
    this.volBarFillEl.style.width = `${fillPct.toFixed(1)}%`;

    // TEMPERATURE (shifts to #E5A93C Amber above 50°C and #EF4444 Red at 100°C boiling)
    this.tempReadoutEl.textContent = `${vessel.temperatureC.toFixed(1)} °C`;
    if (vessel.temperatureC >= 99.5) {
      this.tempReadoutEl.style.color = '#EF4444';
    } else if (vessel.temperatureC > 50.0) {
      this.tempReadoutEl.style.color = '#E5A93C';
    } else {
      this.tempReadoutEl.style.color = '#ECEFF4';
    }
    this.tempSubEl.textContent = `${(vessel.temperatureC + 273.15).toFixed(
      1
    )} K · ${chem.solutionMassGrams.toFixed(1)} g`;

    // CONTINUOUS pH
    const pH = chem.pH;
    this.phReadoutEl.textContent = pH.toFixed(2);
    this.phReadoutEl.style.color = this.getUniversalPhHex(pH);
    const phPosPct = Math.max(0, Math.min(100, (pH / 14.0) * 100));
    this.phBarDotEl.style.left = `calc(${phPosPct.toFixed(1)}% - 1.5px)`;

    // THERMAL ENTHALPY (J/s rate + status badge)
    const prevEnthKj =
      this.prevEnthalpyByVessel.get(vessel.id) ?? chem.cumulativeEnthalpyKj;
    const deltaKj = chem.cumulativeEnthalpyKj - prevEnthKj;
    this.prevEnthalpyByVessel.set(vessel.id, chem.cumulativeEnthalpyKj);

    const instantWatts = dt > 0 ? (-deltaKj * 1000) / dt : 0;
    const prevSmoothed = this.smoothedHeatRateJs.get(vessel.id) ?? 0;
    const nextSmoothed =
      Math.abs(instantWatts) > 0.5
        ? instantWatts
        : prevSmoothed * Math.pow(0.15, dt);
    this.smoothedHeatRateJs.set(vessel.id, nextSmoothed);

    if (vessel.temperatureC >= 99.5 && vessel.currentVolumeMl > 0.2) {
      this.enthalpyStatusBadgeEl.textContent = 'BOILING';
      this.enthalpyStatusBadgeEl.style.color = '#EF4444';
      this.enthalpyStatusBadgeEl.style.borderColor = '#EF4444';
      this.enthalpyReadoutEl.textContent = `${(
        chem.cumulativeEnthalpyKj * 1000
      ).toFixed(0)} J`;
    } else if (nextSmoothed > 5.0) {
      this.enthalpyStatusBadgeEl.textContent = 'EXOTHERMIC';
      this.enthalpyStatusBadgeEl.style.color = '#E5A93C';
      this.enthalpyStatusBadgeEl.style.borderColor = '#E5A93C';
      this.enthalpyReadoutEl.textContent = `+${nextSmoothed.toFixed(0)} J/s`;
    } else {
      this.enthalpyStatusBadgeEl.textContent = 'STABLE';
      this.enthalpyStatusBadgeEl.style.color = '#10B981';
      this.enthalpyStatusBadgeEl.style.borderColor = '#22262E';
      this.enthalpyReadoutEl.textContent = `${chem.cumulativeEnthalpyKj.toFixed(
        2
      )} kJ`;
    }

    // 5. Active Indicator Selector highlight
    const activeInd = chem.activeIndicators[0] ?? 'none';
    for (const [indId, btn] of this.indicatorButtons.entries()) {
      if (indId === activeInd) {
        btn.classList.add('ics-cat-pill-active');
      } else {
        btn.classList.remove('ics-cat-pill-active');
      }
    }

    // 3. Aqueous Ionic Inventory Table
    this.renderIonicInventory(vessel);

    // 4. Precipitate & Gas Evolution Readout
    this.renderPhaseSeparations(vessel);
  }

  private syncVesselSelectorBar(
    vessels: VesselSnapshot[],
    selectedId: string | null,
    hoveredId: string | null
  ): void {
    this.vesselSelectorBar.innerHTML = '';
    for (const v of vessels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = v.id === selectedId;
      const isHovered = v.id === hoveredId;
      btn.className = `ics-cat-pill ${isSelected ? 'ics-cat-pill-active' : ''}`;
      btn.style.padding = '0 6px';
      btn.style.flexShrink = '0';
      if (isHovered && !isSelected) {
        btn.style.borderColor = '#E5A93C';
      }
      btn.textContent = v.id.toUpperCase();
      btn.addEventListener('click', () => {
        this.callbacks.onSelectVesselTab(v.id);
      });
      this.vesselSelectorBar.appendChild(btn);
    }
  }

  private renderIonicInventory(vessel: VesselSnapshot): void {
    const chem = vessel.chemistryState;
    const entries = Object.entries(chem.ionMolarities)
      .filter(([, molarity]) => molarity > 1e-6)
      .sort((a, b) => b[1] - a[1]);

    this.ionsTableBodyEl.innerHTML = '';

    if (entries.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" style="color:#7A828E;text-align:center;padding:8px;">DEIONIZED / EMPTY AQUEOUS POOL</td>`;
      this.ionsTableBodyEl.appendChild(tr);
      return;
    }

    for (const [ionId, molarity] of entries) {
      const ionDef = this.ionCatalog.get(ionId);
      const molesMmol = (chem.ionMoles[ionId] ?? 0) * 1000;
      const tr = document.createElement('tr');

      const tdIon = document.createElement('td');
      tdIon.style.fontWeight = '600';
      tdIon.style.color = '#ECEFF4';
      tdIon.textContent = ionDef?.formula ?? ionId;

      const tdMmol = document.createElement('td');
      tdMmol.style.textAlign = 'right';
      tdMmol.style.color = '#7A828E';
      tdMmol.textContent = `${molesMmol.toFixed(2)} mmol`;

      const tdMol = document.createElement('td');
      tdMol.style.textAlign = 'right';
      tdMol.style.color = '#38BDF8';
      tdMol.textContent = `${molarity.toFixed(4)} M`;

      tr.appendChild(tdIon);
      tr.appendChild(tdMmol);
      tr.appendChild(tdMol);
      this.ionsTableBodyEl.appendChild(tr);
    }
  }

  private renderPhaseSeparations(vessel: VesselSnapshot): void {
    const chem = vessel.chemistryState;
    const ppts = Object.values(chem.precipitates);
    const gases = Object.values(chem.evolvedGases);

    this.phaseSeparationContainerEl.innerHTML = '';

    if (ppts.length === 0 && gases.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'ics-mono';
      emptyBox.style.padding = '8px';
      emptyBox.style.border = '1px solid #22262E';
      emptyBox.style.backgroundColor = '#090A0C';
      emptyBox.style.fontSize = '10px';
      emptyBox.style.color = '#7A828E';
      emptyBox.textContent = 'HOMOGENEOUS // NO SOLID PRECIPITATES OR EVOLVED GASES';
      this.phaseSeparationContainerEl.appendChild(emptyBox);
      return;
    }

    for (const ppt of ppts) {
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.justifyContent = 'space-between';
      card.style.padding = '6px 8px';
      card.style.marginBottom = '4px';
      card.style.border = '1px solid #22262E';
      card.style.backgroundColor = '#090A0C';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '7px';

      const swatch = document.createElement('span');
      swatch.className = 'ics-reagent-swatch';
      swatch.style.backgroundColor = ppt.colorHex;

      const labelBox = document.createElement('div');
      const formulaEl = document.createElement('div');
      formulaEl.className = 'ics-mono';
      formulaEl.style.fontSize = '11px';
      formulaEl.style.fontWeight = '600';
      formulaEl.style.color = '#ECEFF4';
      formulaEl.textContent = `${ppt.formula}(s)`;

      const nameEl = document.createElement('div');
      nameEl.style.fontSize = '9px';
      nameEl.style.color = '#7A828E';
      nameEl.textContent = ppt.appearance;

      labelBox.appendChild(formulaEl);
      labelBox.appendChild(nameEl);
      left.appendChild(swatch);
      left.appendChild(labelBox);

      const right = document.createElement('div');
      right.className = 'ics-mono';
      right.style.textAlign = 'right';
      right.innerHTML = `
        <div style="font-size:11px;color:#10B981;font-weight:600;">${ppt.massGrams.toFixed(
          3
        )} g</div>
        <div style="font-size:9px;color:#7A828E;">${(ppt.moles * 1000).toFixed(
          2
        )} mmol</div>
      `;

      card.appendChild(left);
      card.appendChild(right);
      this.phaseSeparationContainerEl.appendChild(card);
    }

    for (const gas of gases) {
      const card = document.createElement('div');
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.justifyContent = 'space-between';
      card.style.padding = '6px 8px';
      card.style.marginBottom = '4px';
      card.style.border = '1px solid #22262E';
      card.style.backgroundColor = '#090A0C';

      const left = document.createElement('div');
      left.innerHTML = `
        <div class="ics-mono" style="font-size:11px;font-weight:600;color:#E5A93C;">${gas.formula}(g) Evolved</div>
        <div style="font-size:9px;color:#7A828E;">Henry's Law Supersaturation</div>
      `;

      const right = document.createElement('div');
      right.className = 'ics-mono';
      right.style.textAlign = 'right';
      right.innerHTML = `
        <div style="font-size:11px;color:#ECEFF4;font-weight:600;">${gas.volumeMl.toFixed(
          1
        )} mL</div>
        <div style="font-size:9px;color:#7A828E;">${(gas.moles * 1000).toFixed(
          2
        )} mmol</div>
      `;

      card.appendChild(left);
      card.appendChild(right);
      this.phaseSeparationContainerEl.appendChild(card);
    }
  }
}
