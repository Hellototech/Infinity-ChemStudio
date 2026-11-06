import { ThermalSolver } from '../chemistry/ThermalSolver';
import { BurnerSnapshot } from './types';
import { Vessel } from './Vessel';

export interface BurnerInitOptions {
  id: string;
  x?: number;
  y?: number;
  isLit?: boolean;
  airHoleOpenRatio?: number;
  thermalPowerWatts?: number;
}

/**
 * Models a laboratory Bunsen burner with adjustable air collar (safety yellow flame
 * at ~500C vs roaring blue flame at ~1200C), radiative/convective heat transfer,
 * ambient Newton cooling, and 100C boiling water vaporization.
 */
export class Burner {
  public static readonly MAX_THERMAL_POWER_WATTS = 450;
  public static readonly MIN_LIT_POWER_WATTS = 180;
  public static readonly AMBIENT_TEMP_C = 25.0;
  public static readonly NEWTON_COOLING_COEFF = 0.015;
  public static readonly WATER_MOLAR_MASS = 18.015; // g/mol
  // Effective latent heat of vaporization (J/g) calibrated for real-time 60Hz interactive boiling
  public static readonly EFFECTIVE_LATENT_HEAT_J_PER_GRAM = 540.0;

  public readonly id: string;
  public x: number;
  public y: number;
  public isLit: boolean;

  private _airHoleOpenRatio: number;
  private _customPowerWatts: number | null = null;

  constructor(options: BurnerInitOptions) {
    this.id = options.id;
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;
    this.isLit = options.isLit ?? false;
    this._airHoleOpenRatio = Math.max(
      0,
      Math.min(1, options.airHoleOpenRatio ?? 1.0)
    );
    if (typeof options.thermalPowerWatts === 'number') {
      this._customPowerWatts = Math.max(
        0,
        Math.min(Burner.MAX_THERMAL_POWER_WATTS, options.thermalPowerWatts)
      );
    }
  }

  public get airHoleOpenRatio(): number {
    return this._airHoleOpenRatio;
  }

  public set airHoleOpenRatio(ratio: number) {
    this._airHoleOpenRatio = Math.max(0, Math.min(1, ratio));
  }

  /**
   * Flame temperature ranges from ~500C (0.0 yellow safety flame)
   * to ~1200C (1.0 roaring blue flame).
   */
  public get flameTemperatureC(): number {
    if (!this.isLit) return Burner.AMBIENT_TEMP_C;
    return 500 + 700 * this._airHoleOpenRatio;
  }

  /**
   * Thermal output power in Watts (0 to 450W).
   */
  public get thermalPowerWatts(): number {
    if (!this.isLit) return 0;
    if (this._customPowerWatts !== null) {
      return this._customPowerWatts;
    }
    return (
      Burner.MIN_LIT_POWER_WATTS +
      (Burner.MAX_THERMAL_POWER_WATTS - Burner.MIN_LIT_POWER_WATTS) *
        this._airHoleOpenRatio
    );
  }

  public set thermalPowerWatts(watts: number) {
    this._customPowerWatts = Math.max(
      0,
      Math.min(Burner.MAX_THERMAL_POWER_WATTS, watts)
    );
  }

  /**
   * Checks whether a vessel is positioned inside the active heating zone above the burner tip:
   * dx < 45px, and vertical distance dy between 10px and 80px above burner tip
   * (checking both vessel base and vessel center for coordinate convention flexibility).
   */
  public isVesselInHeatingZone(vessel: Vessel): boolean {
    if (!this.isLit || this.thermalPowerWatts <= 0) return false;

    const basePos = vessel.getWorldBasePosition();
    const dxBase = Math.abs(basePos.x - this.x);
    const dxCenter = Math.abs(vessel.x - this.x);
    if (Math.min(dxBase, dxCenter) >= 45) {
      return false;
    }

    // Support both screen coordinates (y-down: vessel above burner means burner.y - y > 0)
    // and Cartesian y-up coordinates, for either vessel base or vessel origin.
    const dyBase = Math.abs(this.y - basePos.y);
    const dyCenter = Math.abs(this.y - vessel.y);

    const baseInZone = dyBase >= 10 && dyBase <= 80;
    const centerInZone = dyCenter >= 10 && dyCenter <= 80;

    return baseInZone || centerInZone;
  }

  /**
   * Applies thermal energy transfer from this burner to a target vessel over time step dt.
   * Returns true if the vessel received heat during this tick.
   */
  public applyHeatToVessel(vessel: Vessel, dt: number): boolean {
    if (!this.isVesselInHeatingZone(vessel) || dt <= 0) {
      return false;
    }

    const volMl = vessel.currentVolumeMl;
    if (volMl <= 1e-6) {
      return false;
    }

    const qJoules = this.thermalPowerWatts * vessel.thermalConductivity * dt;
    const massGrams = Math.max(0.01, vessel.solutionMassGrams);
    const cp = ThermalSolver.SPECIFIC_HEAT_WATER_J_G_C; // 4.184 J/(g*C)

    const dT = qJoules / (massGrams * cp);
    const unclampedTemp = vessel.temperatureC + dT;

    if (unclampedTemp < vessel.boilingPointC) {
      vessel.temperatureC = unclampedTemp;
      vessel.activeSteamRate = 0;
    } else {
      // Clamp liquid temperature at boiling point (100.0C) and convert excess thermal
      // energy into water vaporization, concentrating non-volatile dissolved ions.
      const tempToBoil = Math.max(0, vessel.boilingPointC - vessel.temperatureC);
      const energyToReachBoilJoules = tempToBoil * massGrams * cp;
      const excessJoules = Math.max(0, qJoules - energyToReachBoilJoules);

      vessel.temperatureC = vessel.boilingPointC;

      if (excessJoules > 0) {
        const evaporatedGrams =
          excessJoules / Burner.EFFECTIVE_LATENT_HEAT_J_PER_GRAM;
        const actualEvaporatedMl = vessel
          .getEngine()
          .getIonPool()
          .evaporateWaterMl(evaporatedGrams);

        const steamMoles = actualEvaporatedMl / Burner.WATER_MOLAR_MASS;
        vessel.evaporatedSteamMoles += steamMoles;
        vessel.activeSteamRate = steamMoles / dt;

        // Re-evaluate equilibrium (since evaporating water concentrates ions and can
        // push Q > Ksp or shift pH) while preserving the 100.0C boiling temperature.
        vessel.getEngine().solve();
        vessel.temperatureC = vessel.boilingPointC;
      }
    }

    return true;
  }

  /**
   * Applies Newton's Law of Cooling toward ambient room temperature (25.0C)
   * when a vessel is not actively heated:
   * dT = -(T_vessel - 25.0) * 0.015 * dt
   */
  public static applyAmbientCooling(vessel: Vessel, dt: number): void {
    if (dt <= 0) return;
    vessel.activeSteamRate = 0;
    const currentT = vessel.temperatureC;
    const diff = currentT - Burner.AMBIENT_TEMP_C;
    if (Math.abs(diff) <= 1e-5) {
      vessel.temperatureC = Burner.AMBIENT_TEMP_C;
      return;
    }
    const deltaT = -diff * Burner.NEWTON_COOLING_COEFF * dt;
    vessel.temperatureC = currentT + deltaT;
  }

  public getSnapshot(): BurnerSnapshot {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      isLit: this.isLit,
      airHoleOpenRatio: this._airHoleOpenRatio,
      flameTemperatureC: Number(this.flameTemperatureC.toFixed(1)),
      thermalPowerWatts: Number(this.thermalPowerWatts.toFixed(1)),
    };
  }
}
