export interface ParticleStruct {
  readonly index: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: number;
  age: number;
  maxLife: number;
  wobblePhase: number;
  wobbleSpeed: number;
  kind: number;
  vesselId: string;
  precipitateId: string;
  massContribution: number;
}

export interface ParticleSpawnConfig {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius?: number;
  alpha?: number;
  color?: number;
  maxLife?: number;
  wobblePhase?: number;
  wobbleSpeed?: number;
  kind?: number;
  vesselId?: string;
  precipitateId?: string;
  massContribution?: number;
}

/**
 * Zero-allocation, pre-allocated object pool (default capacity: 2048 particles)
 * for high-frequency 60fps WebGL particle recycling without GC pressure.
 */
export class ParticlePool {
  public static readonly DEFAULT_CAPACITY = 2048;

  public readonly capacity: number;
  private readonly pool: ParticleStruct[];
  private readonly freeStack: Int32Array;
  private freeTop: number;
  private activeCount: number = 0;

  constructor(capacity: number = ParticlePool.DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.pool = new Array<ParticleStruct>(capacity);
    this.freeStack = new Int32Array(capacity);
    this.freeTop = capacity - 1;

    for (let i = 0; i < capacity; i++) {
      this.pool[i] = {
        index: i,
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 2,
        alpha: 1,
        color: 0xffffff,
        age: 0,
        maxLife: 1,
        wobblePhase: 0,
        wobbleSpeed: 0,
        kind: 0,
        vesselId: '',
        precipitateId: '',
        massContribution: 0,
      };
      // Push indices in reverse so index 0 is popped first
      this.freeStack[i] = capacity - 1 - i;
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Activates the next available particle slot in O(1) time.
   */
  public spawn(config: ParticleSpawnConfig): ParticleStruct | null {
    if (this.freeTop < 0) {
      return null;
    }

    const slotIndex = this.freeStack[this.freeTop];
    this.freeTop -= 1;
    this.activeCount += 1;

    const p = this.pool[slotIndex];
    p.active = true;
    p.x = config.x;
    p.y = config.y;
    p.vx = config.vx ?? 0;
    p.vy = config.vy ?? 0;
    p.radius = config.radius ?? 2.0;
    p.alpha = config.alpha ?? 1.0;
    p.color = config.color ?? 0xffffff;
    p.age = 0;
    p.maxLife = config.maxLife ?? 1.5;
    p.wobblePhase = config.wobblePhase ?? 0;
    p.wobbleSpeed = config.wobbleSpeed ?? 6.0;
    p.kind = config.kind ?? 0;
    p.vesselId = config.vesselId ?? '';
    p.precipitateId = config.precipitateId ?? '';
    p.massContribution = config.massContribution ?? 0;

    return p;
  }

  /**
   * Iterates all active particles, advances age by dt, runs updaterFn,
   * and recycles expired or deactivated particles in O(1) time.
   */
  public updateAll(
    dt: number,
    updaterFn: (p: ParticleStruct, dt: number) => void
  ): void {
    if (this.activeCount === 0) return;

    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.maxLife) {
        this.recycle(p);
        continue;
      }

      updaterFn(p, dt);

      if (!p.active || p.age >= p.maxLife) {
        this.recycle(p);
      }
    }
  }

  public forEachActive(callback: (p: ParticleStruct) => void): void {
    if (this.activeCount === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) {
        callback(p);
      }
    }
  }

  public clearVesselParticles(vesselId: string): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active && p.vesselId === vesselId) {
        this.recycle(p);
      }
    }
  }

  public clearAll(): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) {
        this.recycle(p);
      }
    }
  }

  private recycle(p: ParticleStruct): void {
    if (!p.active) return;
    p.active = false;
    p.massContribution = 0;
    this.freeTop += 1;
    this.freeStack[this.freeTop] = p.index;
    this.activeCount = Math.max(0, this.activeCount - 1);
  }
}
