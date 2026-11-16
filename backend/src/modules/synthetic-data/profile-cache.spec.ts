import { ProfileCache } from './profile-cache';
import type { SampledProfile } from './types';

const p = (id: string) => ({ profileId: id }) as SampledProfile;

describe('ProfileCache', () => {
  it('keeps a profile for 60 minutes from creation, then forgets it', () => {
    let t = 1_000;
    const cache = new ProfileCache(() => t);
    cache.set(p('a'));
    t += 59 * 60_000;
    expect(cache.get('a')?.profileId).toBe('a');
    // a read does not extend the life
    t += 60_000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used profile beyond 20', () => {
    const cache = new ProfileCache(() => 0);
    for (let i = 0; i < 20; i++) cache.set(p(`p${i}`));
    cache.get('p0'); // p1 is now the oldest
    cache.set(p('p20'));
    expect(cache.get('p1')).toBeUndefined();
    expect(cache.get('p0')).toBeDefined();
    expect(cache.get('p20')).toBeDefined();
    expect(cache.size).toBe(20);
  });

  it('drops expired entries before counting against the limit', () => {
    let t = 0;
    const cache = new ProfileCache(() => t, 2);
    cache.set(p('old'));
    t += 61 * 60_000;
    cache.set(p('b'));
    cache.set(p('c'));
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('answers undefined for an unknown id', () => {
    expect(new ProfileCache().get('nope')).toBeUndefined();
  });
});
