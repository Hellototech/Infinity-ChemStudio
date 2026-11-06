import { IonPool } from './IonPool';
import { ColorRgba, CompoundDefinition } from './types';

export interface AcidBaseSolution {
  pH: number;
  pOH: number;
  hPlusConcentration: number;
  ohMinusConcentration: number;
  indicatorColorRgba: ColorRgba | null;
}

/**
 * Solves continuous charge-balance electroneutrality in water (Kw = 1e-14 at 25C):
 * [H+] - [OH-] + sum(charge_i * Concentration_i) = 0
 * and interpolates active pH indicator colors across their transition ranges.
 */
export class AcidBaseSolver {
  private static readonly KW_25C = 1.0e-14;
  private static readonly KB_CARBONATE = 2.1e-4; // CO3_2- + H2O <-> HCO3- + OH-

  public solve(
    ionPool: IonPool,
    activeIndicatorDefs: CompoundDefinition[] = []
  ): AcidBaseSolution {
    const volL = ionPool.getVolumeLiters();
    if (volL <= 1e-9) {
      return {
        pH: 7.0,
        pOH: 7.0,
        hPlusConcentration: 1.0e-7,
        ohMinusConcentration: 1.0e-7,
        indicatorColorRgba: null,
      };
    }

    // Compute net non-water charge concentration: sigma = sum_{i != H+, OH-} (charge_i * [Ion_i])
    let sigma = 0;
    for (const ionDef of ionPool.getAllIonDefinitions()) {
      if (ionDef.id === 'H+' || ionDef.id === 'OH-') {
        continue;
      }
      const conc = ionPool.getMolarity(ionDef.id);
      sigma += ionDef.charge * conc;
    }

    const kw = AcidBaseSolver.KW_25C;
    let hPlus: number;
    let ohMinus: number;

    // Numerically stable quadratic root for [H+]^2 + sigma * [H+] - Kw = 0
    if (sigma <= 0) {
      hPlus = (-sigma + Math.sqrt(sigma * sigma + 4 * kw)) / 2;
      ohMinus = kw / hPlus;
    } else {
      ohMinus = (sigma + Math.sqrt(sigma * sigma + 4 * kw)) / 2;
      hPlus = kw / ohMinus;
    }

    // Sync equilibrium [H+] and [OH-] back to the IonPool
    ionPool.setMoles('H+', hPlus * volL);
    ionPool.setMoles('OH-', ohMinus * volL);

    const rawPh = -Math.log10(Math.max(1e-16, hPlus));
    const rawPoh = -Math.log10(Math.max(1e-16, ohMinus));

    const pH = Object.is(rawPh, -0) ? 0 : Number(rawPh.toFixed(4));
    const pOH = Object.is(rawPoh, -0) ? 0 : Number(rawPoh.toFixed(4));

    const indicatorColorRgba = this.computeIndicatorColor(pH, activeIndicatorDefs);

    return {
      pH,
      pOH,
      hPlusConcentration: hPlus,
      ohMinusConcentration: ohMinus,
      indicatorColorRgba,
    };
  }

  /**
   * Smoothly interpolates active acid-base indicator colors across their pKa transition range.
   */
  public computeIndicatorColor(
    pH: number,
    indicators: CompoundDefinition[]
  ): ColorRgba | null {
    if (!indicators || indicators.length === 0) {
      return null;
    }

    // Use the most recently added indicator or composite
    const active = indicators[indicators.length - 1];
    if (active.id === 'universal') {
      return this.computeUniversalIndicatorColor(pH);
    }

    const spec = active.indicatorSpec;
    if (!spec) return null;

    const [pHLow, pHHigh] = spec.transitionRange;
    const t = Math.max(0, Math.min(1, (pH - pHLow) / Math.max(0.1, pHHigh - pHLow)));
    // Smoothstep interpolation
    const smoothT = t * t * (3 - 2 * t);

    const r = Math.round(
      spec.acidColorRgba[0] + (spec.baseColorRgba[0] - spec.acidColorRgba[0]) * smoothT
    );
    const g = Math.round(
      spec.acidColorRgba[1] + (spec.baseColorRgba[1] - spec.acidColorRgba[1]) * smoothT
    );
    const b = Math.round(
      spec.acidColorRgba[2] + (spec.baseColorRgba[2] - spec.acidColorRgba[2]) * smoothT
    );
    const a = Number(
      (
        spec.acidColorRgba[3] +
        (spec.baseColorRgba[3] - spec.acidColorRgba[3]) * smoothT
      ).toFixed(3)
    );

    return [r, g, b, a];
  }

  private computeUniversalIndicatorColor(pH: number): ColorRgba {
    // Classic Universal Indicator spectrum:
    // pH <= 3: Red [239, 68, 68]
    // pH 5: Orange/Amber [245, 158, 11]
    // pH 7: Emerald Green [16, 185, 129]
    // pH 9: Cyan/Blue [14, 165, 233]
    // pH >= 11: Deep Violet [139, 92, 246]
    const stops: Array<{ pH: number; rgb: [number, number, number] }> = [
      { pH: 2.0, rgb: [239, 68, 68] },
      { pH: 5.0, rgb: [245, 158, 11] },
      { pH: 7.0, rgb: [16, 185, 129] },
      { pH: 9.5, rgb: [14, 165, 233] },
      { pH: 12.0, rgb: [139, 92, 246] },
    ];

    const clamped = Math.max(stops[0].pH, Math.min(stops[stops.length - 1].pH, pH));
    for (let i = 0; i < stops.length - 1; i++) {
      const curr = stops[i];
      const next = stops[i + 1];
      if (clamped >= curr.pH && clamped <= next.pH) {
        const ratio = (clamped - curr.pH) / (next.pH - curr.pH);
        const r = Math.round(curr.rgb[0] + (next.rgb[0] - curr.rgb[0]) * ratio);
        const g = Math.round(curr.rgb[1] + (next.rgb[1] - curr.rgb[1]) * ratio);
        const b = Math.round(curr.rgb[2] + (next.rgb[2] - curr.rgb[2]) * ratio);
        return [r, g, b, 0.72];
      }
    }

    return [16, 185, 129, 0.72];
  }
}
