/* REST page widgets (helper file, no registerPage):
   ESUI.lib.rest.popup(o)  suggestion list; ESUI.lib.rest.editor(o)  lightweight JSON/DSL editor on a textarea.
   Reads ESUI.lib.rest.keywords (from rest-data.js) when the user types, not at load time. */
(function () {
  'use strict';
  var h = ESUI.h;
  var L = (ESUI.lib = ESUI.lib || {});
  var R = (L.rest = L.rest || {});

  /* Suggestion popup. o: {onPick(item)}; item: {label, meta}. Host element must be position:relative.
     api: el show(list, x, y, activeIndex) hide isOpen move(d) active() */
  R.popup = function (o) {
    var el = h('div', { class: 'rest-pop', hidden: true, role: 'listbox' });
    var items = [], act = -1;
    function paint() {
      el.innerHTML = '';
      items.forEach(function (it, i) {
        el.appendChild(h('div', { class: 'rest-pop-item' + (i === act ? ' active' : ''), role: 'option',
          onmousedown: function (e) { e.preventDefault(); o.onPick(it); } },
          h('span', { class: 'mono grow' }, it.label), it.meta ? h('span', { class: 'rest-pop-meta' }, it.meta) : null));
      });
      var row = el.children[act];
      if (row) {
        if (row.offsetTop < el.scrollTop) el.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight;
      }
    }
    var api = {
      el: el,
      show: function (list, x, y, activeIndex) {
        if (!list.length) return api.hide();
        items = list; act = activeIndex == null ? 0 : activeIndex;
        el.hidden = false;
        if (x != null) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
        paint();
      },
      hide: function () { el.hidden = true; items = []; act = -1; },
      isOpen: function () { return !el.hidden; },
      move: function (d) {
        if (!items.length) return;
        act = act < 0 ? (d > 0 ? 0 : items.length - 1) : (act + d + items.length) % items.length;
        paint();
      },
      active: function () { return items[act] || null; }
    };
    return api;
  };

  /* Editor. o: {placeholder, onInput(value), onSubmit()}. Returns an element with
     getValue() setValue(v) format(quiet) focus(). Tab inserts two spaces, Enter keeps indentation,
     Ctrl/Cmd+Enter calls onSubmit, DSL keyword suggestions open after a quote + one letter. */
  R.editor = function (o) {
    o = o || {};
    var LH = 20, PAD = 8, lastN = 0, charW = 0, skip = false;
    var ta = h('textarea', { class: 'rest-ed-ta mono', spellcheck: 'false', wrap: 'off', autocomplete: 'off', autocapitalize: 'off', placeholder: o.placeholder || '' });
    var gutter = h('div', { class: 'rest-ed-gutter mono', 'aria-hidden': 'true' });
    var pop = R.popup({ onPick: pick });
    var main = h('div', { class: 'rest-ed-main' }, ta, pop.el);
    var wrap = h('div', { class: 'rest-ed' }, gutter, main);

    function syncGutter() {
      var n = ta.value.split('\n').length;
      if (n !== lastN) { lastN = n; var s = ''; for (var i = 1; i <= n; i++) s += i + '\n'; gutter.textContent = s; }
      gutter.scrollTop = ta.scrollTop;
    }
    function measure() {
      if (charW) return charW;
      var s = h('span', { class: 'rest-ed-measure mono' }, 'MMMMMMMMMM');
      main.appendChild(s);
      var w = s.getBoundingClientRect().width / 10;
      s.remove();
      if (w > 0) charW = w;
      return w || 7.2;
    }
    function caret() {
      var pos = ta.selectionStart, before = ta.value.slice(0, pos), lines = before.split('\n');
      return { pos: pos, before: before, line: lines.length - 1, col: lines[lines.length - 1].length };
    }
    function replace(start, end, text) {
      ta.focus(); ta.setSelectionRange(start, end);
      var done = false;
      try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
      if (!done) { ta.setRangeText(text, start, end, 'end'); onChange(); } // execCommand already fires an input event
    }
    function onChange() { syncGutter(); if (o.onInput) o.onInput(ta.value); }
    function suggest() {
      var c = caret(), m = /"([A-Za-z_@.]*)$/.exec(c.before);
      if (ta.selectionStart !== ta.selectionEnd || !m || !m[1]) return pop.hide();
      var prefix = m[1];
      var list = (R.keywords || []).filter(function (k) { return k.word.indexOf(prefix) === 0; });
      if (!list.length || list.every(function (k) { return k.word === prefix; })) return pop.hide();
      var left = Math.max(4, PAD + (c.col - prefix.length) * measure() - ta.scrollLeft), top = PAD + (c.line + 1) * LH - ta.scrollTop + 2;
      pop.show(list.slice(0, 30).map(function (k) { return { label: k.word, meta: k.meta }; }), left, top, 0);
      if (top + pop.el.offsetHeight > main.clientHeight) pop.el.style.top = Math.max(0, top - LH - pop.el.offsetHeight - 4) + 'px';
      if (left + pop.el.offsetWidth > main.clientWidth) pop.el.style.left = Math.max(0, main.clientWidth - pop.el.offsetWidth - 4) + 'px';
    }
    function pick(it) {
      var c = caret(), m = /"([A-Za-z_@.]*)$/.exec(c.before);
      pop.hide();
      if (!m) return;
      skip = true;
      replace(c.pos - m[1].length, c.pos, it.label);
      skip = false;
    }
    function format(quiet) {
      var raw = ta.value.trim();
      if (!raw) { if (!quiet) UI.warn('请求体为空'); return false; }
      try {
        wrap.setValue(JSON.stringify(JSON.parse(raw), null, 2));
        if (o.onInput) o.onInput(ta.value);
        return true;
      } catch (e) {
        if (!quiet) UI.warn('不是合法的 JSON，无法格式化：' + e.message);
        return false;
      }
    }

    ta.addEventListener('input', function (e) {
      syncGutter();
      if (!skip) { if (e.isComposing) pop.hide(); else suggest(); }
      if (o.onInput) o.onInput(ta.value);
    });
    ta.addEventListener('scroll', function () { gutter.scrollTop = ta.scrollTop; pop.hide(); });
    ta.addEventListener('blur', function () { pop.hide(); });
    ta.addEventListener('mousedown', function () { pop.hide(); });
    ta.addEventListener('paste', function () { setTimeout(function () { format(true); }, 0); });
    ta.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (pop.isOpen()) {
        if (e.key === 'ArrowDown') { e.preventDefault(); return pop.move(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); return pop.move(-1); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return pop.hide(); }
        if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) {
          var it = pop.active();
          if (it) { e.preventDefault(); return pick(it); }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (o.onSubmit) o.onSubmit(); return; }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); replace(ta.selectionStart, ta.selectionEnd, '  '); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        var c = caret(), start = ta.selectionStart, end = ta.selectionEnd;
        var ind = /^\s*/.exec(c.before.slice(c.before.lastIndexOf('\n') + 1))[0];
        var extra = /[{\[]/.test(ta.value.charAt(start - 1)) ? '  ' : '';
        e.preventDefault();
        if (extra && /[}\]]/.test(ta.value.charAt(end))) {
          replace(start, end, '\n' + ind + extra + '\n' + ind);
          var target = start + 1 + ind.length + extra.length;
          ta.setSelectionRange(target, target);
        } else replace(start, end, '\n' + ind + extra);
      }
    });

    wrap.getValue = function () { return ta.value; };
    wrap.setValue = function (v) { ta.value = v == null ? '' : String(v); lastN = 0; syncGutter(); pop.hide(); };
    wrap.format = format;
    wrap.focus = function () { ta.focus(); };
    syncGutter();
    return wrap;
  };
})();
