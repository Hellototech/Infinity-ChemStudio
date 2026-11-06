import { Graphics } from 'pixi.js';
import { Vessel } from '../../core/apparatus/Vessel';
import { ParticlePool } from './ParticlePool';

const KIND_BUBBLE = 0;
const KIND_SPLASH_DROPLET = 1;

/**
 * Aqueous effervescence (CO2, H2, O2, SO2) and thermal boiling nucleation (>= 92.0C)
 * bubble emitter rendered inside each vessel's masked liquidContainer.
 */
export class BubbleEmitter {
  private pool: ParticlePool;
  private spawnAccumulators: Map<string, number> = new Map();

  constructor(poolCapacity: number = 2048) {
    this.pool = new ParticlePool(poolCapacity);
  }

  public getPool(): ParticlePool {
    return this.pool;
  }

  /**
   * Spawns new chemical effervescence and thermal boiling bubbles for all vessels,
   * steps buoyancy & wobble physics, and pops bubbles at the gravity-aligned meniscus.
   */
  public updateAndRender(
    vessels: Vessel[],
    graphicsByVesselId: Map<string, Graphics>,
    dt: number
  ): void {
    const vesselMap = new Map<string, Vessel>();
    const surfaceDistMap = new Map<string, number>();

    for (const vessel of vessels) {
      vesselMap.set(vessel.id, vessel);
      const g = graphicsByVesselId.get(vessel.id);
      if (g) g.clear();

      const volMl = vessel.currentVolumeMl;
      if (volMl <= 0.1) {
        this.pool.clearVesselParticles(vessel.id);
        continue;
      }

      const spec = vessel.spec;
      const halfH = spec.height / 2;
      const usableHeight = spec.height - 10;
      const fillRatio = Math.max(
        0,
        Math.min(0.98, volMl / Math.max(1, vessel.maxVolumeMl))
      );
      const surfaceDistFromCenter = halfH - 4 - fillRatio * usableHeight;
      surfaceDistMap.set(vessel.id, surfaceDistFromCenter);

      // 1. Chemical Effervescence Trigger (vessel.gasEvolutionRate)
      const state = vessel.getChemistryState();
      const effectiveGasRate =
        vessel.gasEvolutionRate + (state.isEffervescing ? 0.06 : 0);

      // 2. Thermal Nucleation (Boiling) Trigger (vessel.temperatureC >= 92.0C)
      let boilingRateParticlesPerSec = 0;
      if (vessel.temperatureC >= 92.0) {
        const normalizedBoil = Math.min(
          1,
          (vessel.temperatureC - 92.0) / 8.0
        );
        // Exponential ramp toward vigorous rolling boil at 100.0C
        boilingRateParticlesPerSec = 6 + Math.pow(normalizedBoil, 2.2) * 85;
      }

      const chemRateParticlesPerSec = effectiveGasRate * 420;
      const totalSpawnRate = boilingRateParticlesPerSec + chemRateParticlesPerSec;

      if (totalSpawnRate > 0) {
        const prevAcc = this.spawnAccumulators.get(vessel.id) ?? 0;
        let acc = prevAcc + totalSpawnRate * dt;
        const countToSpawn = Math.min(18, Math.floor(acc));
        acc -= countToSpawn;
        this.spawnAccumulators.set(vessel.id, acc);

        const innerSpreadW = Math.max(8, (spec.width - 10) * 0.78);
        const downX = Math.sin(vessel.rotationRad);
        const downY = Math.cos(vessel.rotationRad);
        const tangX = Math.cos(-vessel.rotationRad);
        const tangY = Math.sin(-vessel.rotationRad);

        for (let i = 0; i < countToSpawn; i++) {
          const isBoilingNucleation =
            boilingRateParticlesPerSec > 0 &&
            Math.random() < boilingRateParticlesPerSec / totalSpawnRate;

          // Boiling nucleates at the heated bottom floor; chemical effervescence spawns across the reaction zone
          const depthFraction = isBoilingNucleation
            ? 0.88 + Math.random() * 0.1
            : 0.35 + Math.random() * 0.6;
          const distAlongGravity =
            surfaceDistFromCenter +
            depthFraction * (halfH - 4 - surfaceDistFromCenter);
          const lateralOffset = (Math.random() - 0.5) * innerSpreadW;

          const spawnX = downX * distAlongGravity + tangX * lateralOffset;
          const spawnY = downY * distAlongGravity + tangY * lateralOffset;

          // Initial upward velocity along -gravity
          const initialUpSpeed = isBoilingNucleation
            ? 25 + Math.random() * 25
            : 18 + Math.random() * 22;

          this.pool.spawn({
            x: spawnX,
            y: spawnY,
            vx: -downX * initialUpSpeed,
            vy: -downY * initialUpSpeed,
            radius: 1.5 + Math.random() * 2.5,
            alpha: 0.55,
            color: 0xffffff,
            maxLife: 2.4,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: 8 + Math.random() * 6,
            kind: KIND_BUBBLE,
            vesselId: vessel.id,
          });
        }
      }
    }

    // Step bubble & surface splash kinematics
    this.pool.updateAll(dt, (p, stepDt) => {
      const vessel = vesselMap.get(p.vesselId);
      if (!vessel) {
        p.active = false;
        return;
      }

      const surfDist = surfaceDistMap.get(p.vesselId) ?? 0;
      const downX = Math.sin(vessel.rotationRad);
      const downY = Math.cos(vessel.rotationRad);
      const tangX = Math.cos(-vessel.rotationRad);
      const tangY = Math.sin(-vessel.rotationRad);

      if (p.kind === KIND_BUBBLE) {
        // Buoyancy upward acceleration (vy -= 120 * dt in world gravity frame)
        p.vx += -downX * 120 * stepDt;
        p.vy += -downY * 120 * stepDt;

        // Sinusoidal horizontal wobble perpendicular to gravity
        const wobbleDelta =
          Math.sin(p.age * p.wobbleSpeed + p.wobblePhase) * 0.4;
        p.x += p.vx * stepDt + tangX * wobbleDelta;
        p.y += p.vy * stepDt + tangY * wobbleDelta;

        // Check if bubble crossed the gravity-aligned liquid meniscus line
        const projGravity = p.x * downX + p.y * downY;
        if (projGravity <= surfDist + 1.0) {
          // Surface pop! Spawn a tiny 2-particle surface splash droplet if boiling or fizzing vigorously
          if (vessel.temperatureC >= 95.0 || vessel.gasEvolutionRate > 0.015) {
            for (let s = 0; s < 2; s++) {
              const sideDir = s === 0 ? -1 : 1;
              const splashTangSpeed = sideDir * (12 + Math.random() * 16);
              const splashUpSpeed = 28 + Math.random() * 18;
              this.pool.spawn({
                x: p.x,
                y: p.y,
                vx: -downX * splashUpSpeed + tangX * splashTangSpeed,
                vy: -downY * splashUpSpeed + tangY * splashTangSpeed,
                radius: 1.1,
                alpha: 0.65,
                color: 0xe2e8f0,
                maxLife: 0.26,
                kind: KIND_SPLASH_DROPLET,
                vesselId: vessel.id,
              });
            }
          }
          p.active = false;
        }
      } else if (p.kind === KIND_SPLASH_DROPLET) {
        // Ballistic droplet arc falling back toward the meniscus under gravity
        p.vx += downX * 180 * stepDt;
        p.vy += downY * 180 * stepDt;
        p.x += p.vx * stepDt;
        p.y += p.vy * stepDt;
        p.alpha = Math.max(0, 0.65 * (1 - p.age / p.maxLife));
      }
    });

    // Batch render active bubbles into their respective vessel Graphics layers
    this.pool.forEachActive((p) => {
      const g = graphicsByVesselId.get(p.vesselId);
      if (!g) return;

      if (p.kind === KIND_BUBBLE) {
        // Translucent hollow/specular micro-bubble
        g.circle(p.x, p.y, p.radius)
          .fill({ color: 0xffffff, alpha: p.alpha * 0.22 })
          .stroke({ width: 1, color: p.color, alpha: p.alpha });
      } else {
        g.circle(p.x, p.y, p.radius).fill({
          color: p.color,
          alpha: p.alpha,
        });
      }
    });
  }
}
