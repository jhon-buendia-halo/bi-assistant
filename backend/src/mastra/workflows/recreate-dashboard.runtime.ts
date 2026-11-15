/**
 * The fixed runtime that draws a recreated dashboard (agents.md 5.17): the
 * script and style sheet every such dashboard ships, word for word. No
 * model writes them. The script reads one JSON document (the blueprint and
 * its data mapping), builds a seeded mock dataset from the blueprint's
 * columns, and draws the filters, the widgets and each widget's mapping
 * indicator; changing a filter recomputes every widget from the same rows.
 *
 * Plain strings, no framework import. The script is browser-native
 * JavaScript with no template literal and no backslash, so it sits in a
 * template literal here unchanged. It exposes `window.dashMock`:
 * `buildRows(blueprint)` and `compute(blueprint, rows, state)` are pure
 * (the unit test runs them without a DOM); `mount(root, document)` draws.
 */

/** The id of the element the runtime mounts on. */
export const DASHBOARD_MOCK_ROOT_ID = 'dash-mock-root';

/** How many rows the mock dataset has. */
export const DASHBOARD_MOCK_ROWS = 360;

export const DASHBOARD_MOCK_RUNTIME = `(function () {
  'use strict';
  var ROWS = ${DASHBOARD_MOCK_ROWS};
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FALLBACK_PALETTE = ['#3b6cf6', '#f6a13b', '#35b58a', '#c0527a', '#7a5af8', '#12a5b8', '#d97706', '#64748b'];
  var SVG = 'http://www.w3.org/2000/svg';

  function hashOf(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32: the same seed always gives the same rows.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isAll(option) {
    return String(option).trim().toLowerCase().indexOf('all') === 0;
  }

  function choices(filter) {
    return (filter.options || []).filter(function (option) {
      return !isAll(option);
    });
  }

  function columnOf(blueprint, name) {
    var columns = blueprint.columns || [];
    for (var i = 0; i < columns.length; i += 1) {
      if (columns[i].name === name) return columns[i];
    }
    return null;
  }

  // The values a string or date column takes, in display order. A filter
  // on the column decides them when the two lists share nothing, so every
  // option of the filter selects some rows.
  function valuesOf(blueprint, column) {
    var own = (column.values || []).map(String);
    var filters = blueprint.filters || [];
    for (var i = 0; i < filters.length; i += 1) {
      if (filters[i].column !== column.name) continue;
      var options = choices(filters[i]);
      if (!options.length) continue;
      var shared = options.filter(function (option) {
        return own.indexOf(option) >= 0;
      });
      if (!shared.length) return options;
    }
    if (own.length) return own;
    if (column.type === 'date') return MONTHS.slice();
    if (column.type === 'boolean') return ['Yes', 'No'];
    return ['A', 'B', 'C', 'D'];
  }

  function pick(values, random) {
    // Earlier values are more likely, as a ranked list usually reads.
    var weights = values.map(function (_value, index) {
      return 1 / Math.sqrt(index + 1);
    });
    var total = weights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    var at = random() * total;
    for (var i = 0; i < values.length; i += 1) {
      at -= weights[i];
      if (at <= 0) return values[i];
    }
    return values[values.length - 1];
  }

  function fold(values, aggregation) {
    if (aggregation === 'count') return values.length;
    if (!values.length) return 0;
    if (aggregation === 'min') return Math.min.apply(null, values);
    if (aggregation === 'max') return Math.max.apply(null, values);
    var sum = values.reduce(function (total, value) {
      return total + value;
    }, 0);
    return aggregation === 'avg' ? sum / values.length : sum;
  }

  function buildRows(blueprint) {
    var columns = blueprint.columns || [];
    var random = rng(hashOf(String(blueprint.title || 'dashboard')));
    var dates = columns.filter(function (column) {
      return column.type === 'date';
    });
    var periods = dates.length ? valuesOf(blueprint, dates[0]) : [];
    var rows = [];
    for (var i = 0; i < ROWS; i += 1) {
      var row = {};
      // Every period gets the same number of rows; later ones run higher.
      var period = periods.length ? i % periods.length : 0;
      var trend = periods.length > 1 ? 0.75 + 0.5 * (period / (periods.length - 1)) : 1;
      for (var c = 0; c < columns.length; c += 1) {
        var column = columns[c];
        if (column.type === 'number') {
          var low = typeof column.min === 'number' ? column.min : 0;
          var high = typeof column.max === 'number' && column.max > low ? column.max : low + 100;
          row[column.name] = (low + (high - low) * random()) * trend;
        } else if (column.type === 'date') {
          var values = valuesOf(blueprint, column);
          row[column.name] = values[(dates[0] === column ? period : i) % values.length];
        } else {
          row[column.name] = pick(valuesOf(blueprint, column), random);
        }
      }
      rows.push(row);
    }
    // A figure the image shows over all the data is met exactly: the first
    // sum or average read for a column scales that column.
    var scaled = {};
    (blueprint.widgets || []).forEach(function (widget) {
      (widget.measures || []).forEach(function (measure) {
        if (typeof measure.total !== 'number' || !measure.total || scaled[measure.column]) return;
        if (measure.aggregation !== 'sum' && measure.aggregation !== 'avg') return;
        var column = columnOf(blueprint, measure.column);
        if (!column || column.type !== 'number') return;
        var now = fold(rows.map(function (row) { return row[measure.column]; }), measure.aggregation);
        if (!now) return;
        var factor = measure.total / now;
        rows.forEach(function (row) {
          row[measure.column] *= factor;
        });
        scaled[measure.column] = true;
      });
    });
    return rows;
  }

  function filteredRows(blueprint, rows, state) {
    var filters = blueprint.filters || [];
    return rows.filter(function (row) {
      for (var i = 0; i < filters.length; i += 1) {
        var filter = filters[i];
        var value = state[filter.id];
        if (value === undefined || value === null || value === '') continue;
        if (filter.kind === 'search') {
          var needle = String(value).toLowerCase();
          var found = false;
          for (var key in row) {
            if (typeof row[key] === 'string' && row[key].toLowerCase().indexOf(needle) >= 0) found = true;
          }
          if (!found) return false;
        } else if (filter.column && String(row[filter.column]) !== String(value)) {
          return false;
        }
      }
      return true;
    });
  }

  function measureValue(rows, measure) {
    if (measure.aggregation === 'count') return rows.length;
    return fold(
      rows
        .map(function (row) { return row[measure.column]; })
        .filter(function (value) { return typeof value === 'number'; }),
      measure.aggregation
    );
  }

  // One widget's figures from the rows its filters leave: the total of each
  // measure and, with a dimension, each measure by the dimension's values.
  function computeWidget(blueprint, rows, state, widget) {
    var applies = {};
    (widget.filteredBy || []).forEach(function (id) {
      applies[id] = state[id];
    });
    // A search box narrows every widget.
    (blueprint.filters || []).forEach(function (filter) {
      if (filter.kind === 'search') applies[filter.id] = state[filter.id];
    });
    var kept = filteredRows(blueprint, rows, applies);
    var measures = widget.measures || [];
    var totals = measures.map(function (measure) {
      return measureValue(kept, measure);
    });
    var groups = [];
    var column = widget.dimension ? columnOf(blueprint, widget.dimension) : null;
    if (column) {
      var order = column.type === 'number' ? [] : valuesOf(blueprint, column);
      var byKey = {};
      kept.forEach(function (row) {
        var key = String(row[column.name]);
        if (!byKey[key]) byKey[key] = [];
        byKey[key].push(row);
        if (order.indexOf(key) < 0) order.push(key);
      });
      order.forEach(function (key) {
        if (!byKey[key]) return;
        groups.push({
          key: key,
          values: measures.map(function (measure) {
            return measureValue(byKey[key], measure);
          }),
        });
      });
    }
    return { id: widget.id, rowCount: kept.length, totals: totals, groups: groups };
  }

  function compute(blueprint, rows, state) {
    return (blueprint.widgets || []).map(function (widget) {
      return computeWidget(blueprint, rows, state || {}, widget);
    });
  }

  function grouped(value, digits) {
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  // Up to the given number of decimals, without trailing zeros.
  function trimmed(value, digits) {
    return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
  }

  // A sum of mock rows that is a whole number but for rounding error.
  function nearWhole(value) {
    return Math.abs(value - Math.round(value)) < 1e-6;
  }

  function plain(value, measure) {
    var size = Math.abs(value);
    // A count or a total of ten or more reads as a whole number.
    var whole = nearWhole(value) || size >= 100 || (measure.aggregation !== 'avg' && size >= 10);
    return grouped(value, whole ? 0 : 2);
  }

  function compact(value, measure) {
    var size = Math.abs(value);
    if (size >= 1e9) return trimmed(value / 1e9, 2) + 'B';
    if (size >= 1e6) return trimmed(value / 1e6, 2) + 'M';
    if (size >= 1e4) return trimmed(value / 1e3, 1) + 'K';
    return plain(value, measure);
  }

  var CURRENCY_SYMBOLS = ['$', '€', '£', '¥'];

  function formatValue(value, measure, exact) {
    if (typeof value !== 'number' || !isFinite(value)) return '-';
    var unit = measure.unit || '';
    if (measure.format === 'percent') {
      return grouped(Math.abs(value) <= 1 ? value * 100 : value, 1) + '%';
    }
    // A currency symbol leads the figure, whatever the format says.
    var money = measure.format === 'currency' || CURRENCY_SYMBOLS.indexOf(unit) >= 0;
    if (money) {
      var symbol = CURRENCY_SYMBOLS.indexOf(unit) >= 0 ? unit : '$';
      if (!exact) return symbol + compact(value, measure);
      return symbol + grouped(value, Math.abs(value) < 1000 && !nearWhole(value) ? 2 : 0);
    }
    var text = exact || measure.format === 'number' ? plain(value, measure) : compact(value, measure);
    return unit ? text + ' ' + unit : text;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svg(tag, attributes) {
    var node = document.createElementNS(SVG, tag);
    for (var name in attributes) node.setAttribute(name, String(attributes[name]));
    return node;
  }

  function paletteOf(blueprint) {
    var theme = blueprint.theme || {};
    var colours = (theme.palette || []).filter(function (colour) {
      return typeof colour === 'string' && colour.charAt(0) === '#';
    });
    if (theme.accent && theme.accent.charAt(0) === '#' && colours.indexOf(theme.accent) < 0) {
      colours.unshift(theme.accent);
    }
    return colours.concat(FALLBACK_PALETTE);
  }

  var STATUS_TEXT = { mapped: 'Mapped', partial: 'Partly mapped', unmapped: 'No data' };

  function mount(root, input) {
    var blueprint = input.blueprint || {};
    var mapping = input.mapping || {};
    var widgetMapping = {};
    (mapping.widgets || []).forEach(function (entry) {
      widgetMapping[entry.widgetId] = entry;
    });
    var filterMapping = {};
    (mapping.filters || []).forEach(function (entry) {
      filterMapping[entry.filterId] = entry;
    });
    var palette = paletteOf(blueprint);
    var rows = buildRows(blueprint);
    var state = {};
    var sort = {};
    var bodies = {};
    var tooltip = el('div', 'dmk-tooltip');
    tooltip.setAttribute('role', 'status');
    tooltip.hidden = true;

    function showTip(target, text) {
      tooltip.textContent = text;
      tooltip.hidden = false;
      var box = target.getBoundingClientRect();
      var frame = root.getBoundingClientRect();
      tooltip.style.left = Math.max(0, box.left - frame.left + box.width / 2) + 'px';
      tooltip.style.top = Math.max(0, box.top - frame.top - 6) + 'px';
    }

    function mark(node, label) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', label);
      node.classList.add('dmk-mark');
      node.addEventListener('mouseenter', function () { showTip(node, label); });
      node.addEventListener('focus', function () { showTip(node, label); });
      node.addEventListener('mouseleave', function () { tooltip.hidden = true; });
      node.addEventListener('blur', function () { tooltip.hidden = true; });
      return node;
    }

    function sourceText(field) {
      if (!field.column) return 'no source';
      return (field.dataset ? field.dataset + ' / ' : '') + field.entity + '.' + field.column;
    }

    function drawKpi(body, widget, data) {
      var measures = widget.measures || [];
      if (!measures.length) return drawNote(body, widget);
      body.appendChild(el('div', 'dmk-kpi-value', formatValue(data.totals[0], measures[0], false)));
      for (var i = 1; i < measures.length; i += 1) {
        body.appendChild(
          el('div', 'dmk-kpi-sub', measures[i].label + ': ' + formatValue(data.totals[i], measures[i], false))
        );
      }
    }

    function drawBars(body, widget, data, horizontal) {
      var measures = widget.measures || [];
      var groups = data.groups;
      if (!measures.length || !groups.length) return drawNote(body, widget);
      var width = 640;
      var height = horizontal ? Math.max(160, groups.length * 30 + 20) : 260;
      var chart = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, class: 'dmk-chart', role: 'group', 'aria-label': widget.title });
      var top = 0;
      groups.forEach(function (group) {
        group.values.forEach(function (value) { top = Math.max(top, value); });
      });
      top = top || 1;
      var left = horizontal ? 120 : 8;
      var bottom = horizontal ? 8 : 28;
      var innerW = width - left - 8;
      var innerH = height - bottom - 18;
      for (var line = 0; line <= 4; line += 1) {
        var at = horizontal ? left + (innerW * line) / 4 : 18 + (innerH * line) / 4;
        chart.appendChild(
          horizontal
            ? svg('line', { x1: at, y1: 18, x2: at, y2: 18 + innerH, class: 'dmk-grid' })
            : svg('line', { x1: left, y1: at, x2: left + innerW, y2: at, class: 'dmk-grid' })
        );
      }
      var slot = (horizontal ? innerH : innerW) / groups.length;
      var bar = Math.max(2, (slot * 0.72) / measures.length);
      groups.forEach(function (group, g) {
        group.values.forEach(function (value, m) {
          var size = ((horizontal ? innerW : innerH) * Math.max(0, value)) / top;
          var offset = slot * g + slot * 0.14 + bar * m;
          var label = group.key + ' - ' + measures[m].label + ': ' + formatValue(value, measures[m], true);
          var rect = horizontal
            ? svg('rect', { x: left, y: 18 + offset, width: size, height: bar, rx: 3, fill: palette[m % palette.length] })
            : svg('rect', { x: left + offset, y: 18 + innerH - size, width: bar, height: size, rx: 3, fill: palette[m % palette.length] });
          chart.appendChild(mark(rect, label));
        });
        var caption = horizontal
          ? svg('text', { x: left - 6, y: 18 + slot * g + slot / 2 + 4, 'text-anchor': 'end', class: 'dmk-axis' })
          : svg('text', { x: left + slot * g + slot / 2, y: height - 8, 'text-anchor': 'middle', class: 'dmk-axis' });
        caption.textContent = group.key.length > 16 ? group.key.slice(0, 15) + '...' : group.key;
        chart.appendChild(caption);
      });
      body.appendChild(chart);
      drawLegend(body, measures.map(function (measure) { return measure.label; }));
    }

    function drawLines(body, widget, data, area) {
      var measures = widget.measures || [];
      var groups = data.groups;
      if (!measures.length || groups.length < 2) return drawBars(body, widget, data, false);
      var width = 640;
      var height = 260;
      var chart = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, class: 'dmk-chart', role: 'group', 'aria-label': widget.title });
      var top = 0;
      groups.forEach(function (group) {
        group.values.forEach(function (value) { top = Math.max(top, value); });
      });
      top = top || 1;
      var innerW = width - 32;
      var innerH = height - 46;
      for (var line = 0; line <= 4; line += 1) {
        var y = 18 + (innerH * line) / 4;
        chart.appendChild(svg('line', { x1: 16, y1: y, x2: 16 + innerW, y2: y, class: 'dmk-grid' }));
      }
      var step = innerW / (groups.length - 1);
      measures.forEach(function (measure, m) {
        var points = groups.map(function (group, g) {
          return [16 + step * g, 18 + innerH - (innerH * Math.max(0, group.values[m])) / top];
        });
        var path = points.map(function (point, index) {
          return (index ? 'L' : 'M') + point[0].toFixed(1) + ' ' + point[1].toFixed(1);
        }).join(' ');
        if (area) {
          chart.appendChild(svg('path', {
            d: path + ' L' + (16 + innerW) + ' ' + (18 + innerH) + ' L16 ' + (18 + innerH) + ' Z',
            fill: palette[m % palette.length],
            'fill-opacity': 0.18,
          }));
        }
        chart.appendChild(svg('path', { d: path, fill: 'none', stroke: palette[m % palette.length], 'stroke-width': 2.5 }));
        points.forEach(function (point, g) {
          var dot = svg('circle', { cx: point[0], cy: point[1], r: 4.5, fill: palette[m % palette.length] });
          chart.appendChild(
            mark(dot, groups[g].key + ' - ' + measure.label + ': ' + formatValue(groups[g].values[m], measure, true))
          );
        });
      });
      var every = Math.ceil(groups.length / 12);
      groups.forEach(function (group, g) {
        if (g % every) return;
        var caption = svg('text', { x: 16 + step * g, y: height - 8, 'text-anchor': 'middle', class: 'dmk-axis' });
        caption.textContent = group.key.length > 10 ? group.key.slice(0, 9) + '...' : group.key;
        chart.appendChild(caption);
      });
      body.appendChild(chart);
      drawLegend(body, measures.map(function (measure) { return measure.label; }));
    }

    function drawPie(body, widget, data, donut) {
      var measure = (widget.measures || [])[0];
      var groups = data.groups.filter(function (group) { return group.values[0] > 0; });
      if (!measure || !groups.length) return drawNote(body, widget);
      var total = groups.reduce(function (sum, group) { return sum + group.values[0]; }, 0);
      var chart = svg('svg', { viewBox: '0 0 220 220', class: 'dmk-chart dmk-pie', role: 'group', 'aria-label': widget.title });
      var angle = -Math.PI / 2;
      var labels = [];
      groups.forEach(function (group, g) {
        var share = group.values[0] / total;
        var end = angle + share * Math.PI * 2;
        var outer = 100;
        var inner = donut ? 56 : 0;
        var large = share > 0.5 ? 1 : 0;
        // A full circle cannot be one arc: stop a hair short.
        var stop = share >= 0.9999 ? end - 0.0001 : end;
        var d =
          'M' + (110 + outer * Math.cos(angle)).toFixed(2) + ' ' + (110 + outer * Math.sin(angle)).toFixed(2) +
          ' A' + outer + ' ' + outer + ' 0 ' + large + ' 1 ' + (110 + outer * Math.cos(stop)).toFixed(2) + ' ' + (110 + outer * Math.sin(stop)).toFixed(2) +
          ' L' + (110 + inner * Math.cos(stop)).toFixed(2) + ' ' + (110 + inner * Math.sin(stop)).toFixed(2) +
          (inner
            ? ' A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + (110 + inner * Math.cos(angle)).toFixed(2) + ' ' + (110 + inner * Math.sin(angle)).toFixed(2)
            : '') +
          ' Z';
        var percent = grouped(share * 100, 0) + '%';
        chart.appendChild(
          mark(
            svg('path', { d: d, fill: palette[g % palette.length] }),
            group.key + ': ' + formatValue(group.values[0], measure, true) + ' (' + percent + ')'
          )
        );
        labels.push(group.key + ' ' + percent);
        angle = end;
      });
      body.appendChild(chart);
      drawLegend(body, labels);
    }

    function drawTable(body, widget, data) {
      var measures = widget.measures || [];
      if (!data.groups.length) return drawNote(body, widget);
      var order = sort[widget.id] || { column: -1, descending: false };
      var groups = data.groups.slice();
      if (order.column === 0) {
        groups.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
      } else if (order.column > 0) {
        groups.sort(function (a, b) { return a.values[order.column - 1] - b.values[order.column - 1]; });
      }
      if (order.descending) groups.reverse();
      var table = el('table', 'dmk-table');
      table.appendChild(el('caption', 'dmk-sr', widget.title));
      var head = el('tr');
      [widget.dimension].concat(measures.map(function (measure) { return measure.label; })).forEach(function (label, index) {
        var cell = el('th');
        cell.setAttribute('scope', 'col');
        var button = el('button', 'dmk-sort', String(label).split('_').join(' '));
        button.type = 'button';
        if (order.column === index) {
          cell.setAttribute('aria-sort', order.descending ? 'descending' : 'ascending');
          button.textContent += order.descending ? ' (high to low)' : ' (low to high)';
        }
        button.addEventListener('click', function () {
          sort[widget.id] = { column: index, descending: order.column === index && !order.descending };
          render();
        });
        cell.appendChild(button);
        head.appendChild(cell);
      });
      var thead = el('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      var tbody = el('tbody');
      groups.slice(0, 25).forEach(function (group) {
        var row = el('tr');
        var first = el('th', null, group.key);
        first.setAttribute('scope', 'row');
        row.appendChild(first);
        group.values.forEach(function (value, m) {
          row.appendChild(el('td', null, formatValue(value, measures[m], true)));
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      var wrap = el('div', 'dmk-table-wrap');
      wrap.appendChild(table);
      body.appendChild(wrap);
    }

    function drawGauge(body, widget, data) {
      var measure = (widget.measures || [])[0];
      if (!measure) return drawNote(body, widget);
      var value = data.totals[0];
      var column = columnOf(blueprint, measure.column);
      var top = measure.format === 'percent' ? (Math.abs(value) <= 1 ? 1 : 100) : (column && typeof column.max === 'number' ? column.max : value * 1.25) || 1;
      var share = Math.max(0, Math.min(1, value / top));
      var chart = svg('svg', { viewBox: '0 0 220 130', class: 'dmk-chart dmk-pie', role: 'img', 'aria-label': widget.title + ': ' + formatValue(value, measure, true) });
      chart.appendChild(svg('path', { d: 'M20 115 A90 90 0 0 1 200 115', fill: 'none', class: 'dmk-track', 'stroke-width': 18 }));
      var end = Math.PI * (1 - share);
      chart.appendChild(svg('path', {
        d: 'M20 115 A90 90 0 0 1 ' + (110 + 90 * Math.cos(end)).toFixed(2) + ' ' + (115 - 90 * Math.sin(end)).toFixed(2),
        fill: 'none',
        stroke: palette[0],
        'stroke-width': 18,
      }));
      body.appendChild(chart);
      body.appendChild(el('div', 'dmk-kpi-value dmk-center', formatValue(value, measure, false)));
    }

    function drawNote(body, widget) {
      body.appendChild(
        el('p', 'dmk-note', widget.description || 'This widget is not drawn in the mock.')
      );
    }

    function drawLegend(body, labels) {
      if (labels.length < 2) return;
      var list = el('ul', 'dmk-legend');
      labels.forEach(function (label, index) {
        var item = el('li');
        var swatch = el('span', 'dmk-swatch');
        swatch.style.background = palette[index % palette.length];
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(label));
        list.appendChild(item);
      });
      body.appendChild(list);
    }

    function drawWidget(widget, data) {
      var body = bodies[widget.id];
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!data.rowCount) {
        body.appendChild(el('p', 'dmk-note', 'No rows match the filters.'));
        return;
      }
      if (widget.kind === 'kpi') drawKpi(body, widget, data);
      else if (widget.kind === 'bar') drawBars(body, widget, data, false);
      else if (widget.kind === 'funnel') drawBars(body, widget, data, true);
      else if (widget.kind === 'line') drawLines(body, widget, data, false);
      else if (widget.kind === 'area') drawLines(body, widget, data, true);
      else if (widget.kind === 'pie') drawPie(body, widget, data, false);
      else if (widget.kind === 'donut') drawPie(body, widget, data, true);
      else if (widget.kind === 'gauge') drawGauge(body, widget, data);
      else if (widget.kind === 'table' || (widget.dimension && (widget.measures || []).length)) drawTable(body, widget, data);
      else if ((widget.measures || []).length) drawKpi(body, widget, data);
      else drawNote(body, widget);
    }

    function render() {
      var computed = compute(blueprint, rows, state);
      (blueprint.widgets || []).forEach(function (widget, index) {
        drawWidget(widget, computed[index]);
      });
    }

    while (root.firstChild) root.removeChild(root.firstChild);
    root.setAttribute('data-mode', (blueprint.theme || {}).mode === 'dark' ? 'dark' : 'light');
    root.style.setProperty('--dmk-accent', palette[0]);

    var header = el('div', 'dmk-header');
    header.appendChild(el('h2', 'dmk-title', blueprint.title || 'Dashboard'));
    var controls = el('div', 'dmk-filters');
    var inputs = [];
    (blueprint.filters || []).forEach(function (filter) {
      var entry = filterMapping[filter.id];
      var wrap = el('label', 'dmk-filter');
      var caption = el('span', 'dmk-filter-head');
      caption.appendChild(el('span', 'dmk-filter-label', filter.label));
      if (entry && entry.status === 'unmapped') {
        var flag = el('span', 'dmk-badge dmk-unmapped', STATUS_TEXT.unmapped);
        flag.title = (entry.field && entry.field.note) || 'No column of the datasets feeds this filter.';
        caption.appendChild(flag);
      }
      wrap.appendChild(caption);
      var control;
      if (filter.kind === 'search') {
        control = el('input', 'dmk-input');
        control.type = 'search';
        control.addEventListener('input', function () {
          state[filter.id] = control.value;
          render();
        });
      } else {
        control = el('select', 'dmk-input');
        var all = el('option', null, (filter.options || []).filter(isAll)[0] || 'All');
        all.value = '';
        control.appendChild(all);
        choices(filter).forEach(function (option) {
          var node = el('option', null, option);
          node.value = option;
          control.appendChild(node);
        });
        control.addEventListener('change', function () {
          state[filter.id] = control.value;
          render();
        });
      }
      inputs.push(control);
      wrap.appendChild(control);
      controls.appendChild(wrap);
    });
    if (inputs.length) {
      var reset = el('button', 'dmk-reset', 'Reset');
      reset.type = 'button';
      reset.addEventListener('click', function () {
        state = {};
        inputs.forEach(function (control) { control.value = ''; });
        render();
      });
      controls.appendChild(reset);
    }
    header.appendChild(controls);
    root.appendChild(header);

    var counts = { mapped: 0, partial: 0, unmapped: 0 };
    (blueprint.widgets || []).forEach(function (widget) {
      var entry = widgetMapping[widget.id];
      counts[entry ? entry.status : 'unmapped'] += 1;
    });
    var summary = el('p', 'dmk-summary');
    summary.setAttribute('data-testid', 'dash-mock-summary');
    summary.textContent =
      'Data mapping: ' + counts.mapped + ' mapped, ' + counts.partial + ' partly mapped, ' + counts.unmapped +
      ' with no data. Every value shown is invented.';
    root.appendChild(summary);

    var grid = el('div', 'dmk-grid-layout');
    (blueprint.widgets || []).forEach(function (widget) {
      var entry = widgetMapping[widget.id] || { status: 'unmapped', fields: [], reason: '' };
      var card = el('section', 'dmk-card dmk-status-' + entry.status);
      card.setAttribute('data-widget', widget.id);
      card.setAttribute('data-mapping', entry.status);
      card.setAttribute('aria-label', widget.title + ' (' + STATUS_TEXT[entry.status] + ')');
      var span = Math.max(2, Math.min(12, Math.round(Number(widget.span) || 4)));
      card.style.gridColumn = 'span ' + span;
      var top = el('div', 'dmk-card-head');
      top.appendChild(el('h3', 'dmk-card-title', widget.title));
      top.appendChild(el('span', 'dmk-badge dmk-' + entry.status, STATUS_TEXT[entry.status]));
      card.appendChild(top);
      var body = el('div', 'dmk-card-body');
      bodies[widget.id] = body;
      card.appendChild(body);
      var details = el('details', 'dmk-source');
      details.appendChild(el('summary', null, 'Data source'));
      if (entry.reason) details.appendChild(el('p', 'dmk-source-reason', entry.reason));
      var list = el('ul', 'dmk-source-list');
      (entry.fields || []).forEach(function (field) {
        var item = el('li', field.column ? null : 'dmk-source-missing');
        item.appendChild(el('code', null, field.field));
        item.appendChild(document.createTextNode(' -> ' + sourceText(field)));
        if (field.note) item.appendChild(el('span', 'dmk-source-note', ' ' + field.note));
        list.appendChild(item);
      });
      if (list.firstChild) details.appendChild(list);
      card.appendChild(details);
      grid.appendChild(card);
    });
    root.appendChild(grid);
    root.appendChild(tooltip);
    render();
  }

  window.dashMock = { buildRows: buildRows, compute: compute, formatValue: formatValue, mount: mount };
})();`;

export const DASHBOARD_MOCK_CSS = `.dmk { position: relative; color: var(--qti-fg); font-size: 13px; line-height: 1.4; }
.dmk * { box-sizing: border-box; }
.dmk-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dmk-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--qti-fg-strong); }
.dmk-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.dmk-filter { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--qti-fg-muted); }
.dmk-filter-head { display: flex; align-items: center; gap: 6px; min-height: 18px; }
.dmk-filter-label { font-weight: 600; }
.dmk-input, .dmk-reset { height: 30px; padding: 0 8px; border: 1px solid var(--qti-border); border-radius: 6px; background: var(--qti-surface); color: var(--qti-fg); font: inherit; }
.dmk-reset { cursor: pointer; }
.dmk-input:focus-visible, .dmk-reset:focus-visible, .dmk-sort:focus-visible, .dmk-mark:focus-visible, .dmk-source summary:focus-visible { outline: 2px solid var(--dmk-accent); outline-offset: 2px; }
.dmk-summary { margin: 0 0 12px; font-size: 12px; color: var(--qti-fg-muted); }
.dmk-grid-layout { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
.dmk-card { min-width: 0; padding: 12px; border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-surface); display: flex; flex-direction: column; gap: 8px; }
.dmk-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dmk-card-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--qti-fg-strong); }
.dmk-card-body { flex: 1; min-width: 0; }
.dmk-badge { flex-shrink: 0; padding: 1px 7px; border: 1px solid currentColor; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.dmk-mapped { color: var(--qti-pos); }
.dmk-partial { color: var(--qti-fg-strong); border-style: dashed; }
.dmk-unmapped { color: var(--qti-neg); }
.dmk-status-unmapped { border-style: dashed; border-color: var(--qti-neg); }
.dmk-status-unmapped .dmk-card-body { opacity: 0.4; filter: grayscale(1); }
.dmk-status-partial { border-style: dashed; }
.dmk-kpi-value { font-size: 26px; font-weight: 700; color: var(--qti-fg-strong); }
.dmk-kpi-sub { font-size: 12px; color: var(--qti-fg-muted); }
.dmk-center { text-align: center; }
.dmk-chart { display: block; width: 100%; height: auto; }
.dmk-pie { max-width: 240px; margin: 0 auto; }
.dmk-grid { stroke: var(--qti-grid); stroke-width: 1; }
.dmk-track { stroke: var(--qti-grid); }
.dmk-axis { fill: var(--qti-axis); font-size: 11px; }
.dmk-mark { cursor: default; }
.dmk-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 0; padding: 0; list-style: none; font-size: 12px; }
.dmk-swatch { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 2px; }
.dmk-table-wrap { overflow-x: auto; }
.dmk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dmk-table th, .dmk-table td { padding: 6px 8px; border-top: 1px solid var(--qti-border); text-align: left; font-weight: 400; }
.dmk-table thead th { border-top: 0; }
.dmk-sort { padding: 0; border: 0; background: none; color: var(--qti-fg-muted); font: inherit; font-weight: 600; cursor: pointer; text-transform: capitalize; }
.dmk-note { margin: 0; color: var(--qti-fg-muted); }
.dmk-source { font-size: 12px; color: var(--qti-fg-muted); }
.dmk-source summary { cursor: pointer; }
.dmk-source-reason { margin: 4px 0; }
.dmk-source-list { margin: 4px 0 0; padding-left: 16px; }
.dmk-source-missing { color: var(--qti-neg); }
.dmk-source-note { color: var(--qti-fg-muted); }
.dmk-tooltip { position: absolute; z-index: 2; transform: translate(-50%, -100%); padding: 4px 8px; border-radius: 6px; background: var(--qti-fg-strong); color: var(--qti-bg); font-size: 12px; pointer-events: none; white-space: nowrap; }
.dmk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 640px) { .dmk-grid-layout { grid-template-columns: 1fr; } .dmk-card { grid-column: 1 / -1 !important; } }
@media (prefers-reduced-motion: no-preference) { .dmk-mark { transition: opacity 0.1s; } .dmk-mark:hover { opacity: 0.85; } }`;
