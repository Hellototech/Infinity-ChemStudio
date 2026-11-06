import apparatusSpecsData from '../../../public/data/apparatus_specs.json';
import { ReactionEngine } from '../chemistry/ReactionEngine';
import { VesselState } from '../chemistry/types';
import {
  ApparatusSpec,
  ApparatusTypeId,
  MouthSegment,
  Point2D,
  SpoutInfo,
  VesselSnapshot,
} from './types';

const SPECS_MAP = apparatusSpecsData as unknown as Record<ApparatusTypeId, ApparatusSpec>;

export interface VesselInitOptions {
  id: string;
  type?: ApparatusTypeId;
  label?: string;
  x?: number;
  y?: number;
  rotationRad?: number;
  snappedToId?: string;
  boilingPointC?: number;
}

/**
 * Stateful physical apparatus container wrapping Phase 1 IonPool + ReactionEngine
 * with 2D spatial transforms, spout rotation matrix math, and boiling state.
 */
export class Vessel {
  public readonly id: string;
  public readonly type: ApparatusTypeId;
  public readonly spec: ApparatusSpec;
  public label: string;

  // Spatial State (world coordinates in px)
  public x: number;
  public y: number;
  public rotationRad: number;
  public angularVelocity: number = 0;
  public isDragged: boolean = false;
  public isAgitated: boolean = false;
  public snappedToId?: string;
  public stopcockOpenRatio: number = 0; // 0..1 for burette_50

  // Thermal, Gas Evolution & Boiling State
  public boilingPointC: number;
  public evaporatedSteamMoles: number = 0;
  public activeSteamRate: number = 0; // mol/sec of steam currently evolving
  public gasEvolutionRate: number = 0; // mol/sec of chemical gas (e.g. CO2) currently evolving

  private engine: ReactionEngine;

  constructor(options: VesselInitOptions) {
    this.id = options.id;
    this.type = options.type ?? 'beaker_250';
    const spec = SPECS_MAP[this.type];
    if (!spec) {
      throw new Error(`Unknown apparatus type: "${this.type}"`);
    }
    this.spec = spec;
    this.label = options.label ?? `${spec.name} (${options.id})`;
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.rotationRad = options.rotationRad ?? 0;
    this.snappedToId = options.snappedToId;
    this.boilingPointC = options.boilingPointC ?? 100.0;

    this.engine = new ReactionEngine();
  }

  public getEngine(): ReactionEngine {
    return this.engine;
  }

  public get ionPool() {
    return this.engine.getIonPool();
  }

  public get precipitates() {
    return this.engine.getPrecipitatesMap();
  }

  public get currentVolumeMl(): number {
    return this.engine.getIonPool().getVolumeMl();
  }

  public get maxVolumeMl(): number {
    return this.spec.maxVolumeMl;
  }

  public get temperatureC(): number {
    return this.engine.getTemperatureC();
  }

  public set temperatureC(tempC: number) {
    // Allow clamping up to boiling point or arbitrary liquid temp
    this.engine.setTemperatureC(tempC);
  }

  public get thermalConductivity(): number {
    return this.spec.thermalConductivity ?? 0.85;
  }

  public get solutionMassGrams(): number {
    return this.engine.getIonPool().getSolutionMassGrams();
  }

  /**
   * Sets tilt angle in degrees (convenience helper converting to radians).
   */
  public setRotationDeg(degrees: number): void {
    this.rotationRad = (degrees * Math.PI) / 180;
  }

  public getRotationDeg(): number {
    return (this.rotationRad * 180) / Math.PI;
  }

  /**
   * Applies the 2D rotation matrix:
   * [x'] = [x] + [cos(theta)  -sin(theta)] [localX]
   * [y']   [y]   [sin(theta)   cos(theta)] [localY]
   */
  public localToWorld(localOffset: [number, number]): Point2D {
    const [lx, ly] = localOffset;
    const cosT = Math.cos(this.rotationRad);
    const sinT = Math.sin(this.rotationRad);
    return {
      x: this.x + (lx * cosT - ly * sinT),
      y: this.y + (lx * sinT + ly * cosT),
    };
  }

  /**
   * Returns the active world-space spout coordinate based on tilt direction:
   * - If rotationRad < 0 (tilted left / counter-clockwise), uses spoutOffsetLeft.
   * - If rotationRad >= 0 (tilted right / clockwise), uses spoutOffsetRight.
   * - For a vertical burette using its bottom stopcock, uses [0, height / 2].
   */
  public getWorldSpoutPosition(): Point2D {
    return this.getActiveSpoutInfo().worldPosition;
  }

  public getActiveSpoutInfo(): SpoutInfo {
    if (
      this.type === 'burette_50' &&
      this.stopcockOpenRatio > 0 &&
      Math.abs(this.rotationRad) < 0.2
    ) {
      const bottomOffset: [number, number] = [0, this.spec.height / 2];
      return {
        side: 'bottom',
        localOffset: bottomOffset,
        worldPosition: this.localToWorld(bottomOffset),
      };
    }

    const side: 'left' | 'right' = this.rotationRad < 0 ? 'left' : 'right';
    const localOffset: [number, number] =
      side === 'left' ? this.spec.spoutOffsetLeft : this.spec.spoutOffsetRight;

    return {
      side,
      localOffset,
      worldPosition: this.localToWorld(localOffset),
    };
  }

  /**
   * Returns the world-space line segment [leftLip, rightLip] of the vessel's top opening
   * for receiving poured liquids.
   */
  public getMouthSegment(): MouthSegment {
    const leftLip = this.localToWorld(this.spec.spoutOffsetLeft);
    const rightLip = this.localToWorld(this.spec.spoutOffsetRight);
    return [leftLip, rightLip];
  }

  /**
   * Returns the world-space center of the bottom base of the vessel (for burner heat transfer).
   */
  public getWorldBasePosition(): Point2D {
    return this.localToWorld([0, this.spec.height / 2]);
  }

  /**
   * Adds an aqueous solution directly to this vessel and runs the Phase 1 ReactionEngine.
   */
  public addSolution(
    compoundId: string,
    volumeMl: number,
    molarity?: number,
    reagentTempC: number = 25.0
  ): VesselState {
    const prevGas = this.engine.getState().totalEvolvedGasMoles;
    const nextState = this.engine.addSolution(
      compoundId,
      volumeMl,
      molarity,
      reagentTempC
    );
    const deltaGas = Math.max(0, nextState.totalEvolvedGasMoles - prevGas);
    if (deltaGas > 1e-7) {
      this.gasEvolutionRate = Math.min(0.25, this.gasEvolutionRate + deltaGas * 8.0);
    }
    return nextState;
  }

  /**
   * Adds pure water at a specified temperature to this vessel.
   */
  public addWater(volumeMl: number, waterTempC: number = 25.0): VesselState {
    return this.engine.addWater(volumeMl, waterTempC);
  }

  /**
   * Adds solid compound in grams to this vessel.
   */
  public addSolid(compoundId: string, massGrams: number): VesselState {
    const prevGas = this.engine.getState().totalEvolvedGasMoles;
    const nextState = this.engine.addSolid(compoundId, massGrams);
    const deltaGas = Math.max(0, nextState.totalEvolvedGasMoles - prevGas);
    if (deltaGas > 1e-7) {
      this.gasEvolutionRate = Math.min(0.25, this.gasEvolutionRate + deltaGas * 8.0);
    }
    return nextState;
  }

  /**
   * Sets or clears the active indicator ('phenolphthalein', 'methyl_orange', 'universal', or null).
   */
  public setIndicator(indicatorId: string | null): VesselState {
    return this.engine.setIndicator(indicatorId);
  }

  /**
   * Returns dissolved moles of a specific ion in the aqueous phase.
   */
  public getIonMoles(ionId: string): number {
    return this.engine.getIonPool().getMoles(ionId);
  }

  /**
   * Returns dissolved molarity (mol/L) of a specific ion in the aqueous phase.
   */
  public getIonMolarity(ionId: string): number {
    return this.engine.getIonPool().getMolarity(ionId);
  }

  /**
   * Returns total conserved moles of an ion across both the dissolved aqueous phase
   * AND any solid precipitates currently settled in this vessel (e.g. Ag+ in AgCl(s)).
   */
  public getTotalConservedIonMoles(ionId: string): number {
    let total = this.getIonMoles(ionId);
    const state = this.engine.getState();

    // Map known precipitates to their constituent stoichiometry
    const precipStoich: Record<string, Array<{ ionId: string; coeff: number }>> = {
      AgCl: [
        { ionId: 'Ag+', coeff: 1 },
        { ionId: 'Cl-', coeff: 1 },
      ],
      AgI: [
        { ionId: 'Ag+', coeff: 1 },
        { ionId: 'I-', coeff: 1 },
      ],
      PbI2: [
        { ionId: 'Pb2+', coeff: 1 },
        { ionId: 'I-', coeff: 2 },
      ],
      'Cu(OH)2': [
        { ionId: 'Cu2+', coeff: 1 },
        { ionId: 'OH-', coeff: 2 },
      ],
      'Fe(OH)3': [
        { ionId: 'Fe3+', coeff: 1 },
        { ionId: 'OH-', coeff: 3 },
      ],
      'Fe(OH)2': [
        { ionId: 'Fe2+', coeff: 1 },
        { ionId: 'OH-', coeff: 2 },
      ],
      BaSO4: [
        { ionId: 'Ba2+', coeff: 1 },
        { ionId: 'SO4_2-', coeff: 1 },
      ],
      CaCO3: [
        { ionId: 'Ca2+', coeff: 1 },
        { ionId: 'CO3_2-', coeff: 1 },
      ],
    };

    for (const [pptId, record] of Object.entries(state.precipitates)) {
      const components = precipStoich[pptId];
      if (!components) continue;
      for (const comp of components) {
        if (comp.ionId === ionId) {
          total += record.moles * comp.coeff;
        }
      }
    }

    return total;
  }

  public getChemistryState(): VesselState {
    return this.engine.getState();
  }

  public getSnapshot(): VesselSnapshot {
    return {
      id: this.id,
      label: this.label,
      type: this.type,
      spec: this.spec,
      x: this.x,
      y: this.y,
      rotationRad: this.rotationRad,
      rotationDeg: this.getRotationDeg(),
      isDragged: this.isDragged,
      isAgitated: this.isAgitated,
      snappedToId: this.snappedToId,
      stopcockOpenRatio: this.stopcockOpenRatio,
      currentVolumeMl: Number(this.currentVolumeMl.toFixed(4)),
      maxVolumeMl: this.maxVolumeMl,
      temperatureC: Number(this.temperatureC.toFixed(4)),
      boilingPointC: this.boilingPointC,
      evaporatedSteamMoles: Number(this.evaporatedSteamMoles.toFixed(6)),
      activeSteamRate: Number(this.activeSteamRate.toFixed(6)),
      worldSpout: this.getWorldSpoutPosition(),
      mouthSegment: this.getMouthSegment(),
      chemistryState: this.engine.getState(),
    };
  }

  public reset(): void {
    this.rotationRad = 0;
    this.stopcockOpenRatio = 0;
    this.evaporatedSteamMoles = 0;
    this.activeSteamRate = 0;
    this.engine.reset();
  }
}
