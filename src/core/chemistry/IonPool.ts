import { ColorRgba, CompoundDefinition, IonDefinition } from './types';

/**
 * Tracks aqueous ion moles, solution volume, dissolved mass, and computes
 * composite solution color via a Beer-Lambert law logarithmic optical density model.
 */
export class IonPool {
  private ionDefinitions: Map<string, IonDefinition> = new Map();
  private ionMoles: Map<string, number> = new Map();
  private volumeMl: number = 0;
  private dissolvedSolidMassGrams: number = 0;

  constructor(ions: IonDefinition[] = []) {
    this.registerIons(ions);
  }

  public registerIons(ions: IonDefinition[]): void {
    for (const ion of ions) {
      this.ionDefinitions.set(ion.id, ion);
      if (!this.ionMoles.has(ion.id)) {
        this.ionMoles.set(ion.id, 0);
      }
    }
  }

  public getIonDefinition(ionId: string): IonDefinition | undefined {
    return this.ionDefinitions.get(ionId);
  }

  public getAllIonDefinitions(): IonDefinition[] {
    return Array.from(this.ionDefinitions.values());
  }

  public getVolumeMl(): number {
    return this.volumeMl;
  }

  public getVolumeLiters(): number {
    return this.volumeMl / 1000;
  }

  public getSolutionMassGrams(): number {
    // Aqueous solution density approximation: 1.0 g/mL + dissolved solids
    return this.volumeMl * 1.0 + this.dissolvedSolidMassGrams;
  }

  public addVolumeMl(deltaVolumeMl: number): void {
    if (deltaVolumeMl < 0) {
      throw new Error(`Cannot add negative volume: ${deltaVolumeMl} mL`);
    }
    this.volumeMl += deltaVolumeMl;
  }

  public setVolumeMl(newVolumeMl: number): void {
    this.volumeMl = Math.max(0, newVolumeMl);
  }

  /**
   * Decrements aqueous liquid volume due to boiling/evaporation while preserving
   * non-volatile dissolved solute ion moles (thereby concentrating molarity).
   */
  public evaporateWaterMl(evaporatedMl: number): number {
    if (evaporatedMl <= 0 || this.volumeMl <= 0) return 0;
    const actualRemovedMl = Math.min(this.volumeMl, evaporatedMl);
    this.volumeMl = Math.max(0, this.volumeMl - actualRemovedMl);
    return actualRemovedMl;
  }

  public getMoles(ionId: string): number {
    return this.ionMoles.get(ionId) ?? 0;
  }

  public setMoles(ionId: string, moles: number): void {
    this.ionMoles.set(ionId, Math.max(0, moles));
  }

  public addMoles(ionId: string, deltaMoles: number): void {
    const current = this.getMoles(ionId);
    this.ionMoles.set(ionId, Math.max(0, current + deltaMoles));
  }

  public getMolarity(ionId: string): number {
    const volL = this.getVolumeLiters();
    if (volL <= 1e-9) return 0;
    return this.getMoles(ionId) / volL;
  }

  public getAllIonMoles(): Record<string, number> {
    const record: Record<string, number> = {};
    for (const [id, moles] of this.ionMoles.entries()) {
      record[id] = moles;
    }
    return record;
  }

  public getAllIonMolarities(): Record<string, number> {
    const record: Record<string, number> = {};
    const volL = this.getVolumeLiters();
    for (const [id, moles] of this.ionMoles.entries()) {
      record[id] = volL > 1e-9 ? moles / volL : 0;
    }
    return record;
  }

  /**
   * Adds V (mL) of an aqueous compound solution of molarity M (mol/L).
   * Updates solution volume and increments dissociated constituent ion moles.
   */
  public addAqueousCompound(
    compound: CompoundDefinition,
    volumeMl: number,
    molarity: number
  ): number {
    if (volumeMl <= 0 || molarity < 0) return 0;
    const volumeL = volumeMl / 1000;
    const compoundMoles = molarity * volumeL;

    this.addVolumeMl(volumeMl);

    for (const step of compound.dissociation) {
      this.addMoles(step.ionId, compoundMoles * step.coefficient);
    }

    return compoundMoles;
  }

  /**
   * Adds massGrams (g) of a solid compound directly into the solution.
   * Updates dissolved mass (and minimal volume if dry) and increments constituent ion moles.
   */
  public addSolidCompound(
    compound: CompoundDefinition,
    massGrams: number
  ): number {
    if (massGrams <= 0 || compound.molarMass <= 0) return 0;
    const compoundMoles = massGrams / compound.molarMass;
    this.dissolvedSolidMassGrams += massGrams;

    for (const step of compound.dissociation) {
      this.addMoles(step.ionId, compoundMoles * step.coefficient);
    }

    return compoundMoles;
  }

  /**
   * Computes ionic strength I = 0.5 * sum(c_i * z_i^2)
   */
  public getIonicStrength(): number {
    const volL = this.getVolumeLiters();
    if (volL <= 1e-9) return 0;
    let sum = 0;
    for (const [ionId, moles] of this.ionMoles.entries()) {
      if (moles <= 0) continue;
      const def = this.ionDefinitions.get(ionId);
      if (!def) continue;
      const c = moles / volL;
      sum += c * (def.charge * def.charge);
    }
    return 0.5 * sum;
  }

  /**
   * Beer-Lambert Law optical density blending:
   * Absorbance A_c = sum_i (epsilon_i * C_i * pathLength * (1 - rgb_i / 255))
   * Transmittance T_c = 10^(-A_c)
   * Composite opacity alpha = 1 - 10^(-sum_i (epsilon_i * C_i * pathLength))
   */
  public computeBeerLambertColor(indicatorColor?: ColorRgba | null): ColorRgba {
    const volL = this.getVolumeLiters();
    if (volL <= 1e-9) {
      return [226, 232, 240, 0.0];
    }

    const pathLengthCm = 1.5; // Optical path scale factor
    let totalOpticalDensity = 0;
    let absR = 0;
    let absG = 0;
    let absB = 0;

    for (const [ionId, moles] of this.ionMoles.entries()) {
      if (moles <= 1e-9) continue;
      const def = this.ionDefinitions.get(ionId);
      if (!def) continue;

      const [r, g, b, extinctionAlpha] = def.colorRgba;
      if (extinctionAlpha <= 0) continue;

      const molarity = moles / volL;
      // Logarithmic compression of extreme molarities + linear Beer-Lambert regime
      const effectiveConcentration = Math.log1p(molarity * 4) / 4;
      const od = extinctionAlpha * effectiveConcentration * pathLengthCm;

      totalOpticalDensity += od;
      absR += od * (1 - r / 255);
      absG += od * (1 - g / 255);
      absB += od * (1 - b / 255);
    }

    // Include active indicator optical density if present
    if (indicatorColor && indicatorColor[3] > 0.01) {
      const [ir, ig, ib, ialpha] = indicatorColor;
      const indOd = -Math.log10(Math.max(0.05, 1 - Math.min(0.92, ialpha)));
      totalOpticalDensity += indOd;
      absR += indOd * (1 - ir / 255);
      absG += indOd * (1 - ig / 255);
      absB += indOd * (1 - ib / 255);
    }

    if (totalOpticalDensity <= 1e-5) {
      // Clear aqueous solution (water baseline)
      return [226, 232, 240, 0.08];
    }

    const transR = Math.pow(10, -absR);
    const transG = Math.pow(10, -absG);
    const transB = Math.pow(10, -absB);

    const finalR = Math.round(Math.max(0, Math.min(255, transR * 255)));
    const finalG = Math.round(Math.max(0, Math.min(255, transG * 255)));
    const finalB = Math.round(Math.max(0, Math.min(255, transB * 255)));

    // Beer-Lambert total opacity (clamped between 0.12 and 0.92 for liquid rendering)
    const rawOpacity = 1 - Math.pow(10, -totalOpticalDensity);
    const finalAlpha = Number(Math.max(0.12, Math.min(0.92, rawOpacity)).toFixed(3));

    return [finalR, finalG, finalB, finalAlpha];
  }

  public computeSolutionColor(indicatorColor?: ColorRgba | null): ColorRgba {
    return this.computeBeerLambertColor(indicatorColor);
  }

  public reset(): void {
    this.volumeMl = 0;
    this.dissolvedSolidMassGrams = 0;
    for (const key of this.ionMoles.keys()) {
      this.ionMoles.set(key, 0);
    }
  }
}
