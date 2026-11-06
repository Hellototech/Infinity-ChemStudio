import { Burner, BurnerInitOptions } from './Burner';
import { PourPhysics } from './PourPhysics';
import { PourStream, WorkbenchSnapshot } from './types';
import { Vessel, VesselInitOptions } from './Vessel';

/**
 * World coordinator managing all active vessels, Bunsen burners, pouring streams,
 * and the 60Hz physical & chemical simulation tick loop.
 */
export class WorkbenchState {
  private vessels: Map<string, Vessel> = new Map();
  private burners: Map<string, Burner> = new Map();
  private pourPhysics: PourPhysics;
  private activePourStreams: PourStream[] = [];
  private simTimeSeconds: number = 0;
  private tickCount: number = 0;

  constructor(flowCoefficient: number = PourPhysics.DEFAULT_FLOW_COEFFICIENT) {
    this.pourPhysics = new PourPhysics(flowCoefficient);
  }

  public addVessel(optionsOrVessel: VesselInitOptions | Vessel): Vessel {
    const vessel =
      optionsOrVessel instanceof Vessel
        ? optionsOrVessel
        : new Vessel(optionsOrVessel);
    this.vessels.set(vessel.id, vessel);
    return vessel;
  }

  public getVessel(id: string): Vessel | undefined {
    return this.vessels.get(id);
  }

  public getAllVessels(): Vessel[] {
    return Array.from(this.vessels.values());
  }

  public removeVessel(id: string): boolean {
    return this.vessels.delete(id);
  }

  public addBurner(optionsOrBurner: BurnerInitOptions | Burner): Burner {
    const burner =
      optionsOrBurner instanceof Burner
        ? optionsOrBurner
        : new Burner(optionsOrBurner);
    this.burners.set(burner.id, burner);
    return burner;
  }

  public getBurner(id: string): Burner | undefined {
    return this.burners.get(id);
  }

  public getAllBurners(): Burner[] {
    return Array.from(this.burners.values());
  }

  public removeBurner(id: string): boolean {
    return this.burners.delete(id);
  }

  public getPourPhysics(): PourPhysics {
    return this.pourPhysics;
  }

  public getActivePourStreams(): PourStream[] {
    return this.activePourStreams;
  }

  /**
   * Advances the workbench physical and chemical simulation by dt seconds (e.g. 1/60s):
   * 1. Evaluates tilt thresholds, vertical spout raycasting, and mass/heat-conserving pouring.
   * 2. Evaluates radiative/convective Bunsen burner heating and 100C boiling evaporation.
   * 3. Applies ambient Newton cooling to unheated vessels.
   */
  public tick(dt: number = 1 / 60): WorkbenchSnapshot {
    if (dt <= 0) return this.getSnapshot();

    const vesselList = this.getAllVessels();
    const burnerList = this.getAllBurners();

    // Pass 1: Tilt & Pouring Physics
    this.activePourStreams = this.pourPhysics.stepWorkbenchPouring(vesselList, dt);

    // Pass 2: Burner Thermal Transfer, Boiling Evaporation & Ambient Newton Cooling
    for (const vessel of vesselList) {
      let heatedThisTick = false;
      for (const burner of burnerList) {
        if (burner.applyHeatToVessel(vessel, dt)) {
          heatedThisTick = true;
        }
      }

      if (!heatedThisTick) {
        Burner.applyAmbientCooling(vessel, dt);
      }

      // Smoothly decay transient chemical gasEvolutionRate after effervescence completes
      if (vessel.gasEvolutionRate > 0) {
        vessel.gasEvolutionRate *= Math.pow(0.42, dt);
        if (vessel.gasEvolutionRate < 1e-5) {
          vessel.gasEvolutionRate = 0;
        }
      }
    }

    this.simTimeSeconds += dt;
    this.tickCount += 1;

    return this.getSnapshot();
  }

  /**
   * Steps the workbench forward by N ticks at a fixed time step dt (default 60Hz).
   */
  public stepTicks(count: number, dt: number = 1 / 60): WorkbenchSnapshot {
    for (let i = 0; i < count; i++) {
      this.tick(dt);
    }
    return this.getSnapshot();
  }

  public getSnapshot(): WorkbenchSnapshot {
    return {
      simTimeSeconds: Number(this.simTimeSeconds.toFixed(4)),
      tickCount: this.tickCount,
      vessels: this.getAllVessels().map((v) => v.getSnapshot()),
      burners: this.getAllBurners().map((b) => b.getSnapshot()),
      activePourStreams: [...this.activePourStreams],
    };
  }

  public reset(): void {
    this.vessels.clear();
    this.burners.clear();
    this.activePourStreams = [];
    this.simTimeSeconds = 0;
    this.tickCount = 0;
  }
}
