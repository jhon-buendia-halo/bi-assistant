/**
 * The fixed runtime that draws a Consumption Gap Analysis report (agents.md
 * 5.20): the script and style sheet every such report ships, word for word.
 * No model writes them. The script reads one JSON document (the `GapReport`)
 * and draws the status summary, the requirement matrix, the inferred lineage
 * graph (three layer columns of entity cards and SVG curves), the reference
 * dashboards with a status badge per widget, and the fixes by layer.
 * Selecting a requirement highlights the columns it needs and every upstream
 * edge and column.
 *
 * Plain strings, no framework import. The script is browser-native
 * JavaScript with no template literal and no backslash, so it sits in a
 * template literal here unchanged. Every text reaches the page through
 * `textContent`, never `innerHTML`. It exposes `window.gapReport.mount`.
 */

/** The id of the element the runtime mounts on. */
export const GAP_REPORT_ROOT_ID = 'gap-report-root';

export const GAP_REPORT_RUNTIME = `(function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var ARROW = String.fromCharCode(8594);
  var DASH = String.fromCharCode(8212);
  var MIDDOT = String.fromCharCode(183);
  var CARET = String.fromCharCode(9662);
  var ORDER = ['supported', 'derivable', 'grain', 'normalized-only', 'landing-only', 'missing'];
  var STATUS = {
    supported: { label: 'Supported', icon: String.fromCharCode(10003), help: 'In Consumption' },
    derivable: { label: 'Derivable', icon: String.fromCharCode(402), help: 'Computable from Consumption' },
    grain: { label: 'Grain / coverage', icon: String.fromCharCode(9888), help: 'Column exists, data does not answer' },
    'normalized-only': { label: 'In Normalized only', icon: String.fromCharCode(8593), help: 'Expose in Consumption' },
    'landing-only': { label: 'In Landing only', icon: String.fromCharCode(8593, 8593), help: 'Normalize, then expose' },
    missing: { label: 'No source', icon: String.fromCharCode(8709), help: 'New source / ingestion' }
  };
  var LAYER_ORDER = ['landing', 'normalized', 'consumption'];
  var LAYER_LABEL = { landing: 'Landing', normalized: 'Normalized', consumption: 'Consumption', source: 'New source' };
  var FIX_ORDER = ['consumption', 'normalized', 'landing', 'source'];
  var FIX_HEAD = {
    consumption: 'Change Consumption only',
    normalized: 'Start in Normalized',
    landing: 'Start in Landing',
    source: 'Needs a new source'
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svgEl(tag, cls) {
    var node = document.createElementNS(SVG, tag);
    if (cls) node.setAttribute('class', cls);
    return node;
  }

  function add(parent) {
    for (var i = 1; i < arguments.length; i += 1) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function shortEntity(entity) {
    return String(entity).split('.').slice(-2).join('.');
  }

  function colKey(entity, column) {
    return entity + '|' + column;
  }

  function plural(count, noun) {
    // A noun ending in s, x, z, ch or sh takes 'es' (fix → fixes).
    var suffix = /(s|x|z|ch|sh)$/.test(noun) ? 'es' : 's';
    return count + ' ' + noun + (count === 1 ? '' : suffix);
  }

  function statusChip(status) {
    var info = STATUS[status] || STATUS.missing;
    var chip = el('span', 'gap-st gap-st-' + status);
    add(chip, el('span', 'gap-st-icon', info.icon), el('span', null, info.label));
    return chip;
  }

  function layerChip(layer) {
    return el('span', 'gap-chip gap-L-' + layer, LAYER_LABEL[layer] || layer);
  }

  function mapClass(status) {
    if (status === 'supported' || status === 'derivable') return 'mapped';
    if (status === 'grain') return 'partial';
    return 'nodata';
  }

  var MAP_LABEL = { mapped: 'Mapped', partial: 'Partly mapped', nodata: 'No data' };

  function mapBadge(status) {
    var cls = mapClass(status);
    return el('span', 'gap-badge gap-badge-' + cls, MAP_LABEL[cls]);
  }

  function mount(root, report) {
    root.textContent = '';
    var requirements = report.requirements || [];
    var assessments = report.assessments || [];
    var fixes = report.fixes || [];
    var tables = report.tables || [];
    var edges = (report.lineage && report.lineage.edges) || [];
    var dashboards = report.dashboards || [];

    var reqById = {};
    requirements.forEach(function (r) { reqById[r.id] = r; });
    var assessById = {};
    assessments.forEach(function (a) { assessById[a.requirementId] = a; });
    var fixIdsByReq = {};
    fixes.forEach(function (f) {
      (f.closes || []).forEach(function (id) {
        (fixIdsByReq[id] = fixIdsByReq[id] || []).push(f.id);
      });
    });
    var entityKnown = {};
    tables.forEach(function (t) { entityKnown[t.entity] = true; });

    function statusOf(id) {
      var a = assessById[id];
      return a ? a.status : 'missing';
    }

    function counts() {
      var out = {};
      ORDER.forEach(function (s) { out[s] = 0; });
      requirements.forEach(function (r) { out[statusOf(r.id)] += 1; });
      return out;
    }

    // The columns a requirement needs: each field's Consumption source, else its upstream one.
    function sourcesOf(id) {
      var a = assessById[id];
      var out = [];
      if (!a) return out;
      a.fields.forEach(function (f) {
        var s = f.consumption || f.upstream;
        if (s && entityKnown[s.entity]) out.push(s);
      });
      return out;
    }

    function foundIn(id) {
      var seen = {};
      var parts = [];
      sourcesOf(id).forEach(function (s) {
        var text = shortEntity(s.entity) + '.' + s.column;
        if (s.layer !== 'consumption') text += ' (' + (LAYER_LABEL[s.layer] || s.layer) + ')';
        if (!seen[text]) { seen[text] = true; parts.push(text); }
      });
      return parts;
    }

    var state = { filter: null, selected: null };
    var colEls = {};
    var edgeEls = [];
    var summaryButtons = {};
    var matrixBody = null;
    var widgetEls = [];
    var caption = null;
    var missingNote = null;
    var lin = null;

    // ---- header and summary ----
    var consumptionSchemas = (report.layers || [])
      .filter(function (l) { return l.layer === 'consumption'; })
      .map(function (l) { return l.schemaKey; });
    var total = requirements.length;
    var c = counts();

    function headline() {
      var parts = [];
      parts.push(c.supported + ' of ' + total + ' requirements are supported as is');
      if (c.derivable) parts[0] += ' and ' + c.derivable + ' more ' + (c.derivable === 1 ? 'is' : 'are') + ' derivable';
      var by = {};
      fixes.forEach(function (f) { by[f.startsIn] = (by[f.startsIn] || 0) + 1; });
      var text = parts[0] + '.';
      if (fixes.length) {
        var groups = FIX_ORDER.filter(function (l) { return by[l]; }).map(function (l) {
          return by[l] + ' ' + (l === 'source' ? 'that needs a new source' : 'starting in ' + LAYER_LABEL[l]);
        });
        text += ' ' + plural(fixes.length, 'fix') + ' close' + (fixes.length === 1 ? 's' : '') + ' the rest: ' + groups.join(', ') + '.';
      }
      var confirmed = edges.filter(function (e) { return e.method === 'values'; }).length;
      var lineage = report.lineage || { failedChecks: 0 };
      text += ' Lineage was inferred (no declared lineage): ' + plural(edges.length, 'edge') + ', ' + confirmed +
        ' confirmed by matching values' + (lineage.failedChecks ? ', ' + plural(lineage.failedChecks, 'check') + ' failed' : '') + '.';
      return text;
    }

    var head = el('section', 'gap-card');
    add(head, el('h2', 'gap-h2', 'Can ' + (consumptionSchemas.join(', ') || 'Consumption') + ' support the questions and the dashboards?'));
    add(head, el('p', 'gap-lead', headline()));
    var sumGrid = el('div', 'gap-summary');
    ORDER.forEach(function (s) {
      var btn = el('button', 'gap-sum');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', STATUS[s].label + ': ' + c[s] + ' requirements. Filter the matrix.');
      if (!c[s]) btn.disabled = true;
      add(btn, statusChip(s), el('div', 'gap-sum-n', c[s]), el('div', 'gap-small gap-muted', STATUS[s].help));
      btn.addEventListener('click', function () {
        state.filter = state.filter === s ? null : s;
        update();
      });
      summaryButtons[s] = btn;
      sumGrid.appendChild(btn);
    });
    add(head, sumGrid);
    root.appendChild(head);

    // ---- matrix ----
    var matrixCard = el('section', 'gap-card');
    add(matrixCard, el('h2', 'gap-h2', 'Requirement matrix'));
    var wrap = el('div', 'gap-table-wrap');
    var table = el('table', 'gap-table');
    var thead = el('thead');
    var htr = el('tr');
    ['#', 'Requirement', 'Needs', 'Found in', 'Status', 'Evidence', 'Fix'].forEach(function (h) {
      var th = el('th', null, h);
      th.setAttribute('scope', 'col');
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    matrixBody = el('tbody');
    add(table, thead, matrixBody);
    wrap.appendChild(table);
    add(matrixCard, wrap, el('p', 'gap-small gap-muted gap-hint', 'Select a row to trace the requirement in the lineage graph.'));
    root.appendChild(matrixCard);

    function fieldTag(f) {
      var label = f.aggregation ? f.aggregation + ' ' + f.name : f.name;
      return el('span', 'gap-tag gap-tag-' + f.role, label);
    }

    function select(id) {
      state.selected = state.selected === id ? null : id;
      update();
    }

    function renderMatrix() {
      matrixBody.textContent = '';
      requirements.forEach(function (r) {
        var st = statusOf(r.id);
        if (state.filter && st !== state.filter) return;
        var a = assessById[r.id];
        var tr = el('tr', 'gap-req' + (state.selected === r.id ? ' gap-sel' : ''));
        var idCell = el('td');
        var idBtn = el('button', 'gap-id', r.id);
        idBtn.type = 'button';
        idBtn.setAttribute('aria-pressed', state.selected === r.id ? 'true' : 'false');
        idBtn.setAttribute('aria-label', 'Trace ' + r.id + ' in the lineage: ' + r.title);
        idCell.appendChild(idBtn);
        var titleCell = el('td');
        add(titleCell, el('div', null, r.title), el('div', 'gap-src', r.source));
        var needs = el('td');
        (r.fields || []).forEach(function (f) { needs.appendChild(fieldTag(f)); });
        if (r.grain) add(needs, el('div', 'gap-src', 'grain: ' + r.grain));
        var found = el('td', 'gap-mono');
        var parts = foundIn(r.id);
        if (parts.length) parts.forEach(function (p) { found.appendChild(el('div', null, p)); });
        else found.textContent = DASH;
        var stCell = el('td');
        stCell.appendChild(statusChip(st));
        var ev = el('td', 'gap-probe', (a && (a.evidence || a.reason)) || DASH);
        var fx = el('td', 'gap-fixcell', (fixIdsByReq[r.id] || []).join(', ') || DASH);
        add(tr, idCell, titleCell, needs, found, stCell, ev, fx);
        tr.addEventListener('click', function () { select(r.id); });
        matrixBody.appendChild(tr);
      });
    }

    // ---- lineage ----
    var linCard = el('section', 'gap-card');
    var linHead = el('h2', 'gap-h2', 'Inferred lineage ');
    caption = el('span', 'gap-small gap-muted gap-caption', DASH + ' all edges');
    linHead.appendChild(caption);
    linCard.appendChild(linHead);
    missingNote = el('div', 'gap-missing');
    missingNote.hidden = true;
    linCard.appendChild(missingNote);
    var linWrap = el('div', 'gap-lin-wrap');
    lin = el('div', 'gap-lin');
    LAYER_ORDER.forEach(function (layer) {
      var colBox = el('div', 'gap-lin-col');
      var lh = el('div', 'gap-layerhead');
      add(lh, layerChip(layer));
      (report.layers || []).filter(function (l) { return l.layer === layer; }).forEach(function (l) {
        lh.appendChild(el('code', 'gap-small', l.schemaKey));
      });
      colBox.appendChild(lh);
      var inLayer = tables.filter(function (t) { return t.layer === layer; });
      if (!inLayer.length) colBox.appendChild(el('div', 'gap-small gap-muted', 'No entities loaded.'));
      inLayer.forEach(function (t) {
        var card = el('div', 'gap-tbl');
        var tn = el('div', 'gap-tn', t.entity.split('.').slice(-1)[0]);
        tn.title = t.entity;
        card.appendChild(tn);
        t.columns.forEach(function (col) {
          var row = el('div', 'gap-col');
          add(row, el('span', 'gap-col-name', col.name), el('span', 'gap-col-type', col.type));
          colEls[colKey(t.entity, col.name)] = row;
          card.appendChild(row);
        });
        if (t.more) card.appendChild(el('div', 'gap-col gap-col-more', '+ ' + t.more + ' more'));
        colBox.appendChild(card);
      });
      lin.appendChild(colBox);
    });
    linWrap.appendChild(lin);
    linCard.appendChild(linWrap);
    var legend = el('div', 'gap-legend');
    var l1 = el('span');
    var s1 = svgEl('svg');
    s1.setAttribute('width', '30');
    s1.setAttribute('height', '6');
    var ln1 = svgEl('line', 'gap-legend-line');
    ln1.setAttribute('x1', '0'); ln1.setAttribute('y1', '3'); ln1.setAttribute('x2', '30'); ln1.setAttribute('y2', '3');
    s1.appendChild(ln1);
    add(l1, s1, document.createTextNode('a query found the values (solid)'));
    var l2 = el('span');
    var s2 = svgEl('svg');
    s2.setAttribute('width', '30');
    s2.setAttribute('height', '6');
    var ln2 = svgEl('line', 'gap-legend-line gap-legend-dashed');
    ln2.setAttribute('x1', '0'); ln2.setAttribute('y1', '3'); ln2.setAttribute('x2', '30'); ln2.setAttribute('y2', '3');
    s2.appendChild(ln2);
    add(l2, s2, document.createTextNode('name match or derived by the mapper (dashed)'));
    var l3 = el('span');
    add(l3, el('span', 'gap-col gap-need gap-legend-col', 'col'), document.createTextNode('a column the selected requirement needs'));
    add(legend, l1, l2, l3);
    linCard.appendChild(legend);
    root.appendChild(linCard);

    function drawEdges() {
      var old = lin.querySelector('svg');
      if (old) lin.removeChild(old);
      edgeEls = [];
      var box = lin.getBoundingClientRect();
      if (!box.width) return;
      var svg = svgEl('svg', 'gap-edges');
      svg.setAttribute('width', String(box.width));
      svg.setAttribute('height', String(box.height));
      svg.setAttribute('aria-hidden', 'true');
      edges.forEach(function (e) {
        var a = colEls[colKey(e.from.entity, e.from.column)];
        var b = colEls[colKey(e.to.entity, e.to.column)];
        if (!a || !b) return;
        var ra = a.getBoundingClientRect();
        var rb = b.getBoundingClientRect();
        var x1 = ra.right - box.left;
        var y1 = ra.top + ra.height / 2 - box.top;
        var x2 = rb.left - box.left;
        var y2 = rb.top + rb.height / 2 - box.top;
        var dx = Math.max(24, Math.abs(x2 - x1) / 2);
        var p = svgEl('path', 'gap-edge' + (e.method === 'values' ? '' : ' gap-edge-inferred'));
        p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
        var title = svgEl('title');
        title.textContent = shortEntity(e.from.entity) + '.' + e.from.column + ' ' + ARROW + ' ' +
          shortEntity(e.to.entity) + '.' + e.to.column + ' ' + MIDDOT + ' ' + e.method +
          (e.overlap !== null && e.overlap !== undefined ? ' ' + MIDDOT + ' values ' + Math.round(e.overlap * 100) + '%' : '') +
          (e.expression ? ' ' + MIDDOT + ' ' + e.expression : '');
        p.appendChild(title);
        svg.appendChild(p);
        edgeEls.push({ node: p, from: colKey(e.from.entity, e.from.column), to: colKey(e.to.entity, e.to.column) });
      });
      lin.insertBefore(svg, lin.firstChild);
      highlight();
    }

    function upstream(seeds) {
      var set = {};
      var queue = seeds.slice();
      while (queue.length) {
        var k = queue.pop();
        if (set[k]) continue;
        set[k] = true;
        edges.forEach(function (e) {
          if (colKey(e.to.entity, e.to.column) === k) queue.push(colKey(e.from.entity, e.from.column));
        });
      }
      return set;
    }

    function highlight() {
      Object.keys(colEls).forEach(function (k) {
        colEls[k].classList.remove('gap-hl', 'gap-need');
      });
      var r = state.selected ? reqById[state.selected] : null;
      if (!r) {
        edgeEls.forEach(function (e) { e.node.classList.remove('gap-edge-hl', 'gap-edge-dim'); });
        caption.textContent = DASH + ' all edges';
        missingNote.hidden = true;
        return;
      }
      var a = assessById[r.id];
      var need = sourcesOf(r.id).map(function (s) { return colKey(s.entity, s.column); });
      var seeds = need.slice();
      if (a) {
        a.fields.forEach(function (f) {
          (f.path || []).forEach(function (p) { seeds.push(colKey(p.entity, p.column)); });
        });
      }
      var set = upstream(seeds);
      Object.keys(set).forEach(function (k) { if (colEls[k]) colEls[k].classList.add('gap-hl'); });
      need.forEach(function (k) { if (colEls[k]) colEls[k].classList.add('gap-need'); });
      edgeEls.forEach(function (e) {
        var on = set[e.from] && set[e.to];
        e.node.classList.toggle('gap-edge-hl', !!on);
        e.node.classList.toggle('gap-edge-dim', !on);
      });
      caption.textContent = DASH + ' ' + r.id + ': ' + r.title;
      var none = statusOf(r.id) === 'missing';
      missingNote.hidden = !none;
      missingNote.textContent = none
        ? STATUS.missing.icon + ' ' + r.id + ' has no candidate column in any layer' + (a && (a.evidence || a.reason) ? ': ' + (a.evidence || a.reason) : '.')
        : '';
    }

    // ---- dashboards ----
    function reqOf(dashboardId, kind, ref) {
      for (var i = 0; i < requirements.length; i += 1) {
        var r = requirements[i];
        if (r.kind === kind && r.dashboardId === dashboardId && r.ref === ref) return r;
      }
      return null;
    }

    function mark(kind, index) {
      var box = el('div', 'gap-viz');
      box.setAttribute('aria-hidden', 'true');
      if (kind === 'kpi') {
        box.classList.add('gap-viz-kpi');
        box.appendChild(el('i', 'gap-kpi-mark'));
      } else if (kind === 'pie' || kind === 'donut') {
        box.classList.add('gap-viz-round');
        box.appendChild(el('i', 'gap-round-mark'));
      } else if (kind === 'table') {
        box.classList.add('gap-viz-rows');
        for (var r = 0; r < 4; r += 1) box.appendChild(el('i', 'gap-row-mark'));
      } else {
        for (var b = 0; b < 8; b += 1) {
          var bar = el('i', 'gap-bar-mark');
          bar.style.height = (22 + ((b * 37 + index * 13) % 68)) + '%';
          box.appendChild(bar);
        }
      }
      return box;
    }

    dashboards.forEach(function (d) {
      var card = el('section', 'gap-card');
      add(card, el('h2', 'gap-h2', 'Reference dashboard ' + MIDDOT + ' ' + d.name));
      var tally = { mapped: 0, partial: 0, nodata: 0 };
      var bp = d.blueprint;
      var filterRow = el('div', 'gap-filters');
      (bp.filters || []).forEach(function (f) {
        var r = reqOf(d.id, 'filter', f.id);
        var pill = el('span', 'gap-flt');
        add(pill, el('span', null, f.label + ' ' + CARET));
        if (r) pill.appendChild(mapBadge(statusOf(r.id)));
        filterRow.appendChild(pill);
      });
      var tallyLine = el('p', 'gap-small gap-tally');
      var grid = el('div', 'gap-dash');
      (bp.widgets || []).forEach(function (w, index) {
        var r = reqOf(d.id, 'widget', w.id);
        var st = r ? statusOf(r.id) : null;
        var cls = st ? mapClass(st) : 'plain';
        if (st) tally[cls] += 1;
        var span = Math.min(12, Math.max(2, Math.round(w.span) || 12));
        var wc = el('div', 'gap-w gap-w-' + cls);
        wc.style.gridColumn = 'span ' + span;
        var wh = el('div', 'gap-wh');
        add(wh, el('h3', 'gap-h3', w.title));
        if (st) wh.appendChild(mapBadge(st));
        add(wc, wh, mark(w.kind, index));
        var note = '';
        if (r) {
          var found = foundIn(r.id);
          note = st === 'supported' || st === 'derivable'
            ? ARROW + ' ' + (found.join(', ') || DASH)
            : STATUS[st].label + ((fixIdsByReq[r.id] || []).length ? ' ' + MIDDOT + ' fix ' + fixIdsByReq[r.id].join(', ') : '');
        }
        if (note) wc.appendChild(el('div', 'gap-src', note));
        if (r) {
          wc.tabIndex = 0;
          wc.setAttribute('role', 'button');
          wc.setAttribute('aria-pressed', 'false');
          wc.setAttribute('aria-label', w.title + ', ' + MAP_LABEL[cls] + '. Trace ' + r.id + ' in the lineage.');
          var pick = function () {
            state.selected = r.id;
            update();
            lin.scrollIntoView({ block: 'center' });
          };
          wc.addEventListener('click', pick);
          wc.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
          });
          widgetEls.push({ node: wc, id: r.id });
        }
        grid.appendChild(wc);
      });
      tallyLine.textContent = 'Data mapping: ' + tally.mapped + ' mapped, ' + tally.partial + ' partly mapped, ' +
        tally.nodata + ' with no data. The marks are placeholders, not data.';
      add(card, tallyLine, filterRow, grid);
      root.appendChild(card);
    });

    // ---- fixes ----
    var fixCard = el('section', 'gap-card');
    add(fixCard, el('h2', 'gap-h2', 'Recommended fixes, by layer'));
    if (!fixes.length) fixCard.appendChild(el('p', 'gap-muted', 'No fix is needed.'));
    FIX_ORDER.forEach(function (layer) {
      var group = fixes.filter(function (f) { return f.startsIn === layer; });
      if (!group.length) return;
      fixCard.appendChild(el('h3', 'gap-h3 gap-group', FIX_HEAD[layer]));
      group.forEach(function (f) {
        var box = el('div', 'gap-fix');
        var fh = el('div', 'gap-fh');
        var path = el('span', 'gap-path');
        (f.path || []).forEach(function (p, i) {
          if (i) path.appendChild(document.createTextNode(ARROW));
          path.appendChild(p === 'source' ? el('span', 'gap-chip gap-L-source', LAYER_LABEL.source) : layerChip(p));
        });
        add(fh, el('b', null, f.id), el('span', 'gap-fix-title', f.title), el('span', 'gap-spacer'), path);
        var closes = el('div', 'gap-closes');
        closes.appendChild(document.createTextNode('Closes '));
        (f.closes || []).forEach(function (id, i) {
          if (i) closes.appendChild(document.createTextNode(', '));
          closes.appendChild(el('b', null, id));
        });
        closes.appendChild(document.createTextNode(' ' + MIDDOT + ' ' + f.why));
        var details = el('details', 'gap-details');
        add(details, el('summary', null, 'Proposed change'), el('pre', null, f.change));
        add(box, fh, closes, details);
        fixCard.appendChild(box);
      });
    });
    root.appendChild(fixCard);

    // ---- state ----
    function update() {
      ORDER.forEach(function (s) {
        summaryButtons[s].setAttribute('aria-pressed', state.filter === s ? 'true' : 'false');
      });
      renderMatrix();
      widgetEls.forEach(function (w) {
        w.node.setAttribute('aria-pressed', state.selected === w.id ? 'true' : 'false');
        w.node.classList.toggle('gap-w-sel', state.selected === w.id);
      });
      highlight();
    }

    update();
    drawEdges();
    if (typeof ResizeObserver === 'function') {
      var last = 0;
      new ResizeObserver(function () {
        var w = lin.getBoundingClientRect().width;
        if (Math.abs(w - last) > 1) { last = w; drawEdges(); }
      }).observe(lin);
    } else {
      window.addEventListener('resize', drawEdges);
    }
  }

  window.gapReport = { mount: mount };
})();`;

export const GAP_REPORT_CSS = `.gap { color: var(--qti-fg); font-size: 13px; line-height: 1.45; }
.gap * { box-sizing: border-box; }
.gap [hidden] { display: none !important; }
.gap button { font: inherit; color: inherit; cursor: pointer; }
.gap button:disabled { cursor: default; opacity: 0.55; }
.gap :focus-visible { outline: 2px solid var(--qti-focus); outline-offset: 2px; }
.gap-card { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-bg); }
.gap-h2 { margin: 0 0 10px; font-size: 16px; font-weight: 600; color: var(--qti-fg-strong); }
.gap-h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--qti-fg-strong); }
.gap-group { margin: 12px 0 8px; }
.gap-lead { margin: -2px 0 12px; }
.gap-small { font-size: 12px; }
.gap-muted { color: var(--qti-fg-muted); }
.gap-mono, .gap code, .gap pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.gap-hint { margin: 8px 0 0; }
.gap-caption { font-weight: 400; }

.gap-st, .gap-badge, .gap-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.gap-st { --c: var(--qti-fg-muted); color: color-mix(in srgb, var(--c) 55%, var(--qti-fg-strong)); background: color-mix(in srgb, var(--c) 14%, var(--qti-bg)); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); }
.gap-st-supported { --c: var(--qti-pos); }
.gap-st-derivable { --c: var(--qti-cat-1); }
.gap-st-grain { --c: var(--qti-cat-4); }
.gap-st-normalized-only { --c: var(--qti-cat-2); }
.gap-st-landing-only { --c: var(--qti-neg); }
.gap-st-missing { --c: var(--qti-fg-muted); border-style: dashed; }
.gap-st-icon { font-weight: 700; }
.gap-badge { border: 1px solid currentColor; background: transparent; }
.gap-badge-mapped { color: color-mix(in srgb, var(--qti-pos) 60%, var(--qti-fg-strong)); }
.gap-badge-partial { color: var(--qti-fg-strong); border-style: dashed; }
.gap-badge-nodata { color: color-mix(in srgb, var(--qti-neg) 60%, var(--qti-fg-strong)); border-style: dashed; }
.gap-chip { --c: var(--qti-fg-muted); color: color-mix(in srgb, var(--c) 55%, var(--qti-fg-strong)); background: color-mix(in srgb, var(--c) 16%, var(--qti-bg)); }
.gap-L-landing { --c: var(--qti-cat-2); }
.gap-L-normalized { --c: var(--qti-cat-6); }
.gap-L-consumption { --c: var(--qti-cat-4); }
.gap-L-source { border: 1px dashed var(--qti-border); background: var(--qti-surface); }

.gap-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.gap-sum { padding: 10px 12px; border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-surface); text-align: left; }
.gap-sum[aria-pressed="true"] { outline: 2px solid var(--qti-link); }
.gap-sum-n { margin: 6px 0 2px; font-size: 26px; line-height: 1; font-weight: 600; color: var(--qti-fg-strong); }

.gap-table-wrap { overflow-x: auto; }
.gap-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.gap-table th { padding: 6px 8px; border-bottom: 1px solid var(--qti-border); text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--qti-fg-muted); }
.gap-table td { padding: 8px; border-bottom: 1px solid var(--qti-border); vertical-align: top; }
.gap-req { cursor: pointer; }
.gap-req:hover td { background: var(--qti-surface); }
.gap-req.gap-sel td { background: color-mix(in srgb, var(--qti-link) 12%, var(--qti-bg)); }
.gap-id { padding: 0; border: 0; background: none; font-weight: 700; color: var(--qti-fg-strong); text-decoration: underline dotted; }
.gap-src { font-size: 11px; color: var(--qti-fg-muted); }
.gap-probe { font-size: 11.5px; min-width: 180px; }
.gap-fixcell { font-weight: 700; color: var(--qti-fg-strong); white-space: nowrap; }
.gap-tag { display: inline-block; margin: 1px 3px 1px 0; padding: 1px 6px; border-radius: 4px; background: var(--qti-surface); color: var(--qti-fg); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; border: 1px solid var(--qti-border); }
.gap-tag-measure { border-color: color-mix(in srgb, var(--qti-cat-1) 50%, transparent); }
.gap-tag-filter { border-style: dashed; }

.gap-lin-wrap { position: relative; overflow-x: auto; }
.gap-lin { position: relative; display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)); gap: clamp(36px, 7vw, 90px); min-width: 560px; }
.gap-edges { position: absolute; left: 0; top: 0; z-index: 0; pointer-events: none; overflow: visible; }
.gap-lin-col { position: relative; z-index: 1; min-width: 0; }
.gap-layerhead { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.gap-tbl { margin-bottom: 12px; border: 1px solid var(--qti-border); border-radius: 8px; background: var(--qti-bg); overflow: hidden; }
.gap-tn { padding: 6px 10px; border-bottom: 1px solid var(--qti-border); background: var(--qti-surface); font-size: 12px; font-weight: 600; color: var(--qti-fg-strong); }
.gap-col { display: flex; justify-content: space-between; gap: 6px; padding: 3px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.gap-col-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.gap-col-type { color: var(--qti-fg-muted); flex-shrink: 0; }
.gap-col-more { color: var(--qti-fg-muted); font-style: italic; }
.gap-col.gap-hl { background: color-mix(in srgb, var(--qti-link) 14%, var(--qti-bg)); font-weight: 700; }
.gap-col.gap-need { box-shadow: inset 3px 0 0 var(--qti-link); }
.gap-edge { fill: none; stroke: var(--qti-fg-muted); stroke-width: 1.2; opacity: 0.55; pointer-events: stroke; }
.gap-edge-inferred { stroke-dasharray: 4 3; }
.gap-edge-hl { stroke: var(--qti-link); stroke-width: 2.2; opacity: 1; }
.gap-edge-dim { opacity: 0.12; }
.gap-missing { margin-bottom: 12px; padding: 8px 10px; border: 1px dashed var(--qti-neg); border-radius: 8px; font-size: 12px; color: color-mix(in srgb, var(--qti-neg) 60%, var(--qti-fg-strong)); }
.gap-legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px; font-size: 11.5px; color: var(--qti-fg-muted); }
.gap-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.gap-legend-line { stroke: var(--qti-fg-muted); stroke-width: 1.5; }
.gap-legend-dashed { stroke-dasharray: 4 3; }
.gap-legend-col { padding: 0 8px; }

.gap-tally { margin: -4px 0 10px; color: var(--qti-fg-muted); }
.gap-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.gap-flt { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid var(--qti-border); border-radius: 8px; background: var(--qti-surface); font-size: 12px; }
.gap-dash { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 10px; }
.gap-w { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 120px; padding: 10px; border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-surface); }
.gap-w[role="button"] { cursor: pointer; }
.gap-w-partial { border-style: dashed; }
.gap-w-nodata { border: 1.5px dashed var(--qti-neg); }
.gap-w-nodata .gap-viz { opacity: 0.35; }
.gap-w-sel { outline: 2px solid var(--qti-link); }
.gap-wh { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.gap-viz { flex: 1; display: flex; align-items: flex-end; gap: 4px; min-height: 56px; }
.gap-viz i { display: block; background: var(--qti-fg-muted); opacity: 0.45; }
.gap-bar-mark { flex: 1; border-radius: 3px 3px 0 0; }
.gap-viz-kpi { align-items: center; }
.gap-kpi-mark { width: 45%; height: 24px; border-radius: 6px; }
.gap-viz-round { align-items: center; justify-content: center; }
.gap-round-mark { width: 56px; height: 56px; border-radius: 50%; background: none !important; border: 12px solid var(--qti-fg-muted); opacity: 0.45; }
.gap-viz-rows { flex-direction: column; align-items: stretch; justify-content: center; }
.gap-row-mark { height: 8px; border-radius: 4px; }

.gap-fix { margin-bottom: 10px; padding: 12px 14px; border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-surface); }
.gap-fh { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.gap-fix-title { color: var(--qti-fg-strong); }
.gap-spacer { flex: 1; }
.gap-path { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--qti-fg-muted); }
.gap-closes { margin: 6px 0; font-size: 11.5px; color: var(--qti-fg-muted); }
.gap-closes b { color: var(--qti-fg-strong); }
.gap-details summary { cursor: pointer; font-size: 12px; color: var(--qti-link); }
.gap-details pre { margin: 8px 0 0; padding: 10px; overflow: auto; border: 1px solid var(--qti-border); border-radius: 8px; background: var(--qti-bg); color: var(--qti-fg); white-space: pre; }
@media (max-width: 720px) { .gap-dash { grid-template-columns: repeat(2, minmax(0, 1fr)); } .gap-w { grid-column: span 2 !important; } }`;
