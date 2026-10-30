/* UI kit part 1: icon, btn, tag, chip, progress, input, select, textarea, switch, field, empty, spin, ribbon, fmt, io. */
(function () {
  'use strict';
  var h = ESUI.h;
  var UI = (window.UI = window.UI || {});
  UI.h = h;

  UI.icon = function (name, size) {
    size = size || 16;
    return h('span', { class: 'ic', html: '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ESUI.icons[name] || '') + '</svg>' });
  };

  /* UI.btn('保存', {kind:'primary'|'danger'|'warn'|'ghost'|'ghost err'|'ghost info', size:'sm', icon, title, disabled, onClick, loading})
     btn.setLoading(bool). Empty label => icon-only button. */
  UI.btn = function (label, o) {
    o = o || {};
    var cls = 'btn' + (label ? '' : ' btn-icon') + (o.size === 'sm' ? ' btn-sm' : '') + (o.class ? ' ' + o.class : '');
    (o.kind || '').split(' ').forEach(function (k) { if (k) cls += ' btn-' + k; });
    var b = h('button', { class: cls, type: 'button', title: o.title, disabled: !!o.disabled, onclick: o.onClick });
    if (o.icon) b.appendChild(UI.icon(o.icon, o.size === 'sm' ? 14 : 16));
    if (label) b.appendChild(h('span', null, label));
    b.setLoading = function (on) { b.classList.toggle('is-loading', !!on); };
    if (o.loading) b.setLoading(true);
    return b;
  };

  /* kind: ok | warn | err | info | primary | neutral(default). o.dot adds a status dot. */
  UI.tag = function (text, kind, o) {
    return h('span', { class: 'tag' + (kind ? ' tag-' + kind : '') + (o && o.dot ? ' tag-dot' : '') + (o && o.mono ? ' mono' : '') }, text);
  };
  UI.chip = function (text, o) {
    o = o || {};
    var c = h('span', { class: 'chip' + (o.kind === 'err' ? ' chip-err' : ''), onclick: o.onClick }, h('span', null, text));
    if (o.onClose) c.appendChild(UI.btn('', { icon: 'close', size: 'sm', kind: 'ghost', onClick: function (e) { e.stopPropagation(); o.onClose(); } }));
    return c;
  };

  /* progress bar; kind auto by threshold (<60 ok, <80 warn, else err) unless o.kind given */
  UI.progress = function (pct, o) {
    o = o || {};
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    var kind = o.kind || (pct < 60 ? 'ok' : pct < 80 ? 'warn' : 'err');
    return h('div', { class: 'progress progress-' + kind, style: o.width ? { width: o.width } : null },
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: { width: pct + '%' } })),
      o.text === false ? null : h('span', { class: 'progress-text' }, o.text || Math.round(pct) + '%'));
  };

  /* text input. Returns wrapper; wrapper.value get/set, wrapper.input is the <input>. */
  UI.input = function (o) {
    o = o || {};
    var inp = h('input', { class: 'input' + (o.mono ? ' mono' : ''), type: o.type || 'text', placeholder: o.placeholder, value: o.value == null ? '' : o.value });
    var clear = o.clearable ? h('button', { class: 'input-clear', type: 'button', tabindex: '-1' }, UI.icon('close', 12)) : null;
    var wrap = h('div', { class: 'input-wrap' + (o.icon ? ' has-icon' : '') + (clear ? ' clearable' : ''), style: o.width ? { width: o.width } : null },
      o.icon ? UI.icon(o.icon, 14) : null, inp, clear);
    function sync() { wrap.classList.toggle('has-value', !!inp.value); }
    inp.addEventListener('input', function () { sync(); if (o.onInput) o.onInput(inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && o.onEnter) o.onEnter(inp.value, e); // ignore IME composition
    });
    if (clear) clear.addEventListener('click', function () { inp.value = ''; sync(); if (o.onInput) o.onInput(''); if (o.onClear) o.onClear(); inp.focus(); });
    Object.defineProperty(wrap, 'value', { get: function () { return inp.value; }, set: function (v) { inp.value = v == null ? '' : v; sync(); } });
    wrap.input = inp; sync();
    return wrap;
  };

  /* returns the <textarea> itself */
  UI.textarea = function (o) {
    o = o || {};
    var t = h('textarea', { class: 'textarea' + (o.mono ? ' mono' : ''), rows: o.rows || 4, placeholder: o.placeholder, value: o.value == null ? '' : o.value, readonly: !!o.readonly, spellcheck: 'false' });
    if (o.onInput) t.addEventListener('input', function () { o.onInput(t.value); });
    return t;
  };

  /* native <select>. options: ['a','b'] or [{value,label}]. returns the <select>; .value works. */
  UI.setOptions = function (sel, options, value, placeholder) {
    sel.innerHTML = '';
    if (placeholder != null) sel.appendChild(h('option', { value: '' }, placeholder));
    (options || []).forEach(function (opt) {
      var obj = typeof opt === 'object' && opt !== null;
      sel.appendChild(h('option', { value: obj ? opt.value : opt }, obj ? (opt.label != null ? opt.label : opt.value) : opt));
    });
    if (value != null) sel.value = value;
  };
  UI.select = function (options, o) {
    o = o || {};
    var sel = h('select', { class: 'select' + (o.class ? ' ' + o.class : ''), style: o.width ? { width: o.width } : null });
    UI.setOptions(sel, options, o.value, o.placeholder);
    if (o.onChange) sel.addEventListener('change', function () { o.onChange(sel.value); });
    return sel;
  };

  /* toggle switch. el.checked get/set. */
  UI.switch = function (o) {
    o = o || {};
    var inp = h('input', { type: 'checkbox', checked: !!o.checked });
    var el = h('label', { class: 'switch' }, inp, h('span', { class: 'switch-track' }), o.label ? h('span', null, o.label) : null);
    inp.addEventListener('change', function () { if (o.onChange) o.onChange(inp.checked); });
    Object.defineProperty(el, 'checked', { get: function () { return inp.checked; }, set: function (v) { inp.checked = !!v; } });
    return el;
  };

  /* label-top form row. o: {required, hint, inline} */
  UI.field = function (label, control, o) {
    o = o || {};
    return h('div', { class: 'field' + (o.inline ? ' field-inline' : '') },
      h('label', { class: 'field-label' }, label, o.required ? h('i', { class: 'req' }, '*') : null),
      control, o.hint ? h('div', { class: 'field-hint' }, o.hint) : null);
  };

  UI.empty = function (title, hint, icon) {
    return h('div', { class: 'empty' }, UI.icon(icon || 'inbox', 36),
      h('div', { class: 'empty-title' }, title || '暂无数据'), hint ? h('div', null, hint) : null);
  };

  UI.pageHead = function (o) {
    var count = h('span', { class: 'count' }, o.count != null ? o.count : '');
    var desc = h('span', { class: 'desc' }, o.desc || '');
    var el = h('div', { class: 'page-head' }, h('h1', null, o.title), count, desc, h('div', { class: 'actions' }, o.actions));
    el.setCount = function (t) { count.textContent = t == null ? '' : t; };
    el.setDesc = function (t) { desc.textContent = t == null ? '' : t; };
    return el;
  };
  UI.toolbar = function () { return h('div', { class: 'toolbar' }, Array.prototype.slice.call(arguments)); };
  UI.spacer = function () { return h('div', { class: 'grow' }); };
})();
