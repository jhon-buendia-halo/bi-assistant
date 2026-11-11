import { PROFILE_CACHE_MAX, PROFILE_TTL_MS } from './limits';
import type { SampledProfile } from './types';

/**
 * In-process LRU of sampled profiles (plan 2.3): at most PROFILE_CACHE_MAX
 * entries, each kept PROFILE_TTL_MS from creation. Nothing is persisted.
 * The clock is injected so tests do not wait.
 */
export class ProfileCache {
  private readonly entries = new Map<
    string,
    { profile: SampledProfile; expiresAt: number }
  >();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly max: number = PROFILE_CACHE_MAX,
    private readonly ttlMs: number = PROFILE_TTL_MS,
  ) {}

  get ttl(): number {
    return this.ttlMs;
  }

  now(): number {
    return this.clock();
  }

  set(profile: SampledProfile): void {
    this.purgeExpired();
    this.entries.delete(profile.profileId);
    this.entries.set(profile.profileId, {
      profile,
      expiresAt: this.clock() + this.ttlMs,
    });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /** Undefined when unknown or expired. A hit marks the entry recently used. */
  get(profileId: string): SampledProfile | undefined {
    const entry = this.entries.get(profileId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(profileId);
      return undefined;
    }
    this.entries.delete(profileId);
    this.entries.set(profileId, entry);
    return entry.profile;
  }

  get size(): number {
    this.purgeExpired();
    return this.entries.size;
  }

  private purgeExpired(): void {
    const t = this.clock();
    for (const [id, e] of this.entries) {
      if (e.expiresAt <= t) this.entries.delete(id);
    }
  }
}
