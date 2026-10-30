/* UI kit part 2: spin, sleep, shard ribbon, logo, formatters, csv/download/copy. */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI;

  /* loading mask over a container. UI.spin(el, true|false, '文字') */
  UI.spin = function (host, on, text) {
    var mask = host._spin;
    if (on && !mask) {
      host.classList.add('spin-host');
      mask = host._spin = h('div', { class: 'spin-mask' }, h('span', { class: 'spinner' }), h('span', null, text || '加载中...'));
      host.appendChild(mask);
    } else if (!on && mask) { mask.remove(); host._spin = null; }
  };
  /* show the loading mask on `host` while promise `p` is pending, then pass the result (or error) through.
     Overlapping calls on one host keep the mask until the last one settles. */
  UI.busy = function (host, p, text) {
    host._busy = (host._busy || 0) + 1;
    UI.spin(host, true, text);
    var done = function () { if (--host._busy <= 0) { host._busy = 0; UI.spin(host, false); } };
    return Promise.resolve(p).then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  };

  /* Shard ribbon: c = {active, relocating, initializing, unassigned}. o.size:'lg', o.legend:true.
     el.update(c) re-renders. */
  var SEG = [['active', '活跃分片'], ['relocating', '迁移中'], ['initializing', '初始化中'], ['unassigned', '未分配']];
  UI.ribbon = function (c, o) {
    o = o || {};
    var bar = h('div', { class: 'ribbon' + (o.size === 'lg' ? ' ribbon-lg' : '') });
    var legend = o.legend ? h('div', { class: 'ribbon-legend' }) : null;
    var root = legend ? h('div', null, bar, legend) : bar;
    root.update = function (v) {
      var total = SEG.reduce(function (s, x) { return s + (v[x[0]] || 0); }, 0) || 1;
      bar.innerHTML = '';
      if (legend) legend.innerHTML = '';
      SEG.forEach(function (x) {
        var n = v[x[0]] || 0;
        if (n > 0) bar.appendChild(h('i', { class: 'rb-' + x[0], style: { width: (n / total * 100) + '%' }, title: x[1] + ' ' + n }));
        if (legend) legend.appendChild(h('span', null, h('i', { class: 'rb-' + x[0] }), x[1] + ' ' + n));
      });
    };
    root.update(c || {});
    return root;
  };

  /* brand mark: three stacked slabs (amber / blue / teal) taken from the app icon */
  UI.logo = function (size) {
    size = size || 24;
    return h('span', { class: 'ic', html: '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<rect x="6" y="4" width="20" height="7" rx="3.5" fill="#F5A524"/><rect x="3" y="12.5" width="26" height="7" rx="3.5" fill="#3D56B2"/>' +
      '<rect x="6" y="21" width="20" height="7" rx="3.5" fill="#19B5A8"/></svg>' });
  };

  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  UI.fmt = {
    bytes: function (n) {
      if (n == null || n === '') return '';
      if (n === 0) return '0 B';
      var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return (n / Math.pow(1024, i)).toFixed(i ? 2 : 0) + ' ' + u[i];
    },
    num: function (n) { return n == null ? '' : Number(n).toLocaleString('en-US'); },
    millis: function (ms) {
      if (!ms) return '0s';
      var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hr = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
      return [d && d + 'd', hr && hr + 'h', m && m + 'm', (s % 60 || (!d && !hr && !m)) && (s % 60) + 's'].filter(Boolean).join(' ');
    },
    days: function (ms) { return Math.floor(ms / 86400000) + '天'; },
    date: function (t) {
      var d = t instanceof Date ? t : new Date(t);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
  };

  UI.download = function (name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };
  UI.toCsv = function (headers, rows) {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    return '\ufeff' + [headers].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\n');
  };
  UI.exportCsv = function (name, headers, rows) { UI.download(name, UI.toCsv(headers, rows), 'text/csv;charset=utf-8'); };
  UI.copy = function (text) {
    var done = function () { if (UI.ok) UI.ok('已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else {
      var t = h('textarea', { style: { position: 'fixed', opacity: 0 }, value: text });
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      t.remove(); done();
    }
  };
})();
