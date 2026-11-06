export type PhysicalState = 'aqueous' | 'solid' | 'liquid' | 'gas';

export type CompoundCategory = 'acid' | 'base' | 'salt' | 'indicator';

/**
 * RGBA tuple where r, g, b are [0..255] and index 3 is molarExtinctionAlpha (or opacity [0..1] for final blended colors).
 */
export type ColorRgba = [number, number, number, number];

export interface IonDefinition {
  id: string;
  name: string;
  formula: string;
  charge: number;
  molarMass: number; // g/mol
  enthalpyGf: number; // kJ/mol
  colorRgba: ColorRgba; // [r, g, b, molarExtinctionAlpha]
}

export interface DissociationStep {
  ionId: string;
  coefficient: number;
}

export interface IndicatorSpec {
  pKa: number;
  transitionRange: [number, number];
  acidColorRgba: ColorRgba;
  baseColorRgba: ColorRgba;
}

export interface CompoundDefinition {
  id: string;
  name: string;
  formula: string;
  category: CompoundCategory;
  stateAt25C: PhysicalState;
  molarMass: number; // g/mol
  standardEnthalpyHf: number; // kJ/mol
  defaultMolarity?: number; // mol/L
  dissociation: DissociationStep[];
  indicatorSpec?: IndicatorSpec;
}

export interface PrecipitationRule {
  id: string;
  name: string;
  formula: string;
  cationId: string;
  cationCoeff: number;
  anionId: string;
  anionCoeff: number;
  ksp: number;
  molarMass: number; // g/mol
  enthalpyFormationKjMol?: number; // kJ/mol
  colorHex: string;
  appearance: string;
}

export interface GasEquilibriumRule {
  id: string;
  name: string;
  equation: string;
  reactants: DissociationStep[];
  gasFormula: string;
  gasMolarMass: number;
  henrysLawConstantMolPerLAtm: number;
  enthalpyReactionKjMol: number;
}

export interface ReactionsDatabase {
  precipitations: PrecipitationRule[];
  gasEquilibria: GasEquilibriumRule[];
}

export interface PrecipitateRecord {
  id: string;
  name: string;
  formula: string;
  moles: number;
  massGrams: number;
  colorHex: string;
  appearance: string;
}

export interface EvolvedGasRecord {
  id: string;
  formula: string;
  moles: number;
  volumeMl: number;
  massGrams: number;
}

export interface ReactionLogEntry {
  id: string;
  timestampMs: number;
  equation: string;
  type: 'dissociation' | 'precipitation' | 'neutralization' | 'gas_evolution' | 'redox';
  deltaEnthalpyKj: number;
  deltaTempC: number;
  details: string;
}

export interface VesselState {
  volumeMl: number;
  volumeLiters: number;
  solutionMassGrams: number;
  temperatureC: number;
  pH: number;
  pOH: number;
  hPlusConcentration: number; // mol/L
  ohMinusConcentration: number; // mol/L
  ionicStrength: number; // mol/L
  solutionColorRgba: ColorRgba; // [r, g, b, alpha (0..1)]
  solutionColorCss: string;
  ionMoles: Record<string, number>;
  ionMolarities: Record<string, number>;
  precipitates: Record<string, PrecipitateRecord>;
  evolvedGases: Record<string, EvolvedGasRecord>;
  totalEvolvedGasMoles: number;
  totalEvolvedGasVolumeMl: number;
  isEffervescing: boolean;
  activeIndicators: string[];
  cumulativeEnthalpyKj: number;
  reactionLog: ReactionLogEntry[];
}
