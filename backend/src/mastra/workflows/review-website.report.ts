/**
 * The Review a Website report (agents.md 5.19): the interactive visual the
 * last step stores, and the run's answer. Both are built by fixed code from
 * the measured findings; no model writes any of it. The visual is a fixed
 * style sheet and a fixed vanilla-JS runtime with the data embedded as JSON,
 * the way the dashboard mock is built (recreate-dashboard.steps.ts): the
 * runtime makes DOM nodes and sets text, so a page title, URL or selector
 * from a hostile website never reaches the markup. No framework import.
 */
import {
  SITE_SCREENS,
  type DiscoveredSite,
  type Finding,
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

function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, major: 0, minor: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
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
 * The run's answer in Markdown: what was reviewed, the worst findings to
 * fix first, and what the crawl did and did not reach. Fixed text.
 */
export function reviewAnswer(site: ReviewedSite): string {
  const counts = countBySeverity(site.findings);
  const screens = joinList(site.screens.map(screenLabel));
  const lines = [
    `**${hostOf(site)}**: ${counted(site.pages.length, 'page')} on ${screens} — ${severityLine(counts)}.`,
  ];

  if (site.reviewed.length > 0) {
    const irisCount = site.findings.filter((f) => f.source === 'iris').length;
    lines.push(
      '',
      `Iris reviewed ${counted(site.reviewed.length, 'page template')} and found ${counted(irisCount, 'visual issue')}.`,
    );
  } else if (
    site.visualReview &&
    site.reviewTemplates.length === 0 &&
    site.templates.length > 0
  ) {
    lines.push('', "Iris's visual review was skipped: measured checks only.");
  }

  if (site.findings.length) {
    const bullets = site.findings
      .slice(0, 3)
      .map(
        (finding) =>
          `- **${finding.title}** (${finding.severity}, ${screenLabel(finding.screen)})${finding.source === 'iris' ? ' (Iris)' : ''} on ${counted(finding.pages.length, 'page')} of \`${finding.group}\`: ${finding.measured}`,
      );
    lines.push('', 'Fix first:', ...bullets);
  }

  const coverage = [
    `${counted(site.pages.length, 'page')} reached out of a limit of ${site.maxPages}${
      site.capped
        ? '; the crawl stopped at the page limit, so the site may have more'
        : ''
    }.`,
    `${counted(site.templates.length, 'page template')}.`,
  ];
  const skipped = site.skippedLinks.length;
  if (skipped) {
    coverage.push(
      `${counted(skipped, 'link')} ${skipped === 1 ? 'was' : 'were'} not followed because of the exclusion rule.`,
    );
  }
  const failed = failedPages(site).length;
  if (failed) coverage.push(`${counted(failed, 'page')} failed to load.`);
  const failedCaptures = site.captures.filter((c) => c.error !== null).length;
  if (failedCaptures) {
    coverage.push(`${counted(failedCaptures, 'capture')} failed.`);
  }
  lines.push('', `Coverage: ${coverage.join(' ')}`);

  lines.push(
    '',
    'The full report is the visual above: every finding shows the element, what was measured and a crop of the screenshot.',
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
.sr { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.45; color: var(--sr-fg); }
.sr * { box-sizing: border-box; }
.sr h2, .sr h3, .sr p, .sr ul, .sr ol { margin: 0; }
.sr ul, .sr ol { padding: 0; list-style: none; }
.sr a { color: var(--sr-link); }
.sr code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; background: var(--sr-surface); border: 1px solid var(--sr-border); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
.sr :focus-visible { outline: 2px solid var(--sr-focus); outline-offset: 2px; }
.sr-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.sr-host { font-size: 18px; font-weight: 700; color: var(--sr-strong); overflow-wrap: anywhere; }
.sr-meta { color: var(--sr-muted); font-size: 12px; overflow-wrap: anywhere; }
.sr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sr-badge { display: inline-block; padding: 1px 7px; border-radius: 4px; color: #ffffff; font-size: 12px; font-weight: 700; white-space: nowrap; }
.sr-b-critical { background: #7f1d1d; }
.sr-b-major { background: #dc2626; }
.sr-b-minor { background: #b45309; }
.sr-b-ok { background: #15803d; }
.sr-toggle { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.sr-btn { font: inherit; font-size: 13px; cursor: pointer; color: var(--sr-fg); background: var(--sr-bg); border: 1px solid var(--sr-border); border-radius: 999px; padding: 3px 12px; }
.sr-btn[aria-pressed='true'] { background: var(--sr-strong); color: var(--sr-bg); border-color: var(--sr-strong); }
.sr-cols { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 700px) { .sr-cols { grid-template-columns: minmax(0, 1fr); } }
.sr-h { font-size: 13px; font-weight: 700; color: var(--sr-strong); margin-bottom: 8px; }
.sr-groups { display: flex; flex-direction: column; gap: 8px; }
.sr-group { display: block; width: 100%; text-align: left; font: inherit; color: var(--sr-fg); cursor: pointer; background: var(--sr-bg); border: 1px solid var(--sr-border); border-radius: 8px; padding: 8px 10px; }
.sr-group[aria-current='true'] { border: 2px solid var(--sr-focus); padding: 7px 9px; background: var(--sr-surface); }
.sr-group-pattern { display: block; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 13px; font-weight: 700; color: var(--sr-strong); overflow-wrap: anywhere; }
.sr-group-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; font-size: 12px; color: var(--sr-muted); }
.sr-thumb { display: block; max-width: 100%; max-height: 220px; border: 1px solid var(--sr-border); border-radius: 6px; margin-bottom: 12px; }
.sr-cards { display: flex; flex-direction: column; gap: 12px; }
.sr-card { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 12px; border: 1px solid var(--sr-border); border-radius: 8px; padding: 10px; background: var(--sr-bg); }
@media (max-width: 560px) { .sr-card { grid-template-columns: minmax(0, 1fr); } }
.sr-crop { display: block; width: 100%; max-height: 160px; object-fit: cover; object-position: top left; border: 1px solid var(--sr-border); border-radius: 4px; }
.sr-ph { display: flex; align-items: center; justify-content: center; min-height: 80px; padding: 6px; text-align: center; font-size: 12px; color: var(--sr-muted); border: 1px dashed var(--sr-border); border-radius: 4px; background: repeating-linear-gradient(45deg, transparent 0 8px, var(--sr-surface) 8px 16px); }
.sr-ftitle { font-weight: 700; color: var(--sr-strong); margin-left: 6px; }
.sr-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.sr-label { color: var(--sr-muted); }
.sr details { margin-top: 2px; }
.sr summary { cursor: pointer; color: var(--sr-muted); font-size: 12px; }
.sr-list { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.sr-box { border: 1px solid var(--sr-border); border-radius: 8px; padding: 10px 12px; margin-top: 16px; background: var(--sr-surface); }
.sr-box > .sr-h { margin-bottom: 6px; }
.sr-box ul { display: flex; flex-direction: column; gap: 2px; }
.sr-empty { border: 1px solid var(--sr-border); border-radius: 8px; padding: 16px; background: var(--sr-surface); color: var(--sr-strong); font-weight: 700; }
.sr-src { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; vertical-align: 1px; }
.sr-src-measured { background: var(--sr-surface); color: var(--sr-strong); border: 1px solid var(--sr-border); }
.sr-src-iris { background: transparent; color: var(--sr-strong); border: 1px solid var(--sr-focus); }
.sr .sr-quote { margin-bottom: 12px; padding: 8px 12px; border-left: 4px solid var(--sr-focus); border-radius: 4px; background: var(--sr-surface); color: var(--sr-fg); }
.sr-quote-label { display: block; font-size: 11px; font-weight: 700; color: var(--sr-muted); margin-bottom: 2px; }
.sr-tree li { font-size: 12px; padding: 2px 0; overflow-wrap: anywhere; }
.sr-tree .sr-st { color: var(--sr-muted); }
`;

const REPORT_RUNTIME = `
(function () {
  var SEVERITIES = ['critical', 'major', 'minor'];

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

  function mount(root, data) {
    var site = data.site;
    var images = data.images || {};
    var screens = data.screens;
    var state = { screen: site.screens[0], group: null, open: {} };

    function screenLabel(name) {
      for (var i = 0; i < screens.length; i++) if (screens[i].name === name) return screens[i].label;
      return name;
    }

    function countsOf(list) {
      var counts = { critical: 0, major: 0, minor: 0 };
      for (var i = 0; i < list.length; i++) counts[list[i].severity] += 1;
      return counts;
    }

    function badges(counts, withEmpty) {
      var out = [];
      for (var i = 0; i < SEVERITIES.length; i++) {
        var s = SEVERITIES[i];
        if (counts[s] > 0) out.push(badge(s, counts[s] + ' ' + s));
      }
      if (!out.length && withEmpty) out.push(badge('ok', 'ok'));
      return out;
    }

    function image(path, alt, cls) {
      var src = path ? images[path] : null;
      if (typeof src === 'string' && src.indexOf('data:image/') === 0) {
        return h('img', { class: cls, src: src, alt: alt });
      }
      return h('div', { class: 'sr-ph', role: 'img', 'aria-label': alt, text: 'No image available' });
    }

    function details(key, summary, content) {
      var el = h('details', { 'data-key': key, open: state.open[key] === true }, [h('summary', { text: summary }), content]);
      el.addEventListener('toggle', function () { state.open[key] = el.open; });
      return el;
    }

    var reviewedBy = {};
    (site.reviewed || []).forEach(function (r) { reviewedBy[r.template] = r; });

    function groupsOf(screen) {
      var byGroup = {};
      var order = [];
      for (var i = 0; i < site.pages.length; i++) {
        var g = site.pages[i].group;
        if (!byGroup[g]) { byGroup[g] = { group: g, pages: 0, findings: [] }; order.push(g); }
        byGroup[g].pages += 1;
      }
      for (var j = 0; j < site.findings.length; j++) {
        var f = site.findings[j];
        if (f.screen === screen && byGroup[f.group]) byGroup[f.group].findings.push(f);
      }
      var list = order.map(function (g) { return byGroup[g]; });
      list.forEach(function (entry, index) { entry.index = index; entry.counts = countsOf(entry.findings); });
      list.sort(function (a, b) {
        var ac = a.counts.critical > 0 ? 1 : 0;
        var bc = b.counts.critical > 0 ? 1 : 0;
        if (ac !== bc) return bc - ac;
        if (a.findings.length !== b.findings.length) return b.findings.length - a.findings.length;
        if (a.pages !== b.pages) return b.pages - a.pages;
        return a.index - b.index;
      });
      return list;
    }

    function header() {
      var all = countsOf(site.findings);
      var host = site.origin;
      try { host = new URL(site.origin).host; } catch (e) { /* keep the origin */ }
      var labels = site.screens.map(screenLabel).join(', ');
      return h('header', { class: 'sr-head' }, [
        h('h2', { class: 'sr-host', text: host }),
        h('p', { class: 'sr-meta' }, ['Entry URL: ', h('span', { text: site.url }), ' ', link(site.url, '(open)')]),
        h('div', { class: 'sr-row', role: 'group', 'aria-label': 'Findings by severity' }, badges(all, true)),
        h('p', { class: 'sr-meta', text: 'Screens reviewed: ' + labels + '. Generated ' + data.generatedAt + '.' }),
      ]);
    }

    function toggle() {
      var buttons = site.screens.map(function (name) {
        var btn = h('button', { type: 'button', class: 'sr-btn', 'data-key': 'screen:' + name, 'aria-pressed': state.screen === name ? 'true' : 'false', text: screenLabel(name) });
        btn.addEventListener('click', function () { state.screen = name; state.group = null; render(); });
        return btn;
      });
      return h('div', { class: 'sr-toggle', role: 'group', 'aria-label': 'Screen' }, buttons);
    }

    function groupList(groups) {
      var items = groups.map(function (entry) {
        var btn = h('button', { type: 'button', class: 'sr-group', 'data-key': 'group:' + entry.group, 'aria-current': entry.group === state.group ? 'true' : null }, [
          h('span', { class: 'sr-group-pattern', text: entry.group }),
          h('span', { class: 'sr-group-line' }, [
            h('span', { class: 'sr-row' }, [h('span', { text: plural(entry.pages, 'page') }), reviewedBy[entry.group] ? sourceTag('iris') : null]),
            h('span', { class: 'sr-row' }, badges(entry.counts, true)),
          ]),
        ]);
        btn.addEventListener('click', function () { state.group = entry.group; render(); });
        return h('li', null, [btn]);
      });
      return h('div', null, [h('h3', { class: 'sr-h', text: 'Page templates' }), h('ul', { class: 'sr-groups' }, items)]);
    }

    function sourceTag(source) {
      return h('span', { class: 'sr-src sr-src-' + (source === 'iris' ? 'iris' : 'measured'), text: source === 'iris' ? 'Iris' : 'Measured' });
    }

    function findingCard(f) {
      var iris = f.source === 'iris';
      var expected = [h('span', { class: 'sr-label', text: iris ? 'Suggestion: ' : 'Expected: ' }), h('span', { text: f.expected })];
      if (!iris && f.helpUrl && isWebUrl(f.helpUrl)) { expected.push(' '); expected.push(link(f.helpUrl, '(rule)')); }
      var body = [
        h('div', null, [badge(f.severity, f.severity), ' ', sourceTag(f.source), h('span', { class: 'sr-ftitle', text: f.title })]),
        h('p', null, [h('span', { class: 'sr-label', text: iris ? 'Observed: ' : 'Measured: ' }), h('span', { text: f.measured })]),
        h('p', null, expected),
      ];
      if (f.selector) body.push(h('p', null, [h('span', { class: 'sr-label', text: 'Element: ' }), h('code', { text: f.selector })]));
      var pages = h('ul', { class: 'sr-list' }, f.pages.map(function (url) { return h('li', null, [link(url)]); }));
      body.push(h('p', { text: 'Found on ' + plural(f.pages.length, 'page') }));
      body.push(details('f:' + f.id, 'Pages with this finding', pages));
      return h('li', { class: 'sr-card' }, [image(f.crop, 'Crop of the screenshot for: ' + f.title, 'sr-crop'), h('div', { class: 'sr-body' }, body)]);
    }

    function findingsPane(entry) {
      var kids = [h('h3', { class: 'sr-h', text: entry.group + ' - ' + screenLabel(state.screen) + ' - ' + plural(entry.pages, 'page') })];
      var thumbCapture = null;
      for (var i = 0; i < site.captures.length; i++) {
        var c = site.captures[i];
        if (c.group === entry.group && c.screen === state.screen && c.thumbnail) { thumbCapture = c; break; }
      }
      if (thumbCapture) kids.push(image(thumbCapture.thumbnail, 'Screenshot of ' + thumbCapture.url + ' on ' + screenLabel(state.screen), 'sr-thumb'));
      var review = reviewedBy[entry.group];
      if (review) {
        kids.push(h('p', { class: 'sr-quote' }, [h('span', { class: 'sr-quote-label', text: 'Iris' }), h('span', { text: review.summary })]));
      }
      if (!entry.findings.length) {
        kids.push(h('p', { class: 'sr-empty', text: 'No ' + (review ? '' : 'measured ') + 'issues in this page template on ' + screenLabel(state.screen) + '.' }));
      } else {
        kids.push(h('ul', { class: 'sr-cards' }, entry.findings.map(findingCard)));
      }
      return h('div', null, kids);
    }

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
        site.findings.forEach(function (f) { if (f.screen === state.screen && f.pages.indexOf(page.url) >= 0) n += 1; });
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

    function render() {
      var active = document.activeElement;
      var focusKey = active && active.getAttribute ? active.getAttribute('data-key') : null;
      var groups = groupsOf(state.screen);
      var selected = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].group === state.group) selected = groups[i];
      if (!selected && groups.length) { selected = groups[0]; state.group = selected.group; }

      var kids = [header()];
      if (!site.findings.length) {
        kids.push(h('p', { class: 'sr-empty', text: 'No ' + (site.reviewed && site.reviewed.length ? '' : 'measured ') + 'issues found on ' + plural(site.pages.length, 'page') + '.' }));
        kids.push(pagesTree());
        kids.push(coverage());
      } else {
        kids.push(toggle());
        kids.push(h('div', { class: 'sr-cols', style: 'margin-top:16px' }, [groupList(groups), selected ? findingsPane(selected) : h('p', { text: 'No pages.' })]));
        kids.push(pagesTree());
        kids.push(coverage());
      }
      root.textContent = '';
      kids.forEach(function (k) { root.appendChild(k); });
      if (focusKey) {
        var all = root.querySelectorAll('[data-key]');
        for (var j = 0; j < all.length; j++) {
          if (all[j].getAttribute('data-key') === focusKey) { all[j].focus(); break; }
        }
      }
    }

    render();
  }

  window.siteReview = { mount: mount };
})();
`;

/**
 * The report as a visual bundle: the fixed runtime and style sheet with the
 * measured site embedded as data. Only the images a finding or a capture
 * refers to are embedded; one missing from `images` shows a placeholder.
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
  const counts = countBySeverity(site.findings);
  const labels = joinList(site.screens.map(screenLabel));
  return {
    title: `Site review: ${hostOf(site)}`,
    description: `Reviewed ${counted(site.pages.length, 'page')} on ${labels}: ${severityLine(counts)}.`,
    html: `<div id="${ROOT_ID}" class="sr"></div>`,
    css: REPORT_CSS,
    javascript: [
      REPORT_RUNTIME,
      `window.siteReview.mount(document.getElementById(${JSON.stringify(ROOT_ID)}), ${scriptJson({ site, images, screens, generatedAt })});`,
    ].join('\n'),
  };
}
