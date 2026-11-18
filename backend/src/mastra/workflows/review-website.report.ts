/**
 * The Review a Website report (agents.md 5.19): the interactive visual the
 * last step stores, and the run's answer. Both are built by fixed code from
 * the measured findings; no model writes any of it. The visual is a fixed
 * style sheet and a fixed vanilla-JS runtime with the data embedded as JSON,
 * the way the dashboard mock is built (recreate-dashboard.steps.ts): the
 * runtime makes DOM nodes and sets text, so a page title, URL or selector
 * from a hostile website never reaches the markup. No framework import.
 *
 * The report is issue-first: findings are grouped into problems (one rule
 * broken on many elements is one problem), listed worst first, and each
 * problem is read element by element with the element framed in its page.
 */
import {
  SITE_SCREENS,
  type DiscoveredSite,
  type Finding,
  type FindingSeverity,
  type FindingSource,
  type ReviewedSite,
  type SeverityCounts,
} from './review-website.schemas';

/** A visual's bundle, as the sandboxed frame takes it. */
export interface ReportBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

const ROOT_ID = 'site-review-root';

/** JSON that is safe inside a `<script>`: no `<`, no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

/** `1 page`, `3 pages`. */
function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** `Mobile`, `Mobile and Laptop`, `Mobile, Tablet and Laptop`. */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function screenLabel(name: string): string {
  return SITE_SCREENS.find((screen) => screen.name === name)?.label ?? name;
}

function hostOf(site: { origin: string; url: string }): string {
  for (const candidate of [site.origin, site.url]) {
    try {
      return new URL(candidate).host;
    } catch {
      // Try the next candidate.
    }
  }
  return site.origin || site.url;
}

/** How many problems (`problemGroups`) there are of each worst severity. */
function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, major: 0, minor: 0 };
  for (const group of problemGroups(findings)) counts[group.severity] += 1;
  return counts;
}

/** `5 problems: 4 major and 1 minor`, or `no problems found`. */
function problemsLine(findings: readonly Finding[]): string {
  const total = problemGroups(findings).length;
  return total
    ? `${counted(total, 'problem')}: ${severityLine(countBySeverity(findings))}`
    : 'no problems found';
}

/**
 * The counts as one phrase: `1 critical, 8 major and 14 minor`. Kinds with
 * none are left out; no findings at all reads `no measured issues`.
 */
export function severityLine(counts: SeverityCounts): string {
  const parts = (['critical', 'major', 'minor'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return parts.length ? joinList(parts) : 'no measured issues';
}

function failedPages(site: DiscoveredSite) {
  return site.pages.filter(
    (page) =>
      page.error !== null || (page.status !== null && page.status >= 400),
  );
}

/**
 * One problem: the findings that break the same rule, together. A measured
 * rule groups every element, page, template and screen it was found on; each
 * of Iris's findings is its own problem unless she repeated rule and title.
 * The report's runtime applies the same rules.
 */
export interface ProblemGroup {
  key: string;
  /** The first finding's title. */
  title: string;
  /** The worst severity among its findings. */
  severity: FindingSeverity;
  source: FindingSource;
  findings: Finding[];
  /** How many findings (elements) it has. */
  elementCount: number;
  /** How many distinct pages they were found on. */
  pageCount: number;
  /** How many distinct page templates those pages belong to. */
  templateCount: number;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/** The findings as problems, worst first, then most elements, then by title. */
export function problemGroups(findings: readonly Finding[]): ProblemGroup[] {
  const byKey = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key =
      finding.source === 'iris'
        ? `iris|${finding.rule}|${finding.title}`
        : `measured|${finding.rule}`;
    const list = byKey.get(key);
    if (list) list.push(finding);
    else byKey.set(key, [finding]);
  }
  const groups: ProblemGroup[] = [];
  for (const [key, list] of byKey) {
    let severity = list[0].severity;
    for (const finding of list) {
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[severity]) {
        severity = finding.severity;
      }
    }
    groups.push({
      key,
      title: list[0].title,
      severity,
      source: list[0].source,
      findings: list,
      // One element per selector, whatever its page, template or screen.
      elementCount: new Set(
        list
          .filter((finding) => finding.selector !== null)
          .map((finding) => finding.selector),
      ).size,
      pageCount: new Set(list.flatMap((finding) => finding.pages)).size,
      templateCount: new Set(list.map((finding) => finding.group)).size,
    });
  }
  return groups.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      // How widespread first: the pages it is on, then its elements.
      b.pageCount - a.pageCount ||
      b.elementCount - a.elementCount ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
}

/**
 * The run's answer in Markdown: what was reviewed, the top problems to fix
 * first and how far the crawl got. Short on purpose: the report has the rest.
 */
export function reviewAnswer(site: ReviewedSite): string {
  const screens = joinList(site.screens.map(screenLabel));
  const lines = [
    `**${hostOf(site)}**: ${counted(site.pages.length, 'page')}, ${counted(site.templates.length, 'page template')} on ${screens} — ${problemsLine(site.findings)}.`,
  ];

  if (site.reviewed.length > 0) {
    const irisCount = site.findings.filter((f) => f.source === 'iris').length;
    // A template whose review failed is counted apart (workflows R43).
    const done = site.reviewed.filter((r) => r.notReviewed === undefined);
    const of =
      done.length === site.reviewed.length
        ? counted(done.length, 'template')
        : `${done.length} of ${counted(site.reviewed.length, 'template')}`;
    lines.push(
      '',
      `Iris reviewed ${of} and found ${counted(irisCount, 'visual issue')}.`,
    );
  } else if (
    site.visualReview &&
    site.reviewTemplates.length === 0 &&
    site.templates.length > 0
  ) {
    lines.push('', "Iris's visual review was skipped: measured checks only.");
  }

  const top = problemGroups(site.findings).slice(0, 3);
  if (top.length) {
    lines.push(
      '',
      'Fix first:',
      ...top.map(
        (group) =>
          `- **${group.title}** — ${group.elementCount ? `${counted(group.elementCount, 'element')} on ` : 'on '}${counted(group.pageCount, 'page')} (${group.severity}, ${group.source === 'iris' ? 'Iris' : 'Measured'})`,
      ),
    );
  }

  const coverage = [
    `${site.pages.length} of ${counted(site.maxPages, 'page')}${site.capped ? '; stopped at the limit' : ''}`,
  ];
  const skipped = site.skippedLinks.length;
  if (skipped) coverage.push(`${counted(skipped, 'link')} skipped`);
  const failed = failedPages(site).length;
  if (failed) coverage.push(`${counted(failed, 'page')} failed`);
  lines.push('', `Coverage: ${coverage.join('; ')}.`);

  lines.push(
    '',
    'Open the report in full screen to see each element framed in its page.',
  );
  return lines.join('\n');
}

/** The answer of a run whose sign-in expired before anything was reviewed. */
export function sessionLostAnswer(site: DiscoveredSite): string {
  return `The sign-in for **${hostOf(site)}** expired: ${site.sessionLost ?? 'a page'} sent the crawler back to the sign-in page, so nothing was reviewed. Run again with **The site needs a sign-in** ticked to sign in again.`;
}

const REPORT_CSS = `
:root {
  --sr-bg: var(--qti-bg, #ffffff);
  --sr-fg: var(--qti-fg, #2a2a2a);
  --sr-strong: var(--qti-fg-strong, #181818);
  --sr-muted: var(--qti-fg-muted, #5f5f5c);
  --sr-surface: var(--qti-surface, #f6f6f4);
  --sr-border: var(--qti-border, #e3e3df);
  --sr-link: var(--qti-link, #d4380f);
  --sr-focus: var(--qti-focus, #ed3e13);
}
.sr { container-type: inline-size; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.45; color: var(--sr-fg); }
.sr * { box-sizing: border-box; }
.sr h2, .sr h3, .sr h4, .sr p, .sr ul, .sr ol, .sr dl, .sr dd { margin: 0; }
.sr ul, .sr ol { padding: 0; list-style: none; }
.sr a { color: var(--sr-link); }
.sr code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; background: var(--sr-surface); border: 1px solid var(--sr-border); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
.sr :focus-visible { outline: 2px solid var(--sr-focus); outline-offset: 2px; }
.sr-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.sr-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.sr-host { font-size: 18px; font-weight: 700; color: var(--sr-strong); overflow-wrap: anywhere; }
.sr-meta { color: var(--sr-muted); font-size: 12px; overflow-wrap: anywhere; }
.sr-count { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--sr-strong); }
.sr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sr-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.sr-badge { display: inline-block; padding: 1px 7px; border-radius: 4px; color: #ffffff; font-size: 12px; font-weight: 700; white-space: nowrap; }
.sr-b-critical { background: #7f1d1d; }
.sr-b-major { background: #dc2626; }
.sr-b-minor { background: #b45309; }
.sr-b-ok { background: #15803d; }
.sr-toggle { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.sr-btn { font: inherit; font-size: 12px; cursor: pointer; color: var(--sr-fg); background: var(--sr-bg); border: 1px solid var(--sr-border); border-radius: 999px; padding: 2px 10px; }
.sr-btn:disabled { cursor: default; opacity: 0.45; }
.sr-btn[aria-pressed='true'] { background: var(--sr-strong); color: var(--sr-bg); border-color: var(--sr-strong); }
.sr-chip-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
.sr-field { font: inherit; font-size: 12px; color: var(--sr-fg); background: var(--sr-bg); border: 1px solid var(--sr-border); border-radius: 6px; padding: 3px 8px; min-width: 0; }
.sr-search { flex: 1 1 160px; max-width: 280px; }
.sr-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--sr-border); margin-bottom: 10px; }
.sr-tab { font: inherit; font-weight: 600; cursor: pointer; color: var(--sr-muted); background: transparent; border: 0; border-bottom: 3px solid transparent; padding: 6px 12px; margin-bottom: -1px; }
.sr-tab[aria-selected='true'] { color: var(--sr-strong); border-bottom-color: var(--sr-focus); }
.sr-split { display: grid; grid-template-columns: minmax(240px, 38%) minmax(0, 1fr); gap: 14px; height: clamp(440px, calc(100vh - 200px), 880px); }
.sr-left { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; padding: 2px 4px 2px 2px; }
.sr-right { min-height: 0; overflow-y: auto; padding: 2px 6px 8px 2px; }
@container (max-width: 759px) {
  .sr-split { display: flex; flex-direction: column; height: auto; }
  .sr-left { max-height: 250px; flex: none; }
  .sr-right { overflow: visible; }
  .sr-count { margin-left: 0; }
}
.sr-plist { display: flex; flex-direction: column; gap: 6px; }
.sr-prob { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; font: inherit; color: var(--sr-fg); cursor: pointer; background: var(--sr-bg); border: 1px solid var(--sr-border); border-radius: 8px; padding: 8px 10px; }
.sr-prob[aria-current='true'] { border: 2px solid var(--sr-focus); padding: 7px 9px; background: var(--sr-surface); }
.sr-prob-title { font-weight: 700; color: var(--sr-strong); overflow-wrap: anywhere; }
.sr-prob-meta { font-size: 12px; color: var(--sr-muted); }
.sr-d-title { font-size: 18px; font-weight: 700; color: var(--sr-strong); overflow-wrap: anywhere; margin-bottom: 6px; }
.sr-d-line { margin-top: 6px; overflow-wrap: anywhere; }
.sr-label { color: var(--sr-muted); }
.sr-nav { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; }
.sr-nav-pos { font-weight: 700; color: var(--sr-strong); min-width: 9em; text-align: center; }
.sr-nav .sr-btn { border-radius: 6px; padding: 3px 12px; }
.sr-shot { position: relative; display: inline-block; max-width: 100%; line-height: 0; border: 1px solid var(--sr-border); border-radius: 4px; }
.sr-shot img { display: block; max-width: 100%; height: auto; border-radius: 3px; }
.sr-mark { position: absolute; min-width: 8px; min-height: 8px; border: 2px solid #e11d48; background: rgba(225, 29, 72, 0.14); box-shadow: 0 0 0 1px #ffffff, 0 0 0 3px rgba(0, 0, 0, 0.45); pointer-events: none; }
.sr-mark-label { position: absolute; left: -2px; bottom: calc(100% + 4px); padding: 1px 6px; border-radius: 3px; background: #e11d48; color: #ffffff; font-size: 11px; font-weight: 700; line-height: 1.4; white-space: nowrap; }
.sr-mark-low .sr-mark-label { bottom: auto; top: calc(100% + 4px); }
.sr-cap { margin-top: 4px; font-size: 12px; color: var(--sr-muted); }
.sr-ph { display: flex; align-items: center; justify-content: center; min-height: 90px; padding: 6px; text-align: center; font-size: 12px; color: var(--sr-muted); border: 1px dashed var(--sr-border); border-radius: 4px; background: repeating-linear-gradient(45deg, transparent 0 8px, var(--sr-surface) 8px 16px); }
.sr-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin-top: 12px; }
.sr-facts dt { color: var(--sr-muted); }
.sr-facts dd { overflow-wrap: anywhere; }
.sr details { margin-top: 2px; }
.sr summary { cursor: pointer; color: var(--sr-fg); font-size: 13px; }
.sr-list { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.sr-strip-h { margin-top: 14px; font-size: 12px; font-weight: 700; color: var(--sr-muted); }
.sr-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
.sr-th { display: block; width: 76px; height: 52px; padding: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; color: var(--sr-strong); background: var(--sr-surface); border: 1px solid var(--sr-border); border-radius: 6px; overflow: hidden; position: relative; }
.sr-th img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
.sr-th-n { position: absolute; left: 0; bottom: 0; padding: 0 5px; font-size: 11px; font-weight: 700; background: var(--sr-strong); color: var(--sr-bg); border-top-right-radius: 4px; }
.sr-th[aria-current='true'] { border: 2px solid var(--sr-focus); }
.sr-more { font-size: 12px; color: var(--sr-muted); }
.sr-box { border: 1px solid var(--sr-border); border-radius: 8px; padding: 10px 12px; margin-top: 16px; background: var(--sr-surface); }
.sr-box > .sr-h { margin-bottom: 6px; }
.sr-box ul { display: flex; flex-direction: column; gap: 2px; }
.sr-h { font-size: 13px; font-weight: 700; color: var(--sr-strong); margin-bottom: 8px; }
.sr-empty { border: 1px solid var(--sr-border); border-radius: 8px; padding: 16px; background: var(--sr-surface); color: var(--sr-strong); font-weight: 700; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sr-src { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; vertical-align: 1px; }
.sr-src-measured { background: var(--sr-surface); color: var(--sr-strong); border: 1px solid var(--sr-border); }
.sr-src-iris { background: transparent; color: var(--sr-strong); border: 1px solid var(--sr-focus); }
.sr .sr-quote { padding: 8px 12px; border-left: 4px solid var(--sr-focus); border-radius: 4px; background: var(--sr-surface); color: var(--sr-fg); font-size: 13px; }
.sr-quote-label { display: block; font-size: 11px; font-weight: 700; color: var(--sr-muted); margin-bottom: 2px; }
.sr-tree li { font-size: 12px; padding: 2px 0; overflow-wrap: anywhere; }
.sr-tree .sr-st { color: var(--sr-muted); }
.sr-tpl { display: flex; flex-direction: column; gap: 8px; }
.sr-tpl li { display: flex; align-items: center; gap: 10px; }
.sr-tpl img { width: 72px; height: 48px; object-fit: cover; object-position: top left; border: 1px solid var(--sr-border); border-radius: 4px; flex: none; }
.sr-tpl-ph { width: 72px; height: 48px; flex: none; border: 1px dashed var(--sr-border); border-radius: 4px; }
.sr-tpl-txt { display: flex; flex-direction: column; min-width: 0; }
`;

const REPORT_RUNTIME = `
(function () {
  var SEVERITIES = ['critical', 'major', 'minor'];
  var RANK = { critical: 0, major: 1, minor: 2 };
  var STRIP = 12;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'text') el.textContent = String(value);
        else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (kids) {
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid === null || kid === undefined) continue;
        el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
      }
    }
    return el;
  }

  function plural(count, noun) {
    return count + ' ' + noun + (count === 1 ? '' : 's');
  }

  function isWebUrl(value) {
    return typeof value === 'string' && (value.indexOf('http://') === 0 || value.indexOf('https://') === 0);
  }

  function link(url, text) {
    if (!isWebUrl(url)) return h('span', { text: text || url });
    return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: text || url });
  }

  function badge(kind, text) {
    return h('span', { class: 'sr-badge sr-b-' + kind, text: text });
  }

  function sourceTag(source) {
    return h('span', { class: 'sr-src sr-src-' + (source === 'iris' ? 'iris' : 'measured'), text: source === 'iris' ? 'Iris' : 'Measured' });
  }

  function unique(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) { seen[list[i]] = true; out.push(list[i]); }
    }
    return out;
  }

  /** The same grouping as problemGroups() on the server. */
  function problemGroups(findings) {
    var byKey = {};
    var order = [];
    findings.forEach(function (f) {
      var key = f.source === 'iris' ? 'iris|' + f.rule + '|' + f.title : 'measured|' + f.rule;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(f);
    });
    var groups = order.map(function (key) {
      var list = byKey[key];
      var severity = list[0].severity;
      var pages = [];
      list.forEach(function (f) {
        if (RANK[f.severity] < RANK[severity]) severity = f.severity;
        pages = pages.concat(f.pages);
      });
      // One element per selector, whatever its page, template or screen (a
      // site-wide header link is one element on many pages); a page-wide
      // finding stays one entry per page set and screen.
      var seen = {};
      var merged = [];
      list.forEach(function (f) {
        var k = f.selector === null ? 'page|' + f.screen + '|' + f.group + '|' + f.pages.join(' ') : 'el|' + f.selector;
        var e = seen[k];
        if (!e) { e = seen[k] = { f: f, pages: [], screens: [] }; merged.push(e); }
        if (!e.f.context && f.context) e.f = f;
        e.pages = unique(e.pages.concat(f.pages));
        if (e.screens.indexOf(f.screen) < 0) e.screens.push(f.screen);
      });
      var elements = merged.map(function (e) {
        var copy = {};
        for (var p in e.f) copy[p] = e.f[p];
        copy.pages = e.pages;
        copy.screens = e.screens;
        return copy;
      });
      return {
        key: key,
        title: list[0].title,
        severity: severity,
        source: list[0].source,
        findings: list,
        elements: elements,
        elementCount: elements.filter(function (f) { return f.selector !== null; }).length,
        pageCount: unique(pages).length,
        templateCount: unique(list.map(function (f) { return f.group; })).length,
      };
    });
    groups.sort(function (a, b) {
      return RANK[a.severity] - RANK[b.severity] || b.pageCount - a.pageCount || b.elementCount - a.elementCount || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
    });
    return groups;
  }

  /** A date as the reader's locale writes it; the ISO text when it is no date. */
  function readableDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }

  /**
   * The report uses the whole frame: the visual document's 920 px column and
   * its title and takeaway (the report's own header says the same) give way.
   * Only this bundle's document is touched (visualization-document.ts).
   */
  function useWholeFrame() {
    var frame = document.querySelector('.qti-frame');
    if (!frame) return;
    frame.style.maxWidth = 'none';
    var header = frame.querySelector('.qti-header');
    if (header) header.style.display = 'none';
    var takeaway = frame.querySelector('.qti-takeaway');
    if (takeaway) {
      takeaway.style.display = 'none';
      var heading = takeaway.previousElementSibling;
      if (heading && heading.classList.contains('qti-h2')) heading.style.display = 'none';
    }
  }

  function mount(root, data) {
    useWholeFrame();
    var site = data.site;
    var images = data.images || {};
    var screens = data.screens;
    var state = { tab: 'problems', sev: {}, screen: 'all', source: 'all', template: 'all', q: '', key: null, occ: 0, open: { pages: true } };
    var hasIris = site.findings.some(function (f) { return f.source === 'iris'; });
    var hasMeasured = site.findings.some(function (f) { return f.source !== 'iris'; });

    function screenLabel(name) {
      for (var i = 0; i < screens.length; i++) if (screens[i].name === name) return screens[i].label;
      return name;
    }

    function validImage(path) {
      var src = path ? images[path] : null;
      return typeof src === 'string' && src.indexOf('data:image/') === 0 ? src : null;
    }

    var reviewedBy = {};
    (site.reviewed || []).forEach(function (r) { reviewedBy[r.template] = r; });
    // A template whose review failed carries why, and is no review by Iris.
    var notReviewed = (site.reviewed || []).filter(function (r) { return typeof r.notReviewed === 'string'; });
    var irisReviewed = (site.reviewed || []).length - notReviewed.length;
    function reviewOf(template) {
      var r = reviewedBy[template];
      return r && typeof r.notReviewed !== 'string' ? r : null;
    }

    // --- Filters -----------------------------------------------------------

    function passes(f, skipSeverity) {
      if (!skipSeverity) {
        var any = false;
        for (var k in state.sev) if (state.sev[k]) any = true;
        if (any && !state.sev[f.severity]) return false;
      }
      if (state.screen !== 'all' && f.screen !== state.screen) return false;
      if (state.source !== 'all' && f.source !== state.source) return false;
      if (state.template !== 'all' && f.group !== state.template) return false;
      if (state.q) {
        var hay = (f.title + ' ' + (f.selector || '') + ' ' + f.pages.join(' ')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    }

    function filtered() {
      return site.findings.filter(function (f) { return passes(f, false); });
    }

    function isFiltered() {
      var any = false;
      for (var k in state.sev) if (state.sev[k]) any = true;
      return any || state.screen !== 'all' || state.source !== 'all' || state.template !== 'all' || state.q !== '';
    }

    function clearFilters() {
      state.sev = {};
      state.screen = 'all';
      state.source = 'all';
      state.template = 'all';
      state.q = '';
      ui.search.value = '';
      ui.select.value = 'all';
      state.occ = 0;
      update();
    }

    // --- Header, built once -------------------------------------------------

    var ui = { sev: {}, screen: {}, source: {}, tabs: {} };

    function pressedGroup(label, items, store, onPick) {
      var buttons = items.map(function (item) {
        var btn = h('button', { type: 'button', class: 'sr-btn', 'aria-pressed': 'false', text: item.label });
        btn.addEventListener('click', function () { onPick(item.value); });
        store[item.value] = btn;
        return btn;
      });
      return h('div', { class: 'sr-toggle', role: 'group', 'aria-label': label }, buttons);
    }

    function buildHeader() {
      var host = site.origin;
      try { host = new URL(site.origin).host; } catch (e) { /* keep the origin */ }
      var top = h('div', { class: 'sr-top' }, [
        h('h2', { class: 'sr-host', text: host }),
        h('span', { class: 'sr-meta' }, [link(site.url, site.url), ' · ' + plural(site.pages.length, 'page') + ' · generated ' + readableDate(data.generatedAt)]),
      ]);
      var head = h('header', { class: 'sr-head' }, [top]);
      if (!site.findings.length) return head;

      ui.count = h('span', { class: 'sr-count', 'aria-live': 'polite' });
      top.appendChild(ui.count);

      var filters = h('div', { class: 'sr-filters' });
      filters.appendChild(h('div', { class: 'sr-toggle', role: 'group', 'aria-label': 'Filter by severity' }, SEVERITIES.map(function (s) {
        var btn = h('button', { type: 'button', class: 'sr-btn', 'aria-pressed': 'false' });
        btn.addEventListener('click', function () { state.sev[s] = !state.sev[s]; state.occ = 0; update(); });
        ui.sev[s] = btn;
        return btn;
      })));
      if (site.screens.length > 1) {
        var screenItems = [{ value: 'all', label: 'All screens' }].concat(site.screens.map(function (n) { return { value: n, label: screenLabel(n) }; }));
        filters.appendChild(pressedGroup('Filter by screen', screenItems, ui.screen, function (v) { state.screen = v; state.occ = 0; update(); }));
      }
      if (hasIris && hasMeasured) {
        filters.appendChild(pressedGroup('Filter by source', [{ value: 'all', label: 'All sources' }, { value: 'measured', label: 'Measured' }, { value: 'iris', label: 'Iris' }], ui.source, function (v) { state.source = v; state.occ = 0; update(); }));
      }
      if (site.templates.length > 1) {
        var options = [h('option', { value: 'all', text: 'All page templates' })];
        site.templates.forEach(function (t) {
          options.push(h('option', { value: t.id, text: t.id + ' (' + plural(t.pages.length, 'page') + ')' }));
        });
        ui.select = h('select', { class: 'sr-field', 'aria-label': 'Filter by page template' }, options);
        ui.select.addEventListener('change', function () { state.template = ui.select.value; state.occ = 0; update(); });
        filters.appendChild(ui.select);
      } else {
        ui.select = h('select');
      }
      ui.search = h('input', { type: 'search', class: 'sr-field sr-search', placeholder: 'Search problems, selectors, URLs', 'aria-label': 'Search problems, selectors and URLs' });
      ui.search.addEventListener('input', function () { state.q = ui.search.value.trim(); state.occ = 0; update(); });
      filters.appendChild(ui.search);
      head.appendChild(filters);
      return head;
    }

    function syncHeader() {
      if (!site.findings.length) return;
      // Problems, not findings: the unit the list counts (by worst severity).
      var others = problemGroups(site.findings.filter(function (f) { return passes(f, true); }));
      SEVERITIES.forEach(function (s) {
        var n = 0;
        others.forEach(function (g) { if (g.severity === s) n += 1; });
        ui.sev[s].textContent = '';
        ui.sev[s].appendChild(h('span', { class: 'sr-chip-dot sr-b-' + s, 'aria-hidden': 'true' }));
        ui.sev[s].appendChild(document.createTextNode(n + ' ' + s));
        ui.sev[s].setAttribute('aria-pressed', state.sev[s] ? 'true' : 'false');
      });
      for (var sc in ui.screen) ui.screen[sc].setAttribute('aria-pressed', state.screen === sc ? 'true' : 'false');
      for (var so in ui.source) ui.source[so].setAttribute('aria-pressed', state.source === so ? 'true' : 'false');
      var shown = problemGroups(filtered()).length;
      var total = problemGroups(site.findings).length;
      ui.count.textContent = shown + ' of ' + plural(total, 'problem');
    }

    function buildTabs() {
      var defs = [{ id: 'problems', label: 'Problems' }, { id: 'pages', label: 'Pages & coverage' }];
      var tabs = defs.map(function (d) {
        var btn = h('button', { type: 'button', role: 'tab', class: 'sr-tab', id: 'sr-tab-' + d.id, 'aria-controls': 'sr-panel', text: d.label });
        btn.addEventListener('click', function () { state.tab = d.id; update(); });
        ui.tabs[d.id] = btn;
        return btn;
      });
      return h('div', { class: 'sr-tabs', role: 'tablist', 'aria-label': 'Report sections' }, tabs);
    }

    function syncTabs() {
      for (var id in ui.tabs) {
        var on = state.tab === id;
        ui.tabs[id].setAttribute('aria-selected', on ? 'true' : 'false');
        ui.tabs[id].setAttribute('tabindex', on ? '0' : '-1');
      }
      ui.panel.setAttribute('aria-labelledby', 'sr-tab-' + state.tab);
    }

    // --- Problems tab -------------------------------------------------------

    function metaOf(g) {
      var parts = g.elementCount ? [plural(g.elementCount, 'element')] : [];
      if (g.pageCount > 1 || !g.elementCount) parts.push(plural(g.pageCount, 'page'));
      if (g.templateCount > 1) parts.push(g.templateCount + ' templates');
      return parts.join(' · ');
    }

    function problemList(groups) {
      var items = groups.map(function (g) {
        var btn = h('button', { type: 'button', class: 'sr-prob', 'data-key': 'p:' + g.key, 'aria-current': g.key === state.key ? 'true' : null }, [
          h('span', { class: 'sr-row' }, [badge(g.severity, g.severity), sourceTag(g.source)]),
          h('span', { class: 'sr-prob-title', text: g.title }),
          h('span', { class: 'sr-prob-meta', text: metaOf(g) }),
        ]);
        btn.addEventListener('click', function () { state.key = g.key; state.occ = 0; update(); });
        return h('li', null, [btn]);
      });
      return h('ul', { class: 'sr-plist', 'aria-label': 'Problems' }, items);
    }

    function shot(f) {
      var ctx = f.context;
      var src = ctx ? validImage(ctx.image) : null;
      if (src && ctx.clip && ctx.clip.width > 0 && ctx.clip.height > 0) {
        var kids = [h('img', { src: src, alt: 'The page around the element: ' + f.title })];
        if (f.rect) {
          var c = ctx.clip;
          var r = f.rect;
          var left = Math.max(0, Math.min(100, ((r.x - c.x) / c.width) * 100));
          var top = Math.max(0, Math.min(100, ((r.y - c.y) / c.height) * 100));
          var width = Math.max(0, Math.min(100 - left, (r.width / c.width) * 100));
          var height = Math.max(0, Math.min(100 - top, (r.height / c.height) * 100));
          kids.push(h('div', { class: 'sr-mark' + (top < 12 ? ' sr-mark-low' : ''), style: 'left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%' }, [
            h('span', { class: 'sr-mark-label', text: 'This element' }),
          ]));
        }
        return h('div', null, [h('div', { class: 'sr-shot' }, kids), h('p', { class: 'sr-cap', text: f.rect ? 'The element is outlined in its page.' : 'This problem is about the page as a whole.' })]);
      }
      var crop = validImage(f.crop);
      if (crop) {
        return h('div', null, [h('div', { class: 'sr-shot' }, [h('img', { src: crop, alt: 'Crop of the screenshot for: ' + f.title })]), h('p', { class: 'sr-cap', text: 'Crop of the element; the page around it was not captured.' })]);
      }
      return h('div', { class: 'sr-ph', role: 'img', 'aria-label': 'No image available', text: 'No image available' });
    }

    function details(key, summary, content) {
      var el = h('details', { 'data-key': 'd:' + key, open: state.open[key] === true }, [h('summary', { text: summary }), content]);
      el.addEventListener('toggle', function () { state.open[key] = el.open; });
      return el;
    }

    function strip(g) {
      var n = g.elements.length;
      if (n < 2) return null;
      var start = Math.max(0, Math.min(state.occ - Math.floor(STRIP / 2), n - STRIP));
      var end = Math.min(n, start + STRIP);
      var kids = [];
      for (var i = start; i < end; i++) {
        (function (index) {
          var f = g.elements[index];
          var thumb = validImage(f.crop);
          var btn = h('button', { type: 'button', class: 'sr-th', 'data-key': 'o:' + index, 'aria-current': index === state.occ ? 'true' : null, 'aria-label': 'Show element ' + (index + 1) + (f.selector ? ': ' + f.selector : '') }, [
            thumb ? h('img', { src: thumb, alt: '' }) : null,
            h('span', { class: 'sr-th-n', text: String(index + 1) }),
          ]);
          btn.addEventListener('click', function () { state.occ = index; update(); });
          kids.push(btn);
        })(i);
      }
      if (n > STRIP) kids.push(h('span', { class: 'sr-more', text: '+' + (n - STRIP) + ' more' }));
      return h('div', null, [h('h4', { class: 'sr-strip-h', text: 'Other elements with this problem' }), h('div', { class: 'sr-strip', role: 'group', 'aria-label': 'Elements with this problem' }, kids)]);
    }

    function detail(g) {
      var n = g.elements.length;
      if (state.occ > n - 1) state.occ = n - 1;
      if (state.occ < 0) state.occ = 0;
      var f = g.elements[state.occ];
      var iris = g.source === 'iris';
      var helpUrl = null;
      g.findings.forEach(function (x) { if (!helpUrl && isWebUrl(x.helpUrl)) helpUrl = x.helpUrl; });
      var rule = [h('span', { class: 'sr-label', text: iris ? 'Suggestion: ' : 'Expected: ' }), h('span', { text: g.findings[0].expected })];
      if (!iris && helpUrl) { rule.push(' '); rule.push(link(helpUrl, '(rule)')); }

      var prev = h('button', { type: 'button', class: 'sr-btn', 'data-key': 'nav:prev', 'aria-label': 'Previous element', text: 'Previous', disabled: state.occ === 0 });
      var next = h('button', { type: 'button', class: 'sr-btn', 'data-key': 'nav:next', 'aria-label': 'Next element', text: 'Next', disabled: state.occ >= n - 1 });
      prev.addEventListener('click', function () { go(-1); });
      next.addEventListener('click', function () { go(1); });

      var facts = [
        h('dt', { text: 'Element' }),
        h('dd', null, [f.selector ? h('code', { text: f.selector }) : h('span', { text: 'The page as a whole' })]),
        h('dt', { text: iris ? 'Observed' : 'Measured' }),
        h('dd', { text: f.measured }),
        h('dt', { text: 'Page template' }),
        h('dd', null, [h('code', { text: f.group })]),
        h('dt', { text: 'Screen' }),
        h('dd', { text: (f.screens || [f.screen]).map(screenLabel).join(', ') }),
        h('dt', { text: 'Found on' }),
        h('dd', null, [
          plural(f.pages.length, 'page'),
          details('pages:' + f.id, 'Show the pages', h('ul', { class: 'sr-list' }, f.pages.map(function (url) { return h('li', null, [link(url)]); }))),
        ]),
      ];

      return h('div', null, [
        h('h3', { class: 'sr-d-title', text: g.title }),
        h('div', { class: 'sr-row' }, [badge(g.severity, g.severity), sourceTag(g.source), h('span', { class: 'sr-meta', text: metaOf(g) })]),
        h('p', { class: 'sr-d-line' }, rule),
        h('div', { class: 'sr-nav', role: 'group', 'aria-label': 'Elements with this problem' }, [
          prev,
          h('span', { class: 'sr-nav-pos', 'aria-live': 'polite', text: (state.occ + 1) + ' of ' + n }),
          next,
        ]),
        shot(f),
        h('dl', { class: 'sr-facts' }, facts),
        strip(g),
      ]);
    }

    function go(delta) {
      var g = current();
      if (!g) return;
      var target = Math.max(0, Math.min(g.elements.length - 1, state.occ + delta));
      if (target === state.occ) return;
      state.occ = target;
      update();
    }

    function current() {
      var groups = problemGroups(filtered());
      for (var i = 0; i < groups.length; i++) if (groups[i].key === state.key) return groups[i];
      return null;
    }

    function emptyState(text, withClear) {
      var kids = [h('span', { text: text })];
      if (withClear) {
        var clear = h('button', { type: 'button', class: 'sr-btn', 'data-key': 'clear', text: 'Clear filters' });
        clear.addEventListener('click', clearFilters);
        kids.push(clear);
      }
      return h('div', { class: 'sr-empty' }, kids);
    }

    function problemsPanel() {
      if (!site.findings.length) {
        return emptyState('No ' + (irisReviewed ? '' : 'measured ') + 'issues found on ' + plural(site.pages.length, 'page') + '.', false);
      }
      var groups = problemGroups(filtered());
      if (!groups.length) return emptyState('No problems match these filters', true);
      var selected = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].key === state.key) selected = groups[i];
      if (!selected) { selected = groups[0]; state.key = selected.key; state.occ = 0; }

      var leftKids = [];
      var review = state.template !== 'all' ? reviewOf(state.template) : null;
      if (review) leftKids.push(h('p', { class: 'sr-quote' }, [h('span', { class: 'sr-quote-label', text: 'Iris' }), h('span', { text: review.summary })]));
      leftKids.push(problemList(groups));
      return h('div', { class: 'sr-split' }, [
        h('div', { class: 'sr-left', 'data-pane': 'left' }, leftKids),
        h('div', { class: 'sr-right', 'data-pane': 'right' }, [detail(selected)]),
      ]);
    }

    // --- Pages & coverage tab -----------------------------------------------

    function pagesTree() {
      var known = {};
      var children = {};
      var roots = [];
      site.pages.forEach(function (page) { known[page.url] = true; });
      site.pages.forEach(function (page) {
        if (page.parent && known[page.parent]) {
          if (!children[page.parent]) children[page.parent] = [];
          children[page.parent].push(page);
        } else roots.push(page);
      });
      var seen = {};
      var rows = [];
      function visit(page) {
        if (seen[page.url]) return;
        seen[page.url] = true;
        var n = 0;
        site.findings.forEach(function (f) { if ((state.screen === 'all' || f.screen === state.screen) && f.pages.indexOf(page.url) >= 0) n += 1; });
        var status = page.error ? 'failed: ' + page.error : page.status === null ? 'no status' : String(page.status);
        rows.push(h('li', { style: 'margin-left:' + (Number(page.depth) || 0) * 16 + 'px' }, [
          link(page.url, page.url), ' ',
          h('span', { class: 'sr-st', text: '(' + status + ', ' + page.group + ', ' + plural(n, 'finding') + ')' }),
        ]));
        (children[page.url] || []).forEach(visit);
      }
      roots.forEach(visit);
      site.pages.forEach(visit);
      return details('pages', 'Pages (' + site.pages.length + ')', h('ul', { class: 'sr-tree' }, rows));
    }

    function templatesBox() {
      var rows = site.templates.map(function (t) {
        var thumb = null;
        for (var i = 0; i < site.captures.length && !thumb; i++) {
          var c = site.captures[i];
          if (c.url === t.representative && c.thumbnail && validImage(c.thumbnail)) thumb = validImage(c.thumbnail);
        }
        var n = site.findings.filter(function (f) { return f.group === t.id; }).length;
        var review = reviewOf(t.id);
        var failed = reviewedBy[t.id] && typeof reviewedBy[t.id].notReviewed === 'string' ? reviewedBy[t.id].notReviewed : null;
        return h('li', null, [
          thumb ? h('img', { src: thumb, alt: 'Screenshot of ' + t.representative }) : h('span', { class: 'sr-tpl-ph', 'aria-hidden': 'true' }),
          h('span', { class: 'sr-tpl-txt' }, [
            h('span', null, [h('code', { text: t.id }), review ? ' ' : null, review ? sourceTag('iris') : null]),
            h('span', { class: 'sr-meta', text: plural(t.pages.length, 'page') + ' · ' + plural(n, 'finding') }),
            failed !== null ? h('span', { class: 'sr-meta', text: 'not reviewed: ' + failed }) : null,
          ]),
        ]);
      });
      var kids = [h('h3', { class: 'sr-h', text: 'Page templates' })];
      // Only when a review failed: a stored run from before renders as it did.
      if (notReviewed.length) kids.push(h('p', { class: 'sr-meta', text: 'Iris reviewed ' + irisReviewed + ' of ' + plural(site.reviewed.length, 'template') + '.' }));
      kids.push(h('ul', { class: 'sr-tpl' }, rows));
      return h('section', { class: 'sr-box', 'aria-label': 'Page templates' }, kids);
    }

    function coverage() {
      var items = [];
      var limit = 'Pages reached: ' + site.pages.length + ' of the ' + site.maxPages + '-page limit.';
      if (site.capped) limit += ' Stopped at the page limit; the site may have more.';
      items.push(h('li', { text: limit }));
      if (site.skippedLinks.length) {
        var skipped = h('ul', { class: 'sr-list' }, site.skippedLinks.map(function (u) { return h('li', null, [h('span', { text: u })]); }));
        items.push(h('li', null, [plural(site.skippedLinks.length, 'link') + ' not followed because of the exclusion rule.', details('skipped', 'Links not followed', skipped)]));
      }
      var failed = site.pages.filter(function (p) { return p.error || (p.status !== null && p.status >= 400); });
      if (failed.length) {
        items.push(h('li', null, [plural(failed.length, 'page') + ' failed to load.', h('ul', { class: 'sr-list' }, failed.map(function (p) {
          return h('li', { text: p.url + ' (' + (p.error ? p.error : p.status) + ')' });
        }))]));
      }
      var bad = site.captures.filter(function (c) { return c.error; });
      if (bad.length) {
        items.push(h('li', null, [plural(bad.length, 'capture') + ' failed.', h('ul', { class: 'sr-list' }, bad.map(function (c) {
          return h('li', { text: c.url + ' on ' + screenLabel(c.screen) + ': ' + c.error });
        }))]));
      }
      return h('section', { class: 'sr-box', 'aria-label': 'Coverage' }, [h('h3', { class: 'sr-h', text: 'Coverage' }), h('ul', null, items)]);
    }

    function pagesPanel() {
      return h('div', null, [pagesTree(), templatesBox(), coverage()]);
    }

    // --- Render --------------------------------------------------------------

    function paneScroll(name) {
      var pane = root.querySelector('[data-pane="' + name + '"]');
      return pane ? pane.scrollTop : 0;
    }

    var lastKey = null;
    var lastOcc = null;

    function update() {
      var active = document.activeElement;
      var focusKey = active && root.contains(active) && active.getAttribute ? active.getAttribute('data-key') : null;
      var left = paneScroll('left');
      var right = paneScroll('right');
      syncHeader();
      syncTabs();
      ui.panel.textContent = '';
      ui.panel.appendChild(state.tab === 'problems' ? problemsPanel() : pagesPanel());
      var l = root.querySelector('[data-pane="left"]');
      var r = root.querySelector('[data-pane="right"]');
      if (l) l.scrollTop = left;
      // A new problem or element: bring the framed element into view (it can
      // sit low in its band); otherwise keep the reader's scroll.
      var moved = lastKey !== state.key || lastOcc !== state.occ;
      if (r && !moved) r.scrollTop = right;
      if (r && moved) {
        var mark = r.querySelector('.sr-mark');
        if (mark) {
          var img = r.querySelector('.sr-shot img');
          var place = function () {
            var below = mark.getBoundingClientRect().top - r.getBoundingClientRect().top;
            if (below > r.clientHeight * 0.6) r.scrollTop += below - r.clientHeight / 3;
          };
          if (img && !img.complete) img.addEventListener('load', place, { once: true });
          else place();
        }
      }
      lastKey = state.key;
      lastOcc = state.occ;
      if (focusKey) {
        var all = root.querySelectorAll('[data-key]');
        var found = null;
        for (var j = 0; j < all.length; j++) if (all[j].getAttribute('data-key') === focusKey) { found = all[j]; break; }
        if (found && found.disabled) {
          var alt = root.querySelector('[data-key="' + (focusKey === 'nav:next' ? 'nav:prev' : 'nav:next') + '"]');
          found = alt && !alt.disabled ? alt : null;
        }
        if (found) found.focus();
      }
    }

    root.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = target && target.tagName ? target.tagName : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      var prevKey = event.key === 'ArrowLeft' || event.key === 'k';
      var nextKey = event.key === 'ArrowRight' || event.key === 'j';
      if (!prevKey && !nextKey) return;
      if (target && target.getAttribute && target.getAttribute('role') === 'tab') {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        state.tab = state.tab === 'problems' ? 'pages' : 'problems';
        update();
        ui.tabs[state.tab].focus();
        event.preventDefault();
        return;
      }
      if (state.tab !== 'problems') return;
      event.preventDefault();
      go(prevKey ? -1 : 1);
    });

    var tabs = buildTabs();
    ui.panel = h('div', { id: 'sr-panel', role: 'tabpanel' });
    root.textContent = '';
    root.appendChild(buildHeader());
    root.appendChild(tabs);
    root.appendChild(ui.panel);
    update();
  }

  window.siteReview = { mount: mount };
})();
`;

/**
 * The report as a visual bundle: the fixed runtime and style sheet with the
 * measured site embedded as data. Only the images a finding or a capture
 * refers to (its crop, its context image, a thumbnail) are embedded; one
 * missing from `images` shows a placeholder.
 */
export function renderReportBundle(input: {
  site: ReviewedSite;
  /** Workspace path to `data:image/jpeg;base64,...`. */
  images: Readonly<Record<string, string>>;
  generatedAt: string;
}): ReportBundle {
  const { site, generatedAt } = input;
  const referenced = new Set<string>();
  for (const finding of site.findings) {
    if (finding.crop) referenced.add(finding.crop);
    if (finding.context) referenced.add(finding.context.image);
  }
  for (const capture of site.captures) {
    if (capture.thumbnail) referenced.add(capture.thumbnail);
  }
  const images: Record<string, string> = {};
  for (const path of referenced) {
    const uri = input.images[path];
    if (typeof uri === 'string' && uri.startsWith('data:image/')) {
      images[path] = uri;
    }
  }
  const screens = SITE_SCREENS.map(({ name, label }) => ({ name, label }));
  const labels = joinList(site.screens.map(screenLabel));
  return {
    title: `Site review: ${hostOf(site)}`,
    description: `Reviewed ${counted(site.pages.length, 'page')} on ${labels}: ${problemsLine(site.findings)}.`,
    html: `<div id="${ROOT_ID}" class="sr"></div>`,
    css: REPORT_CSS,
    javascript: [
      REPORT_RUNTIME,
      `window.siteReview.mount(document.getElementById(${JSON.stringify(ROOT_ID)}), ${scriptJson({ site, images, screens, generatedAt })});`,
    ].join('\n'),
  };
}
