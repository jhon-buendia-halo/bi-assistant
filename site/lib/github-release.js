// Resolves installer downloads for the landing page.
//
// The repository is private, so its release assets are not publicly fetchable.
// The GitHub API does hand out a short-lived, credential-free URL for one:
// requesting an asset with `Accept: application/octet-stream` answers 302 with
// a `release-assets.githubusercontent.com` link that needs no auth. So the
// token stays on the edge and the browser downloads straight from GitHub's CDN
// — no multi-hundred-megabyte proxying through a Worker.

export const REPO = 'jhon-buendia-halo/bi-assistant';

/**
 * Installer file-name prefixes per product (ADR-0045, ADR-0046). Halo Workbench
 * shipped as `Questions-to-Insights-…` before the rename, so both count.
 */
const HALO_PREFIXES = ['Halo-Workbench-', 'Questions-to-Insights-'];
const AGENTIC_HUB_PREFIXES = ['Agentic-Hub-'];

/**
 * Download targets, keyed by the URL segment the page links to. An asset
 * matches when its name starts with one of the product's prefixes and ends
 * with the platform suffix. `win-x64` stays the Halo Workbench link so older
 * links keep working.
 */
export const TARGETS = {
  'win-x64': {
    prefixes: HALO_PREFIXES,
    suffix: '-win-x64.exe',
    label: 'Halo Workbench · Windows x64',
  },
  'agentic-hub-win-x64': {
    prefixes: AGENTIC_HUB_PREFIXES,
    suffix: '-win-x64.exe',
    label: 'Agentic Hub · Windows x64',
  },
  'mac-arm64': {
    prefixes: HALO_PREFIXES,
    suffix: '-mac-arm64.dmg',
    label: 'Halo Workbench · macOS Apple silicon',
  },
  'mac-x64': {
    prefixes: HALO_PREFIXES,
    suffix: '-mac-x64.dmg',
    label: 'Halo Workbench · macOS Intel',
  },
};

/** Whether a release asset is the installer a target names. */
export function assetMatches(name, spec) {
  return (
    name.endsWith(spec.suffix) &&
    spec.prefixes.some((prefix) => name.startsWith(prefix))
  );
}

/** How long a resolved release list is reused before GitHub is asked again. */
const CACHE_SECONDS = 300;
/** Releases scanned when looking for a target — a build may skip a platform. */
const RELEASE_PAGE = 20;

function apiHeaders(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('missing-token');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API requests without one.
    'User-Agent': 'halo-workbench-site',
  };
}

/**
 * Newest non-draft releases, oldest entries dropped. Cached at the edge so a
 * burst of page loads costs one GitHub call.
 */
async function fetchReleases(env) {
  const cacheKey = new Request(
    `https://internal.invalid/releases/${encodeURIComponent(REPO)}`,
  );
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=${RELEASE_PAGE}`,
    { headers: apiHeaders(env) },
  );
  if (!res.ok) throw new Error(`github-${res.status}`);

  const releases = (await res.json())
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      publishedAt: r.published_at,
      prerelease: r.prerelease,
      assets: r.assets.map((a) => ({ id: a.id, name: a.name, size: a.size })),
    }));

  await cache.put(
    cacheKey,
    new Response(JSON.stringify(releases), {
      headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` },
    }),
  );
  return releases;
}

/** `v0.13.1` → `0.13.1`. */
function versionOf(tag) {
  return String(tag || '').replace(/^v/, '');
}

/**
 * For each target, the newest release that actually carries that installer —
 * a run can publish Windows only, and that platform's button should still
 * work rather than break until the next full build.
 */
export async function resolveTargets(env) {
  const releases = await fetchReleases(env);
  const targets = {};

  for (const [key, spec] of Object.entries(TARGETS)) {
    for (const release of releases) {
      const asset = release.assets.find((a) => assetMatches(a.name, spec));
      if (!asset) continue;
      targets[key] = {
        label: spec.label,
        tag: release.tag,
        version: versionOf(release.tag),
        publishedAt: release.publishedAt,
        name: asset.name,
        size: asset.size,
        assetId: asset.id,
      };
      break;
    }
  }

  // The headline version is the newest release that shipped any installer.
  const newest = releases.find((r) =>
    Object.values(TARGETS).some((s) =>
      r.assets.some((a) => assetMatches(a.name, s)),
    ),
  );

  return {
    latest: newest
      ? {
          tag: newest.tag,
          version: versionOf(newest.tag),
          publishedAt: newest.publishedAt,
        }
      : null,
    targets,
  };
}

/**
 * Turns an asset id into a URL the browser can fetch unauthenticated. The 302
 * must not be followed here — following it would stream the installer through
 * this Worker instead of handing the signed link to the client.
 */
export async function signedAssetUrl(assetId, env) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/assets/${assetId}`,
    {
      headers: { ...apiHeaders(env), Accept: 'application/octet-stream' },
      redirect: 'manual',
    },
  );

  const location = res.headers.get('location');
  if (!location) throw new Error(`no-redirect-${res.status}`);
  return location;
}

export function jsonResponse(body, status = 200, maxAge = CACHE_SECONDS) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  });
}
