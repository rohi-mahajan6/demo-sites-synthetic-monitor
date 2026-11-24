/* Renders window.MONITOR_DATA (written by scripts/build-dashboard.js). No network requests. */
(function () {
  'use strict';

  var data = window.MONITOR_DATA;
  var css = getComputedStyle(document.documentElement);
  var token = function (name) { return css.getPropertyValue(name).trim(); };

  // Status colours are always paired with an icon and a label, never colour alone.
  var STATUS = {
    pass: { label: 'Pass', icon: '✓', color: token('--good') },
    flaky: { label: 'Pass after retry', icon: '~', color: token('--warning') },
    fail: { label: 'Fail', icon: '✕', color: token('--critical') },
    unavailable: { label: 'Unavailable', icon: '?', color: token('--serious') },
    error: { label: 'Monitor error', icon: '!', color: token('--neutral') },
  };
  var statusKey = function (p) { return p.status === 'pass' && p.flaky ? 'flaky' : p.status; };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function badge(key) {
    var s = STATUS[key] || STATUS.error;
    return el('span', { class: 'badge' }, [
      el('span', { class: 'dot', style: 'background:' + s.color, 'aria-hidden': 'true', text: s.icon }),
      el('span', { text: s.label }),
    ]);
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function fmtMs(ms) { return ms == null ? '–' : (ms / 1000).toFixed(1) + ' s'; }
  function runs(n) { return n + ' run' + (n === 1 ? '' : 's'); }
  function fmtPct(u) { return u.percent == null ? '–' : u.percent.toFixed(1) + '%'; }

  function stat(value, key) {
    return el('div', { class: 'stat' }, [el('div', { class: 'v', text: value }), el('div', { class: 'k', text: key })]);
  }

  // Legend for the status colours used in the history strips and tables.
  var legend = document.getElementById('legend');
  Object.keys(STATUS).forEach(function (k) { legend.appendChild(badge(k)); });

  var summary = document.getElementById('summary');
  var content = document.getElementById('content');

  if (!data || !data.runCount) {
    summary.textContent = 'No runs recorded yet.';
    content.appendChild(el('div', { class: 'empty', text: 'The first scheduled run has not stored any results yet. This page fills in after it does.' }));
    return;
  }

  summary.textContent = data.runCount + ' run' + (data.runCount === 1 ? '' : 's') + ' recorded since ' +
    fmtTime(data.firstRun) + '. Last run ' + fmtTime(data.lastRun) + '.';

  var grid = el('div', { class: 'grid' });
  content.appendChild(grid);

  data.sites.forEach(function (site) {
    var card = el('section', { class: 'card', 'aria-label': site.name });
    card.appendChild(el('h3', { text: site.name }));
    card.appendChild(el('p', { class: 'journey', text: 'Journey: ' + site.journey }));

    if (!site.latest) {
      card.appendChild(el('p', { class: 'meta', text: 'No results for this site yet.' }));
      grid.appendChild(card);
      return;
    }

    card.appendChild(badge(statusKey(site.latest)));
    card.appendChild(el('div', { class: 'meta', text: 'Latest: ' + fmtTime(site.latest.timestamp) +
      (site.latest.status === 'pass' ? ' in ' + fmtMs(site.latest.durationMs) : '') }));
    if (site.latest.failingStep) card.appendChild(el('div', { class: 'meta', text: site.latest.failingStep }));

    card.appendChild(el('div', { class: 'stats' }, [
      stat(fmtPct(site.uptime7d), 'Uptime 7 d (' + runs(site.uptime7d.runs) + ')'),
      stat(fmtPct(site.uptime30d), 'Uptime 30 d (' + runs(site.uptime30d.runs) + ')'),
      stat(fmtMs(site.latencyP50) + ' / ' + fmtMs(site.latencyP95), 'Latency p50 / p95'),
    ]));

    // History strip: one block per run, oldest on the left.
    var strip = el('div', { class: 'strip', role: 'img', 'aria-label': 'Last ' + runs(site.history.length) });
    site.history.forEach(function (p) {
      var s = STATUS[statusKey(p)] || STATUS.error;
      strip.appendChild(el('span', { style: 'background:' + s.color, title: fmtTime(p.timestamp) + ' – ' + s.label + (p.status === 'pass' ? ' (' + fmtMs(p.durationMs) + ')' : '') }));
    });
    card.appendChild(strip);
    card.appendChild(el('div', { class: 'strip-caption' }, [
      el('span', { text: 'Last ' + runs(site.history.length) }),
      el('span', { text: 'now' }),
    ]));

    // Latency of passing runs, last 30 days. One series, so the card title names it.
    var canvasWrap = el('div', { class: 'chart-wrap' });
    var canvas = el('canvas', { 'aria-label': site.name + ' journey duration, passing runs, last 30 days', role: 'img' });
    canvasWrap.appendChild(canvas);
    card.appendChild(canvasWrap);
    grid.appendChild(card);

    if (window.Chart) {
      new window.Chart(canvas, {
        type: 'line',
        data: {
          labels: site.series.map(function (p) { return fmtTime(p.t).slice(5, 16); }),
          datasets: [{
            label: 'Duration (s)',
            data: site.series.map(function (p) { return p.ms == null ? null : p.ms / 1000; }),
            borderColor: token('--series-1'),
            backgroundColor: token('--series-1'),
            borderWidth: 2,
            pointRadius: site.series.length > 40 ? 0 : 3,
            pointHoverRadius: 5,
            spanGaps: false,
            tension: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var p = site.series[ctx.dataIndex];
                  return p.ms == null ? STATUS[statusKey(p)].label : 'Duration ' + fmtMs(p.ms) + (p.flaky ? ' (after retry)' : '');
                },
              },
            },
          },
          scales: {
            x: { ticks: { color: token('--text-muted'), maxTicksLimit: 4, maxRotation: 0 }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: token('--text-muted'), maxTicksLimit: 4, callback: function (v) { return v + ' s'; } }, grid: { color: token('--grid') } },
          },
        },
      });
    }
  });

  // Recent problems: non-pass runs and passes that needed the retry.
  content.appendChild(el('h2', { text: 'Recent problems' }));
  if (!data.problems.length) {
    content.appendChild(el('p', { class: 'sub', text: 'None recorded.' }));
  } else {
    var tbody = el('tbody');
    data.problems.forEach(function (p) {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'num' }, [p.runUrl ? el('a', { href: p.runUrl, text: fmtTime(p.timestamp) }) : document.createTextNode(fmtTime(p.timestamp))]),
        el('td', { text: p.site }),
        el('td', {}, [badge(statusKey(p))]),
        el('td', { text: p.detail || '' }),
      ]));
    });
    content.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Time', 'Site', 'Status', 'Detail'].map(function (h) { return el('th', { text: h }); }))]),
      tbody,
    ])]));
  }

  // Table view of the latest runs, so every value is readable without the charts.
  content.appendChild(el('h2', { text: 'Latest runs' }));
  var rows = [];
  data.sites.forEach(function (site) {
    site.history.forEach(function (p) { rows.push({ site: site.name, p: p }); });
  });
  rows.sort(function (a, b) { return b.p.timestamp.localeCompare(a.p.timestamp); });
  var body2 = el('tbody');
  rows.slice(0, 30).forEach(function (r) {
    body2.appendChild(el('tr', {}, [
      el('td', { class: 'num', text: fmtTime(r.p.timestamp) }),
      el('td', { text: r.site }),
      el('td', {}, [badge(statusKey(r.p))]),
      el('td', { class: 'num', text: fmtMs(r.p.durationMs) }),
    ]));
  });
  content.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, ['Time', 'Site', 'Status', 'Duration'].map(function (h) { return el('th', { text: h }); }))]),
    body2,
  ])]));
})();
