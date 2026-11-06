import { beforeEach, describe, expect, it } from 'vitest';
import { ReactionEngine } from '../core/chemistry/ReactionEngine';

describe('ChemStudio Headless First-Principles Chemistry Engine', () => {
  let engine: ReactionEngine;

  beforeEach(() => {
    engine = new ReactionEngine();
  });

  it('1. Halide & Sulphate Precipitation: Mixing 25 mL of 0.1 M BaCl2 with 25 mL of 0.1 M Na2SO4 precipitates 0.0025 mol (0.583 g) of white BaSO4 and leaves Na+ and Cl- in solution', () => {
    // Add 25 mL of 0.1 M BaCl2 -> 0.0025 mol Ba2+ and 0.0050 mol Cl-
    engine.addSolution('BaCl2', 25, 0.1);

    // Mix with 25 mL of 0.1 M Na2SO4 -> 0.0050 mol Na+ and 0.0025 mol SO4_2-
    const state = engine.addSolution('Na2SO4', 25, 0.1);

    expect(state.volumeMl).toBeCloseTo(50, 4);

    // Verify white BaSO4 precipitate formed
    const baSo4 = state.precipitates['BaSO4'];
    expect(baSo4).toBeDefined();
    expect(baSo4.moles).toBeCloseTo(0.0025, 5);
    expect(baSo4.massGrams).toBeCloseTo(0.583, 2); // 0.0025 * 233.387 = 0.5835 g
    expect(baSo4.colorHex).toBe('#F8FAFC');

    // Verify Ba2+ and SO4_2- are consumed while spectator Na+ and Cl- remain in solution
    expect(state.ionMoles['Ba2+']).toBeCloseTo(0, 6);
    expect(state.ionMoles['SO4_2-']).toBeCloseTo(0, 6);
    expect(state.ionMoles['Na+']).toBeCloseTo(0.005, 5);
    expect(state.ionMoles['Cl-']).toBeCloseTo(0.005, 5);
    expect(state.ionMolarities['Na+']).toBeCloseTo(0.1, 4);
    expect(state.ionMolarities['Cl-']).toBeCloseTo(0.1, 4);
  });

  it('2. Golden Rain Reaction: Mixing Pb(NO3)2 and KI precipitates stoichiometric PbI2 with hex #FACC15', () => {
    // 25 mL of 0.1 M Pb(NO3)2 -> 0.0025 mol Pb2+, 0.0050 mol NO3-
    engine.addSolution('Pb(NO3)2', 25, 0.1);

    // 50 mL of 0.1 M KI -> 0.0050 mol K+, 0.0050 mol I-
    const state = engine.addSolution('KI', 50, 0.1);

    const pbI2 = state.precipitates['PbI2'];
    expect(pbI2).toBeDefined();
    expect(pbI2.colorHex).toBe('#FACC15');
    expect(pbI2.moles).toBeCloseTo(0.0025, 5);
    expect(pbI2.massGrams).toBeCloseTo(0.0025 * 461.008, 3); // ~1.1525 g

    // Pb2+ and I- stoichiometrically consumed; K+ and NO3- remain as spectators
    expect(state.ionMoles['Pb2+']).toBeCloseTo(0, 6);
    expect(state.ionMoles['I-']).toBeCloseTo(0, 6);
    expect(state.ionMoles['K+']).toBeCloseTo(0.005, 5);
    expect(state.ionMoles['NO3-']).toBeCloseTo(0.005, 5);
  });

  it('3. Strong Acid-Base Titration & Exotherm: Mixing 50 mL of 1.0 M HCl with 50 mL of 1.0 M NaOH shifts pH from 0.0 to 7.0 and raises solution temperature by approximately 6.8 C', () => {
    // Initial 50 mL of 1.0 M HCl at 25.0 °C
    const acidState = engine.addSolution('HCl', 50, 1.0);
    expect(acidState.pH).toBeCloseTo(0.0, 2);
    expect(acidState.temperatureC).toBeCloseTo(25.0, 2);

    // Titrate with 50 mL of 1.0 M NaOH at 25.0 °C
    const neutralState = engine.addSolution('NaOH', 50, 1.0);

    // Continuous charge-balance pH shifts from 0.0 to 7.0
    expect(neutralState.pH).toBeCloseTo(7.0, 2);
    expect(neutralState.volumeMl).toBeCloseTo(100.0, 2);

    // Exothermic heat of neutralization:
    // n(H2O) = 0.05 mol, dH = -57.3 kJ/mol -> q = 2865 J
    // dT = 2865 / (100 g * 4.184 J/(g*C)) = +6.8475 °C (~6.8 °C)
    const deltaT = neutralState.temperatureC - 25.0;
    expect(deltaT).toBeCloseTo(6.85, 1);
    expect(neutralState.temperatureC).toBeCloseTo(31.85, 1);
  });

  it('4. Carbonate Effervescence: Adding HCl to Na2CO3 consumes CO3_2- and outputs evolved CO2 gas volume', () => {
    // 25 mL of 0.1 M Na2CO3 -> 0.0050 mol Na+, 0.0025 mol CO3_2-
    const initialCarbonate = engine.addSolution('Na2CO3', 25, 0.1);
    expect(initialCarbonate.ionMoles['CO3_2-']).toBeCloseTo(0.0025, 5);
    expect(initialCarbonate.totalEvolvedGasVolumeMl).toBe(0);

    // Add 50 mL of 0.1 M HCl -> 0.0050 mol H+, 0.0050 mol Cl-
    // Reaction: 2 H+ + CO3_2- -> H2O + CO2(g)
    const afterAcid = engine.addSolution('HCl', 50, 0.1);

    expect(afterAcid.ionMoles['CO3_2-']).toBeCloseTo(0, 6);
    expect(afterAcid.isEffervescing).toBe(true);
    expect(afterAcid.evolvedGases['CO2']).toBeDefined();
    expect(afterAcid.evolvedGases['CO2'].moles).toBeCloseTo(0.0025, 5);
    expect(afterAcid.totalEvolvedGasVolumeMl).toBeGreaterThan(55); // ~61.2 mL at 25C
  });

  it('5. Beer-Lambert Optical Blending & Transition Metal Hydroxide Precipitation', () => {
    // Clear NaCl solution has minimal baseline optical alpha
    const clearState = engine.addSolution('NaCl', 50, 0.1);
    expect(clearState.solutionColorRgba[3]).toBeLessThanOrEqual(0.1);

    // Reset and add blue CuSO4 solution
    engine.reset();
    const cuState = engine.addSolution('CuSO4', 50, 0.2);
    expect(cuState.solutionColorRgba[2]).toBeGreaterThan(cuState.solutionColorRgba[0]);
    expect(cuState.solutionColorRgba[3]).toBeGreaterThan(0.2);

    // Precipitate Cu(OH)2 with NaOH
    const pptState = engine.addSolution('NaOH', 50, 0.4);
    expect(pptState.precipitates['Cu(OH)2']).toBeDefined();
    expect(pptState.precipitates['Cu(OH)2'].colorHex).toBe('#0284C7');
    expect(pptState.ionMoles['Cu2+']).toBeCloseTo(0, 5);
  });
});
