import { Graphics } from 'pixi.js';
import { Vessel } from '../../core/apparatus/Vessel';
import { ParticlePool } from './ParticlePool';

const KIND_STANDARD_CRYSTAL = 2;
const KIND_GOLDEN_RAIN_PBI2 = 3;

/**
 * Models realistic turbidity, flocculation, and Stokes' law sedimentation of
 * newly formed solid precipitates (including shimmering hexagonal PbI2 "Golden Rain")
 * that feed the bottom settled sediment layer as crystals land on the vessel floor.
 */
export class PrecipitateEmitter {
  public static readonly STOKES_SETTLING_VELOCITY_PX_S = 28.0;

  private pool: ParticlePool;
  // Tracks total precipitate mass (grams) already accounted for per vessel & precipitate ID
  private knownTotalMassByVessel: Map<string, Map<string, number>> = new Map();
  // Tracks settled precipitate mass (grams) that has reached the bottom floor per vessel & precipitate ID
  private settledMassByVessel: Map<string, Map<string, number>> = new Map();

  constructor(poolCapacity: number = 2048) {
    this.pool = new ParticlePool(poolCapacity);
  }

  public getPool(): ParticlePool {
    return this.pool;
  }

  /**
   * Returns the visual settled mass (in grams) for a precipitate in a vessel.
   * As suspended crystals land on the bottom floor, this value smoothly converges
   * to the total stoichiometric precipitate mass.
   */
  public getVisualSettledMassGrams(
    vesselId: string,
    precipitateId: string,
    totalActualMassGrams: number
  ): number {
    const vesselSettled = this.settledMassByVessel.get(vesselId);
    if (!vesselSettled) return totalActualMassGrams;
    const settled = vesselSettled.get(precipitateId);
    if (typeof settled !== 'number') return totalActualMassGrams;
    return Math.min(totalActualMassGrams, settled);
  }

  public updateAndRender(
    vessels: Vessel[],
    graphicsByVesselId: Map<string, Graphics>,
    dt: number
  ): void {
    const vesselMap = new Map<string, Vessel>();
    const bottomFloorMap = new Map<string, number>();

    for (const vessel of vessels) {
      vesselMap.set(vessel.id, vessel);
      const g = graphicsByVesselId.get(vessel.id);
      if (g) g.clear();

      const spec = vessel.spec;
      const halfH = spec.height / 2;
      const usableHeight = spec.height - 10;
      const fillRatio = Math.max(
        0,
        Math.min(0.98, vessel.currentVolumeMl / Math.max(1, vessel.maxVolumeMl))
      );
      const surfaceDistFromCenter = halfH - 4 - fillRatio * usableHeight;
      const bottomFloorDist = halfH - 4;
      bottomFloorMap.set(vessel.id, bottomFloorDist);

      if (vessel.currentVolumeMl <= 0.05) {
        this.knownTotalMassByVessel.delete(vessel.id);
        this.settledMassByVessel.delete(vessel.id);
        this.pool.clearVesselParticles(vessel.id);
        continue;
      }

      let knownMap = this.knownTotalMassByVessel.get(vessel.id);
      if (!knownMap) {
        knownMap = new Map<string, number>();
        this.knownTotalMassByVessel.set(vessel.id, knownMap);
      }

      let settledMap = this.settledMassByVessel.get(vessel.id);
      if (!settledMap) {
        settledMap = new Map<string, number>();
        this.settledMassByVessel.set(vessel.id, settledMap);
      }

      const downX = Math.sin(vessel.rotationRad);
      const downY = Math.cos(vessel.rotationRad);
      const tangX = Math.cos(-vessel.rotationRad);
      const tangY = Math.sin(-vessel.rotationRad);
      const innerSpreadW = Math.max(10, (spec.width - 10) * 0.78);

      // Check for newly formed precipitate mass (dMoles > 0)
      for (const [pptId, record] of vessel.precipitates.entries()) {
        const prevKnownMass = knownMap.get(pptId) ?? 0;
        const deltaMass = record.massGrams - prevKnownMass;

        if (deltaMass > 1e-5) {
          knownMap.set(pptId, record.massGrams);
          if (!settledMap.has(pptId)) {
            // Seed a small immediate base layer (15%) and suspend 85% in falling crystals
            settledMap.set(pptId, deltaMass * 0.15);
          }

          const suspendedMass = deltaMass * 0.85;
          const particleBurstCount = Math.min(
            90,
            Math.max(18, Math.ceil(deltaMass * 110))
          );
          const massPerCrystal = suspendedMass / particleBurstCount;
          const hexColor = parseInt(record.colorHex.replace('#', ''), 16);
          const isGoldenRain = pptId === 'PbI2';

          for (let i = 0; i < particleBurstCount; i++) {
            // Spawn in the upper/middle mixing zone of the liquid
            const depthRatio = 0.08 + Math.random() * 0.58;
            const distAlongGravity =
              surfaceDistFromCenter +
              depthRatio * Math.max(8, bottomFloorDist - surfaceDistFromCenter);
            const lateralOffset = (Math.random() - 0.5) * innerSpreadW;

            const sx = downX * distAlongGravity + tangX * lateralOffset;
            const sy = downY * distAlongGravity + tangY * lateralOffset;

            const speedVariation = 0.75 + Math.random() * 0.55;
            const stokesSpeed =
              PrecipitateEmitter.STOKES_SETTLING_VELOCITY_PX_S * speedVariation;

            const spawned = this.pool.spawn({
              x: sx,
              y: sy,
              vx: downX * stokesSpeed,
              vy: downY * stokesSpeed,
              radius: isGoldenRain
                ? 1.8 + Math.random() * 1.4
                : 1.4 + Math.random() * 1.3,
              alpha: isGoldenRain ? 0.95 : 0.85,
              color: Number.isNaN(hexColor) ? 0xf8fafc : hexColor,
              maxLife: 4.5,
              wobblePhase: Math.random() * Math.PI * 2,
              wobbleSpeed: 5 + Math.random() * 6,
              kind: isGoldenRain ? KIND_GOLDEN_RAIN_PBI2 : KIND_STANDARD_CRYSTAL,
              vesselId: vessel.id,
              precipitateId: pptId,
              massContribution: massPerCrystal,
            });

            // If pool is saturated, credit mass directly to settled layer
            if (!spawned) {
              settledMap.set(
                pptId,
                (settledMap.get(pptId) ?? 0) + massPerCrystal
              );
            }
          }
        }
      }
    }

    // Update Stokes' law settling & Brownian jitter
    this.pool.updateAll(dt, (p, stepDt) => {
      const vessel = vesselMap.get(p.vesselId);
      if (!vessel) {
        p.active = false;
        return;
      }

      const downX = Math.sin(vessel.rotationRad);
      const downY = Math.cos(vessel.rotationRad);
      const tangX = Math.cos(-vessel.rotationRad);
      const tangY = Math.sin(-vessel.rotationRad);

      const stokesSpeed = PrecipitateEmitter.STOKES_SETTLING_VELOCITY_PX_S;
      const brownianJitter =
        Math.sin(p.age * p.wobbleSpeed + p.wobblePhase) * 8.5 +
        (Math.random() - 0.5) * 6.0;

      p.x += (downX * stokesSpeed + tangX * brownianJitter) * stepDt;
      p.y += (downY * stokesSpeed + tangY * brownianJitter) * stepDt;

      // Golden Rain (PbI2) specular crystalline glint modulation: alpha oscillates with sin(age * 15)
      if (p.kind === KIND_GOLDEN_RAIN_PBI2) {
        p.alpha = 0.45 + 0.55 * Math.abs(Math.sin(p.age * 15 + p.wobblePhase));
      }

      const floorDist = bottomFloorMap.get(p.vesselId) ?? vessel.spec.height / 2 - 4;
      const projAlongGravity = p.x * downX + p.y * downY;

      if (projAlongGravity >= floorDist - 2 || p.age + stepDt >= p.maxLife) {
        // Crystal reached the bottom sediment boundary -> increment settled sediment layer!
        const settledMap = this.settledMassByVessel.get(p.vesselId);
        if (settledMap && p.precipitateId) {
          settledMap.set(
            p.precipitateId,
            (settledMap.get(p.precipitateId) ?? 0) + p.massContribution
          );
        }
        p.active = false;
      }
    });

    // Render suspended crystals
    this.pool.forEachActive((p) => {
      const g = graphicsByVesselId.get(p.vesselId);
      if (!g) return;

      if (p.kind === KIND_GOLDEN_RAIN_PBI2) {
        // Shimmering crystalline hexagonal/diamond platelet for PbI2 Golden Rain
        const r = p.radius;
        g.moveTo(p.x, p.y - r)
          .lineTo(p.x + r * 0.9, p.y)
          .lineTo(p.x, p.y + r)
          .lineTo(p.x - r * 0.9, p.y)
          .closePath()
          .fill({ color: p.color, alpha: p.alpha });
      } else {
        g.rect(p.x - p.radius * 0.5, p.y - p.radius * 0.5, p.radius, p.radius).fill({
          color: p.color,
          alpha: p.alpha,
        });
      }
    });
  }
}
