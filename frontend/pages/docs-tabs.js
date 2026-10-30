/* docs 页辅助：字段统计标签页、导入数据标签页。
   D.statsTab(panel, ctx) / D.importTab(panel, ctx) 往 panel 里渲染，并返回 {onShow, reset, ...}。
   ctx 由 docs.js 提供：names、pickers、state、resets、browseIndex()、loadIndexes()、dataChanged(index)。
   只定义函数并挂到 ESUI.lib.docs。 */
(function () {
  'use strict';
  var L = (ESUI.lib = ESUI.lib || {});
  var D = (L.docs = L.docs || {});
  var h = ESUI.h, api = ESUI.api;

  /* ---------- 字段统计 ---------- */
  D.statsTab = function (panel, ctx) {
    var seq = 0;
    var picker = D.indexPicker(ctx, { value: ctx.state.statsIndex, onChange: function (v) { ctx.state.statsIndex = v; } });
    var fieldIn = UI.input({ placeholder: '字段名', width: '220px', mono: true, clearable: true, onEnter: query });
    var sizeIn = UI.input({ type: 'number', value: 10, width: '96px', mono: true, onEnter: query });
    sizeIn.input.setAttribute('min', '1');
    sizeIn.input.setAttribute('max', '1000');
    var btn = UI.btn('搜索', { kind: 'primary', icon: 'search', onClick: query });
    var statline = h('div', { class: 'docs-statline' });
    var table = UI.table({
      fill: true, pageSize: 20, pageSizes: [10, 20, 50, 100], resizable: false,
      columns: [
        { key: 'key', title: '值', mono: true },
        { key: 'doc_count', title: '文档数', width: 160, align: 'right', mono: true, render: function (r) { return UI.fmt.num(r.doc_count); } }
      ],
      empty: UI.empty('暂无数据', '选择索引并输入字段名后搜索')
    });

    /* GetFieldTopValues(index, field, size)：聚合结果在 aggregations.top_values.buckets / unique_count.value */
    function query() {
      var index = picker.get(), field = fieldIn.value.trim();
      if (!index) return UI.warn('请先选择索引');
      if (!field) return UI.warn('请输入字段名');
      var n = parseInt(sizeIn.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      if (n > 1000) n = 1000;
      sizeIn.value = n;
      var tok = ++seq;
      btn.setLoading(true);
      statline.textContent = '';
      UI.busy(table, api.guard(api.es.GetFieldTopValues(index, field, n), '字段统计失败：')).then(function (res) {
        if (tok !== seq) return;
        btn.setLoading(false);
        if (res === undefined) return; // 失败时保留上一次的结果，原应用同样
        var aggs = (res && res.aggregations) || {};
        var buckets = (aggs.top_values && aggs.top_values.buckets) || [];
        table.setRows(buckets.map(function (b) {
          return { key: typeof b.key === 'object' ? JSON.stringify(b.key) : String(b.key), doc_count: b.doc_count };
        }));
        if (aggs.unique_count) statline.textContent = '基数（去重数量）：' + UI.fmt.num(aggs.unique_count.value);
      });
    }

    panel.appendChild(h('div', { class: 'docs-tab-wrap' },
      UI.toolbar(picker.el, fieldIn, h('span', { class: 'docs-lbl' }, 'Top N'), sizeIn, btn), statline, table));

    // not named `api`: that would shadow ESUI.api inside query()
    var tab = {
      onShow: function () {
        if (picker.get()) return;
        var v = ctx.browseIndex() || ctx.names[0] || '';
        picker.set(v);
        ctx.state.statsIndex = v;
      },
      reset: function () {
        seq++;
        picker.set(''); fieldIn.value = ''; sizeIn.value = 10;
        statline.textContent = '';
        btn.setLoading(false);
        table.setRows([]);
      }
    };
    ctx.resets.push(tab.reset);
    return tab;
  };
  /* ---------- 导入数据 ---------- */
  D.importTab = function (panel, ctx) {
    var fmt = 'json', timer = null, busy = false;
    var picker = D.indexPicker(ctx, { value: ctx.state.importIndex, onChange: function (v) { ctx.state.importIndex = v; sync(); } });

    var btnJson = h('button', { type: 'button', class: 'docs-seg-btn on', role: 'radio', 'aria-checked': 'true', onclick: function () { setFormat('json'); } }, 'JSON');
    var btnCsv = h('button', { type: 'button', class: 'docs-seg-btn', role: 'radio', 'aria-checked': 'false', onclick: function () { setFormat('csv'); } }, 'CSV');
    var seg = h('div', { class: 'docs-seg', role: 'radiogroup' }, btnJson, btnCsv);

    var file = h('input', { type: 'file', accept: '.json,.csv,.txt', style: { display: 'none' } });
    var hint = h('span', { class: 'muted' });
    var status = h('span', { class: 'docs-status' });
    var ta = UI.textarea({ rows: 14, mono: true, placeholder: D.placeholder('json'), onInput: onInput });
    ta.classList.add('docs-ta');
    var go = UI.btn('开始导入', { kind: 'primary', icon: 'upload', disabled: true, onClick: run });
    var needIndex = h('span', { class: 'muted' }, '请先选择索引');
    var wrap = h('div', { class: 'docs-tab-wrap' });

    function setFormat(f) {
      fmt = f;
      btnJson.classList.toggle('on', f === 'json');
      btnCsv.classList.toggle('on', f === 'csv');
      btnJson.setAttribute('aria-checked', f === 'json' ? 'true' : 'false');
      btnCsv.setAttribute('aria-checked', f === 'csv' ? 'true' : 'false');
      ta.placeholder = D.placeholder(f);
      hint.textContent = f === 'csv' ? 'CSV 第一行为字段名表头，之后每行是一条文档，支持双引号转义' : '输入 JSON 数组，每个元素是一条文档';
      refresh();
    }
    function sync() {
      go.disabled = busy || !picker.get() || !ta.value.trim();
      needIndex.hidden = !!picker.get();
    }
    function refresh() {
      var text = ta.value, r = D.parseImport(fmt, text);
      status.innerHTML = '';
      if (r.docs.length > 0) status.appendChild(UI.tag('已识别 ' + r.docs.length + ' 条待导入数据', 'ok'));
      else if (text.trim() && r.error) {
        var t = UI.tag(r.error, 'err');
        t.title = r.error;
        status.appendChild(t);
      }
      sync();
    }
    function onInput() {
      sync();
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    }

    /* BulkImport(index, 文档数组的 JSON 文本) 返回 {total, success, failed, first_error?}；空数组由后端拒绝 */
    function run() {
      var index = picker.get();
      if (!index) return UI.warn('请先选择索引');
      var r = D.parseImport(fmt, ta.value);
      if (r.error) return r.notArray ? UI.err('文档数据必须是JSON数组') : UI.err('解析失败：' + r.error);
      var gen = ctx.gen;
      busy = true;
      go.setLoading(true);
      sync();
      UI.busy(wrap, api.guard(api.es.BulkImport(index, JSON.stringify(r.docs)), '导入失败：')).then(function (s) {
        busy = false;
        go.setLoading(false);
        sync();
        if (s === undefined || gen !== ctx.gen) return; // failed (already reported) or the cluster changed meanwhile
        s = s || {};
        if (s.failed > 0) UI.warn('导入完成：成功 ' + s.success + ' 条，失败 ' + s.failed + ' 条，首个错误：' + (s.first_error || ''), 6000);
        else UI.ok('成功导入 ' + s.total + ' 条文档');
        if (s.success > 0) ctx.dataChanged(index);
      });
    }

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var name = f.name, reader = new FileReader();
      reader.onload = function () {
        ta.value = String(reader.result || '');
        if (/\.csv$/i.test(name)) setFormat('csv');
        else if (/\.json$/i.test(name)) setFormat('json');
        else refresh();
        UI.ok('已读取文件：' + name);
      };
      reader.onerror = function () { UI.err('文件读取失败'); };
      reader.readAsText(f);
      file.value = '';
    });

    wrap.append(
      UI.toolbar(picker.el, seg,
        UI.btn('选择本地文件', { icon: 'file', onClick: function () { file.click(); } }),
        UI.btn('填入示例模板', { kind: 'ghost', onClick: function () { ta.value = D.sample(fmt); refresh(); } }),
        UI.btn('清空', { kind: 'ghost', onClick: function () { ta.value = ''; refresh(); } }),
        file),
      h('div', { class: 'docs-hintrow' }, hint, status),
      ta,
      h('div', { class: 'row' }, go, needIndex));
    panel.appendChild(wrap);
    setFormat('json');

    var tab = {
      onShow: function () {
        if (picker.get()) return;
        var v = ctx.browseIndex() || ctx.names[0] || '';
        picker.set(v);
        ctx.state.importIndex = v;
        sync();
      },
      setIndex: function (v) { picker.set(v); ctx.state.importIndex = v; sync(); },
      reset: function () {
        clearTimeout(timer);
        busy = false;
        go.setLoading(false);
        picker.set('');
        ta.value = '';
        setFormat('json');
      }
    };
    ctx.resets.push(tab.reset);
    return tab;
  };
})();
