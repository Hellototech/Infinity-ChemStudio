import { ApparatusTypeId } from '../core/apparatus/types';
import { WorkbenchState } from '../core/apparatus/WorkbenchState';
import { PrecipitateRecord, EvolvedGasRecord } from '../core/chemistry/types';

export interface ExperimentPreset {
  id: string;
  code: string;
  title: string;
  description: string;
  defaultSelectedVesselId: string;
  apply: (workbench: WorkbenchState) => void;
}

export interface SerializedWorkbenchState {
  version: '1.0';
  exportedAtIso: string;
  simTimeSeconds: number;
  vessels: Array<{
    id: string;
    type: ApparatusTypeId;
    label: string;
    x: number;
    y: number;
    rotationRad: number;
    snappedToId?: string;
    stopcockOpenRatio: number;
    boilingPointC: number;
    volumeMl: number;
    temperatureC: number;
    ionMoles: Record<string, number>;
    precipitates: Record<string, PrecipitateRecord>;
    evolvedGases: Record<string, EvolvedGasRecord>;
    activeIndicators: string[];
    cumulativeEnthalpyKj: number;
  }>;
  burners: Array<{
    id: string;
    x: number;
    y: number;
    isLit: boolean;
    airHoleOpenRatio: number;
    thermalPowerWatts: number;
  }>;
}

/**
 * Manages the 5 curated laboratory experiment presets and full JSON state export/import.
 */
export class PresetManager {
  public static readonly PRESETS: ExperimentPreset[] = [
    {
      id: 'preset_01_default_sandbox',
      code: '01 // Default Sandbox Bench',
      title: '01 // Default Sandbox Bench',
      description:
        'General multi-vessel laboratory setup with CuSO₄, NaOH, AgNO₃, NaCl, and heated Na₂CO₃.',
      defaultSelectedVesselId: 'beaker_01',
      apply: (workbench: WorkbenchState) => {
        workbench.reset();

        const burner = workbench.addBurner({
          id: 'burner_01',
          x: -300,
          y: 250,
          isLit: true,
          airHoleOpenRatio: 1.0,
          thermalPowerWatts: 450,
        });

        const beaker3 = workbench.addVessel({
          id: 'beaker_03',
          type: 'beaker_250',
          label: 'BEAKER_03 · Na₂CO₃',
          x: -300,
          y: 190,
          snappedToId: burner.id,
        });
        beaker3.addSolution('Na2CO3', 120, 0.5);

        const beaker1 = workbench.addVessel({
          id: 'beaker_01',
          type: 'beaker_250',
          label: 'BEAKER_01 · CuSO₄',
          x: -155,
          y: 250,
        });
        beaker1.addSolution('CuSO4', 100, 0.2);

        const beaker2 = workbench.addVessel({
          id: 'beaker_02',
          type: 'beaker_250',
          label: 'BEAKER_02 · NaOH',
          x: 0,
          y: 250,
        });
        beaker2.addSolution('NaOH', 100, 0.4);

        const flask1 = workbench.addVessel({
          id: 'flask_01',
          type: 'erlenmeyer_250',
          label: 'FLASK_01 · AgNO₃',
          x: 155,
          y: 250,
        });
        flask1.addSolution('AgNO3', 80, 0.1);

        const tube1 = workbench.addVessel({
          id: 'tube_01',
          type: 'test_tube_50',
          label: 'TUBE_01 · NaCl',
          x: 280,
          y: 250,
        });
        tube1.addSolution('NaCl', 30, 0.2);
      },
    },
    {
      id: 'preset_02_golden_rain',
      code: '02 // Golden Rain Crystallization',
      title: '02 // Golden Rain Crystallization',
      description:
        'Beaker of KI poised above a Beaker of Pb(NO₃)₂ — pouring nucleates shimmering golden hexagonal PbI₂(s) micro-crystals.',
      defaultSelectedVesselId: 'beaker_ki',
      apply: (workbench: WorkbenchState) => {
        workbench.reset();

        const leadVessel = workbench.addVessel({
          id: 'beaker_pb',
          type: 'beaker_250',
          label: 'BEAKER_01 · Pb(NO₃)₂',
          x: 15,
          y: 250,
        });
        leadVessel.addSolution('Pb(NO3)2', 90, 0.15);

        // Poised above and tilted so PbI2 Golden Rain crystals immediately nucleate and settle
        const kiVessel = workbench.addVessel({
          id: 'beaker_ki',
          type: 'beaker_250',
          label: 'BEAKER_02 · KI (POURING)',
          x: -48,
          y: 95,
          rotationRad: (62 * Math.PI) / 180,
        });
        kiVessel.addSolution('KI', 90, 0.3);

        workbench.addBurner({
          id: 'burner_01',
          x: -240,
          y: 250,
          isLit: false,
          airHoleOpenRatio: 1.0,
          thermalPowerWatts: 450,
        });
      },
    },
    {
      id: 'preset_03_acid_base_titration',
      code: '03 // Strong Acid-Base Exothermic Titration',
      title: '03 // Strong Acid-Base Exothermic Titration',
      description:
        '50 mL Precision Burette with 1.0 M HCl positioned over an Erlenmeyer Flask with 1.0 M NaOH + Phenolphthalein indicator.',
      defaultSelectedVesselId: 'flask_01',
      apply: (workbench: WorkbenchState) => {
        workbench.reset();

        const flask = workbench.addVessel({
          id: 'flask_01',
          type: 'erlenmeyer_250',
          label: 'FLASK_01 · 1.0M NaOH + Ind',
          x: 0,
          y: 250,
        });
        flask.addSolution('NaOH', 50, 1.0);
        flask.setIndicator('phenolphthalein');

        const burette = workbench.addVessel({
          id: 'burette_01',
          type: 'burette_50',
          label: 'BURETTE_01 · 1.0M HCl',
          x: 0,
          y: 35,
        });
        burette.addSolution('HCl', 50, 1.0);
        burette.stopcockOpenRatio = 0.45;
      },
    },
    {
      id: 'preset_04_copper_hydroxide_boil',
      code: '04 // Copper Hydroxide & Thermal Boil',
      title: '04 // Copper Hydroxide & Thermal Boil',
      description:
        'CuSO₄ + NaOH over a lit roaring-blue Bunsen Burner producing pale blue Cu(OH)₂(s) precipitate and rising thermal steam.',
      defaultSelectedVesselId: 'beaker_01',
      apply: (workbench: WorkbenchState) => {
        workbench.reset();

        const burner = workbench.addBurner({
          id: 'burner_01',
          x: -40,
          y: 250,
          isLit: true,
          airHoleOpenRatio: 1.0,
          thermalPowerWatts: 450,
        });

        const reactionBeaker = workbench.addVessel({
          id: 'beaker_01',
          type: 'beaker_250',
          label: 'BEAKER_01 · CuSO₄ + NaOH',
          x: -40,
          y: 190,
          snappedToId: burner.id,
        });
        reactionBeaker.addSolution('CuSO4', 70, 0.25, 78.0);
        reactionBeaker.addSolution('NaOH', 50, 0.5, 78.0);

        const reserveNaOH = workbench.addVessel({
          id: 'beaker_02',
          type: 'beaker_250',
          label: 'BEAKER_02 · 0.5M NaOH',
          x: 140,
          y: 250,
        });
        reserveNaOH.addSolution('NaOH', 80, 0.5);
      },
    },
    {
      id: 'preset_05_carbonate_effervescence',
      code: '05 // Carbonate Acid Effervescence',
      title: '05 // Carbonate Acid Effervescence',
      description:
        '1.0 M HCl pouring into aqueous Na₂CO₃ driving vigorous Henry’s Law CO₂(g) bubble nucleation and surface splash.',
      defaultSelectedVesselId: 'beaker_01',
      apply: (workbench: WorkbenchState) => {
        workbench.reset();

        const carbonateBeaker = workbench.addVessel({
          id: 'beaker_01',
          type: 'beaker_250',
          label: 'BEAKER_01 · 0.5M Na₂CO₃',
          x: 20,
          y: 250,
        });
        carbonateBeaker.addSolution('Na2CO3', 90, 0.5);
        carbonateBeaker.setIndicator('methyl_orange');

        const acidBeaker = workbench.addVessel({
          id: 'beaker_02',
          type: 'beaker_250',
          label: 'BEAKER_02 · 1.5M HCl (POURING)',
          x: -42,
          y: 95,
          rotationRad: (64 * Math.PI) / 180,
        });
        acidBeaker.addSolution('HCl', 80, 1.5);
      },
    },
  ];

  public static getPresetById(id: string): ExperimentPreset {
    return (
      PresetManager.PRESETS.find((p) => p.id === id) ?? PresetManager.PRESETS[0]
    );
  }

  public static loadPreset(
    workbench: WorkbenchState,
    presetId: string
  ): ExperimentPreset {
    const preset = PresetManager.getPresetById(presetId);
    preset.apply(workbench);
    return preset;
  }

  /**
   * Serializes the entire WorkbenchState (vessels, ions, precipitates, gases, burners) to formatted JSON.
   */
  public static exportToJson(workbench: WorkbenchState): string {
    const snapshot = workbench.getSnapshot();
    const payload: SerializedWorkbenchState = {
      version: '1.0',
      exportedAtIso: new Date().toISOString(),
      simTimeSeconds: snapshot.simTimeSeconds,
      vessels: snapshot.vessels.map((v) => ({
        id: v.id,
        type: v.type,
        label: v.label,
        x: Math.round(v.x * 10) / 10,
        y: Math.round(v.y * 10) / 10,
        rotationRad: Number(v.rotationRad.toFixed(4)),
        snappedToId: v.snappedToId,
        stopcockOpenRatio: v.stopcockOpenRatio,
        boilingPointC: v.boilingPointC,
        volumeMl: v.currentVolumeMl,
        temperatureC: v.temperatureC,
        ionMoles: v.chemistryState.ionMoles,
        precipitates: v.chemistryState.precipitates,
        evolvedGases: v.chemistryState.evolvedGases,
        activeIndicators: v.chemistryState.activeIndicators,
        cumulativeEnthalpyKj: v.chemistryState.cumulativeEnthalpyKj,
      })),
      burners: snapshot.burners.map((b) => ({
        id: b.id,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        isLit: b.isLit,
        airHoleOpenRatio: b.airHoleOpenRatio,
        thermalPowerWatts: b.thermalPowerWatts,
      })),
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Deserializes a JSON string and reconstructs all vessels, aqueous pools, precipitates, and burners.
   */
  public static importFromJson(
    workbench: WorkbenchState,
    jsonText: string
  ): string | null {
    const parsed = JSON.parse(jsonText) as SerializedWorkbenchState;
    if (!parsed || !Array.isArray(parsed.vessels)) {
      throw new Error('Invalid Infinity ChemStudio JSON state schema.');
    }

    workbench.reset();

    if (Array.isArray(parsed.burners)) {
      for (const b of parsed.burners) {
        workbench.addBurner({
          id: b.id,
          x: b.x,
          y: b.y,
          isLit: b.isLit,
          airHoleOpenRatio: b.airHoleOpenRatio,
          thermalPowerWatts: b.thermalPowerWatts,
        });
      }
    }

    let firstVesselId: string | null = null;
    for (const vData of parsed.vessels) {
      if (!firstVesselId) firstVesselId = vData.id;
      const vessel = workbench.addVessel({
        id: vData.id,
        type: vData.type,
        label: vData.label,
        x: vData.x,
        y: vData.y,
        rotationRad: vData.rotationRad,
        snappedToId: vData.snappedToId,
        boilingPointC: vData.boilingPointC,
      });
      vessel.stopcockOpenRatio = vData.stopcockOpenRatio ?? 0;
      vessel.getEngine().restoreSerializedState({
        volumeMl: vData.volumeMl,
        temperatureC: vData.temperatureC,
        ionMoles: vData.ionMoles,
        precipitates: vData.precipitates,
        evolvedGases: vData.evolvedGases,
        activeIndicators: vData.activeIndicators,
        cumulativeEnthalpyKj: vData.cumulativeEnthalpyKj,
      });
    }

    return firstVesselId;
  }
}
