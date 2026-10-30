/* UI kit part 3: pager and tabs. */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI;

  /* Pager. o: {total, page, size, sizes:[10,20,...], onChange(page,size)}.
     el.update({total,page,size}) re-renders without firing onChange. */
  UI.pager = function (o) {
    var st = { total: o.total || 0, page: o.page || 1, size: o.size || 10 };
    var el = h('div', { class: 'pager' });
    function pages() { return Math.max(1, Math.ceil(st.total / st.size)); }
    function go(p, s) {
      if (s) st.size = s;
      st.page = Math.max(1, Math.min(pages(), p));
      render();
      if (o.onChange) o.onChange(st.page, st.size);
    }
    function list() {
      var n = pages(), c = st.page, out = [];
      if (n <= 7) { for (var i = 1; i <= n; i++) out.push(i); return out; }
      out.push(1);
      if (c > 3) out.push('…');
      for (var j = Math.max(2, c - 1); j <= Math.min(n - 1, c + 1); j++) out.push(j);
      if (c < n - 2) out.push('…');
      out.push(n);
      return out;
    }
    function render() {
      el.innerHTML = '';
      if (o.sizes) el.appendChild(UI.select(o.sizes.map(function (n) { return { value: n, label: n + ' 条/页' }; }), { value: st.size, onChange: function (v) { go(1, +v); } }));
      el.appendChild(h('button', { class: 'pg-btn', disabled: st.page <= 1, title: '上一页', onclick: function () { go(st.page - 1); } }, UI.icon('chevronLeft', 14)));
      list().forEach(function (p) {
        if (p === '…') el.appendChild(h('span', { class: 'muted' }, '…'));
        else el.appendChild(h('button', { class: 'pg-btn' + (p === st.page ? ' active' : ''), onclick: function () { go(p); } }, p));
      });
      el.appendChild(h('button', { class: 'pg-btn', disabled: st.page >= pages(), title: '下一页', onclick: function () { go(st.page + 1); } }, UI.icon('chevronRight', 14)));
    }
    el.update = function (p) { Object.assign(st, p); st.page = Math.max(1, Math.min(pages(), st.page)); render(); };
    el.state = st;
    render();
    return el;
  };

  /* Tabs. o: {items:[{key,label,render(panel,item),onShow(panel)}], active, variant:'line'|'card',
     addable, closable, onAdd(), onClose(key), onChange(key)}. Panels render lazily and stay alive.
     API: select(key) add(item,select) remove(key) setLabel(key,text) panel(key) active() keys() */
  UI.tabs = function (o) {
    var items = [], cur = null;
    var head = h('div', { class: 'tabs-head' }), panels = h('div', { class: 'tab-panels' });
    var root = h('div', { class: 'tabs' + (o.variant === 'card' ? ' tabs-card' : '') }, head, panels);
    var addBtn = o.addable ? UI.btn('', { icon: 'plus', size: 'sm', kind: 'ghost', title: '新建', onClick: function () { if (o.onAdd) o.onAdd(); } }) : null;

    function drawHead() {
      head.innerHTML = '';
      items.forEach(function (it) {
        var close = o.closable && items.length > 1 ? UI.btn('', { icon: 'close', size: 'sm', kind: 'ghost', onClick: function (e) { e.stopPropagation(); if (o.onClose) o.onClose(it.key); else root.remove(it.key); } }) : null;
        it._tab = h('button', { class: 'tab' + (it.key === cur ? ' active' : ''), type: 'button', onclick: function () { root.select(it.key); } },
          h('span', { class: 'tab-label' }, it.label), close);
        head.appendChild(it._tab);
      });
      if (addBtn) head.appendChild(addBtn);
    }
    function find(k) { return items.filter(function (i) { return i.key === k; })[0]; }

    root.add = function (it, select) {
      it._panel = h('div', { class: 'tab-panel', hidden: true });
      panels.appendChild(it._panel);
      items.push(it); drawHead();
      if (select !== false) root.select(it.key);
      return it;
    };
    root.select = function (k) {
      var it = find(k); if (!it) return;
      cur = k;
      items.forEach(function (i) { i._panel.hidden = i !== it; i._tab.classList.toggle('active', i === it); });
      if (!it._ready) { it._ready = true; if (it.render) it.render(it._panel, it); }
      if (it.onShow) it.onShow(it._panel, it);
      if (o.onChange) o.onChange(k);
    };
    root.remove = function (k) {
      var i = items.findIndex(function (x) { return x.key === k; });
      if (i < 0 || items.length < 2) return;
      items[i]._panel.remove(); items.splice(i, 1); drawHead();
      if (cur === k) root.select(items[Math.min(i, items.length - 1)].key); // the next tab slides into the closed slot
    };
    root.setLabel = function (k, t) { var it = find(k); if (it) { it.label = t; it._tab.querySelector('.tab-label').textContent = t; } };
    root.panel = function (k) { var it = find(k); return it && it._panel; };
    root.active = function () { return cur; };
    root.keys = function () { return items.map(function (i) { return i.key; }); };

    (o.items || []).forEach(function (it) { root.add(it, false); });
    if (items.length) root.select(o.active || items[0].key);
    return root;
  };
})();
