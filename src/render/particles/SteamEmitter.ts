import { Container, Graphics } from 'pixi.js';
import { Vessel } from '../../core/apparatus/Vessel';
import { ParticlePool } from './ParticlePool';

const KIND_STEAM = 4;

/**
 * Rising thermal condensation & evaporation vapor plumes rendered in world space
 * above vessels when vessel.temperatureC >= 60.0C, scaling to dense steam plumes at 100.0C.
 */
export class SteamEmitter {
  public static readonly EMISSION_THRESHOLD_TEMP_C = 60.0;
  public static readonly THERMAL_DRAFT_VY = -45.0; // px/s upward

  private pool: ParticlePool;
  private graphics: Graphics;
  private spawnAccumulators: Map<string, number> = new Map();

  constructor(parentLayer: Container, poolCapacity: number = 1024) {
    this.pool = new ParticlePool(poolCapacity);
    this.graphics = new Graphics();
    parentLayer.addChild(this.graphics);
  }

  public getPool(): ParticlePool {
    return this.pool;
  }

  public updateAndRender(vessels: Vessel[], dt: number): void {
    this.graphics.clear();

    for (const vessel of vessels) {
      if (
        vessel.currentVolumeMl <= 0.1 ||
        vessel.temperatureC < SteamEmitter.EMISSION_THRESHOLD_TEMP_C
      ) {
        continue;
      }

      // Scale emission rate from subtle wisps at 60C to dense rising steam plumes at 100C
      const tempFactor = Math.max(
        0,
        Math.min(1, (vessel.temperatureC - 60.0) / 40.0)
      );
      const steamBoost = Math.min(1.5, vessel.activeSteamRate * 12);
      const spawnRatePerSec = 3.5 + tempFactor * tempFactor * 24 + steamBoost * 18;

      const prevAcc = this.spawnAccumulators.get(vessel.id) ?? 0;
      let acc = prevAcc + spawnRatePerSec * dt;
      const countToSpawn = Math.min(8, Math.floor(acc));
      acc -= countToSpawn;
      this.spawnAccumulators.set(vessel.id, acc);

      if (countToSpawn > 0) {
        const [leftLip, rightLip] = vessel.getMouthSegment();
        const mouthCenterX = (leftLip.x + rightLip.x) * 0.5;
        const mouthCenterY = (leftLip.y + rightLip.y) * 0.5;
        const mouthSpan = Math.max(12, Math.hypot(rightLip.x - leftLip.x, rightLip.y - leftLip.y) * 0.65);

        for (let i = 0; i < countToSpawn; i++) {
          const offsetX = (Math.random() - 0.5) * mouthSpan;
          // Rise ~120px at vy = -45 px/s -> maxLife ≈ 2.67s
          this.pool.spawn({
            x: mouthCenterX + offsetX,
            y: mouthCenterY - 2 - Math.random() * 6,
            vx: (Math.random() - 0.5) * 8,
            vy: SteamEmitter.THERMAL_DRAFT_VY * (0.88 + Math.random() * 0.24),
            radius: 6.0,
            alpha: 0.18,
            color: 0xe2e8f0,
            maxLife: 2.65,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: 2.4 + Math.random() * 1.8,
            kind: KIND_STEAM,
            vesselId: vessel.id,
          });
        }
      }
    }

    // Update plume kinematics: radius expands 6px -> 22px, alpha fades 0.18 -> 0.0 via cosine easing
    this.pool.updateAll(dt, (p, stepDt) => {
      const progress = Math.max(0, Math.min(1, p.age / p.maxLife));

      // Turbulent curl drift as plume rises 120px above vessel rim
      const curlVx =
        Math.sin(p.age * p.wobbleSpeed + p.wobblePhase) * 14.0 +
        Math.cos(p.age * 1.3 - p.wobblePhase) * 6.0;

      p.x += (p.vx + curlVx) * stepDt;
      p.y += p.vy * stepDt;

      // Expand radius smoothly from 6px to 22px
      p.radius = 6.0 + (22.0 - 6.0) * progress;

      // Smooth cosine easing fade from initial alpha 0.18 to 0.0
      p.alpha = 0.18 * 0.5 * (1 + Math.cos(Math.PI * progress));
    });

    // Draw procedural low-opacity vapor circles
    const g = this.graphics;
    this.pool.forEachActive((p) => {
      if (p.alpha <= 0.003) return;
      g.circle(p.x, p.y, p.radius).fill({
        color: p.color,
        alpha: p.alpha,
      });
    });
  }
}
