/* docs 页辅助：UI 部件。combo（可搜索 / 可清空 / 可手输的下拉）、tagsInput（多值标签输入）、
   indexPicker（索引选择 + 刷新按钮）、openFilterDialog（过滤条件弹窗）。
   只定义函数并挂到 ESUI.lib.docs，在 mount 之后才会被调用。 */
(function () {
  'use strict';
  var L = (ESUI.lib = ESUI.lib || {});
  var D = (L.docs = L.docs || {});
  var h = ESUI.h;

  /* combo(o): {placeholder, width, options:[string], value, allowCustom, clearable, mono, onChange(v), onInput(text)}
     返回元素：.value 读写（写入不触发 onChange）、.setOptions(list)、.input */
  D.combo = function (o) {
    var st = { options: (o.options || []).slice(), value: o.value || '', active: -1, list: [], filterOn: false };
    var inp = h('input', { class: 'input docs-combo-input' + (o.mono ? ' mono' : ''), type: 'text', placeholder: o.placeholder || '', value: st.value, spellcheck: 'false', autocomplete: 'off' });
    var clear = h('button', { class: 'docs-combo-clear', type: 'button', tabindex: '-1', title: '清空' }, UI.icon('close', 12));
    var arrow = h('span', { class: 'docs-combo-arrow' }, UI.icon('chevronDown', 14));
    var el = h('div', { class: 'docs-combo' + (o.clearable === false ? '' : ' clearable'), style: o.width ? { width: o.width } : null }, inp, clear, arrow);
    var pop = null;

    function sync() { el.classList.toggle('has-value', !!inp.value); }
    function setValue(v, fire) {
      var changed = v !== st.value;
      st.value = v; inp.value = v; sync();
      if (fire && changed && o.onChange) o.onChange(v);
    }
    function filtered() {
      var q = inp.value.trim().toLowerCase();
      return st.filterOn && q ? st.options.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; }) : st.options;
    }
    function place() {
      var r = el.getBoundingClientRect(), w = Math.max(r.width, 220);
      pop.style.minWidth = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      var ph = pop.offsetHeight, below = window.innerHeight - r.bottom - 8;
      pop.style.top = (below >= Math.min(ph, 200) ? r.bottom + 2 : Math.max(8, r.top - ph - 2)) + 'px';
    }
    function render() {
      if (!pop) return;
      if (!el.isConnected) { close(); return; }
      var list = st.list = filtered();
      pop.innerHTML = '';
      if (!list.length) {
        var typed = inp.value.trim();
        pop.appendChild(h('div', { class: 'docs-pop-empty' }, o.allowCustom && typed ? '回车使用 ' + typed : '没有匹配的选项'));
      }
      list.forEach(function (name, i) {
        var it = h('div', { class: 'docs-pop-item' + (name === st.value ? ' is-current' : '') + (i === st.active ? ' active' : ''), title: name }, name);
        it.addEventListener('mousedown', function (e) { e.preventDefault(); pick(name); });
        pop.appendChild(it);
      });
      place();
      var act = pop.querySelector('.active');
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }
    function outside(e) { if (pop && !pop.contains(e.target) && !el.contains(e.target)) close(); }
    function onScroll(e) { if (pop && !pop.contains(e.target)) close(); }
    function open() {
      if (pop) return;
      pop = h('div', { class: 'docs-pop', role: 'listbox' });
      pop.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 点滚动条等空白处不让输入框失焦
      document.body.appendChild(pop);
      st.active = st.options.indexOf(st.value);
      document.addEventListener('mousedown', outside, true);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', onScroll, true);
      el.classList.add('is-open');
      render();
    }
    function close() {
      if (!pop) return;
      pop.remove(); pop = null;
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
      el.classList.remove('is-open');
      st.filterOn = false;
    }
    function pick(name) { setValue(name, true); close(); }
    function commitText() {
      var v = inp.value.trim();
      if (o.allowCustom) setValue(v, true);
      else if (v === '') setValue('', true);
      else if (st.options.indexOf(v) >= 0) setValue(v, true);
      else { inp.value = st.value; sync(); }
    }
    function move(d) {
      var n = st.list.length;
      if (!n) return;
      st.active = st.active < 0 ? (d > 0 ? 0 : n - 1) : (st.active + d + n) % n;
      render();
    }

    inp.addEventListener('focus', function () { inp.select(); open(); });
    inp.addEventListener('click', open);
    inp.addEventListener('blur', function () { commitText(); close(); });
    inp.addEventListener('input', function () {
      st.filterOn = true; st.active = -1; sync();
      if (!pop) open(); else render();
      if (o.onInput) o.onInput(inp.value);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!pop) open();
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pop && st.active >= 0 && st.list[st.active] !== undefined) pick(st.list[st.active]);
        else if (pop && !o.allowCustom && st.filterOn && st.list.length) pick(st.list[0]);
        else { commitText(); close(); }
      } else if (e.key === 'Escape' && pop) {
        e.stopPropagation();
        inp.value = st.value; sync(); close();
      }
    });
    clear.addEventListener('mousedown', function (e) { e.preventDefault(); });
    clear.addEventListener('click', function () {
      setValue('', true); close();
      if (o.onInput) o.onInput('');
    });
    arrow.addEventListener('mousedown', function (e) {
      e.preventDefault();
      if (pop) close(); else { inp.focus(); open(); }
    });

    Object.defineProperty(el, 'value', { get: function () { return st.value; }, set: function (v) { setValue(v == null ? '' : String(v), false); } });
    el.setOptions = function (list) { st.options = (list || []).slice(); render(); };
    el.input = inp;
    sync();
    return el;
  };
  /* tagsInput(o): {placeholder, values, onChange(values)}。Enter 或逗号添加，退格删除最后一个。
     .values 读取时包含尚未回车的输入，所以点保存前不必先回车。onChange 在输入和增删时都会触发。 */
  D.tagsInput = function (o) {
    var vals = (o.values || []).slice();
    var inp = h('input', { class: 'docs-tags-input', type: 'text', spellcheck: 'false' });
    var el = h('div', { class: 'docs-tags', onclick: function () { inp.focus(); } });
    function all() {
      var p = inp.value.trim();
      return p && vals.indexOf(p) < 0 ? vals.concat([p]) : vals.slice();
    }
    function fire() { if (o.onChange) o.onChange(all()); }
    function draw() {
      el.innerHTML = '';
      vals.forEach(function (v, i) {
        el.appendChild(UI.chip(v, { onClose: function () { vals.splice(i, 1); draw(); fire(); inp.focus(); } }));
      });
      inp.placeholder = vals.length ? '' : (o.placeholder || '');
      el.appendChild(inp);
    }
    function commit() {
      var t = inp.value.trim();
      if (!t) return false;
      if (vals.indexOf(t) < 0) vals.push(t);
      inp.value = '';
      draw(); fire();
      return true;
    }
    inp.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        if (commit()) inp.focus();
      } else if (e.key === 'Backspace' && !inp.value && vals.length) {
        vals.pop(); draw(); fire(); inp.focus();
      }
    });
    inp.addEventListener('input', fire);
    inp.addEventListener('blur', commit);
    Object.defineProperty(el, 'values', { get: all });
    draw();
    return el;
  };

  /* indexPicker(ctx, o): 索引选择 + 刷新按钮。o: {value, width, onChange(name)}。
     ctx 需提供 names（数组）、pickers（数组）、loadIndexes(manual)。 */
  D.indexPicker = function (ctx, o) {
    o = o || {};
    var combo = D.combo({
      placeholder: '选择索引', width: o.width || '260px', options: ctx.names, value: o.value || '', mono: true,
      onChange: function (v) { if (o.onChange) o.onChange(v); }
    });
    var refresh = UI.btn('', { icon: 'refresh', onClick: function () { ctx.loadIndexes(true); } });
    UI.tip(refresh, '刷新索引列表');
    var p = {
      el: h('div', { class: 'docs-picker' }, combo, refresh),
      combo: combo,
      get: function () { return combo.value; },
      set: function (v) { combo.value = v || ''; },
      setOptions: function (names) { combo.setOptions(names); },
      setLoading: function (on) { refresh.setLoading(on); }
    };
    ctx.pickers.push(p);
    return p;
  };

  /* openFilterDialog(o): {fields:[字段名], filter: 已有条件或 null, onSave(draft)}。保存按钮在条件不完整时禁用。 */
  D.openFilterDialog = function (o) {
    var f = o.filter;
    var draft = f ? { field: f.field, op: f.op, value: f.value == null ? '' : f.value, value2: f.value2 == null ? '' : f.value2, values: (f.values || []).slice() }
      : { field: '', op: 'is', value: '', value2: '', values: [] };
    var m, saveBtn;
    function sync() { if (saveBtn) saveBtn.disabled = !D.isFilterValid(draft); }
    function save() {
      if (!D.isFilterValid(draft)) return;
      o.onSave({ field: draft.field, op: draft.op, value: draft.value, value2: draft.value2, values: draft.values.slice() });
      m.close();
    }

    var fieldBox = D.combo({
      placeholder: '选择或输入字段', options: o.fields, value: draft.field, allowCustom: true, mono: true, width: '100%',
      onInput: function (v) { draft.field = v.trim(); sync(); },
      onChange: function (v) { draft.field = v; sync(); }
    });
    var opSel = UI.select(D.FILTER_OPS.map(function (op) { return { value: op, label: D.OP_LABEL[op] }; }), {
      value: draft.op, onChange: function (v) { draft.op = v; drawValue(); sync(); }
    });
    opSel.style.width = '100%';
    var valueBox = h('div', { class: 'docs-filter-value' });

    function drawValue() {
      valueBox.innerHTML = '';
      if (draft.op === 'is' || draft.op === 'isNot') {
        valueBox.appendChild(UI.field('值', UI.input({ placeholder: '值', value: draft.value, mono: true, width: '100%',
          onInput: function (v) { draft.value = v; sync(); }, onEnter: save })));
      } else if (draft.op === 'isOneOf') {
        valueBox.appendChild(UI.field('值', D.tagsInput({ placeholder: '输入值后回车，可输入多个', values: draft.values,
          onChange: function (vs) { draft.values = vs; sync(); } }), { hint: '回车或逗号分隔多个值' }));
      } else if (draft.op === 'between') {
        valueBox.appendChild(UI.field('范围', h('div', { class: 'docs-between' },
          UI.input({ placeholder: '起始值（含）', value: draft.value, mono: true, onInput: function (v) { draft.value = v; sync(); }, onEnter: save }),
          h('span', { class: 'muted' }, '~'),
          UI.input({ placeholder: '结束值（含）', value: draft.value2, mono: true, onInput: function (v) { draft.value2 = v; sync(); }, onEnter: save })),
        { hint: '起止至少填写一个' }));
      } else {
        valueBox.appendChild(h('div', { class: 'field-hint' }, draft.op === 'exists' ? '匹配该字段有值的文档' : '匹配该字段没有值的文档'));
      }
    }

    saveBtn = UI.btn('保存', { kind: 'primary', disabled: !D.isFilterValid(draft), onClick: save });
    m = UI.modal({
      title: f ? '编辑过滤条件' : '添加过滤条件', width: '460px',
      body: [UI.field('字段', fieldBox), UI.field('运算符', opSel), valueBox],
      footer: [UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } }), saveBtn]
    });
    drawValue();
    return m;
  };
})();
