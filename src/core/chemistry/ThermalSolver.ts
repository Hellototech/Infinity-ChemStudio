import { PrecipitationRule } from './types';

export interface ThermalStepInput {
  previousVolumeMl: number;
  addedVolumeMl: number;
  currentTemperatureC: number;
  reagentTemperatureC?: number;
  waterFormedMoles: number;
  precipitatesFormed: Array<{ rule: PrecipitationRule; moles: number }>;
}

export interface ThermalStepResult {
  newTemperatureC: number;
  deltaTempC: number;
  deltaEnthalpyKj: number;
  heatReleasedJoules: number;
}

/**
 * Thermodynamics solver computing standard reaction enthalpy (dH_rxn) and
 * vessel temperature delta via q = m * cp * dT.
 */
export class ThermalSolver {
  public static readonly SPECIFIC_HEAT_WATER_J_G_C = 4.184;
  public static readonly ENTHALPY_NEUTRALIZATION_KJ_MOL = -57.3; // H+(aq) + OH-(aq) -> H2O(l)
  public static readonly AMBIENT_TEMP_C = 25.0;

  public solve(input: ThermalStepInput): ThermalStepResult {
    const {
      previousVolumeMl,
      addedVolumeMl,
      currentTemperatureC,
      reagentTemperatureC = ThermalSolver.AMBIENT_TEMP_C,
      waterFormedMoles,
      precipitatesFormed,
    } = input;

    const totalVolumeMl = previousVolumeMl + addedVolumeMl;
    if (totalVolumeMl <= 1e-9) {
      return {
        newTemperatureC: ThermalSolver.AMBIENT_TEMP_C,
        deltaTempC: 0,
        deltaEnthalpyKj: 0,
        heatReleasedJoules: 0,
      };
    }

    // 1. Thermal mixing of existing solution at T1 and added reagent at T2
    const mixedTempC =
      previousVolumeMl > 1e-9
        ? (previousVolumeMl * currentTemperatureC + addedVolumeMl * reagentTemperatureC) /
          totalVolumeMl
        : reagentTemperatureC;

    // 2. Reaction enthalpy dH_rxn (kJ)
    // Neutralization: H+ + OH- -> H2O (dH = -57.3 kJ/mol)
    let deltaEnthalpyKj =
      waterFormedMoles * ThermalSolver.ENTHALPY_NEUTRALIZATION_KJ_MOL;

    // Precipitate formation enthalpy contribution
    for (const ppt of precipitatesFormed) {
      if (typeof ppt.rule.enthalpyFormationKjMol === 'number') {
        deltaEnthalpyKj += ppt.moles * ppt.rule.enthalpyFormationKjMol;
      }
    }

    // 3. Apply calorimetry equation: q = -dH_rxn (in Joules) = m * cp * dT
    // Using aqueous solution mass m = totalVolumeMl * 1.0 g/mL and cp = 4.184 J/(g*C)
    const solutionMassGrams = totalVolumeMl * 1.0;
    const heatReleasedJoules = -deltaEnthalpyKj * 1000;
    const deltaTempC =
      heatReleasedJoules /
      (solutionMassGrams * ThermalSolver.SPECIFIC_HEAT_WATER_J_G_C);

    const newTemperatureC = mixedTempC + deltaTempC;

    return {
      newTemperatureC: Number(newTemperatureC.toFixed(4)),
      deltaTempC: Number(deltaTempC.toFixed(4)),
      deltaEnthalpyKj: Number(deltaEnthalpyKj.toFixed(4)),
      heatReleasedJoules: Number(heatReleasedJoules.toFixed(2)),
    };
  }

  /**
   * Optional Newton's Law of Cooling pass for real-time 60fps simulation loop
   * when thermal relaxation toward ambient or active Bunsen burner heating is enabled.
   */
  public stepAmbientRelaxation(
    currentTempC: number,
    targetTempC: number,
    dtSeconds: number,
    coolingRatePerSec: number = 0.015
  ): number {
    const diff = targetTempC - currentTempC;
    if (Math.abs(diff) < 0.001) return targetTempC;
    return currentTempC + diff * Math.min(1, coolingRatePerSec * dtSeconds);
  }
}
