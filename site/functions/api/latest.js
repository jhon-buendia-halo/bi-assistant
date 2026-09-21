import { resolveTargets, jsonResponse } from '../../lib/github-release.js';

// GET /api/latest → what the download cards render: the headline version and,
// per platform, the release that actually carries that installer.
export async function onRequestGet({ env }) {
  if (!env.GITHUB_TOKEN) return jsonResponse({ error: 'not-configured' }, 503, 0);

  try {
    const resolved = await resolveTargets(env);
    return jsonResponse(resolved);
  } catch (err) {
    if (err.message === 'missing-token') {
      return jsonResponse({ error: 'not-configured' }, 503, 0);
    }
    return jsonResponse({ error: 'github-unavailable' }, 502, 0);
  }
}
