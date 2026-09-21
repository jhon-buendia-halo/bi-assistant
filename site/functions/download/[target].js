import {
  TARGETS,
  resolveTargets,
  signedAssetUrl,
} from '../../lib/github-release.js';

// GET /download/<target> → 302 to the newest installer for that platform.
// The page links here rather than to a versioned GitHub URL, so a new release
// needs no edit to the site.
export async function onRequestGet({ params, env }) {
  const target = params.target;

  // Checked up front: a cached release list can otherwise carry an
  // unconfigured deployment far enough to fail with a misleading error.
  if (!env.GITHUB_TOKEN) {
    return new Response(
      'Downloads are not configured yet: this deployment has no GITHUB_TOKEN secret.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  if (!TARGETS[target]) {
    return new Response(
      `Unknown download target "${target}". Expected one of: ${Object.keys(TARGETS).join(', ')}.`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  let resolved;
  try {
    resolved = await resolveTargets(env);
  } catch {
    return new Response(
      'Could not reach GitHub to resolve the latest release. Please try again shortly.',
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const asset = resolved.targets[target];
  if (!asset) {
    return new Response(
      `No ${TARGETS[target].label} installer has been published yet.`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  let location;
  try {
    location = await signedAssetUrl(asset.assetId, env);
  } catch {
    return new Response(
      'GitHub did not return a download link for that installer. Please try again shortly.',
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  // The signed link is short-lived, so this redirect must never be cached.
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'X-Installer-Name': asset.name,
      'X-Installer-Version': asset.version,
    },
  });
}
