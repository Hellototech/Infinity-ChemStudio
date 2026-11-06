import { ApparatusTypeId } from '../core/apparatus/types';
import { ReactionEngine } from '../core/chemistry/ReactionEngine';
import { CompoundCategory, CompoundDefinition } from '../core/chemistry/types';

export interface ReagentShelfCallbacks {
  onDispenseReagent: (
    compound: CompoundDefinition,
    volumeMl: number,
    molarity: number
  ) => void;
  onDispenseWater: (volumeMl: number) => void;
  onSpawnApparatus: (type: ApparatusTypeId | 'bunsen_burner') => void;
}

const VOLUME_PRESETS = [5, 10, 25, 50, 100];
const MOLARITY_PRESETS = [0.05, 0.1, 0.5, 1.0, 2.0];

/**
 * 280px docked left panel (#111317, right border 1px solid #22262E)
 * with REAGENTS and APPARATUS tabs, instant '/' search, category filters,
 * precision volume/molarity dosing steppers, optical swatches, and apparatus spawner cards.
 */
export class ReagentShelf {
  private rootEl: HTMLElement;
  private callbacks: ReagentShelfCallbacks;
  private catalogEngine: ReactionEngine;
  private compounds: CompoundDefinition[];

  private activeTab: 'reagents' | 'apparatus' = 'reagents';
  private searchQuery: string = '';
  private activeCategory: 'all' | CompoundCategory = 'all';
  private dispenseVolumeMl: number = 25;
  private dispenseMolarity: number = 0.2;

  private searchInputEl!: HTMLInputElement;
  private volumeInputEl!: HTMLInputElement;
  private molarityInputEl!: HTMLInputElement;
  private tabReagentsBtn!: HTMLButtonElement;
  private tabApparatusBtn!: HTMLButtonElement;
  private reagentsViewEl!: HTMLElement;
  private apparatusViewEl!: HTMLElement;
  private categoryPillsContainer!: HTMLElement;
  private volumePresetsContainer!: HTMLElement;
  private molarityPresetsContainer!: HTMLElement;
  private reagentListContainer!: HTMLElement;

  constructor(parentDock: HTMLElement, callbacks: ReagentShelfCallbacks) {
    this.rootEl = parentDock;
    this.callbacks = callbacks;
    this.catalogEngine = new ReactionEngine();
    this.compounds = this.catalogEngine.getAllCompounds();

    this.buildDOM();
    this.renderReagentRows();
  }

  public focusSearchInput(): void {
    if (this.activeTab !== 'reagents') {
      this.setActiveTab('reagents');
    }
    this.searchInputEl.focus();
    this.searchInputEl.select();
  }

  private setActiveTab(tab: 'reagents' | 'apparatus'): void {
    this.activeTab = tab;
    if (tab === 'reagents') {
      this.tabReagentsBtn.classList.add('ics-dock-tab-active');
      this.tabApparatusBtn.classList.remove('ics-dock-tab-active');
      this.reagentsViewEl.style.display = 'flex';
      this.apparatusViewEl.style.display = 'none';
    } else {
      this.tabApparatusBtn.classList.add('ics-dock-tab-active');
      this.tabReagentsBtn.classList.remove('ics-dock-tab-active');
      this.reagentsViewEl.style.display = 'none';
      this.apparatusViewEl.style.display = 'grid';
    }
  }

  private computeCompoundSwatchCss(compound: CompoundDefinition): string {
    if (compound.category === 'indicator' && compound.indicatorSpec) {
      const [r, g, b, a] = compound.indicatorSpec.baseColorRgba;
      return `rgba(${r}, ${g}, ${b}, ${Math.max(0.65, a)})`;
    }

    const previewEngine = new ReactionEngine();
    const state = previewEngine.addSolution(
      compound.id,
      50,
      compound.defaultMolarity ?? 0.2
    );
    const [r, g, b, a] = state.solutionColorRgba;
    if (a <= 0.12) {
      return 'rgba(226, 232, 240, 0.22)';
    }
    return `rgba(${r}, ${g}, ${b}, ${Math.min(0.95, a + 0.25)})`;
  }

  private getStateBadgeText(compound: CompoundDefinition): string {
    if (compound.category === 'indicator') return 'IND';
    if (compound.stateAt25C === 'solid') return 'SOLID';
    return 'AQ';
  }

  private buildDOM(): void {
    this.rootEl.innerHTML = '';
    this.rootEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    // 1. Segmented Dock Tabs (REAGENTS | APPARATUS)
    const tabsBar = document.createElement('div');
    tabsBar.className = 'ics-dock-tabs';

    this.tabReagentsBtn = document.createElement('button');
    this.tabReagentsBtn.type = 'button';
    this.tabReagentsBtn.className = 'ics-dock-tab ics-dock-tab-active';
    this.tabReagentsBtn.textContent = 'REAGENTS (18)';
    this.tabReagentsBtn.addEventListener('click', () =>
      this.setActiveTab('reagents')
    );

    this.tabApparatusBtn = document.createElement('button');
    this.tabApparatusBtn.type = 'button';
    this.tabApparatusBtn.className = 'ics-dock-tab';
    this.tabApparatusBtn.textContent = 'APPARATUS (05)';
    this.tabApparatusBtn.addEventListener('click', () =>
      this.setActiveTab('apparatus')
    );

    tabsBar.appendChild(this.tabReagentsBtn);
    tabsBar.appendChild(this.tabApparatusBtn);
    this.rootEl.appendChild(tabsBar);

    // 2. REAGENTS VIEW CONTAINER
    this.reagentsViewEl = document.createElement('div');
    this.reagentsViewEl.style.display = 'flex';
    this.reagentsViewEl.style.flexDirection = 'column';
    this.reagentsViewEl.style.flex = '1';
    this.reagentsViewEl.style.minHeight = '0';

    // 2a. Search & Category Filter Section
    const filterSection = document.createElement('div');
    filterSection.className = 'ics-shelf-section';

    const searchRow = document.createElement('div');
    searchRow.style.position = 'relative';
    searchRow.style.display = 'flex';
    searchRow.style.alignItems = 'center';

    this.searchInputEl = document.createElement('input');
    this.searchInputEl.type = 'text';
    this.searchInputEl.className = 'ics-input';
    this.searchInputEl.style.width = '100%';
    this.searchInputEl.style.paddingRight = '24px';
    this.searchInputEl.placeholder = 'Filter formula or IUPAC name... [/]';
    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl.value.trim().toLowerCase();
      this.renderReagentRows();
    });

    const slashHint = document.createElement('span');
    slashHint.className = 'ics-mono';
    slashHint.style.position = 'absolute';
    slashHint.style.right = '6px';
    slashHint.style.fontSize = '9px';
    slashHint.style.color = '#7A828E';
    slashHint.style.pointerEvents = 'none';
    slashHint.textContent = '[/]';

    searchRow.appendChild(this.searchInputEl);
    searchRow.appendChild(slashHint);
    filterSection.appendChild(searchRow);

    this.categoryPillsContainer = document.createElement('div');
    this.categoryPillsContainer.className = 'ics-category-bar';
    this.renderCategoryPills();
    filterSection.appendChild(this.categoryPillsContainer);
    this.reagentsViewEl.appendChild(filterSection);

    // 2b. Precision Dosing Controls (Dispense Volume mL & Molarity M)
    const dosingSection = document.createElement('div');
    dosingSection.className = 'ics-shelf-section';
    dosingSection.style.backgroundColor = '#0D0F12';

    // Volume Header + Custom Input
    const volHeader = document.createElement('div');
    volHeader.style.display = 'flex';
    volHeader.style.alignItems = 'center';
    volHeader.style.justifyContent = 'space-between';

    const volLabel = document.createElement('span');
    volLabel.className = 'ics-section-title';
    volLabel.textContent = 'DISPENSE VOLUME (mL)';

    this.volumeInputEl = document.createElement('input');
    this.volumeInputEl.type = 'number';
    this.volumeInputEl.min = '1';
    this.volumeInputEl.max = '250';
    this.volumeInputEl.step = '5';
    this.volumeInputEl.value = String(this.dispenseVolumeMl);
    this.volumeInputEl.className = 'ics-input';
    this.volumeInputEl.style.width = '68px';
    this.volumeInputEl.style.height = '20px';
    this.volumeInputEl.style.textAlign = 'right';
    this.volumeInputEl.addEventListener('change', () => {
      const val = Math.max(
        1,
        Math.min(250, Number(this.volumeInputEl.value) || 25)
      );
      this.dispenseVolumeMl = val;
      this.volumeInputEl.value = String(val);
      this.renderVolumePresets();
    });

    volHeader.appendChild(volLabel);
    volHeader.appendChild(this.volumeInputEl);
    dosingSection.appendChild(volHeader);

    this.volumePresetsContainer = document.createElement('div');
    this.volumePresetsContainer.className = 'ics-stepper-row';
    this.renderVolumePresets();
    dosingSection.appendChild(this.volumePresetsContainer);

    // Molarity Header + Custom Input
    const molHeader = document.createElement('div');
    molHeader.style.display = 'flex';
    molHeader.style.alignItems = 'center';
    molHeader.style.justifyContent = 'space-between';
    molHeader.style.marginTop = '8px';

    const molLabel = document.createElement('span');
    molLabel.className = 'ics-section-title';
    molLabel.textContent = 'MOLARITY (mol/L)';

    this.molarityInputEl = document.createElement('input');
    this.molarityInputEl.type = 'number';
    this.molarityInputEl.min = '0.01';
    this.molarityInputEl.max = '6.0';
    this.molarityInputEl.step = '0.05';
    this.molarityInputEl.value = String(this.dispenseMolarity);
    this.molarityInputEl.className = 'ics-input';
    this.molarityInputEl.style.width = '68px';
    this.molarityInputEl.style.height = '20px';
    this.molarityInputEl.style.textAlign = 'right';
    this.molarityInputEl.addEventListener('change', () => {
      const val = Math.max(
        0.005,
        Math.min(6.0, Number(this.molarityInputEl.value) || 0.2)
      );
      this.dispenseMolarity = val;
      this.molarityInputEl.value = String(val);
      this.renderMolarityPresets();
    });

    molHeader.appendChild(molLabel);
    molHeader.appendChild(this.molarityInputEl);
    dosingSection.appendChild(molHeader);

    this.molarityPresetsContainer = document.createElement('div');
    this.molarityPresetsContainer.className = 'ics-stepper-row';
    this.renderMolarityPresets();
    dosingSection.appendChild(this.molarityPresetsContainer);

    // Quick Deionized Water (H2O) Dispense Bar
    const waterRow = document.createElement('div');
    waterRow.style.display = 'flex';
    waterRow.style.alignItems = 'center';
    waterRow.style.justifyContent = 'space-between';
    waterRow.style.marginTop = '8px';
    waterRow.style.paddingTop = '7px';
    waterRow.style.borderTop = '1px solid #22262E';

    const waterTitle = document.createElement('span');
    waterTitle.className = 'ics-mono';
    waterTitle.style.fontSize = '10px';
    waterTitle.style.color = '#7A828E';
    waterTitle.textContent = 'SOLVENT // H₂O(l)';

    const waterBtns = document.createElement('div');
    waterBtns.style.display = 'flex';
    waterBtns.style.gap = '4px';

    for (const vol of [25, 50]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ics-btn';
      btn.style.height = '20px';
      btn.style.padding = '0 6px';
      btn.textContent = `+${vol}mL H₂O`;
      btn.addEventListener('click', () => this.callbacks.onDispenseWater(vol));
      waterBtns.appendChild(btn);
    }

    waterRow.appendChild(waterTitle);
    waterRow.appendChild(waterBtns);
    dosingSection.appendChild(waterRow);

    this.reagentsViewEl.appendChild(dosingSection);

    // 2c. Scrollable Reagent Rows List
    this.reagentListContainer = document.createElement('div');
    this.reagentListContainer.className = 'ics-reagent-list';
    this.reagentsViewEl.appendChild(this.reagentListContainer);

    this.rootEl.appendChild(this.reagentsViewEl);

    // 3. APPARATUS SPAWNER VIEW CONTAINER
    this.apparatusViewEl = document.createElement('div');
    this.apparatusViewEl.className = 'ics-apparatus-grid';
    this.apparatusViewEl.style.display = 'none';
    this.buildApparatusCards();
    this.rootEl.appendChild(this.apparatusViewEl);
  }

  private renderCategoryPills(): void {
    this.categoryPillsContainer.innerHTML = '';
    const categories: Array<{ id: 'all' | CompoundCategory; label: string }> = [
      { id: 'all', label: 'ALL' },
      { id: 'acid', label: 'ACIDS' },
      { id: 'base', label: 'BASES' },
      { id: 'salt', label: 'SALTS' },
      { id: 'indicator', label: 'INDICATORS' },
    ];

    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ics-cat-pill ${
        this.activeCategory === cat.id ? 'ics-cat-pill-active' : ''
      }`;
      btn.textContent = cat.label;
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id;
        this.renderCategoryPills();
        this.renderReagentRows();
      });
      this.categoryPillsContainer.appendChild(btn);
    }
  }

  private renderVolumePresets(): void {
    this.volumePresetsContainer.innerHTML = '';
    for (const v of VOLUME_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ics-cat-pill ${
        Math.abs(this.dispenseVolumeMl - v) < 1e-3 ? 'ics-cat-pill-active' : ''
      }`;
      btn.textContent = `${v}mL`;
      btn.addEventListener('click', () => {
        this.dispenseVolumeMl = v;
        this.volumeInputEl.value = String(v);
        this.renderVolumePresets();
      });
      this.volumePresetsContainer.appendChild(btn);
    }
  }

  private renderMolarityPresets(): void {
    this.molarityPresetsContainer.innerHTML = '';
    for (const m of MOLARITY_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ics-cat-pill ${
        Math.abs(this.dispenseMolarity - m) < 1e-3 ? 'ics-cat-pill-active' : ''
      }`;
      btn.textContent = `${m}M`;
      btn.addEventListener('click', () => {
        this.dispenseMolarity = m;
        this.molarityInputEl.value = String(m);
        this.renderMolarityPresets();
      });
      this.molarityPresetsContainer.appendChild(btn);
    }
  }

  private renderReagentRows(): void {
    this.reagentListContainer.innerHTML = '';

    const filtered = this.compounds.filter((c) => {
      if (this.activeCategory !== 'all' && c.category !== this.activeCategory) {
        return false;
      }
      if (!this.searchQuery) return true;
      return (
        c.id.toLowerCase().includes(this.searchQuery) ||
        c.formula.toLowerCase().includes(this.searchQuery) ||
        c.name.toLowerCase().includes(this.searchQuery)
      );
    });

    if (filtered.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.style.padding = '16px 10px';
      emptyEl.style.color = '#7A828E';
      emptyEl.style.fontFamily = 'var(--font-mono)';
      emptyEl.style.fontSize = '10px';
      emptyEl.textContent = 'NO MATCHING REAGENTS IN CATALOG.';
      this.reagentListContainer.appendChild(emptyEl);
      return;
    }

    for (const compound of filtered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ics-reagent-row';
      row.title = `Click to dispense ${this.dispenseVolumeMl} mL of ${this.dispenseMolarity} M ${compound.name}`;

      // Left cluster: 10x10px optical swatch + formula + Sulphate IUPAC name
      const leftCluster = document.createElement('div');
      leftCluster.style.display = 'flex';
      leftCluster.style.alignItems = 'center';
      leftCluster.style.gap = '8px';
      leftCluster.style.minWidth = '0';

      const swatch = document.createElement('span');
      swatch.className = 'ics-reagent-swatch';
      swatch.style.backgroundColor = this.computeCompoundSwatchCss(compound);

      const textStack = document.createElement('div');
      textStack.style.minWidth = '0';

      const formulaLine = document.createElement('div');
      formulaLine.className = 'ics-mono';
      formulaLine.style.fontSize = '12px';
      formulaLine.style.fontWeight = '600';
      formulaLine.style.color = '#ECEFF4';
      formulaLine.textContent = compound.formula;

      const nameLine = document.createElement('div');
      nameLine.style.fontSize = '10px';
      nameLine.style.color = '#7A828E';
      nameLine.style.whiteSpace = 'nowrap';
      nameLine.style.overflow = 'hidden';
      nameLine.style.textOverflow = 'ellipsis';
      nameLine.textContent = compound.name;

      textStack.appendChild(formulaLine);
      textStack.appendChild(nameLine);

      leftCluster.appendChild(swatch);
      leftCluster.appendChild(textStack);

      // Right cluster: State badge (AQ / SOLID / IND) + molar mass
      const rightCluster = document.createElement('div');
      rightCluster.style.display = 'flex';
      rightCluster.style.flexDirection = 'column';
      rightCluster.style.alignItems = 'flex-end';
      rightCluster.style.gap = '2px';
      rightCluster.style.flexShrink = '0';

      const badge = document.createElement('span');
      badge.className = 'ics-badge';
      badge.textContent = this.getStateBadgeText(compound);

      const mwSpan = document.createElement('span');
      mwSpan.className = 'ics-mono';
      mwSpan.style.fontSize = '9px';
      mwSpan.style.color = '#7A828E';
      mwSpan.textContent = `${compound.molarMass.toFixed(1)} g/mol`;

      rightCluster.appendChild(badge);
      rightCluster.appendChild(mwSpan);

      row.appendChild(leftCluster);
      row.appendChild(rightCluster);

      row.addEventListener('click', () => {
        this.callbacks.onDispenseReagent(
          compound,
          this.dispenseVolumeMl,
          this.dispenseMolarity
        );
      });

      this.reagentListContainer.appendChild(row);
    }
  }

  private buildApparatusCards(): void {
    this.apparatusViewEl.innerHTML = '';

    const items: Array<{
      type: ApparatusTypeId | 'bunsen_burner';
      title: string;
      specLine: string;
      svgMarkup: string;
    }> = [
      {
        type: 'beaker_250',
        title: '250 mL Beaker',
        specLine: 'BOROSILICATE // 250 mL',
        svgMarkup: `
          <svg width="46" height="54" viewBox="0 0 46 54" fill="none">
            <path d="M8 8 L11 12 L11 44 Q11 47 14 47 L32 47 Q35 47 35 44 L35 12 L38 8" stroke="#94A3B8" stroke-width="1.5"/>
            <line x1="27" y1="20" x2="35" y2="20" stroke="#38BDF8" stroke-width="1"/>
            <line x1="29" y1="28" x2="35" y2="28" stroke="#475569" stroke-width="1"/>
            <line x1="27" y1="36" x2="35" y2="36" stroke="#38BDF8" stroke-width="1"/>
          </svg>
        `,
      },
      {
        type: 'erlenmeyer_250',
        title: '250 mL Erlenmeyer Flask',
        specLine: 'CONICAL NECK // 250 mL',
        svgMarkup: `
          <svg width="46" height="54" viewBox="0 0 46 54" fill="none">
            <path d="M18 7 L18 19 L9 44 Q8 47 12 47 L34 47 Q38 47 37 44 L28 19 L28 7" stroke="#94A3B8" stroke-width="1.5"/>
            <line x1="23" y1="28" x2="31" y2="28" stroke="#38BDF8" stroke-width="1"/>
            <line x1="23" y1="37" x2="34" y2="37" stroke="#475569" stroke-width="1"/>
          </svg>
        `,
      },
      {
        type: 'test_tube_50',
        title: '50 mL Test Tube',
        specLine: 'U-BOTTOM // 50 mL',
        svgMarkup: `
          <svg width="46" height="54" viewBox="0 0 46 54" fill="none">
            <path d="M16 7 L18 9 L18 39 A5 5 0 0 0 28 39 L28 9 L30 7" stroke="#94A3B8" stroke-width="1.5"/>
            <line x1="23" y1="22" x2="28" y2="22" stroke="#38BDF8" stroke-width="1"/>
            <line x1="23" y1="31" x2="28" y2="31" stroke="#475569" stroke-width="1"/>
          </svg>
        `,
      },
      {
        type: 'burette_50',
        title: '50 mL Precision Burette',
        specLine: 'STOPCOCK // ±0.05 mL',
        svgMarkup: `
          <svg width="46" height="54" viewBox="0 0 46 54" fill="none">
            <rect x="20" y="5" width="6" height="34" stroke="#94A3B8" stroke-width="1.4"/>
            <line x1="17" y1="42" x2="29" y2="42" stroke="#38BDF8" stroke-width="2"/>
            <path d="M21 39 L23 49 L25 39" stroke="#94A3B8" stroke-width="1.2"/>
          </svg>
        `,
      },
      {
        type: 'bunsen_burner',
        title: 'Bunsen Burner',
        specLine: '450W // TRIPOD + GAUZE',
        svgMarkup: `
          <svg width="46" height="54" viewBox="0 0 46 54" fill="none">
            <path d="M23 10 Q17 19 20 26 L26 26 Q29 19 23 10 Z" fill="rgba(56,189,248,0.35)" stroke="#38BDF8" stroke-width="1.2"/>
            <rect x="20" y="26" width="6" height="16" fill="#181B20" stroke="#94A3B8" stroke-width="1.3"/>
            <path d="M12 47 L16 42 L30 42 L34 47 Z" fill="#181B20" stroke="#94A3B8" stroke-width="1.3"/>
          </svg>
        `,
      },
    ];

    for (const item of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ics-apparatus-card';
      if (item.type === 'bunsen_burner') {
        card.style.gridColumn = 'span 2';
      }

      const iconWrap = document.createElement('div');
      iconWrap.innerHTML = item.svgMarkup;

      const titleDiv = document.createElement('div');
      titleDiv.style.fontWeight = '600';
      titleDiv.style.fontSize = '11px';
      titleDiv.style.marginTop = '4px';
      titleDiv.textContent = item.title;

      const specDiv = document.createElement('div');
      specDiv.className = 'ics-mono';
      specDiv.style.fontSize = '9px';
      specDiv.style.color = '#7A828E';
      specDiv.style.marginTop = '2px';
      specDiv.textContent = item.specLine;

      card.appendChild(iconWrap);
      card.appendChild(titleDiv);
      card.appendChild(specDiv);

      card.addEventListener('click', () => {
        this.callbacks.onSpawnApparatus(item.type);
      });

      this.apparatusViewEl.appendChild(card);
    }
  }
}
