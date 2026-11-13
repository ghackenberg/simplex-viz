/**
 * Deterministic 32-bit Mulberry32 pseudo-random number generator.
 */
export class DeterministicRng {
  private state: number;

  constructor(seed = 0x51a7c0de) {
    this.state = seed >>> 0;
  }

  /** Returns a float in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in `[0, maxExclusive - 1]`. */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return Math.floor(this.next() * maxExclusive);
  }
}
