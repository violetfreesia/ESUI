/* UI kit part 6: menu / dropdown, tooltip, json + text viewers. */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI;
  var openMenu = null, menuAnchor = null;

  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; menuAnchor = null; document.removeEventListener('mousedown', outside, true); } }
  // a press on the trigger itself is left to its click handler, so the trigger toggles the menu
  function outside(e) { if (openMenu && !openMenu.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  function place(pop, x, y, w, hgt) {
    var r = pop.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - r.width - 8);
    var top = y + hgt + 4 + r.height > window.innerHeight ? y - r.height - 4 : y + hgt + 4;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  /* UI.menu(anchorEl, items): items [{label, icon, danger, disabled, divider:true, onClick}] */
  UI.menu = function (anchor, items) {
    closeMenu();
    var m = h('div', { class: 'menu', role: 'menu' });
    items.forEach(function (it) {
      if (it.divider) return m.appendChild(h('div', { class: 'menu-sep' }));
      m.appendChild(h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', disabled: !!it.disabled,
        onclick: function () { closeMenu(); if (it.onClick) it.onClick(); } }, it.icon ? UI.icon(it.icon, 14) : null, it.label));
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    place(m, r.left, r.top, r.width, r.height);
    openMenu = m; menuAnchor = anchor;
    setTimeout(function () { document.addEventListener('mousedown', outside, true); }, 0);
    return { close: closeMenu };
  };
  /* bind a trigger to a menu. items may be an array or a function returning one (for dynamic labels). */
  UI.dropdown = function (trigger, items) {
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu && menuAnchor === trigger) { closeMenu(); return; }
      UI.menu(trigger, typeof items === 'function' ? items() : items);
    });
    return trigger;
  };
  /* "操作 ⋮" button with a menu, for table rows */
  UI.actionMenu = function (items, label) {
    return UI.dropdown(UI.btn(label || '操作', { size: 'sm', icon: 'more' }), items);
  };

  /* hover tooltip: UI.tip(el, 'text' | Node | () => Node|string) */
  var tipEl = null, tipAnchor = null;
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; tipAnchor = null; } }
  // drop a stale tip when its anchor was re-rendered away or the pointer left it without a mouseleave
  document.addEventListener('mousemove', function (e) { if (tipEl && (!tipAnchor.isConnected || !tipAnchor.contains(e.target))) hideTip(); });
  document.addEventListener('mousedown', hideTip, true);
  UI.tip = function (el, content) {
    el.addEventListener('mouseenter', function () {
      var c = typeof content === 'function' ? content() : content;
      if (c == null || c === '') return;
      hideTip();
      tipEl = h('div', { class: 'tip', role: 'tooltip' }, c);
      tipAnchor = el;
      document.body.appendChild(tipEl);
      var r = el.getBoundingClientRect();
      place(tipEl, r.left, r.top, r.width, r.height);
    });
    el.addEventListener('mouseleave', hideTip);
    return el;
  };
  /* key/value tooltip body: UI.kvList([['查询总数', '1,200'], ...]) */
  UI.kvList = function (pairs) {
    var dl = h('dl', { class: 'kv' });
    pairs.forEach(function (p) { dl.appendChild(h('dt', null, p[0])); dl.appendChild(h('dd', null, p[1])); });
    return dl;
  };

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function paint(line) {
    return esc(line).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, function (m, str, colon, lit) {
      if (str) return colon ? '<span class="tk-key">' + str + '</span>' + colon : '<span class="tk-str">' + str + '</span>';
      return lit ? '<span class="tk-lit">' + m + '</span>' : '<span class="tk-num">' + m + '</span>';
    });
  }
  /* JSON / text viewer. data: object or string. o: {maxHeight, lineNumbers:true, wrap, raw (no highlighting)} */
  UI.jsonView = function (data, o) {
    o = o || {};
    var text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    var pre = h('pre', { class: 'code' + (o.lineNumbers === false ? '' : ' ln-on') + (o.wrap ? ' wrap' : ''), style: o.maxHeight ? { maxHeight: o.maxHeight } : null });
    pre.innerHTML = text.split('\n').map(function (l) { return '<div class="code-line">' + (o.raw ? esc(l) : paint(l)) + '</div>'; }).join('');
    return pre;
  };
  UI.textView = function (text, o) { o = o || {}; o.raw = true; return UI.jsonView(text, o); };
})();
