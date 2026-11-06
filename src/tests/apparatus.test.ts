import { beforeEach, describe, expect, it } from 'vitest';
import { Vessel } from '../core/apparatus/Vessel';
import { WorkbenchState } from '../core/apparatus/WorkbenchState';

describe('Infinity ChemStudio Phase 2: Headless Apparatus, Pouring Physics & Thermal Transfer', () => {
  let workbench: WorkbenchState;

  beforeEach(() => {
    workbench = new WorkbenchState();
  });

  it('1. Spout Matrix Math: Tilting a 250 mL beaker by +45 degrees accurately rotates its right spout lip into world coordinates', () => {
    const beaker = new Vessel({
      id: 'beaker_test',
      type: 'beaker_250',
      x: 200,
      y: 300,
      rotationRad: 0,
    });

    // At 0 deg, right spout offset is [40, -55] -> world (240, 245)
    const initialSpout = beaker.getWorldSpoutPosition();
    expect(initialSpout.x).toBeCloseTo(240, 5);
    expect(initialSpout.y).toBeCloseTo(245, 5);

    // Tilt by +45 degrees (+pi/4 radians)
    beaker.setRotationDeg(45);
    const rotatedRightSpout = beaker.getWorldSpoutPosition();

    // 2D Rotation matrix for local (40, -55) by +45 deg:
    // dx = 40 * cos(45°) - (-55) * sin(45°) = 95 * sqrt(2)/2 ≈ 67.175144
    // dy = 40 * sin(45°) + (-55) * cos(45°) = -15 * sqrt(2)/2 ≈ -10.606602
    const cos45 = Math.SQRT1_2;
    const expectedX = 200 + (40 * cos45 - -55 * cos45);
    const expectedY = 300 + (40 * cos45 + -55 * cos45);

    expect(rotatedRightSpout.x).toBeCloseTo(expectedX, 5);
    expect(rotatedRightSpout.y).toBeCloseTo(expectedY, 5);

    // Tilt left by -45 degrees (-pi/4 radians) -> uses left spout [-40, -55]
    beaker.setRotationDeg(-45);
    const rotatedLeftSpout = beaker.getWorldSpoutPosition();
    const expectedLeftX = 200 + (-40 * cos45 - -55 * -cos45);
    const expectedLeftY = 300 + (-40 * -cos45 + -55 * cos45);

    expect(rotatedLeftSpout.x).toBeCloseTo(expectedLeftX, 5);
    expect(rotatedLeftSpout.y).toBeCloseTo(expectedLeftY, 5);
  });

  it('2. Conservation of Mass During Pouring: Tilting Beaker A (100 mL of 0.2 M AgNO3) over Beaker B (100 mL of 0.2 M NaCl) for 3 simulated seconds transfers volume, conserves total moles of Ag+ and Na+ across both beakers to within 1e-9, and precipitates AgCl inside Beaker B', () => {
    // Beaker A positioned above and slightly left of Beaker B so its tilted right spout
    // aligns directly over Beaker B's mouth opening [x - 40, x + 40].
    const beakerA = workbench.addVessel({
      id: 'beaker_A',
      type: 'beaker_250',
      x: 200,
      y: 120,
    });
    const beakerB = workbench.addVessel({
      id: 'beaker_B',
      type: 'beaker_250',
      x: 265,
      y: 280,
    });

    // Populate initial solutions:
    // Beaker A: 100 mL of 0.2 M AgNO3 -> 0.020 mol Ag+, 0.020 mol NO3-
    beakerA.addSolution('AgNO3', 100, 0.2);
    // Beaker B: 100 mL of 0.2 M NaCl -> 0.020 mol Na+, 0.020 mol Cl-
    beakerB.addSolution('NaCl', 100, 0.2);

    const initialTotalAg =
      beakerA.getTotalConservedIonMoles('Ag+') +
      beakerB.getTotalConservedIonMoles('Ag+');
    const initialTotalNa =
      beakerA.getTotalConservedIonMoles('Na+') +
      beakerB.getTotalConservedIonMoles('Na+');

    expect(initialTotalAg).toBeCloseTo(0.02, 10);
    expect(initialTotalNa).toBeCloseTo(0.02, 10);

    // Tilt Beaker A by +75 degrees so it pours steadily into Beaker B
    beakerA.setRotationDeg(75);

    // Verify raycast hits Beaker B before stepping
    const raycastCheck = workbench
      .getPourPhysics()
      .findTargetVessel(beakerA, workbench.getAllVessels());
    expect(raycastCheck.target?.id).toBe('beaker_B');

    // Run for 3 simulated seconds at 60 ticks per second (180 ticks)
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
      workbench.tick(dt);
    }

    // Verify volume was transferred from Beaker A to Beaker B
    expect(beakerA.currentVolumeMl).toBeLessThan(100);
    expect(beakerB.currentVolumeMl).toBeGreaterThan(100);
    expect(beakerA.currentVolumeMl + beakerB.currentVolumeMl).toBeCloseTo(200, 8);

    // Verify total moles of Ag+ (dissolved + precipitated as AgCl) and Na+ are conserved within 1e-9
    const finalTotalAg =
      beakerA.getTotalConservedIonMoles('Ag+') +
      beakerB.getTotalConservedIonMoles('Ag+');
    const finalTotalNa =
      beakerA.getTotalConservedIonMoles('Na+') +
      beakerB.getTotalConservedIonMoles('Na+');

    expect(Math.abs(finalTotalAg - initialTotalAg)).toBeLessThan(1e-9);
    expect(Math.abs(finalTotalNa - initialTotalNa)).toBeLessThan(1e-9);

    // Verify AgCl precipitated inside Beaker B
    const stateB = beakerB.getChemistryState();
    const agCl = stateB.precipitates['AgCl'];
    expect(agCl).toBeDefined();
    expect(agCl.moles).toBeGreaterThan(0.005);
    expect(agCl.colorHex).toBe('#F8FAFC');

    // Exact stoichiometric balance: remaining Ag+ in A + precipitated AgCl in B == 0.020 mol
    expect(beakerA.getIonMoles('Ag+') + agCl.moles).toBeCloseTo(0.02, 9);
  });

  it('3. Thermal Mixing & Heating: Pouring 50 mL of 80C water into 50 mL of 20C water equilibrates to 50.0C, and placing a beaker over a roaring blue Bunsen burner raises temperature to 100C and concentrates solute molarity via evaporation', () => {
    // Part A: Thermal Mixing of 50 mL @ 80C into 50 mL @ 20C
    const hotBeaker = workbench.addVessel({
      id: 'hot_beaker',
      type: 'beaker_250',
      x: 100,
      y: 100,
    });
    const coldBeaker = workbench.addVessel({
      id: 'cold_beaker',
      type: 'beaker_250',
      x: 165,
      y: 260,
    });

    hotBeaker.addWater(50, 80.0);
    coldBeaker.addWater(50, 20.0);

    expect(hotBeaker.temperatureC).toBeCloseTo(80.0, 4);
    expect(coldBeaker.temperatureC).toBeCloseTo(20.0, 4);

    // Transfer the full 50 mL slice from hotBeaker into coldBeaker
    workbench.getPourPhysics().transferSlice(hotBeaker, coldBeaker, 50, 1.0);

    expect(hotBeaker.currentVolumeMl).toBeCloseTo(0, 5);
    expect(coldBeaker.currentVolumeMl).toBeCloseTo(100, 5);
    expect(coldBeaker.temperatureC).toBeCloseTo(50.0, 4);

    // Part B: Roaring Blue Bunsen Burner Heating to 100C & Solute Concentration via Evaporation
    const heatedBeaker = workbench.addVessel({
      id: 'heated_beaker',
      type: 'beaker_250',
      x: 400,
      y: 200,
    });
    // Add 50 mL of 0.20 M NaCl at 25C
    heatedBeaker.addSolution('NaCl', 50, 0.2, 25.0);
    const initialMolarity = heatedBeaker.getIonMolarity('Na+');
    const initialMolesNa = heatedBeaker.getIonMoles('Na+');
    expect(initialMolarity).toBeCloseTo(0.2, 4);

    // Place a lit roaring blue Bunsen burner (airHoleOpenRatio = 1.0, 450W) directly beneath heatedBeaker
    // Vessel base is at y = 200 + 55 = 255; burner at y = 290 -> dy = 35px (within [10, 80] zone)
    const burner = workbench.addBurner({
      id: 'burner_1',
      x: 400,
      y: 290,
      isLit: true,
      airHoleOpenRatio: 1.0,
      thermalPowerWatts: 450,
    });

    expect(burner.flameTemperatureC).toBeCloseTo(1200, 1);
    expect(burner.isVesselInHeatingZone(heatedBeaker)).toBe(true);

    // Simulate 60 seconds at 60Hz (3600 ticks) over the roaring blue burner
    const dt = 1 / 60;
    for (let i = 0; i < 3600; i++) {
      workbench.tick(dt);
    }

    // Verify temperature reached and clamped at 100.0C boiling point
    expect(heatedBeaker.temperatureC).toBeCloseTo(100.0, 3);

    // Verify water evaporated, volume decreased, steam evolved, and Na+ molarity increased
    expect(heatedBeaker.currentVolumeMl).toBeLessThan(50.0);
    expect(heatedBeaker.evaporatedSteamMoles).toBeGreaterThan(0);
    expect(heatedBeaker.activeSteamRate).toBeGreaterThan(0);

    // Non-volatile Na+ moles are strictly conserved while molarity increased due to concentration
    expect(heatedBeaker.getIonMoles('Na+')).toBeCloseTo(initialMolesNa, 8);
    expect(heatedBeaker.getIonMolarity('Na+')).toBeGreaterThan(initialMolarity);
  });
});
