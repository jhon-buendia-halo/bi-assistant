/**
 * The pure rules of the Review a Website workflow: they read what the
 * collector (./review-website.collect.ts), axe and the page load measured and
 * return findings. No model, no browser, no framework import.
 */
import {
  SITE_SCREENS,
  type AxeViolation,
  type Finding,
  type FindingSeverity,
  type PageLoad,
  type RawFinding,
  type SeverityCounts,
  type SiteScreenName,
  type DomSnapshot,
  type SnapElement,
} from './review-website.schemas';

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/** The screen's entry in the catalogue of screens (its size and kind). */
export function screenSpec(name: SiteScreenName) {
  const spec = SITE_SCREENS.find((screen) => screen.name === name);
  if (!spec) throw new Error(`Unknown screen: ${name}`);
  return spec;
}

function words(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) : flat;
}

function controlKind(element: SnapElement): 'Button' | 'Field' | 'Link' {
  const role = /^(button|summary)$/.test(element.tag);
  if (role || element.submit) return 'Button';
  if (/^(input|select|textarea)$/.test(element.tag)) return 'Field';
  return 'Link';
}

/** The placeholder patterns, with the kind each one is reported as. */
const PLACEHOLDERS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'lorem', pattern: /lorem ipsum/i },
  { kind: 'template', pattern: /\{\{|\}\}/ },
  { kind: 'undefined', pattern: /\bundefined\b/ },
  { kind: 'nan', pattern: /\bNaN\b/ },
  { kind: 'null', pattern: /^null$/m },
  { kind: 'forename', pattern: /Forename/ },
  { kind: 'object', pattern: /\[object Object\]/ },
  { kind: 'todo', pattern: /\bTODO\b/ },
];

/**
 * The findings of one page on one screen that its DOM snapshot shows:
 * sideways scroll, cut-off text, covered controls, small tap targets, broken
 * images and placeholder text.
 */
export function snapshotFindings(snapshot: DomSnapshot): RawFinding[] {
  const { url, screen, viewport } = snapshot;
  const isMobile = screenSpec(screen).isMobile;
  const base = { screen, url, helpUrl: null as string | null };
  const out: RawFinding[] = [];

  if (snapshot.scrollWidth > viewport.width + 1) {
    const widest = snapshot.widest;
    out.push({
      ...base,
      rule: 'overflow-x',
      severity: isMobile ? 'major' : 'minor',
      title: 'Page scrolls sideways',
      selector: widest?.selector ?? null,
      measured:
        `Content is ${Math.round(snapshot.scrollWidth)} px wide in a ${viewport.width} px screen` +
        (widest ? `; widest element ${widest.selector}` : ''),
      expected: `No sideways scrolling at ${viewport.width} px (WCAG 1.4.10 Reflow)`,
      rect: widest?.rect ?? null,
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    });
  }

  for (const element of snapshot.elements) {
    if (element.clipsText) {
      out.push({
        ...base,
        rule: 'clipped-text',
        severity: 'minor',
        title: 'Text is cut off',
        selector: element.selector,
        measured: `"${words(element.text, 60)}" is cut off`,
        expected: 'Text fits its box or wraps',
        rect: element.rect,
      });
    }
    if (element.interactive && element.coveredFraction >= 0.5) {
      out.push({
        ...base,
        rule: 'covered-element',
        severity: element.submit ? 'critical' : 'major',
        title: `${controlKind(element)} covered by a fixed element`,
        selector: element.selector,
        measured: `${Math.round(element.coveredFraction * 100)}% of ${element.selector} is under ${element.coveredBy ?? 'a fixed element'}`,
        expected: 'Controls are not hidden by banners or sticky bars at load',
        rect: element.rect,
      });
    }
    if (
      isMobile &&
      element.interactive &&
      (element.rect.width < 24 || element.rect.height < 24)
    ) {
      const inlineLink =
        element.tag === 'a' && element.text !== '' && element.rect.width >= 24;
      if (!inlineLink) {
        out.push({
          ...base,
          rule: 'tap-target',
          severity: 'minor',
          title: 'Tap target too small',
          selector: element.selector,
          measured: `${Math.round(element.rect.width)}×${Math.round(element.rect.height)} px`,
          expected: 'At least 24×24 px (WCAG 2.5.8 Target Size)',
          rect: element.rect,
          helpUrl:
            'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
        });
      }
    }
    if (element.brokenImage) {
      out.push({
        ...base,
        rule: 'broken-image',
        severity: 'major',
        title: 'Image does not load',
        selector: element.selector,
        measured: words(element.brokenImage, 120),
        expected: 'Every image loads',
        rect: element.rect,
      });
    }
  }

  for (const { pattern } of PLACEHOLDERS) {
    const match = pattern.exec(snapshot.visibleText);
    if (!match) continue;
    const start = Math.max(0, match.index - 15);
    const end = Math.min(
      snapshot.visibleText.length,
      match.index + match[0].length + 15,
    );
    const context = snapshot.visibleText
      .slice(start, end)
      .replace(/\s+/g, ' ')
      .trim();
    out.push({
      ...base,
      rule: 'placeholder-text',
      severity: 'major',
      title: 'Placeholder text is visible',
      selector: null,
      measured: `Visible text contains "${context}"`,
      expected: 'No placeholder or template text is shown',
      rect: null,
    });
  }
  return out;
}

/** One finding per node of each axe violation. */
export function axeFindings(
  violations: AxeViolation[],
  screen: SiteScreenName,
  url: string,
): RawFinding[] {
  const out: RawFinding[] = [];
  for (const violation of violations) {
    const severity: FindingSeverity =
      violation.impact === 'critical' || violation.impact === 'serious'
        ? 'major'
        : 'minor';
    for (const node of violation.nodes) {
      out.push({
        rule: `axe:${violation.id}`,
        severity,
        title: violation.help,
        screen,
        url,
        selector: node.selector,
        measured: words(
          node.summary.replace(/^\s*Fix (any|all) of the following:/, ''),
          200,
        ),
        expected: violation.help,
        rect: node.rect,
        helpUrl: violation.helpUrl,
      });
    }
  }
  return out;
}

/** The findings the page load itself shows: an error status, console errors. */
export function loadFindings(load: PageLoad): RawFinding[] {
  const base = {
    screen: load.screen,
    url: load.url,
    selector: null,
    rect: null,
    helpUrl: null,
  };
  const out: RawFinding[] = [];
  if (load.status !== null && load.status >= 400) {
    out.push({
      ...base,
      rule: 'http-error',
      severity: 'major',
      title: `Page answers ${load.status}`,
      measured: `The page answered HTTP ${load.status}`,
      expected: 'The page loads (HTTP 2xx or 3xx)',
    });
  }
  if (load.consoleErrors.length > 0) {
    const more = load.consoleErrors.length - 1;
    out.push({
      ...base,
      rule: 'console-error',
      severity: 'minor',
      title: 'Errors in the browser console',
      measured:
        words(load.consoleErrors[0], 150) +
        (more > 0 ? ` (+${more} more)` : ''),
      expected: 'No uncaught errors in the console',
    });
  }
  return out;
}

/**
 * The path pattern of a URL (`/claims/:id`): lowercase, no trailing slash,
 * query and hash ignored, ids, UUIDs, long tokens and dates as `:id`. An
 * invalid URL comes back unchanged.
 */
export function urlGroup(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return url;
  }
  const segments = pathname
    .toLowerCase()
    .split('/')
    .map((segment) => {
      if (
        /^\d+$/.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          segment,
        ) ||
        /^\d{4}-\d{2}-\d{2}$/.test(segment) ||
        (/^[a-z0-9]{16,}$/.test(segment) && /\d/.test(segment))
      ) {
        return ':id';
      }
      return segment;
    });
  const path = segments.join('/');
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : '/';
}

/** A pure 32-bit FNV-1a hash, as 8 hex characters. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Merges the findings of one rule, screen, URL group and element across the
 * pages of the group into one, worst first.
 */
export function mergeFindings(
  raw: Array<RawFinding & { crop: string | null }>,
): Finding[] {
  const groups = new Map<string, Array<RawFinding & { crop: string | null }>>();
  for (const finding of raw) {
    const group = urlGroup(finding.url);
    const key = `${finding.rule}|${finding.screen}|${group}|${finding.selector ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(finding);
    else groups.set(key, [finding]);
  }
  const merged: Finding[] = [];
  for (const [key, list] of groups) {
    const rep = list.find((item) => item.crop !== null) ?? list[0];
    const pages = [rep.url];
    for (const item of list)
      if (!pages.includes(item.url)) pages.push(item.url);
    const severity = list.reduce<FindingSeverity>(
      (worst, item) =>
        SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[worst]
          ? item.severity
          : worst,
      list[0].severity,
    );
    merged.push({
      id: `f-${fnv1a(key)}`,
      rule: rep.rule,
      severity,
      title: rep.title,
      screen: rep.screen,
      selector: rep.selector,
      measured: rep.measured,
      expected: rep.expected,
      rect: rep.rect,
      helpUrl: rep.helpUrl,
      group: urlGroup(rep.url),
      pages,
      crop: rep.crop,
    });
  }
  return merged.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.pages.length - a.pages.length ||
      a.title.localeCompare(b.title),
  );
}

/** How many findings there are of each severity. */
export function severityCounts(
  findings: readonly { severity: FindingSeverity }[],
): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, major: 0, minor: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

/**
 * A matcher for the exclusion pattern: a case-insensitive regular expression
 * over a URL's path and query. An empty pattern matches nothing.
 */
export function exclusionMatcher(pattern: string): (url: string) => boolean {
  if (pattern.trim() === '') return () => false;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The exclusion pattern is not a valid regular expression: ${message}`,
    );
  }
  return (url: string) => {
    try {
      const parsed = new URL(url);
      return regex.test(parsed.pathname + parsed.search);
    } catch {
      return regex.test(url);
    }
  };
}
