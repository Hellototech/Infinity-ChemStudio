import { Vessel } from '../core/apparatus/Vessel';
import { VesselRenderNode } from './GlasswareRenderer';

/**
 * Gravity-aligned liquid surface solver, Beer-Lambert color fill,
 * bright meniscus highlight, and stacked precipitate sediment renderer.
 */
export class LiquidRenderer {
  private sloshEnergies: Map<string, number> = new Map();
  private lastRotations: Map<string, number> = new Map();
  private lastPositions: Map<string, { x: number; y: number }> = new Map();

  public renderVesselLiquid(
    vessel: Vessel,
    node: VesselRenderNode,
    elapsedTimeSec: number,
    getSettledMassFn?: (vesselId: string, pptId: string, actualMass: number) => number
  ): void {
    const { liquidGraphics, sedimentGraphics, meniscusGraphics } = node;
    liquidGraphics.clear();
    sedimentGraphics.clear();
    meniscusGraphics.clear();

    const volMl = vessel.currentVolumeMl;
    const maxVolMl = Math.max(1, vessel.maxVolumeMl);

    // Track angular & linear motion for damped slosh oscillation
    const prevRot = this.lastRotations.get(vessel.id) ?? vessel.rotationRad;
    const prevPos = this.lastPositions.get(vessel.id) ?? { x: vessel.x, y: vessel.y };
    const dRot = vessel.rotationRad - prevRot;
    const dPos = Math.hypot(vessel.x - prevPos.x, vessel.y - prevPos.y);

    this.lastRotations.set(vessel.id, vessel.rotationRad);
    this.lastPositions.set(vessel.id, { x: vessel.x, y: vessel.y });

    let slosh = this.sloshEnergies.get(vessel.id) ?? 0;
    slosh = slosh * 0.92 + Math.min(0.35, Math.abs(dRot) * 2.5 + dPos * 0.008);
    if (slosh < 0.001) slosh = 0;
    this.sloshEnergies.set(vessel.id, slosh);
    vessel.angularVelocity = dRot * 60;

    if (volMl <= 0.02) {
      return;
    }

    const spec = vessel.spec;
    const halfH = spec.height / 2;
    const usableHeight = spec.height - 10;
    const fillRatio = Math.max(0, Math.min(0.98, volMl / maxVolMl));

    const surfaceDistFromCenter = halfH - 4 - fillRatio * usableHeight;

    // Counter-rotate world-horizontal surface normal by -vessel.rotationRad
    const sloshAngle = Math.sin(elapsedTimeSec * 12) * slosh;
    const counterAngle = -vessel.rotationRad + sloshAngle;

    const downX = Math.sin(vessel.rotationRad - sloshAngle);
    const downY = Math.cos(vessel.rotationRad - sloshAngle);

    const tangX = Math.cos(counterAngle);
    const tangY = Math.sin(counterAngle);

    const surfCenterX = downX * surfaceDistFromCenter;
    const surfCenterY = downY * surfaceDistFromCenter;

    const span = Math.max(spec.width, spec.baseWidth ?? spec.width, spec.height) * 1.8;

    const p1x = surfCenterX - tangX * span;
    const p1y = surfCenterY - tangY * span;
    const p2x = surfCenterX + tangX * span;
    const p2y = surfCenterY + tangY * span;
    const p3x = p2x + downX * span * 2;
    const p3y = p2y + downY * span * 2;
    const p4x = p1x + downX * span * 2;
    const p4y = p1y + downY * span * 2;

    // 1. Beer-Lambert Solution Color Fill
    const state = vessel.getChemistryState();
    const [r, g, b, alpha] = state.solutionColorRgba;
    const hexColor = (r << 16) | (g << 8) | b;

    liquidGraphics
      .moveTo(p1x, p1y)
      .lineTo(p2x, p2y)
      .lineTo(p3x, p3y)
      .lineTo(p4x, p4y)
      .closePath()
      .fill({ color: hexColor, alpha: Math.max(0.18, alpha) });

    // 2. Stacked Precipitate Sediment Layers at the lowest gravity point
    // Visual thickness grows smoothly as PrecipitateEmitter crystals settle to the bottom
    const precipEntries = Array.from(vessel.precipitates.values());
    if (precipEntries.length > 0) {
      const maxDepth = halfH - 2;
      let currentSedimentOffset = maxDepth;

      for (const ppt of precipEntries) {
        const effectiveSettledGrams = getSettledMassFn
          ? getSettledMassFn(vessel.id, ppt.id, ppt.massGrams)
          : ppt.massGrams;

        if (effectiveSettledGrams <= 1e-4) continue;
        const layerThickness = Math.min(
          26,
          Math.max(3, Math.log1p(effectiveSettledGrams * 10) * 8)
        );
        const topOffset = currentSedimentOffset - layerThickness;

        const sCenterX = downX * topOffset;
        const sCenterY = downY * topOffset;

        const sp1x = sCenterX - tangX * span;
        const sp1y = sCenterY - tangY * span;
        const sp2x = sCenterX + tangX * span;
        const sp2y = sCenterY + tangY * span;
        const sp3x = sp2x + downX * (layerThickness + 30);
        const sp3y = sp2y + downY * (layerThickness + 30);
        const sp4x = sp1x + downX * (layerThickness + 30);
        const sp4y = sp1y + downY * (layerThickness + 30);

        const cleanHex = parseInt(ppt.colorHex.replace('#', ''), 16);

        sedimentGraphics
          .moveTo(sp1x, sp1y)
          .lineTo(sp2x, sp2y)
          .lineTo(sp3x, sp3y)
          .lineTo(sp4x, sp4y)
          .closePath()
          .fill({ color: Number.isNaN(cleanHex) ? 0xf8fafc : cleanHex, alpha: 0.92 });

        currentSedimentOffset = topOffset;
      }
    }

    // 3. 2px Bright Meniscus Highlight along the top liquid-air boundary (0xFFFFFF, alpha 0.35)
    meniscusGraphics
      .moveTo(p1x, p1y)
      .lineTo(p2x, p2y)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.35 });
  }
}
