import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Vessel } from '../core/apparatus/Vessel';
import { LiquidRenderer } from './LiquidRenderer';

export interface VesselRenderNode {
  vesselId: string;
  rootContainer: Container;
  interiorMask: Graphics;
  liquidContainer: Container;
  liquidGraphics: Graphics;
  sedimentGraphics: Graphics;
  crystalGraphics: Graphics;
  bubbleGraphics: Graphics;
  meniscusGraphics: Graphics;
  glassOutline: Graphics;
  selectionRing: Graphics;
  captionText: Text;
  readoutText: Text;
}

/**
 * Procedural vector glassware renderer using the Pixi.js v8 Graphics path API.
 * Draws scalable technical glassware, volumetric graduations, interior clipping masks,
 * and Lab Cyan (#38BDF8) selection reticles.
 */
export class GlasswareRenderer {
  private nodes: Map<string, VesselRenderNode> = new Map();
  private liquidRenderer: LiquidRenderer;
  private parentLayer: Container;

  constructor(parentLayer: Container, liquidRenderer: LiquidRenderer) {
    this.parentLayer = parentLayer;
    this.liquidRenderer = liquidRenderer;
  }

  public getBubbleGraphicsMap(): Map<string, Graphics> {
    const map = new Map<string, Graphics>();
    for (const [id, node] of this.nodes.entries()) {
      map.set(id, node.bubbleGraphics);
    }
    return map;
  }

  public getCrystalGraphicsMap(): Map<string, Graphics> {
    const map = new Map<string, Graphics>();
    for (const [id, node] of this.nodes.entries()) {
      map.set(id, node.crystalGraphics);
    }
    return map;
  }

  public syncVessels(
    vessels: Vessel[],
    selectedVesselId: string | null,
    hoveredVesselId: string | null,
    elapsedTimeSec: number,
    getSettledMassFn?: (vesselId: string, pptId: string, actualMass: number) => number
  ): void {
    const activeIds = new Set<string>();

    for (const vessel of vessels) {
      activeIds.add(vessel.id);
      let node = this.nodes.get(vessel.id);

      if (!node) {
        node = this.createVesselNode(vessel);
        this.nodes.set(vessel.id, node);
        this.parentLayer.addChild(node.rootContainer);
      }

      // Update world transform
      node.rootContainer.position.set(vessel.x, vessel.y);
      node.rootContainer.rotation = vessel.rotationRad;

      // Update Layer B (Liquid & Sediment masked by interiorMask)
      this.liquidRenderer.renderVesselLiquid(
        vessel,
        node,
        elapsedTimeSec,
        getSettledMassFn
      );

      // Update Layer D (Selection / Hover Bounding Reticle)
      const isSelected = vessel.id === selectedVesselId;
      const isHovered = vessel.id === hoveredVesselId;
      this.drawSelectionRing(node.selectionRing, vessel, isSelected, isHovered);

      // Keep telemetry readout upright below the vessel
      const state = vessel.getChemistryState();
      node.captionText.rotation = -vessel.rotationRad;
      node.readoutText.rotation = -vessel.rotationRad;
      node.captionText.text = `${vessel.label}`;
      node.readoutText.text = `${vessel.currentVolumeMl.toFixed(1)} mL · pH ${state.pH.toFixed(
        2
      )} · ${vessel.temperatureC.toFixed(1)}°C`;
    }

    // Cleanup removed vessels
    for (const [id, node] of this.nodes.entries()) {
      if (!activeIds.has(id)) {
        this.parentLayer.removeChild(node.rootContainer);
        node.rootContainer.destroy({ children: true });
        this.nodes.delete(id);
      }
    }
  }

  private createVesselNode(vessel: Vessel): VesselRenderNode {
    const rootContainer = new Container();

    // Layer A: Interior Mask
    const interiorMask = new Graphics();
    this.drawInteriorContour(interiorMask, vessel);

    // Layer B: Masked Liquid, Sediment, Suspended Crystals & Effervescence Bubbles Container
    const liquidContainer = new Container();
    const liquidGraphics = new Graphics();
    const sedimentGraphics = new Graphics();
    const crystalGraphics = new Graphics();
    const bubbleGraphics = new Graphics();
    const meniscusGraphics = new Graphics();

    liquidContainer.addChild(liquidGraphics);
    liquidContainer.addChild(sedimentGraphics);
    liquidContainer.addChild(crystalGraphics);
    liquidContainer.addChild(bubbleGraphics);
    liquidContainer.addChild(meniscusGraphics);
    liquidContainer.mask = interiorMask;

    // Layer C: Crisp Borosilicate Glass Outline, Specular Highlight & Graduations
    const glassOutline = new Graphics();
    this.drawGlassOutlineAndTicks(glassOutline, rootContainer, vessel);

    // Layer D: Selection / Hover Ring
    const selectionRing = new Graphics();

    // Upright CAD Telemetry Labels beneath vessel base
    const halfH = vessel.spec.height / 2;
    const captionText = new Text({
      text: vessel.label,
      style: new TextStyle({
        fontFamily: 'IBM Plex Sans, sans-serif',
        fontSize: 10,
        fontWeight: '600',
        fill: 0xeceff4,
      }),
    });
    captionText.anchor.set(0.5, 0);
    captionText.position.set(0, halfH + 10);

    const readoutText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fill: 0x7a828e,
      }),
    });
    readoutText.anchor.set(0.5, 0);
    readoutText.position.set(0, halfH + 23);

    rootContainer.addChild(interiorMask);
    rootContainer.addChild(liquidContainer);
    rootContainer.addChild(glassOutline);
    rootContainer.addChild(selectionRing);
    rootContainer.addChild(captionText);
    rootContainer.addChild(readoutText);

    return {
      vesselId: vessel.id,
      rootContainer,
      interiorMask,
      liquidContainer,
      liquidGraphics,
      sedimentGraphics,
      crystalGraphics,
      bubbleGraphics,
      meniscusGraphics,
      glassOutline,
      selectionRing,
      captionText,
      readoutText,
    };
  }

  /**
   * Layer A: Draws the closed interior polygon for masking liquid, bubbles, and precipitates.
   */
  private drawInteriorContour(g: Graphics, vessel: Vessel): void {
    g.clear();
    const spec = vessel.spec;
    const halfW = spec.width / 2;
    const halfH = spec.height / 2;
    const wall = spec.wallThickness ?? 2.5;
    const innerHalfW = halfW - wall;
    const innerTop = -halfH + 2;
    const innerBottom = halfH - wall;

    if (vessel.type === 'beaker_250') {
      const r = 6;
      g.moveTo(-innerHalfW, innerTop)
        .lineTo(-innerHalfW, innerBottom - r)
        .quadraticCurveTo(-innerHalfW, innerBottom, -innerHalfW + r, innerBottom)
        .lineTo(innerHalfW - r, innerBottom)
        .quadraticCurveTo(innerHalfW, innerBottom, innerHalfW, innerBottom - r)
        .lineTo(innerHalfW, innerTop)
        .closePath()
        .fill({ color: 0xffffff });
    } else if (vessel.type === 'erlenmeyer_250') {
      const baseHalfW = (spec.baseWidth ?? 90) / 2 - wall;
      const neckHalfW = (spec.neckWidth ?? 34) / 2 - wall;
      const neckBottomY = -halfH + 38;
      const r = 6;

      g.moveTo(-neckHalfW, innerTop)
        .lineTo(-neckHalfW, neckBottomY)
        .lineTo(-baseHalfW, innerBottom - r)
        .quadraticCurveTo(-baseHalfW, innerBottom, -baseHalfW + r, innerBottom)
        .lineTo(baseHalfW - r, innerBottom)
        .quadraticCurveTo(baseHalfW, innerBottom, baseHalfW, innerBottom - r)
        .lineTo(neckHalfW, neckBottomY)
        .lineTo(neckHalfW, innerTop)
        .closePath()
        .fill({ color: 0xffffff });
    } else if (vessel.type === 'test_tube_50') {
      const r = innerHalfW;
      g.moveTo(-innerHalfW, innerTop)
        .lineTo(-innerHalfW, innerBottom - r)
        .arc(0, innerBottom - r, r, Math.PI, 0, true)
        .lineTo(innerHalfW, innerTop)
        .closePath()
        .fill({ color: 0xffffff });
    } else if (vessel.type === 'burette_50') {
      g.rect(-innerHalfW, innerTop, innerHalfW * 2, innerBottom - innerTop - 16)
        .fill({ color: 0xffffff });
    }
  }

  /**
   * Layer C: Draws the borosilicate glass contour, specular highlight, and mL graduation marks.
   */
  private drawGlassOutlineAndTicks(
    g: Graphics,
    container: Container,
    vessel: Vessel
  ): void {
    g.clear();
    const spec = vessel.spec;
    const halfW = spec.width / 2;
    const halfH = spec.height / 2;

    if (vessel.type === 'beaker_250') {
      const r = 6;
      g.moveTo(-halfW, -halfH)
        .lineTo(-halfW, halfH - r)
        .quadraticCurveTo(-halfW, halfH, -halfW + r, halfH)
        .lineTo(halfW - r, halfH)
        .quadraticCurveTo(halfW, halfH, halfW, halfH - r)
        .lineTo(halfW, -halfH)
        .closePath()
        .fill({ color: 0x94a3b8, alpha: 0.04 });

      g.moveTo(-halfW - 4, -halfH)
        .lineTo(-halfW, -halfH + 4)
        .lineTo(-halfW, halfH - r)
        .quadraticCurveTo(-halfW, halfH, -halfW + r, halfH)
        .lineTo(halfW - r, halfH)
        .quadraticCurveTo(halfW, halfH, halfW, halfH - r)
        .lineTo(halfW, -halfH + 4)
        .lineTo(halfW + 4, -halfH)
        .stroke({ width: 2.5, color: 0x94a3b8, alpha: 0.75 });

      g.moveTo(-halfW + 5, -halfH + 10)
        .lineTo(-halfW + 5, halfH - 10)
        .stroke({ width: 1.5, color: 0xf8fafc, alpha: 0.28 });

      const usableHeight = spec.height - 14;
      for (const vol of [50, 100, 150, 200]) {
        const frac = vol / spec.maxVolumeMl;
        const ty = halfH - 4 - frac * usableHeight;
        g.moveTo(halfW - 14, ty)
          .lineTo(halfW - 4, ty)
          .stroke({ width: 1, color: 0x7a828e, alpha: 0.75 });

        const tickLabel = new Text({
          text: `${vol}`,
          style: new TextStyle({
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            fill: 0x7a828e,
          }),
        });
        tickLabel.anchor.set(1, 0.5);
        tickLabel.position.set(halfW - 16, ty);
        container.addChild(tickLabel);
      }
    } else if (vessel.type === 'erlenmeyer_250') {
      const baseHalfW = (spec.baseWidth ?? 90) / 2;
      const neckHalfW = (spec.neckWidth ?? 34) / 2;
      const neckBottomY = -halfH + 38;
      const r = 6;

      g.moveTo(-neckHalfW - 3, -halfH)
        .lineTo(-neckHalfW, -halfH + 3)
        .lineTo(-neckHalfW, neckBottomY)
        .lineTo(-baseHalfW, halfH - r)
        .quadraticCurveTo(-baseHalfW, halfH, -baseHalfW + r, halfH)
        .lineTo(baseHalfW - r, halfH)
        .quadraticCurveTo(baseHalfW, halfH, baseHalfW, halfH - r)
        .lineTo(neckHalfW, neckBottomY)
        .lineTo(neckHalfW, -halfH + 3)
        .lineTo(neckHalfW + 3, -halfH)
        .stroke({ width: 2.5, color: 0x94a3b8, alpha: 0.75 });

      g.moveTo(-neckHalfW + 4, neckBottomY + 4)
        .lineTo(-baseHalfW + 7, halfH - 10)
        .stroke({ width: 1.5, color: 0xf8fafc, alpha: 0.28 });

      const usableHeight = spec.height - 28;
      for (const vol of [50, 100, 150, 200]) {
        const frac = vol / spec.maxVolumeMl;
        const ty = halfH - 4 - frac * usableHeight;
        g.moveTo(-8, ty)
          .lineTo(8, ty)
          .stroke({ width: 1, color: 0x7a828e, alpha: 0.7 });

        const tickLabel = new Text({
          text: `${vol}`,
          style: new TextStyle({
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            fill: 0x7a828e,
          }),
        });
        tickLabel.anchor.set(0, 0.5);
        tickLabel.position.set(11, ty);
        container.addChild(tickLabel);
      }
    } else if (vessel.type === 'test_tube_50') {
      const r = halfW;
      g.moveTo(-halfW - 3, -halfH)
        .lineTo(-halfW, -halfH + 3)
        .lineTo(-halfW, halfH - r)
        .arc(0, halfH - r, r, Math.PI, 0, true)
        .lineTo(halfW, -halfH + 3)
        .lineTo(halfW + 3, -halfH)
        .stroke({ width: 2.5, color: 0x94a3b8, alpha: 0.75 });

      g.moveTo(-halfW + 4, -halfH + 8)
        .lineTo(-halfW + 4, halfH - r - 2)
        .stroke({ width: 1.5, color: 0xf8fafc, alpha: 0.28 });

      const usableHeight = spec.height - 16;
      for (const vol of [10, 20, 30, 40]) {
        const frac = vol / spec.maxVolumeMl;
        const ty = halfH - 6 - frac * usableHeight;
        g.moveTo(halfW - 7, ty)
          .lineTo(halfW - 2, ty)
          .stroke({ width: 1, color: 0x7a828e, alpha: 0.7 });
      }
    } else if (vessel.type === 'burette_50') {
      g.moveTo(-halfW, -halfH)
        .lineTo(-halfW, halfH - 16)
        .lineTo(-2, halfH - 6)
        .lineTo(-2, halfH)
        .lineTo(2, halfH)
        .lineTo(2, halfH - 6)
        .lineTo(halfW, halfH - 16)
        .lineTo(halfW, -halfH)
        .stroke({ width: 2.2, color: 0x94a3b8, alpha: 0.75 });

      g.rect(-14, halfH - 14, 28, 5)
        .fill({ color: 0x38bdf8 })
        .stroke({ width: 1, color: 0xeceff4 });
    }
  }

  /**
   * Layer D: Sharp 1px technical bounding frame in Lab Cyan (#38BDF8) with corner reticle ticks.
   */
  private drawSelectionRing(
    g: Graphics,
    vessel: Vessel,
    isSelected: boolean,
    isHovered: boolean
  ): void {
    g.clear();
    if (!isSelected && !isHovered) return;

    const pad = 8;
    const halfW = (vessel.spec.baseWidth ?? vessel.spec.width) / 2 + pad;
    const halfH = vessel.spec.height / 2 + pad;
    const alpha = isSelected ? 0.95 : 0.45;
    const tick = 7;

    g.rect(-halfW, -halfH, halfW * 2, halfH * 2).stroke({
      width: 1,
      color: 0x38bdf8,
      alpha: alpha * 0.35,
    });

    g.moveTo(-halfW, -halfH + tick)
      .lineTo(-halfW, -halfH)
      .lineTo(-halfW + tick, -halfH);
    g.moveTo(halfW - tick, -halfH)
      .lineTo(halfW, -halfH)
      .lineTo(halfW, -halfH + tick);
    g.moveTo(-halfW, halfH - tick)
      .lineTo(-halfW, halfH)
      .lineTo(-halfW + tick, halfH);
    g.moveTo(halfW - tick, halfH)
      .lineTo(halfW, halfH)
      .lineTo(halfW, halfH - tick);

    g.stroke({ width: 1.5, color: 0x38bdf8, alpha });
  }
}
