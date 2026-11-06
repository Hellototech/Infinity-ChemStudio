import compoundsData from '../../../public/data/compounds.json';
import ionsData from '../../../public/data/ions.json';
import reactionsKspData from '../../../public/data/reactions_ksp.json';
import { AcidBaseSolver } from './AcidBaseSolver';
import { EquilibriumSolver } from './EquilibriumSolver';
import { IonPool } from './IonPool';
import { ThermalSolver } from './ThermalSolver';
import {
  CompoundDefinition,
  EvolvedGasRecord,
  IonDefinition,
  PrecipitateRecord,
  ReactionLogEntry,
  ReactionsDatabase,
  VesselState,
} from './types';

/**
 * Main headless coordinator running the 4-stage chemistry tick loop:
 * Stage 1: Conservation of Mass & Dissociation (IonPool)
 * Stage 2: Precipitation & Gas Evolution (EquilibriumSolver)
 * Stage 3: Continuous Charge-Balance pH & Indicator Interpolation (AcidBaseSolver)
 * Stage 4: Thermodynamics & Calorimetry (ThermalSolver)
 */
export class ReactionEngine {
  private ionPool: IonPool;
  private equilibriumSolver: EquilibriumSolver;
  private acidBaseSolver: AcidBaseSolver;
  private thermalSolver: ThermalSolver;

  private compoundsMap: Map<string, CompoundDefinition> = new Map();
  private precipitates: Map<string, PrecipitateRecord> = new Map();
  private evolvedGases: Map<string, EvolvedGasRecord> = new Map();
  private activeIndicators: Map<string, CompoundDefinition> = new Map();
  private reactionLog: ReactionLogEntry[] = [];

  private temperatureC: number = ThermalSolver.AMBIENT_TEMP_C;
  private cumulativeEnthalpyKj: number = 0;
  private lastTickEffervescing: boolean = false;

  constructor(
    customIons?: IonDefinition[],
    customCompounds?: CompoundDefinition[],
    customReactions?: ReactionsDatabase
  ) {
    const ions = (customIons ?? (ionsData as unknown as IonDefinition[]));
    const compounds = (customCompounds ?? (compoundsData as unknown as CompoundDefinition[]));
    const reactions = (customReactions ?? (reactionsKspData as unknown as ReactionsDatabase));

    this.ionPool = new IonPool(ions);
    this.equilibriumSolver = new EquilibriumSolver(
      reactions.precipitations,
      reactions.gasEquilibria
    );
    this.acidBaseSolver = new AcidBaseSolver();
    this.thermalSolver = new ThermalSolver();

    for (const compound of compounds) {
      this.compoundsMap.set(compound.id, compound);
    }
  }

  public getCompound(compoundId: string): CompoundDefinition | undefined {
    return this.compoundsMap.get(compoundId);
  }

  public getAllCompounds(): CompoundDefinition[] {
    return Array.from(this.compoundsMap.values());
  }

  public getAllIons(): IonDefinition[] {
    return this.ionPool.getAllIonDefinitions();
  }

  public getIonPool(): IonPool {
    return this.ionPool;
  }

  /**
   * Adds V (mL) of a compound solution at molarity M (mol/L) and runs the 4-stage solver loop.
   */
  public addSolution(
    compoundId: string,
    volumeMl: number,
    molarity?: number,
    reagentTempC: number = ThermalSolver.AMBIENT_TEMP_C
  ): VesselState {
    const compound = this.compoundsMap.get(compoundId);
    if (!compound) {
      throw new Error(`Unknown compound ID: "${compoundId}"`);
    }

    const effectiveMolarity = molarity ?? compound.defaultMolarity ?? 0.1;
    const previousVolumeMl = this.ionPool.getVolumeMl();

    if (compound.category === 'indicator') {
      this.ionPool.addVolumeMl(volumeMl);
      this.activeIndicators.set(compound.id, compound);
      this.reactionLog.unshift({
        id: `ind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestampMs: Date.now(),
        equation: `${compound.name} → Ind(aq)`,
        type: 'dissociation',
        deltaEnthalpyKj: 0,
        deltaTempC: 0,
        details: `Added ${volumeMl.toFixed(1)} mL of ${compound.name}`,
      });
    } else {
      // Stage 1: Conservation of Mass & Stoichiometric Dissociation
      const addedMoles = this.ionPool.addAqueousCompound(
        compound,
        volumeMl,
        effectiveMolarity
      );

      if (addedMoles > 0) {
        const productsText = compound.dissociation
          .map((d) => {
            const ionFormula =
              this.ionPool.getIonDefinition(d.ionId)?.formula ?? d.ionId;
            return `${d.coefficient > 1 ? d.coefficient + ' ' : ''}${ionFormula}(aq)`;
          })
          .join(' + ');

        this.reactionLog.unshift({
          id: `diss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestampMs: Date.now(),
          equation: `${compound.formula} → ${productsText}`,
          type: 'dissociation',
          deltaEnthalpyKj: 0,
          deltaTempC: 0,
          details: `Added ${volumeMl.toFixed(1)} mL of ${effectiveMolarity.toFixed(2)} M ${compound.id} (${addedMoles.toFixed(4)} mol)`,
        });
      }
    }

    return this.executeSolverStages(previousVolumeMl, volumeMl, reagentTempC);
  }

  /**
   * Alias for addSolution to support flexible test/caller ergonomics.
   */
  public addAqueous(
    compoundId: string,
    volumeMl: number,
    molarity?: number,
    reagentTempC: number = ThermalSolver.AMBIENT_TEMP_C
  ): VesselState {
    return this.addSolution(compoundId, volumeMl, molarity, reagentTempC);
  }

  /**
   * Adds m (g) of a solid compound directly to the vessel and runs the 4-stage solver loop.
   */
  public addSolid(compoundId: string, massGrams: number): VesselState {
    const compound = this.compoundsMap.get(compoundId);
    if (!compound) {
      throw new Error(`Unknown compound ID: "${compoundId}"`);
    }

    const previousVolumeMl = this.ionPool.getVolumeMl();
    const addedMoles = this.ionPool.addSolidCompound(compound, massGrams);

    if (addedMoles > 0) {
      const productsText = compound.dissociation
        .map((d) => {
          const ionFormula =
            this.ionPool.getIonDefinition(d.ionId)?.formula ?? d.ionId;
          return `${d.coefficient > 1 ? d.coefficient + ' ' : ''}${ionFormula}(aq)`;
        })
        .join(' + ');

      this.reactionLog.unshift({
        id: `solid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestampMs: Date.now(),
        equation: `${compound.formula}(s) → ${productsText}`,
        type: 'dissociation',
        deltaEnthalpyKj: 0,
        deltaTempC: 0,
        details: `Dissolved ${massGrams.toFixed(3)} g (${addedMoles.toFixed(4)} mol) ${compound.id}(s)`,
      });
    }

    return this.executeSolverStages(previousVolumeMl, 0, this.temperatureC);
  }

  /**
   * Adds pure deionized water (H2O) to the vessel, diluting concentrations.
   */
  public addWater(
    volumeMl: number,
    waterTempC: number = ThermalSolver.AMBIENT_TEMP_C
  ): VesselState {
    const previousVolumeMl = this.ionPool.getVolumeMl();
    this.ionPool.addVolumeMl(volumeMl);
    return this.executeSolverStages(previousVolumeMl, volumeMl, waterTempC);
  }

  /**
   * Public entry point to run the equilibrium, acid-base, and thermal solver stages
   * directly on the current IonPool state (e.g. during continuous pouring transfer).
   */
  public solve(
    previousVolumeMl?: number,
    addedVolumeMl: number = 0,
    reagentTempC?: number
  ): VesselState {
    const prevVol = previousVolumeMl ?? this.ionPool.getVolumeMl();
    const rTemp = reagentTempC ?? this.temperatureC;
    return this.executeSolverStages(prevVol, addedVolumeMl, rTemp);
  }

  public getTemperatureC(): number {
    return this.temperatureC;
  }

  public getPrecipitatesMap(): Map<string, PrecipitateRecord> {
    return this.precipitates;
  }

  /**
   * Runs Stages 2, 3, and 4 of the tick loop:
   * - Stage 2: EquilibriumSolver (Neutralization, Gas Evolution, Ksp Precipitation)
   * - Stage 3: AcidBaseSolver (Continuous Charge-Balance pH & Indicator Interpolation)
   * - Stage 4: ThermalSolver (Enthalpy dH_rxn & Calorimetry dT)
   */
  private executeSolverStages(
    previousVolumeMl: number,
    addedVolumeMl: number,
    reagentTempC: number
  ): VesselState {
    // Stage 2: Equilibrium Pass (Neutralization, Gas Evolution, Ksp Precipitation)
    const eqResult = this.equilibriumSolver.solve(
      this.ionPool,
      this.precipitates,
      this.evolvedGases,
      this.temperatureC
    );

    // Stage 3: Continuous Charge-Balance Acid-Base Pass
    const activeIndList = Array.from(this.activeIndicators.values());
    const acidBaseResult = this.acidBaseSolver.solve(this.ionPool, activeIndList);

    // Stage 4: Thermodynamics Pass
    const thermalResult = this.thermalSolver.solve({
      previousVolumeMl,
      addedVolumeMl,
      currentTemperatureC: this.temperatureC,
      reagentTemperatureC: reagentTempC,
      waterFormedMoles: eqResult.waterFormedMoles,
      precipitatesFormed: eqResult.precipitatesFormed.map((p) => ({
        rule: p.rule,
        moles: p.moles,
      })),
    });

    this.temperatureC = thermalResult.newTemperatureC;
    this.cumulativeEnthalpyKj += thermalResult.deltaEnthalpyKj;
    this.lastTickEffervescing = eqResult.gasEvolved.length > 0;

    // Attach thermal delta to any reaction log entries created during this tick
    if (eqResult.logs.length > 0) {
      for (const logEntry of eqResult.logs) {
        logEntry.deltaTempC = thermalResult.deltaTempC;
        this.reactionLog.unshift(logEntry);
      }
    }

    if (this.reactionLog.length > 50) {
      this.reactionLog.length = 50;
    }

    return this.getState(acidBaseResult);
  }

  /**
   * Sets or clears the active acid-base indicator (e.g., 'phenolphthalein', 'methyl_orange', 'universal', or null for NONE).
   * Adding an indicator adds 2 drops (~0.1 mL) if the vessel already contains liquid and immediately updates optical color.
   */
  public setIndicator(indicatorId: string | null): VesselState {
    this.activeIndicators.clear();
    if (indicatorId && indicatorId !== 'none') {
      const compound = this.compoundsMap.get(indicatorId);
      if (compound && compound.category === 'indicator') {
        this.activeIndicators.set(compound.id, compound);
        if (this.ionPool.getVolumeMl() > 0) {
          this.ionPool.addVolumeMl(0.1);
        }
      }
    }
    return this.getState();
  }

  /**
   * External thermal control (e.g. Bunsen burner or ice bath in UI).
   */
  public setTemperatureC(tempC: number): VesselState {
    this.temperatureC = Math.max(0, Math.min(100, tempC));
    return this.getState();
  }

  /**
   * Restores raw internal state for JSON preset/state import.
   */
  public restoreSerializedState(data: {
    volumeMl: number;
    temperatureC: number;
    ionMoles: Record<string, number>;
    precipitates?: Record<string, PrecipitateRecord>;
    evolvedGases?: Record<string, EvolvedGasRecord>;
    activeIndicators?: string[];
    cumulativeEnthalpyKj?: number;
  }): VesselState {
    this.reset();
    this.ionPool.setVolumeMl(Math.max(0, data.volumeMl ?? 0));
    this.temperatureC = data.temperatureC ?? ThermalSolver.AMBIENT_TEMP_C;
    this.cumulativeEnthalpyKj = data.cumulativeEnthalpyKj ?? 0;

    if (data.ionMoles) {
      for (const [ionId, moles] of Object.entries(data.ionMoles)) {
        if (moles > 0) {
          this.ionPool.setMoles(ionId, moles);
        }
      }
    }

    if (data.precipitates) {
      for (const [id, rec] of Object.entries(data.precipitates)) {
        this.precipitates.set(id, { ...rec });
      }
    }

    if (data.evolvedGases) {
      for (const [id, gas] of Object.entries(data.evolvedGases)) {
        this.evolvedGases.set(id, { ...gas });
      }
    }

    if (data.activeIndicators) {
      for (const indId of data.activeIndicators) {
        const comp = this.compoundsMap.get(indId);
        if (comp) {
          this.activeIndicators.set(indId, comp);
        }
      }
    }

    return this.getState();
  }

  /**
   * Returns an immutable snapshot of the current VesselState.
   */
  public getState(
    precomputedAcidBase?: ReturnType<AcidBaseSolver['solve']>
  ): VesselState {
    const activeIndList = Array.from(this.activeIndicators.values());
    const ab =
      precomputedAcidBase ??
      this.acidBaseSolver.solve(this.ionPool, activeIndList);

    const colorRgba = this.ionPool.computeBeerLambertColor(ab.indicatorColorRgba);
    const [r, g, b, a] = colorRgba;
    const solutionColorCss = `rgba(${r}, ${g}, ${b}, ${a})`;

    const precipitatesRecord: Record<string, PrecipitateRecord> = {};
    for (const [id, rec] of this.precipitates.entries()) {
      precipitatesRecord[id] = { ...rec };
    }

    const evolvedGasesRecord: Record<string, EvolvedGasRecord> = {};
    let totalEvolvedGasMoles = 0;
    let totalEvolvedGasVolumeMl = 0;

    for (const [id, gas] of this.evolvedGases.entries()) {
      evolvedGasesRecord[id] = { ...gas };
      totalEvolvedGasMoles += gas.moles;
      totalEvolvedGasVolumeMl += gas.volumeMl;
    }

    return {
      volumeMl: Number(this.ionPool.getVolumeMl().toFixed(4)),
      volumeLiters: Number(this.ionPool.getVolumeLiters().toFixed(6)),
      solutionMassGrams: Number(this.ionPool.getSolutionMassGrams().toFixed(4)),
      temperatureC: Number(this.temperatureC.toFixed(4)),
      pH: ab.pH,
      pOH: ab.pOH,
      hPlusConcentration: ab.hPlusConcentration,
      ohMinusConcentration: ab.ohMinusConcentration,
      ionicStrength: Number(this.ionPool.getIonicStrength().toFixed(5)),
      solutionColorRgba: colorRgba,
      solutionColorCss,
      ionMoles: this.ionPool.getAllIonMoles(),
      ionMolarities: this.ionPool.getAllIonMolarities(),
      precipitates: precipitatesRecord,
      evolvedGases: evolvedGasesRecord,
      totalEvolvedGasMoles: Number(totalEvolvedGasMoles.toFixed(6)),
      totalEvolvedGasVolumeMl: Number(totalEvolvedGasVolumeMl.toFixed(3)),
      isEffervescing: this.lastTickEffervescing,
      activeIndicators: Array.from(this.activeIndicators.keys()),
      cumulativeEnthalpyKj: Number(this.cumulativeEnthalpyKj.toFixed(4)),
      reactionLog: [...this.reactionLog],
    };
  }

  /**
   * Resets the vessel to an empty, clean state at 25.0 °C.
   */
  public reset(): VesselState {
    this.ionPool.reset();
    this.precipitates.clear();
    this.evolvedGases.clear();
    this.activeIndicators.clear();
    this.reactionLog = [];
    this.temperatureC = ThermalSolver.AMBIENT_TEMP_C;
    this.cumulativeEnthalpyKj = 0;
    this.lastTickEffervescing = false;
    return this.getState();
  }
}
