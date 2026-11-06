import { ColorRgba, VesselState } from '../chemistry/types';

export type ApparatusTypeId =
  | 'beaker_250'
  | 'erlenmeyer_250'
  | 'test_tube_50'
  | 'burette_50';

export interface Point2D {
  x: number;
  y: number;
}

export type MouthSegment = [Point2D, Point2D];

export interface ApparatusSpec {
  id: ApparatusTypeId;
  name: string;
  category: 'beaker' | 'flask' | 'test_tube' | 'burette';
  width: number;
  baseWidth?: number;
  neckWidth?: number;
  height: number;
  maxVolumeMl: number;
  wallThickness?: number;
  basePourAngleDeg?: number;
  spoutOffsetLeft: [number, number];
  spoutOffsetRight: [number, number];
  stopcockMaxFlowMlPerSec?: number;
  thermalConductivity?: number;
}

export interface SpoutInfo {
  side: 'left' | 'right' | 'bottom';
  localOffset: [number, number];
  worldPosition: Point2D;
}

export interface PourStream {
  sourceVesselId: string;
  targetVesselId: string | null;
  spoutWorld: Point2D;
  streamEndWorld: Point2D;
  flowRateMlPerSec: number;
  transferredVolumeMlThisTick: number;
  colorRgba: ColorRgba;
}

export interface VesselSnapshot {
  id: string;
  label: string;
  type: ApparatusTypeId;
  spec: ApparatusSpec;
  x: number;
  y: number;
  rotationRad: number;
  rotationDeg: number;
  isDragged: boolean;
  isAgitated: boolean;
  snappedToId?: string;
  stopcockOpenRatio: number;
  currentVolumeMl: number;
  maxVolumeMl: number;
  temperatureC: number;
  boilingPointC: number;
  evaporatedSteamMoles: number;
  activeSteamRate: number;
  worldSpout: Point2D;
  mouthSegment: MouthSegment;
  chemistryState: VesselState;
}

export interface BurnerSnapshot {
  id: string;
  x: number;
  y: number;
  isLit: boolean;
  airHoleOpenRatio: number;
  flameTemperatureC: number;
  thermalPowerWatts: number;
}

export interface WorkbenchSnapshot {
  simTimeSeconds: number;
  tickCount: number;
  vessels: VesselSnapshot[];
  burners: BurnerSnapshot[];
  activePourStreams: PourStream[];
}
