import { PourStream } from './types';
import { Vessel } from './Vessel';

/**
 * Implements realistic tilt-threshold pouring physics, vertical spout raycasting,
 * and mass- & enthalpy-conserving liquid slice transfers between vessels.
 */
export class PourPhysics {
  public static readonly DEFAULT_FLOW_COEFFICIENT = 1.35;
  public static readonly MAX_STREAM_DROP_PX = 450;
  public static readonly MIN_POURABLE_VOLUME_ML = 0.05;

  private kFlow: number;

  constructor(kFlow: number = PourPhysics.DEFAULT_FLOW_COEFFICIENT) {
    this.kFlow = kFlow;
  }

  /**
   * Computes the dynamic tilt threshold angle (in radians) at which liquid begins to pour:
   * fillRatio = clamp(currentVolumeMl / maxVolumeMl, 0, 1)
   * theta_start = (90 deg * (1 - fillRatio * 0.65)) in radians
   */
  public computePourStartAngleRad(vessel: Vessel): number {
    const fillRatio = Math.max(
      0,
      Math.min(1, vessel.currentVolumeMl / Math.max(1, vessel.maxVolumeMl))
    );
    const thetaStartDeg = 90 * (1 - fillRatio * 0.65);
    return (thetaStartDeg * Math.PI) / 180;
  }

  /**
   * Computes instantaneous volumetric flow rate (mL/sec) for a vessel based on its tilt
   * angle (or stopcock opening for a precision burette).
   */
  public computeFlowRateMlPerSec(vessel: Vessel): number {
    if (vessel.currentVolumeMl <= PourPhysics.MIN_POURABLE_VOLUME_ML) {
      return 0;
    }

    // Precision burette stopcock flow
    if (
      vessel.type === 'burette_50' &&
      vessel.stopcockOpenRatio > 0 &&
      Math.abs(vessel.rotationRad) < 0.2
    ) {
      const maxFlow = vessel.spec.stopcockMaxFlowMlPerSec ?? 2.5;
      return Math.max(0, Math.min(1, vessel.stopcockOpenRatio)) * maxFlow;
    }

    const thetaStart = this.computePourStartAngleRad(vessel);
    const absTilt = Math.abs(vessel.rotationRad);

    if (absTilt <= thetaStart) {
      return 0;
    }

    return this.kFlow * (absTilt - thetaStart) * vessel.currentVolumeMl;
  }

  /**
   * Projects a vertical pour stream downward from the source vessel's active world spout:
   * x_stream = spout.x, y_range = [spout.y, spout.y + 450].
   * Selects the closest receiving vessel whose mouth segment [leftLip.x, rightLip.x]
   * straddles x_stream below spout.y.
   */
  public findTargetVessel(
    source: Vessel,
    allVessels: Vessel[]
  ): { target: Vessel | null; streamEndY: number } {
    const spout = source.getWorldSpoutPosition();
    const xStream = spout.x;
    const minY = spout.y;
    const maxY = spout.y + PourPhysics.MAX_STREAM_DROP_PX;

    let closestTarget: Vessel | null = null;
    let closestMouthY = maxY;

    for (const candidate of allVessels) {
      if (candidate.id === source.id) continue;

      const [leftLip, rightLip] = candidate.getMouthSegment();
      const lipMinX = Math.min(leftLip.x, rightLip.x);
      const lipMaxX = Math.max(leftLip.x, rightLip.x);

      // Check if candidate's top mouth straddles x_stream
      if (xStream >= lipMinX && xStream <= lipMaxX) {
        // Interpolate exact y along the mouth segment at x = xStream
        const spanX = rightLip.x - leftLip.x;
        const t =
          Math.abs(spanX) > 1e-6 ? (xStream - leftLip.x) / spanX : 0.5;
        const mouthY = leftLip.y + t * (rightLip.y - leftLip.y);

        // Mouth must lie below spout.y and within the vertical stream range
        if (mouthY > minY && mouthY <= closestMouthY) {
          closestTarget = candidate;
          closestMouthY = mouthY;
        }
      }
    }

    return {
      target: closestTarget,
      streamEndY: closestMouthY,
    };
  }

  /**
   * Transfers a differential liquid slice over time step dt from source to target
   * while strictly conserving volume, dissolved ion moles, suspended precipitate fraction,
   * and thermal enthalpy:
   * T_final = (V_target * T_target + dV * T_source) / (V_target + dV)
   * Immediately triggers ReactionEngine.solve() on the target vessel.
   */
  public transferSlice(
    source: Vessel,
    target: Vessel | null,
    flowRateMlPerSec: number,
    dt: number
  ): number {
    if (flowRateMlPerSec <= 0 || dt <= 0) return 0;

    const sourceVol = source.currentVolumeMl;
    if (sourceVol <= PourPhysics.MIN_POURABLE_VOLUME_ML) return 0;

    const dV = Math.min(sourceVol, flowRateMlPerSec * dt);
    if (dV <= 1e-12) return 0;

    const fraction = Math.min(1, dV / sourceVol);
    const sourcePool = source.getEngine().getIonPool();
    const sourceTempC = source.temperatureC;

    // Extract exact fraction f of every dissolved ion mole from source
    const extractedIons: Array<{ ionId: string; moles: number }> = [];
    for (const ionDef of sourcePool.getAllIonDefinitions()) {
      const currentMoles = sourcePool.getMoles(ionDef.id);
      if (currentMoles > 0) {
        const transferredMoles = currentMoles * fraction;
        sourcePool.setMoles(ionDef.id, Math.max(0, currentMoles - transferredMoles));
        extractedIons.push({ ionId: ionDef.id, moles: transferredMoles });
      }
    }

    // Decrement source liquid volume
    sourcePool.setVolumeMl(Math.max(0, sourceVol - dV));

    // If source is agitated, transfer a small suspended fraction (5% of f) of unsettleable fine precipitates
    const extractedPrecipitates: Array<{
      id: string;
      moles: number;
      massGrams: number;
    }> = [];
    if (source.isAgitated) {
      const suspendedFactor = fraction * 0.05;
      const sourcePrecipMap = source.getEngine().getPrecipitatesMap();
      for (const [pptId, rec] of sourcePrecipMap.entries()) {
        if (rec.moles > 0) {
          const dMoles = rec.moles * suspendedFactor;
          const dMass = rec.massGrams * suspendedFactor;
          rec.moles = Math.max(0, rec.moles - dMoles);
          rec.massGrams = Math.max(0, rec.massGrams - dMass);
          extractedPrecipitates.push({ id: pptId, moles: dMoles, massGrams: dMass });
        }
      }
    }

    // Deliver into target receiving vessel if present
    if (target) {
      const targetEngine = target.getEngine();
      const targetPool = targetEngine.getIonPool();
      const previousTargetVol = targetPool.getVolumeMl();

      targetPool.addVolumeMl(dV);
      for (const item of extractedIons) {
        targetPool.addMoles(item.ionId, item.moles);
      }

      if (extractedPrecipitates.length > 0) {
        const targetPrecipMap = targetEngine.getPrecipitatesMap();
        const sourcePrecipMap = source.getEngine().getPrecipitatesMap();
        for (const item of extractedPrecipitates) {
          const srcRec = sourcePrecipMap.get(item.id);
          if (!srcRec) continue;
          const existing = targetPrecipMap.get(item.id) ?? {
            ...srcRec,
            moles: 0,
            massGrams: 0,
          };
          existing.moles += item.moles;
          existing.massGrams += item.massGrams;
          targetPrecipMap.set(item.id, existing);
        }
      }

      // Trigger ReactionEngine.solve() on target vessel:
      // Computes thermal mixing T_final = (V_target * T_target + dV * T_source) / (V_target + dV)
      // plus any chemical reaction enthalpy, Ksp precipitation, gas evolution, and pH shift.
      const prevGas = targetEngine.getState().totalEvolvedGasMoles;
      const solvedState = targetEngine.solve(previousTargetVol, dV, sourceTempC);
      const deltaGas = Math.max(0, solvedState.totalEvolvedGasMoles - prevGas);
      if (deltaGas > 1e-8) {
        target.gasEvolutionRate = Math.min(
          0.25,
          target.gasEvolutionRate + deltaGas / Math.max(0.005, dt)
        );
      }
    }

    return dV;
  }

  /**
   * Evaluates all vessels in the workbench for a single time step dt and executes
   * pouring transfers.
   */
  public stepWorkbenchPouring(allVessels: Vessel[], dt: number): PourStream[] {
    const activeStreams: PourStream[] = [];

    for (const source of allVessels) {
      const flowRate = this.computeFlowRateMlPerSec(source);
      if (flowRate <= 0) continue;

      const spout = source.getWorldSpoutPosition();
      const { target, streamEndY } = this.findTargetVessel(source, allVessels);
      const colorRgba = source.getChemistryState().solutionColorRgba;

      const transferredMl = this.transferSlice(source, target, flowRate, dt);

      if (transferredMl > 0) {
        activeStreams.push({
          sourceVesselId: source.id,
          targetVesselId: target ? target.id : null,
          spoutWorld: spout,
          streamEndWorld: { x: spout.x, y: streamEndY },
          flowRateMlPerSec: flowRate,
          transferredVolumeMlThisTick: transferredMl,
          colorRgba,
        });
      }
    }

    return activeStreams;
  }
}
