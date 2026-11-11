// Seeded pseudo-random numbers (plan 2.4). sfc32, seeded by FNV-1a over UTF-8 bytes.
// Every column (and every composite-key group) owns its stream, so adding a table or a
// column never changes another column's values. No Math.random, no clock.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over the UTF-8 bytes of `parts` joined by NUL. */
export function hash32(...parts: (string | number)[]): number {
  const bytes = Buffer.from(parts.map(String).join('\u0000'), 'utf8');
  let h = FNV_OFFSET;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number, ...parts: (string | number)[]) {
    this.a = hash32(seed, ...parts, 'a');
    this.b = hash32(seed, ...parts, 'b');
    this.c = hash32(seed, ...parts, 'c');
    this.d = hash32(seed, ...parts, 'd');
    for (let i = 0; i < 15; i++) this.nextUint32();
  }

  /** sfc32 step: an unsigned 32-bit integer. */
  nextUint32(): number {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return t >>> 0;
  }

  /** Uniform in [0, 1) with 53 bits. */
  float(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform integer in [0, n), n ≥ 1 (exact up to 2^53). */
  int(n: number): number {
    if (n <= 1) return 0;
    if (n <= 0x100000000) {
      // Rejection sampling over 32 bits: no modulo bias.
      const limit = Math.floor(0x100000000 / n) * n;
      for (;;) {
        const x = this.nextUint32();
        if (x < limit) return x % n;
      }
    }
    return Math.floor(this.float() * n);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return p > 0 && this.float() < p;
  }
}

/**
 * Distinct indices in [0, n) in random order, without allocating n slots
 * (a lazy Fisher-Yates shuffle over a sparse map).
 */
export function* shuffledIndices(prng: Prng, n: number): Generator<number> {
  const swapped = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const j = i + prng.int(n - i);
    const vj = swapped.get(j) ?? j;
    const vi = swapped.get(i) ?? i;
    swapped.set(j, vi);
    swapped.delete(i);
    yield vj;
  }
}
