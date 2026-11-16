/**
 * The illustrated portrait of an agent (ui.md 4.4, 4.5): a DiceBear
 * "Notionists" avatar (CC0 1.0 art by Zoish; MIT library), drawn on the
 * device from the agent's key, so it needs no network and never changes
 * between visits. The library is loaded on first use, outside the initial
 * bundle; until it arrives, and if it fails, the avatar shows the name's
 * initial.
 */

/** The look of one portrait: Notionists option values. */
export interface PortraitLook {
  /** A Notionists hair variant (`variant01` … `variant63`). */
  hair: string;
  /** A clear-lens glasses variant, or none. */
  glasses?: ClearGlasses;
}

/** The glasses variants with clear lenses; the others read as sunglasses. */
export const CLEAR_GLASSES = ['variant03', 'variant08', 'variant11'] as const;
type ClearGlasses = (typeof CLEAR_GLASSES)[number];

/**
 * Hair a portrait drawn from a seed may get: every variant except the caps,
 * the hat and the spiky cuts, which read as costume at avatar size.
 */
export const SEEDED_HAIR: readonly string[] = Array.from(
  { length: 63 },
  (_, i) => `variant${String(i + 1).padStart(2, '0')}`,
).filter((v) => !['variant14', 'variant50', 'variant51'].includes(v));

/**
 * The chosen look of each built-in agent, by registry key, so the drawing
 * fits the persona's name (agents.md 1.1). A user agent, or a built-in
 * missing here, gets a look drawn from its key.
 */
export const BUILTIN_PORTRAITS: Readonly<Record<string, PortraitLook>> = {
  assistant: { hair: 'variant08' }, // Emily
  'insights-analyst': { hair: 'variant01' }, // Michael
  'data-readiness': { hair: 'variant23' }, // Sarah
  visualization: { hair: 'variant17' }, // Ryan
  'sql-fixer': { hair: 'variant06', glasses: 'variant08' }, // David
  'sql-verifier': { hair: 'variant47', glasses: 'variant11' }, // Rachel
  'knowledge-bootstrap': { hair: 'variant22' }, // Kevin
  'assistant-eval-judge': { hair: 'variant36' }, // Laura
  'analysis-planner': { hair: 'variant28' }, // Olivia
  'answer-writer': { hair: 'variant39' }, // Jessica
  'dashboard-reader': { hair: 'variant02', glasses: 'variant03' }, // Grace
  'data-mapper': { hair: 'variant54' }, // Daniel
  'query-explainer': { hair: 'variant58' }, // Hannah
  'result-explorer': { hair: 'variant12' }, // Nathan
};

/** The Notionists options for an agent's portrait (pure; unit-tested). */
export function portraitOptions(key: string): Record<string, unknown> {
  const look = BUILTIN_PORTRAITS[key];
  return {
    seed: key,
    // The tile behind the face is the page's own (ui.md 4.4), not baked in.
    backgroundColor: ['transparent'],
    // Zoom on the face, so it reads at card size (44 px).
    scale: 125,
    translateY: 10,
    beardProbability: 0,
    gestureProbability: 0,
    hair: look ? [look.hair] : [...SEEDED_HAIR],
    glasses: look?.glasses ? [look.glasses] : [...CLEAR_GLASSES],
    glassesProbability: look ? (look.glasses ? 100 : 0) : 20,
  };
}

/** The first letter of the agent's name, shown until the portrait loads. */
export function portraitInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

type Renderer = (key: string) => string;
let renderer: Promise<Renderer> | null = null;
const cache = new Map<string, string>();

/** Load the library once; every later call reuses it. */
function loadRenderer(): Promise<Renderer> {
  renderer ??= Promise.all([
    import('@dicebear/core'),
    import('@dicebear/notionists'),
  ]).then(
    ([core, style]) =>
      (key: string) =>
        core.createAvatar(style, portraitOptions(key)).toDataUri(),
  );
  // A failed load is retried on the next portrait.
  renderer.catch(() => (renderer = null));
  return renderer;
}

/** The portrait as an SVG data URI, memoised by key. */
export async function agentPortrait(key: string): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const uri = (await loadRenderer())(key);
  cache.set(key, uri);
  return uri;
}
