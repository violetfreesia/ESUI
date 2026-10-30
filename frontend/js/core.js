/* ESUI core: DOM helper h(), event bus, local store, theme, page registry + hash router.
   Plain script (no modules) so the prototype works from file://. */
(function () {
  'use strict';
  var ESUI = (window.ESUI = window.ESUI || {});
  ESUI.pages = {};
  ESUI.state = { cluster: null, page: null };

  /* ---- events: 'cluster' | 'theme' | 'route' ---- */
  var listeners = {};
  ESUI.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  ESUI.emit = function (ev, data) {
    (listeners[ev] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[ESUI] listener error for ' + ev, e); }
    });
  };

  /* ---- local store (namespaced localStorage) ---- */
  ESUI.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('esui:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('esui:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  /* ---- h('div', {class, style, dataset, html, text, onclick, value, ...}, ...children) ---- */
  var PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, readOnly: 1, readonly: 1, multiple: 1, indeterminate: 1 };
  function append(el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c.nodeType) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }
  ESUI.h = function (tag, attrs) {
    var el = document.createElement(tag), later = null;
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || (v === false && !PROPS[k])) continue;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROPS[k]) (later = later || {})[k === 'readonly' ? 'readOnly' : k] = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, Array.prototype.slice.call(arguments, 2));
    if (later) for (var p in later) el[p] = later[p]; // after children so <select value> works
    return el;
  };

  /* ---- theme ---- */
  ESUI.theme = {
    get: function () { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; },
    set: function (t) {
      t = t === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      ESUI.store.set('theme', t);
      ESUI.emit('theme', t);
    },
    toggle: function () { ESUI.theme.set(ESUI.theme.get() === 'dark' ? 'light' : 'dark'); }
  };

  /* ---- page registry + router ----
     ESUI.registerPage('nodes', { title: '节点', mount(root, def) {...}, onShow(root) {...} })
     Pages are mounted lazily on first visit and kept alive (hidden) afterwards. */
  ESUI.registerPage = function (key, def) { def.key = key; ESUI.pages[key] = def; };

  function show(key) {
    var view = document.getElementById('view'), def = ESUI.pages[key];
    if (!def.root) {
      def.root = ESUI.h('section', { class: 'page', dataset: { page: key } });
      view.appendChild(def.root);
      try { def.mount(def.root, def); } catch (e) {
        console.error('[ESUI] mount failed: ' + key, e);
        def.root.appendChild(ESUI.h('pre', { class: 'code' }, '页面 ' + key + ' 加载失败：' + e.message));
      }
    }
    Object.keys(ESUI.pages).forEach(function (k) {
      var p = ESUI.pages[k];
      if (p.root) p.root.hidden = p !== def;
    });
    ESUI.state.page = key;
    document.title = (def.title ? def.title + ' - ' : '') + 'ESUI';
    if (def.onShow) { try { def.onShow(def.root); } catch (e) { console.error(e); } }
    ESUI.emit('route', key);
  }
  function route() {
    var key = location.hash.replace(/^#\/?/, '') || 'cluster';
    show(ESUI.pages[key] ? key : 'cluster');
  }
  ESUI.go = function (key) {
    if (location.hash === '#/' + key) route(); else location.hash = '#/' + key;
  };
  ESUI.start = function () { window.addEventListener('hashchange', route); route(); };
})();
