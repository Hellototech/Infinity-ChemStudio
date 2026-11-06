import React, { useEffect, useRef } from 'react';
import { VesselState } from '../core/chemistry/types';

interface VesselCanvasProps {
  state: VesselState;
  maxCapacityMl?: number;
}

interface BubbleParticle {
  x: number;
  y: number;
  radius: number;
  vy: number;
  wobblePhase: number;
  wobbleSpeed: number;
}

interface SedimentGrain {
  rx: number; // normalized 0..1 across vessel width
  ry: number; // normalized 0..1 within sediment bed
  size: number;
  colorHex: string;
}

export const VesselCanvas: React.FC<VesselCanvasProps> = ({
  state,
  maxCapacityMl = 250,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<VesselState>(state);
  const bubblesRef = useRef<BubbleParticle[]>([]);
  const grainsRef = useRef<SedimentGrain[]>([]);
  const meniscusWaveRef = useRef<number>(0);
  const prevVolumeRef = useRef<number>(state.volumeMl);
  const prevGasMolesRef = useRef<number>(state.totalEvolvedGasMoles);
  const effervescenceTimerRef = useRef<number>(0);

  useEffect(() => {
    // Trigger meniscus wave impulse when volume changes
    if (Math.abs(state.volumeMl - prevVolumeRef.current) > 0.1) {
      meniscusWaveRef.current = 1.0;
      prevVolumeRef.current = state.volumeMl;
    }

    // Trigger active bubble burst when new gas evolves
    if (state.totalEvolvedGasMoles > prevGasMolesRef.current + 1e-6) {
      effervescenceTimerRef.current = 4.2; // seconds of visible effervescence
      prevGasMolesRef.current = state.totalEvolvedGasMoles;
    } else if (state.volumeMl === 0) {
      prevGasMolesRef.current = 0;
      effervescenceTimerRef.current = 0;
      bubblesRef.current = [];
    }

    // Rebuild deterministic sediment grain distribution when precipitates change
    const precipList = Object.values(state.precipitates);
    if (precipList.length === 0) {
      grainsRef.current = [];
    } else {
      const totalGrams = precipList.reduce((acc, p) => acc + p.massGrams, 0);
      const targetCount = Math.min(280, Math.max(40, Math.floor(totalGrams * 180)));
      if (grainsRef.current.length !== targetCount) {
        const newGrains: SedimentGrain[] = [];
        for (let i = 0; i < targetCount; i++) {
          // Pick precipitate color weighted by mass
          let rWeight = ((i * 9301 + 49297) % 233280) / 233280 * totalGrams;
          let chosenColor = precipList[0].colorHex;
          for (const p of precipList) {
            if (rWeight <= p.massGrams) {
              chosenColor = p.colorHex;
              break;
            }
            rWeight -= p.massGrams;
          }
          const rx = (((i * 16807) % 2147483647) / 2147483647);
          const ry = (((i * 48271) % 2147483647) / 2147483647);
          newGrains.push({
            rx,
            ry,
            size: 1.5 + (i % 3) * 0.65,
            colorHex: chosenColor,
          });
        }
        grainsRef.current = newGrains;
      }
    }

    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const current = stateRef.current;

      // Clear background
      ctx.clearRect(0, 0, width, height);

      // CAD Technical Crosshair & Coordinate Reticle
      ctx.strokeStyle = 'rgba(34, 38, 46, 0.7)';
      ctx.lineWidth = 1;
      const centerX = Math.floor(width / 2) + 0.5;
      const centerY = Math.floor(height / 2) + 0.5;

      ctx.beginPath();
      ctx.moveTo(centerX, 16);
      ctx.lineTo(centerX, height - 16);
      ctx.moveTo(16, centerY);
      ctx.lineTo(width - 16, centerY);
      ctx.stroke();

      // Vessel Geometry (250 mL Borosilicate Cylindrical Beaker)
      const beakerWidth = Math.min(260, Math.max(180, width * 0.44));
      const beakerHeight = Math.min(340, Math.max(220, height * 0.68));
      const bx = Math.floor((width - beakerWidth) / 2);
      const by = Math.floor((height - beakerHeight) / 2) + 10;
      const bRight = bx + beakerWidth;
      const bBottom = by + beakerHeight;
      const cornerRadius = 8;

      // Decay meniscus wave
      if (meniscusWaveRef.current > 0.001) {
        meniscusWaveRef.current *= Math.pow(0.18, dt);
      } else {
        meniscusWaveRef.current = 0;
      }

      // Compute liquid height from volume
      const fillRatio = Math.max(
        0,
        Math.min(0.95, current.volumeMl / maxCapacityMl)
      );
      const maxLiquidPlotHeight = beakerHeight - 24;
      const liquidHeight = fillRatio * maxLiquidPlotHeight;
      const liquidTopY = bBottom - liquidHeight;

      // Draw liquid body if volume > 0
      if (current.volumeMl > 0.01) {
        ctx.save();
        // Clip inside vessel interior
        ctx.beginPath();
        ctx.moveTo(bx + 2, by + 4);
        ctx.lineTo(bx + 2, bBottom - cornerRadius);
        ctx.quadraticCurveTo(bx + 2, bBottom - 2, bx + cornerRadius, bBottom - 2);
        ctx.lineTo(bRight - cornerRadius, bBottom - 2);
        ctx.quadraticCurveTo(bRight - 2, bBottom - 2, bRight - 2, bBottom - cornerRadius);
        ctx.lineTo(bRight - 2, by + 4);
        ctx.closePath();
        ctx.clip();

        const [r, g, b, a] = current.solutionColorRgba;

        // Dynamic wave path along liquid surface
        ctx.beginPath();
        const waveAmp = meniscusWaveRef.current * 4.5;
        const segments = 32;
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const px = bx + 2 + t * (beakerWidth - 4);
          const waveOffset =
            Math.sin(t * Math.PI * 3 + now * 0.008) * waveAmp +
            Math.cos(t * Math.PI * 2 - now * 0.005) * (waveAmp * 0.5);
          // Concave capillary meniscus at walls
          const wallDist = Math.min(t, 1 - t);
          const meniscusCurve = -Math.exp(-wallDist * 18) * 3.5;
          const py = liquidTopY + waveOffset + meniscusCurve;
          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.lineTo(bRight - 2, bBottom);
        ctx.lineTo(bx + 2, bBottom);
        ctx.closePath();

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.fill();

        // Subtle optical depth gradient from Beer-Lambert path length
        const depthGrad = ctx.createLinearGradient(bx, liquidTopY, bx, bBottom);
        depthGrad.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
        depthGrad.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
        ctx.fillStyle = depthGrad;
        ctx.fill();

        // Meniscus specular hairline
        ctx.strokeStyle = `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, ${Math.min(0.85, a + 0.25)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const px = bx + 2 + t * (beakerWidth - 4);
          const waveOffset =
            Math.sin(t * Math.PI * 3 + now * 0.008) * waveAmp +
            Math.cos(t * Math.PI * 2 - now * 0.005) * (waveAmp * 0.5);
          const wallDist = Math.min(t, 1 - t);
          const meniscusCurve = -Math.exp(-wallDist * 18) * 3.5;
          const py = liquidTopY + waveOffset + meniscusCurve;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Render Precipitate Sediment Layer at Bottom of Beaker
        const precipList = Object.values(current.precipitates);
        if (precipList.length > 0) {
          const totalGrams = precipList.reduce((acc, p) => acc + p.massGrams, 0);
          const sedimentHeight = Math.min(
            42,
            Math.max(8, Math.log1p(totalGrams * 8) * 12)
          );
          const sedimentTopY = bBottom - sedimentHeight;

          // Base solid sediment mound
          const primaryPrecip = precipList[precipList.length - 1];
          ctx.fillStyle = primaryPrecip.colorHex;
          ctx.globalAlpha = 0.88;
          ctx.beginPath();
          ctx.moveTo(bx + 2, bBottom - 2);
          ctx.lineTo(bx + 2, sedimentTopY + 3);
          ctx.quadraticCurveTo(
            bx + beakerWidth * 0.5,
            sedimentTopY - 3,
            bRight - 2,
            sedimentTopY + 3
          );
          ctx.lineTo(bRight - 2, bBottom - 2);
          ctx.closePath();
          ctx.fill();

          // Crystalline / flocculent micro-grains
          ctx.globalAlpha = 0.95;
          for (const grain of grainsRef.current) {
            const gx = bx + 6 + grain.rx * (beakerWidth - 12);
            const gy =
              sedimentTopY + grain.ry * Math.max(4, sedimentHeight - 4);
            ctx.fillStyle = grain.colorHex;
            ctx.fillRect(gx, gy, grain.size, grain.size);
          }
          ctx.globalAlpha = 1.0;
        }

        // Effervescence CO2 Gas Bubble Simulation
        if (effervescenceTimerRef.current > 0) {
          effervescenceTimerRef.current = Math.max(
            0,
            effervescenceTimerRef.current - dt
          );
          // Spawn new bubbles proportional to remaining effervescence timer
          const spawnCount = Math.ceil(effervescenceTimerRef.current * 2.5);
          for (let s = 0; s < spawnCount; s++) {
            if (bubblesRef.current.length < 90) {
              bubblesRef.current.push({
                x: bx + 14 + Math.random() * (beakerWidth - 28),
                y: bBottom - 8 - Math.random() * 16,
                radius: 1.2 + Math.random() * 2.4,
                vy: 55 + Math.random() * 65,
                wobblePhase: Math.random() * Math.PI * 2,
                wobbleSpeed: 4 + Math.random() * 4,
              });
            }
          }
        }

        if (bubblesRef.current.length > 0) {
          ctx.strokeStyle = 'rgba(236, 239, 244, 0.72)';
          ctx.fillStyle = 'rgba(236, 239, 244, 0.18)';
          ctx.lineWidth = 1;

          const survivingBubbles: BubbleParticle[] = [];
          for (const bParticle of bubblesRef.current) {
            bParticle.y -= bParticle.vy * dt;
            bParticle.wobblePhase += bParticle.wobbleSpeed * dt;
            const drawX =
              bParticle.x + Math.sin(bParticle.wobblePhase) * 2.2;

            if (bParticle.y > liquidTopY + 2) {
              ctx.beginPath();
              ctx.arc(drawX, bParticle.y, bParticle.radius, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              survivingBubbles.push(bParticle);
            }
          }
          bubblesRef.current = survivingBubbles;
        }

        ctx.restore();
      }

      // Thermal Warning Aura Hairline if Exothermic (> 28 °C)
      if (current.temperatureC > 28.0) {
        const heatIntensity = Math.min(
          0.65,
          (current.temperatureC - 25.0) / 20.0
        );
        ctx.strokeStyle = `rgba(229, 169, 60, ${heatIntensity.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 6.5, by - 6.5, beakerWidth + 13, beakerHeight + 13);
      }

      // Draw Vessel Structural Outline (Precision CAD Glassware)
      ctx.strokeStyle = '#ECEFF4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Left pouring lip
      ctx.moveTo(bx - 6, by);
      ctx.lineTo(bx, by + 5);
      ctx.lineTo(bx, bBottom - cornerRadius);
      ctx.quadraticCurveTo(bx, bBottom, bx + cornerRadius, bBottom);
      ctx.lineTo(bRight - cornerRadius, bBottom);
      ctx.quadraticCurveTo(bRight, bBottom, bRight, bBottom - cornerRadius);
      ctx.lineTo(bRight, by + 5);
      ctx.lineTo(bRight + 5, by);
      ctx.stroke();

      // Graduated Volumetric Tick Marks & Monospace Labels (50, 100, 150, 200, 250 mL)
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#7A828E';
      ctx.strokeStyle = 'rgba(236, 239, 244, 0.32)';
      ctx.lineWidth = 1;

      const stepMl = 25;
      for (let vol = stepMl; vol <= maxCapacityMl; vol += stepMl) {
        const ratio = vol / maxCapacityMl;
        const tickY = Math.floor(bBottom - ratio * maxLiquidPlotHeight) + 0.5;
        const isMajor = vol % 50 === 0;
        const tickLen = isMajor ? 18 : 10;

        ctx.beginPath();
        ctx.moveTo(bRight - tickLen - 6, tickY);
        ctx.lineTo(bRight - 6, tickY);
        ctx.stroke();

        if (isMajor) {
          ctx.textAlign = 'right';
          ctx.fillText(`${vol} mL`, bRight - tickLen - 10, tickY + 3);
        }
      }

      // CAD Dimension & Optical Callout Lines
      ctx.strokeStyle = '#22262E';
      ctx.fillStyle = '#7A828E';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';

      // Bottom vessel capacity stamp
      ctx.fillText(
        `VESSEL: BOROSILICATE-250ML // PATH: 1.50 CM`,
        14,
        height - 12
      );

      // Live Meniscus Level Callout on Left Side of Beaker
      if (current.volumeMl > 0) {
        const markerY = Math.max(by + 12, Math.min(bBottom - 4, liquidTopY));
        ctx.strokeStyle = '#38BDF8';
        ctx.beginPath();
        ctx.moveTo(bx - 42, markerY);
        ctx.lineTo(bx - 4, markerY);
        ctx.stroke();

        ctx.fillStyle = '#38BDF8';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${current.volumeMl.toFixed(1)} mL`,
          bx - 46,
          markerY + 3
        );
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [maxCapacityMl]);

  return (
    <div className="relative w-full h-full min-h-[380px] cad-grid-bg overflow-hidden select-none cursor-crosshair">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
};
