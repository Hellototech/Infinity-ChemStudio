import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Burner } from '../core/apparatus/Burner';
import { Vessel } from '../core/apparatus/Vessel';

interface BurnerVisualNode {
  burnerId: string;
  container: Container;
  hardwareGraphics: Graphics;
  flameGraphics: Graphics;
  hazeGraphics: Graphics;
  statusLabel: Text;
  subLabel: Text;
}

/**
 * High-precision CAD vector renderer for the Bunsen Burner apparatus:
 * - Heavy cast-iron base, gas intake nozzle, vertical barrel tube, rotatable air-hole collar ring
 * - Multi-zone 60fps procedural Bezier flame (Outer oxidizing mantle + Inner reducing cone)
 * - Radial thermal distortion / heat-haze indicator lines when heating a vessel
 */
export class BurnerRenderer {
  private parentLayer: Container;
  private nodes: Map<string, BurnerVisualNode> = new Map();

  constructor(parentLayer: Container) {
    this.parentLayer = parentLayer;
  }

  public syncBurners(
    burners: Burner[],
    vessels: Vessel[],
    elapsedTimeSec: number
  ): void {
    const activeIds = new Set<string>();

    for (const burner of burners) {
      activeIds.add(burner.id);
      let node = this.nodes.get(burner.id);

      if (!node) {
        node = this.createBurnerNode(burner);
        this.nodes.set(burner.id, node);
        this.parentLayer.addChild(node.container);
      }

      node.container.position.set(burner.x, burner.y);

      const isHeatingAnyVessel = vessels.some((v) =>
        burner.isVesselInHeatingZone(v)
      );

      this.drawHardwareChassis(node.hardwareGraphics, burner);
      this.drawMultiZoneFlame(node.flameGraphics, burner, elapsedTimeSec);
      this.drawThermalHaze(
        node.hazeGraphics,
        burner,
        isHeatingAnyVessel,
        elapsedTimeSec
      );

      if (burner.isLit) {
        const modeText =
          burner.airHoleOpenRatio >= 0.6
            ? 'ROARING BLUE'
            : burner.airHoleOpenRatio <= 0.25
            ? 'SAFETY FLAME'
            : 'MIXED FLAME';
        node.statusLabel.text = `BUNSEN ON · ${Math.round(
          burner.flameTemperatureC
        )}°C · ${Math.round(burner.thermalPowerWatts)}W`;
        node.statusLabel.style.fill = 0xe5a93c;
        node.subLabel.text = `AIR COLLAR ${(burner.airHoleOpenRatio * 100).toFixed(
          0
        )}% (${modeText}) · SCROLL COLLAR`;
      } else {
        node.statusLabel.text = 'BUNSEN OFF [CLICK BASE TO IGNITE]';
        node.statusLabel.style.fill = 0x7a828e;
        node.subLabel.text = `AIR COLLAR ${(burner.airHoleOpenRatio * 100).toFixed(
          0
        )}% · SCROLL COLLAR TO ADJUST`;
      }
    }

    for (const [id, node] of this.nodes.entries()) {
      if (!activeIds.has(id)) {
        this.parentLayer.removeChild(node.container);
        node.container.destroy({ children: true });
        this.nodes.delete(id);
      }
    }
  }

  private createBurnerNode(burner: Burner): BurnerVisualNode {
    const container = new Container();
    const hazeGraphics = new Graphics();
    const flameGraphics = new Graphics();
    const hardwareGraphics = new Graphics();

    const statusLabel = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fontWeight: '600',
        fill: 0x7a828e,
      }),
    });
    statusLabel.anchor.set(0.5, 0);
    statusLabel.position.set(0, 62);

    const subLabel = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 8,
        fill: 0x7a828e,
      }),
    });
    subLabel.anchor.set(0.5, 0);
    subLabel.position.set(0, 74);

    container.addChild(hazeGraphics);
    container.addChild(flameGraphics);
    container.addChild(hardwareGraphics);
    container.addChild(statusLabel);
    container.addChild(subLabel);

    return {
      burnerId: burner.id,
      container,
      hardwareGraphics,
      flameGraphics,
      hazeGraphics,
      statusLabel,
      subLabel,
    };
  }

  /**
   * 1. Hardware Chassis:
   * Tripod heating stand, ceramic gauze pad, heavy cast-iron base, gas intake nozzle,
   * vertical barrel tube, and rotatable air-hole collar ring.
   */
  private drawHardwareChassis(g: Graphics, burner: Burner): void {
    g.clear();

    // Structural Tripod Stand Legs & Ceramic Wire Gauze Pad at y = -5
    // (Supports vessels snapped at y = 190 whose base is at y = 190 + 55 = 245)
    g.moveTo(-44, 55)
      .lineTo(-32, -5)
      .lineTo(32, -5)
      .lineTo(44, 55)
      .stroke({ width: 1.5, color: 0x475569, alpha: 0.85 });

    // Ceramic wire gauze pad with technical hatch ticks
    g.rect(-36, -7, 72, 3)
      .fill({ color: 0x181b20 })
      .stroke({ width: 1.5, color: 0x94a3b8, alpha: 0.9 });

    // Side gas intake nozzle & ribbed hose barb on left of barrel base
    g.moveTo(-22, 41)
      .lineTo(-8, 41)
      .lineTo(-8, 45)
      .lineTo(-22, 45)
      .closePath()
      .fill({ color: 0x181b20 })
      .stroke({ width: 1.2, color: 0x94a3b8 });

    // Heavy stepped cast-iron base sitting on bench deck (y = +55 -> world y = 305)
    g.moveTo(-28, 55)
      .lineTo(-22, 47)
      .lineTo(22, 47)
      .lineTo(28, 55)
      .closePath()
      .fill({ color: 0x181b20 })
      .stroke({ width: 1.5, color: 0x94a3b8 });

    // Vertical barrel chimney tube (#181B20 fill, #94A3B8 stroke)
    g.rect(-6.5, 14, 13, 33)
      .fill({ color: 0x181b20 })
      .stroke({ width: 1.5, color: 0x94a3b8 });

    // Burner crown rim at y = 14
    g.rect(-7.5, 12, 15, 2.5)
      .fill({ color: 0x181b20 })
      .stroke({ width: 1.2, color: 0x94a3b8 });

    // Rotatable Air-Hole Collar Ring (y = 35..43)
    const collarAccent = burner.isLit ? 0x38bdf8 : 0x94a3b8;
    g.rect(-9, 35, 18, 8)
      .fill({ color: 0x111317 })
      .stroke({ width: 1.2, color: collarAccent });

    // Air intake aperture window proportional to burner.airHoleOpenRatio
    const apertureWidth = Math.max(0.5, burner.airHoleOpenRatio * 7.5);
    g.rect(-apertureWidth * 0.5, 36.5, apertureWidth, 5).fill({
      color: burner.isLit ? 0x38bdf8 : 0x475569,
      alpha: 0.85,
    });
  }

  /**
   * 2. Multi-Zone Procedural Flame:
   * - Outer Oxidizing Mantle: Translucent violet-blue (0x38BDF8, alpha 0.35) near 1.0,
   *   shifting to luminous safety yellow-orange (0xF59E0B, alpha 0.75) near 0.0.
   * - Inner Reducing Cone: Crisp cyan-white core (0xE0F2FE, alpha 0.85) whose height
   *   contracts and sharpens as air intake increases.
   */
  private drawMultiZoneFlame(
    g: Graphics,
    burner: Burner,
    elapsedTimeSec: number
  ): void {
    g.clear();
    if (!burner.isLit) return;

    const ratio = burner.airHoleOpenRatio;

    // Interpolate Outer Oxidizing Mantle color between 0xF59E0B (ratio=0) and 0x38BDF8 (ratio=1)
    const r = Math.round(0xf5 + (0x38 - 0xf5) * ratio);
    const gr = Math.round(0x9e + (0xbd - 0x9e) * ratio);
    const b = Math.round(0x0b + (0xf8 - 0x0b) * ratio);
    const outerColor = (r << 16) | (gr << 8) | b;
    const outerAlpha = 0.75 + (0.35 - 0.75) * ratio;

    // Harmonic noise flicker
    const n1 = Math.sin(elapsedTimeSec * 31.4) * 1.6;
    const n2 = Math.cos(elapsedTimeSec * 22.7) * 1.2;
    const tipJitterX = (n1 + n2) * (1.2 - ratio * 0.5);
    const tipJitterY = Math.sin(elapsedTimeSec * 39.1) * 1.8;

    const baseY = 12;
    // Outer mantle reaches up toward the tripod gauze at y = -5
    const outerTipY = -12 + (1 - ratio) * -6 + tipJitterY;
    const outerSpread = 12 + (1 - ratio) * 5;

    // Outer Oxidizing Mantle Bezier Envelope
    g.moveTo(-6.5, baseY)
      .bezierCurveTo(
        -outerSpread,
        baseY - 8,
        -outerSpread * 0.65 + tipJitterX * 0.5,
        outerTipY + 8,
        tipJitterX,
        outerTipY
      )
      .bezierCurveTo(
        outerSpread * 0.65 + tipJitterX * 0.5,
        outerTipY + 8,
        outerSpread,
        baseY - 8,
        6.5,
        baseY
      )
      .closePath()
      .fill({ color: outerColor, alpha: outerAlpha });

    // Inner Reducing Cone (0xE0F2FE, alpha 0.85) — contracts and sharpens as air intake increases
    const innerTipY = baseY - (10 + ratio * 9) + tipJitterY * 0.4;
    const innerSpread = 4.5 - ratio * 1.2;

    g.moveTo(-4.2, baseY)
      .bezierCurveTo(
        -innerSpread,
        baseY - 5,
        -innerSpread * 0.4,
        innerTipY + 3,
        tipJitterX * 0.3,
        innerTipY
      )
      .bezierCurveTo(
        innerSpread * 0.4,
        innerTipY + 3,
        innerSpread,
        baseY - 5,
        4.2,
        baseY
      )
      .closePath()
      .fill({ color: 0xe0f2fe, alpha: 0.85 });
  }

  /**
   * Radial thermal distortion / heat-haze indicator lines above the flame tip when heating a vessel.
   */
  private drawThermalHaze(
    g: Graphics,
    burner: Burner,
    isHeatingVessel: boolean,
    elapsedTimeSec: number
  ): void {
    g.clear();
    if (!burner.isLit || !isHeatingVessel) return;

    for (let row = 0; row < 3; row++) {
      const yBase = -11 - row * 5;
      const phase = elapsedTimeSec * 14 + row * 1.4;
      const waveAmp = 1.6;

      g.moveTo(-22, yBase);
      for (let x = -18; x <= 22; x += 8) {
        const wy = yBase + Math.sin(phase + x * 0.25) * waveAmp;
        g.lineTo(x, wy);
      }
      g.stroke({
        width: 1,
        color: 0xe5a93c,
        alpha: 0.28 - row * 0.06,
      });
    }
  }
}
