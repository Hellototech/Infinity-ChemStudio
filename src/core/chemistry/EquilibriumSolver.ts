import { IonPool } from './IonPool';
import {
  EvolvedGasRecord,
  GasEquilibriumRule,
  PrecipitateRecord,
  PrecipitationRule,
  ReactionLogEntry,
} from './types';

export interface EquilibriumStepResult {
  waterFormedMoles: number;
  precipitatesFormed: Array<{ rule: PrecipitationRule; moles: number; massGrams: number }>;
  gasEvolved: Array<{ rule: GasEquilibriumRule; moles: number; volumeMl: number }>;
  logs: ReactionLogEntry[];
}

/**
 * Dynamic Ksp precipitation, gas evolution (carbonate effervescence),
 * strong acid-base neutralization stoichiometry, and redox pass.
 */
export class EquilibriumSolver {
  private precipitationRules: PrecipitationRule[] = [];
  private gasRules: GasEquilibriumRule[] = [];

  constructor(
    precipitationRules: PrecipitationRule[] = [],
    gasRules: GasEquilibriumRule[] = []
  ) {
    // Sort precipitation rules by ascending Ksp (least soluble precipitates first)
    this.precipitationRules = [...precipitationRules].sort((a, b) => a.ksp - b.ksp);
    this.gasRules = [...gasRules];
  }

  public setRules(
    precipitationRules: PrecipitationRule[],
    gasRules: GasEquilibriumRule[]
  ): void {
    this.precipitationRules = [...precipitationRules].sort((a, b) => a.ksp - b.ksp);
    this.gasRules = [...gasRules];
  }

  public solve(
    ionPool: IonPool,
    precipitates: Map<string, PrecipitateRecord>,
    evolvedGases: Map<string, EvolvedGasRecord>,
    temperatureC: number
  ): EquilibriumStepResult {
    const result: EquilibriumStepResult = {
      waterFormedMoles: 0,
      precipitatesFormed: [],
      gasEvolved: [],
      logs: [],
    };

    const volL = ionPool.getVolumeLiters();
    if (volL <= 1e-9) {
      return result;
    }

    // 1. Strong Acid-Base Neutralization Pass: H+(aq) + OH-(aq) -> H2O(l)
    // Autoionization baseline at 25C is 1e-7 M. Any coexistence significantly above 1e-6 M reacts.
    const nH = ionPool.getMoles('H+');
    const nOH = ionPool.getMoles('OH-');
    const baselineAutoionizationMoles = 1e-7 * volL;

    if (nH > baselineAutoionizationMoles * 10 && nOH > baselineAutoionizationMoles * 10) {
      const neutralizedMoles = Math.min(nH, nOH);
      if (neutralizedMoles > 1e-9) {
        ionPool.addMoles('H+', -neutralizedMoles);
        ionPool.addMoles('OH-', -neutralizedMoles);
        result.waterFormedMoles += neutralizedMoles;

        result.logs.push({
          id: `neut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestampMs: Date.now(),
          equation: 'H⁺(aq) + OH⁻(aq) → H₂O(l)',
          type: 'neutralization',
          deltaEnthalpyKj: neutralizedMoles * -57.3,
          deltaTempC: 0,
          details: `Neutralized ${neutralizedMoles.toFixed(4)} mol H₂O`,
        });
      }
    }

    // 2. Gas Evolution Pass: 2 H+(aq) + CO3_2-(aq) -> H2O(l) + CO2(g)
    for (const gasRule of this.gasRules) {
      if (gasRule.id === 'CO2_EVOLUTION') {
        const currentH = ionPool.getMoles('H+');
        const currentCO3 = ionPool.getMoles('CO3_2-');

        if (currentH > 1e-6 * volL && currentCO3 > 1e-9) {
          // Exact stoichiometric limiting reagent for 2 H+ + 1 CO3_2- -> H2O + CO2(g)
          const extentMoles = Math.min(currentH / 2, currentCO3);

          if (extentMoles > 1e-9) {
            ionPool.addMoles('H+', -2 * extentMoles);
            ionPool.addMoles('CO3_2-', -extentMoles);

            // Ideal gas molar volume V = n * R * T / P (in mL at 1 atm)
            const R = 0.082057366; // L*atm/(mol*K)
            const tempK = temperatureC + 273.15;
            const gasVolumeMl = extentMoles * R * tempK * 1000;
            const gasMassGrams = extentMoles * gasRule.gasMolarMass;

            const existingGas = evolvedGases.get('CO2') ?? {
              id: 'CO2',
              formula: gasRule.gasFormula,
              moles: 0,
              volumeMl: 0,
              massGrams: 0,
            };

            existingGas.moles += extentMoles;
            existingGas.volumeMl += gasVolumeMl;
            existingGas.massGrams += gasMassGrams;
            evolvedGases.set('CO2', existingGas);

            result.gasEvolved.push({
              rule: gasRule,
              moles: extentMoles,
              volumeMl: gasVolumeMl,
            });

            result.logs.push({
              id: `gas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestampMs: Date.now(),
              equation: gasRule.equation,
              type: 'gas_evolution',
              deltaEnthalpyKj: extentMoles * gasRule.enthalpyReactionKjMol,
              deltaTempC: 0,
              details: `Evolved ${gasVolumeMl.toFixed(1)} mL (${extentMoles.toFixed(4)} mol) CO₂(g)`,
            });
          }
        }
      }
    }

    // 3. Dynamic Ksp Precipitation Pass
    for (const rule of this.precipitationRules) {
      const nCation = ionPool.getMoles(rule.cationId);
      const nAnion = ionPool.getMoles(rule.anionId);

      const concCation = nCation / volL;
      const concAnion = nAnion / volL;

      // Require macroscopic reagent concentration (> 1e-5 M) so pure water autoionization
      // ([OH-] = 1e-7 M) does not trigger spurious nanogram hydroxide precipitates
      if (concCation <= 1e-5 || concAnion <= 1e-5) {
        continue;
      }

      const reactionQuotientQ =
        Math.pow(concCation, rule.cationCoeff) * Math.pow(concAnion, rule.anionCoeff);

      if (reactionQuotientQ > rule.ksp) {
        // Compute exact stoichiometric limiting reagent
        const limitingMoles = Math.min(
          nCation / rule.cationCoeff,
          nAnion / rule.anionCoeff
        );

        if (limitingMoles > 1e-9) {
          ionPool.addMoles(rule.cationId, -rule.cationCoeff * limitingMoles);
          ionPool.addMoles(rule.anionId, -rule.anionCoeff * limitingMoles);

          const massGrams = limitingMoles * rule.molarMass;
          const existingPrecip = precipitates.get(rule.id) ?? {
            id: rule.id,
            name: rule.name,
            formula: rule.formula,
            moles: 0,
            massGrams: 0,
            colorHex: rule.colorHex,
            appearance: rule.appearance,
          };

          existingPrecip.moles += limitingMoles;
          existingPrecip.massGrams += massGrams;
          precipitates.set(rule.id, existingPrecip);

          result.precipitatesFormed.push({
            rule,
            moles: limitingMoles,
            massGrams,
          });

          const cationFormula =
            ionPool.getIonDefinition(rule.cationId)?.formula ?? rule.cationId;
          const anionFormula =
            ionPool.getIonDefinition(rule.anionId)?.formula ?? rule.anionId;
          const cPrefix = rule.cationCoeff > 1 ? `${rule.cationCoeff} ` : '';
          const aPrefix = rule.anionCoeff > 1 ? `${rule.anionCoeff} ` : '';

          result.logs.push({
            id: `ppt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestampMs: Date.now(),
            equation: `${cPrefix}${cationFormula}(aq) + ${aPrefix}${anionFormula}(aq) → ${rule.formula}`,
            type: 'precipitation',
            deltaEnthalpyKj: limitingMoles * (rule.enthalpyFormationKjMol ?? 0),
            deltaTempC: 0,
            details: `Precipitated ${massGrams.toFixed(3)} g (${limitingMoles.toFixed(4)} mol) ${rule.id}`,
          });
        }
      }
    }

    // 4. Acidic Permanganate - Iron(II) Redox Pass:
    // MnO4- + 5 Fe2+ + 8 H+ -> Mn2+ (colorless) + 5 Fe3+ + 4 H2O
    const nMnO4 = ionPool.getMoles('MnO4-');
    const nFe2 = ionPool.getMoles('Fe2+');
    const nHRedox = ionPool.getMoles('H+');
    if (nMnO4 > 1e-7 && nFe2 > 1e-7 && nHRedox > 1e-6) {
      const extentRedox = Math.min(nMnO4, nFe2 / 5, nHRedox / 8);
      if (extentRedox > 1e-8) {
        ionPool.addMoles('MnO4-', -extentRedox);
        ionPool.addMoles('Fe2-', 0); // safety no-op
        ionPool.addMoles('Fe2+', -5 * extentRedox);
        ionPool.addMoles('H+', -8 * extentRedox);
        ionPool.addMoles('Fe3+', 5 * extentRedox);

        result.logs.push({
          id: `redox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestampMs: Date.now(),
          equation: 'MnO₄⁻(aq) + 5 Fe²⁺(aq) + 8 H⁺(aq) → Mn²⁺(aq) + 5 Fe³⁺(aq) + 4 H₂O(l)',
          type: 'redox',
          deltaEnthalpyKj: extentRedox * -121.0,
          deltaTempC: 0,
          details: `Oxidized ${(5 * extentRedox).toFixed(4)} mol Fe²⁺ to Fe³⁺`,
        });
      }
    }

    return result;
  }
}
