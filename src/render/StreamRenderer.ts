import { Container, Graphics } from 'pixi.js';
import { PourStream } from '../core/apparatus/types';
import { Vessel } from '../core/apparatus/Vessel';
import { StageManager } from './StageManager';

/**
 * Renders tapered dynamic Bezier pouring streams from an active vessel's world spout
 * down to the target receiving vessel's liquid surface (or the lab bench deck if spilled).
 */
export class StreamRenderer {
  private graphics: Graphics;

  constructor(parentLayer: Container) {
    this.graphics = new Graphics();
    parentLayer.addChild(this.graphics);
  }

  public renderStreams(
    streams: PourStream[],
    vessels: Vessel[],
    elapsedTimeSec: number
  ): void {
    const g = this.graphics;
    g.clear();

    if (streams.length === 0) return;

    const vesselMap = new Map<string, Vessel>();
    for (const v of vessels) {
      vesselMap.set(v.id, v);
    }

    for (const stream of streams) {
      const startX = stream.spoutWorld.x;
      const startY = stream.spoutWorld.y;

      let endY = StageManager.BENCH_DECK_Y;
      if (stream.targetVesselId) {
        const target = vesselMap.get(stream.targetVesselId);
        if (target) {
          const halfH = target.spec.height / 2;
          const usableH = target.spec.height - 10;
          const fillRatio = Math.max(
            0,
            Math.min(0.95, target.currentVolumeMl / Math.max(1, target.maxVolumeMl))
          );
          // Land stream directly on the receiving vessel's liquid meniscus
          endY = target.y + halfH - 4 - fillRatio * usableH;
        }
      }

      if (endY <= startY + 2) {
        endY = startY + 24;
      }

      const [r, gr, b, a] = stream.colorRgba;
      const hexColor = (r << 16) | (gr << 8) | b;
      const streamAlpha = Math.max(0.45, Math.min(0.9, a + 0.25));

      const topHalfWidth = Math.min(4.5, Math.max(1.8, stream.flowRateMlPerSec * 0.14));
      const bottomHalfWidth = Math.max(1.0, topHalfWidth * 0.55);
      const midY = (startY + endY) * 0.5;
      const flutter = Math.sin(elapsedTimeSec * 24) * 1.2;

      // Tapered Bezier fluid stream column
      g.moveTo(startX - topHalfWidth, startY)
        .bezierCurveTo(
          startX - topHalfWidth * 0.8 + flutter,
          midY,
          startX - bottomHalfWidth,
          midY,
          startX - bottomHalfWidth,
          endY
        )
        .lineTo(startX + bottomHalfWidth, endY)
        .bezierCurveTo(
          startX + bottomHalfWidth,
          midY,
          startX + topHalfWidth * 0.8 + flutter,
          midY,
          startX + topHalfWidth,
          startY
        )
        .closePath()
        .fill({ color: hexColor, alpha: streamAlpha });

      // Specular core filament inside stream
      g.moveTo(startX, startY)
        .lineTo(startX + flutter * 0.4, endY)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.4 });

      // Impact ripple rings at stream termination point
      const rippleRadius = 3 + ((elapsedTimeSec * 18) % 5);
      g.ellipse(startX, endY, rippleRadius, rippleRadius * 0.35).stroke({
        width: 1,
        color: 0xffffff,
        alpha: 0.45,
      });
    }
  }
}
