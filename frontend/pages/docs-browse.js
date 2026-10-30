/* docs 页辅助：文档浏览标签页。D.browseTab(panel, ctx) 往 panel 里渲染，并返回 {reset, getIndex, afterWrite}。
   ctx 由 docs.js 提供：names、pickers、loadIndexes(manual)、openImport(index)。只定义函数并挂到 ESUI.lib.docs。 */
(function () {
  'use strict';
  var L = (ESUI.lib = ESUI.lib || {});
  var D = (L.docs = L.docs || {});
  var h = ESUI.h, api = ESUI.api;
  var PAGE_SIZES = [10, 20, 50, 100];
  var QUICK = [['最近 15 分钟', 15 * 60000], ['最近 1 小时', 3600000], ['最近 24 小时', 86400000], ['最近 7 天', 7 * 86400000], ['最近 30 天', 30 * 86400000]];
  var DSL_HINT = '输入原始 DSL，如 {"term":{"status":"active"}}，留空查询全部。Ctrl/⌘ + Enter 搜索';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toLocalInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  D.browseTab = function (panel, ctx) {
    var S = {
      index: '', dsl: false, qs: '', dslText: '', filters: [], timeField: '', range: null, mapping: [],
      selected: [], fieldSearch: '', docs: [], total: 0, from: 0, size: 10, seq: 0, itok: 0
    };
    var fseq = 0;

    /* ---------- 控件 ---------- */
    var picker = D.indexPicker(ctx, { value: '', onChange: function (v) { onIndexChange(v); } });
    var timeSel = UI.select([], { width: '170px', onChange: function (v) { S.timeField = v; newSearch(); } });
    var rangeText = h('span', { class: 'docs-range-text' }, '不限时间');
    var rangeBtn = h('button', { class: 'btn docs-range', type: 'button' }, UI.icon('history', 14), rangeText, UI.icon('chevronDown', 14));
    UI.dropdown(rangeBtn, function () {
      var items = [{ label: '不限时间', onClick: function () { setRange(null); } }];
      QUICK.forEach(function (q) { items.push({ label: q[0], onClick: function () { setRange({ ms: q[1], label: q[0] }); } }); });
      items.push({ divider: true }, { label: '自定义起止时间', icon: 'edit', onClick: openCustomRange });
      return items;
    });
    var timeBox = h('div', { class: 'row' }, timeSel, rangeBtn);

    var searchBtn = UI.btn('搜索', { kind: 'primary', icon: 'search', onClick: newSearch });
    var addBtn = UI.btn('添加文档', { icon: 'plus', onClick: addDoc });
    var importBtn = UI.btn('导入数据', { icon: 'upload', onClick: function () { ctx.openImport(S.index); } });
    var delBtn = UI.btn('按查询删除', { kind: 'err', icon: 'trash', onClick: deleteByQuery });

    var qsInput = UI.input({
      placeholder: '输入查询，如 status:active AND age:>10（Lucene 语法），回车搜索', icon: 'search', clearable: true, mono: true, width: '100%',
      onInput: function (v) { S.qs = v; }, onEnter: newSearch
    });
    var dslArea = UI.textarea({ rows: 3, mono: true, placeholder: DSL_HINT, onInput: function (v) { S.dslText = v; } });
    dslArea.hidden = true;
    dslArea.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); newSearch(); } });
    var addFilterBtn = UI.btn('添加过滤条件', { icon: 'filter', onClick: function () { openFilter(null); } });
    var viewBtn = UI.btn('查看 DSL', { kind: 'ghost', icon: 'code', onClick: viewDsl });
    var dslSwitch = UI.switch({ label: 'DSL', checked: false, onChange: setDsl });
    UI.tip(dslSwitch, '切换到原始 DSL 查询');
    var chipsBox = h('div', { class: 'docs-chips' });
    chipsBox.hidden = true;

    var fieldSearchIn = UI.input({ placeholder: '搜索字段', icon: 'search', clearable: true, width: '100%', onInput: function (v) { S.fieldSearch = v; renderFields(); } });
    var flist = h('div', { class: 'docs-flist' });

    var emptyBox = h('div');
    var table = UI.table({ fill: true, pager: false, footer: false, columns: [], empty: emptyBox });
    var prevBtn = UI.btn('上一页', { size: 'sm', disabled: true, onClick: function () { S.from = Math.max(0, S.from - S.size); search(); } });
    var nextBtn = UI.btn('下一页', { size: 'sm', disabled: true, onClick: function () { S.from += S.size; search(); } });
    var info = h('span', { class: 'docs-pageinfo' });
    var sizeSel = UI.select(PAGE_SIZES.map(function (n) { return { value: n, label: n + ' 条/页' }; }), {
      value: S.size, onChange: function (v) { S.size = +v; resetBrowse(); }
    });
    var result = h('div', { class: 'docs-result' }, table, h('div', { class: 'docs-pager' }, prevBtn, info, nextBtn, sizeSel));

    /* ---------- 时间范围 ---------- */
    function dateFields() {
      return S.mapping.filter(function (f) { return D.DATE_TYPES.indexOf(f.type) >= 0 && !f.multi; });
    }
    /* "最近 N 分钟" is resolved once per search (newSearch resets it) and reused while paging, so offsets stay consistent like the old fixed date range */
    function rangeMs() {
      if (!S.range) return null;
      if (S.range.ms) {
        if (!S.win) { var now = Date.now(); S.win = [now - S.range.ms, now]; }
        return S.win;
      }
      return [S.range.from, S.range.to];
    }
    function setRange(r) {
      S.range = r;
      rangeText.textContent = r ? r.label : '不限时间';
      newSearch();
    }
    function openCustomRange() {
      var cur = S.range && !S.range.ms ? S.range : null;
      var from = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(cur ? cur.from : Date.now() - 86400000) });
      var to = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(cur ? cur.to : Date.now()) });
      var m = UI.modal({
        title: '自定义起止时间', width: '400px',
        body: [UI.field('开始时间', from), UI.field('结束时间', to)],
        footer: [UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } }), UI.btn('应用', { kind: 'primary', onClick: apply })]
      });
      function apply() {
        if (!from.value || !to.value) return UI.warn('请选择起止时间');
        var a = new Date(from.value).getTime(), b = new Date(to.value).getTime();
        if (isNaN(a) || isNaN(b)) return UI.warn('请选择起止时间');
        if (a > b) return UI.warn('开始时间不能晚于结束时间');
        m.close();
        setRange({ from: a, to: b, label: UI.fmt.date(a).slice(0, 16) + ' ~ ' + UI.fmt.date(b).slice(0, 16) });
      }
    }
    /* ---------- 字段侧栏 ---------- */
    function typeOf(name) {
      for (var i = 0; i < S.mapping.length; i++) if (S.mapping[i].name === name) return S.mapping[i].type;
      return '';
    }
    function sidebarFields() {
      var base = S.mapping.length ? S.mapping.filter(function (f) { return !f.multi; })
        : D.topKeys(S.docs).map(function (n) { return { name: n, type: '' }; });
      var kw = S.fieldSearch.trim().toLowerCase();
      return kw ? base.filter(function (f) { return f.name.toLowerCase().indexOf(kw) >= 0; }) : base;
    }
    function toggleField(name) {
      var i = S.selected.indexOf(name);
      if (i >= 0) S.selected.splice(i, 1); else S.selected.push(name);
      renderFields();
      renderTable();
    }
    function renderFields() {
      flist.innerHTML = '';
      var kw = S.fieldSearch.trim().toLowerCase(); // 搜索同时过滤已选字段（原应用的已选项不受搜索影响）
      var picked = kw ? S.selected.filter(function (n) { return n.toLowerCase().indexOf(kw) >= 0; }) : S.selected;
      if (picked.length) {
        flist.appendChild(h('div', { class: 'docs-fgroup' }, '已选字段'));
        picked.forEach(function (n) {
          flist.appendChild(h('div', { class: 'docs-field sel', title: '移除 ' + n, onclick: function () { toggleField(n); } },
            h('span', { class: 'docs-fname' }, n), UI.icon('minus', 14)));
        });
      }
      flist.appendChild(h('div', { class: 'docs-fgroup' }, '可用字段'));
      var avail = sidebarFields().filter(function (f) { return S.selected.indexOf(f.name) < 0; });
      avail.forEach(function (f) {
        flist.appendChild(h('div', { class: 'docs-field', title: f.name + (f.type ? '（' + f.type + '）' : ''), onclick: function () { toggleField(f.name); } },
          h('span', { class: 'docs-fname' }, f.name), f.type ? h('span', { class: 'docs-ftype' }, f.type) : null, UI.icon('plus', 14)));
      });
      if (!avail.length) flist.appendChild(h('div', { class: 'docs-fempty muted' }, '没有字段'));
    }

    /* ---------- 表格 ---------- */
    function colWidth(name) {
      return D.DATE_TYPES.indexOf(typeOf(name)) >= 0 ? 190 : name === 'message' ? 320 : 150;
    }
    function openCellMenu(anchor, field, value) {
      UI.menu(anchor, [
        { label: '筛选此值', icon: 'plus', onClick: function () { quickFilter(field, String(value), false); } },
        { label: '排除此值', icon: 'minus', onClick: function () { quickFilter(field, String(value), true); } }
      ]);
    }
    /* 标量单元格可点击；对象、数组、空值和 DSL 模式只显示文本 */
    function cell(row, name) {
      var v = D.readField(row._source || {}, name), text = D.cellText(v);
      if (text === '') return '';
      var span = h('span', { title: text }, text);
      if (S.dsl || typeof v === 'object') return span;
      span.className = 'docs-cell';
      span.addEventListener('click', function () { openCellMenu(span, name, v); });
      return span;
    }
    function buildColumns() {
      var keys = S.selected.length ? S.selected : D.topKeys(S.docs, 15);
      var cols = [{ key: '_id', title: '_id', width: 190, fixed: 'left', sortable: false, render: function (r) { return UI.tag(r._id, '', { mono: true }); } }]; // _id 只是标识，用中性标签
      keys.forEach(function (k) {
        cols.push({ key: 'src.' + k, title: k, width: colWidth(k), sortable: false, tip: typeOf(k) || undefined, render: function (r) { return cell(r, k); } });
      });
      cols.push({ key: '_ops', title: '操作', width: 96, fixed: 'right', sortable: false, render: function (r) {
        return UI.actionMenu([
          { label: '详情', icon: 'eye', onClick: function () { viewDoc(r); } },
          { label: '编辑', icon: 'edit', onClick: function () { editDoc(r); } },
          { label: '删除', icon: 'trash', danger: true, onClick: function () { deleteDoc(r); } }
        ], '操作');
      } });
      return cols;
    }
    function renderTable() {
      emptyBox.innerHTML = '';
      emptyBox.appendChild(S.index ? UI.empty('没有符合条件的文档', '调整查询或过滤条件后重试') : UI.empty('请选择索引', '选择索引后浏览文档', 'docs'));
      table.setColumns(buildColumns());
      table.setRows(S.docs);
    }
    function syncPager() {
      info.textContent = '第 ' + (S.total === 0 ? 0 : S.from + 1) + '-' + (S.from + S.docs.length) + ' 条，共 ' + S.total + ' 条';
      prevBtn.disabled = S.from <= 0;
      nextBtn.disabled = S.from + S.size >= S.total || S.docs.length === 0;
    }
    function syncControls() {
      var dates = dateFields();
      UI.setOptions(timeSel, dates.map(function (f) { return f.name; }), S.timeField);
      timeBox.hidden = S.dsl || dates.length === 0;
      qsInput.hidden = S.dsl;
      dslArea.hidden = !S.dsl;
      addFilterBtn.hidden = S.dsl;
      chipsBox.hidden = S.dsl || !S.filters.length;
    }
    function render() {
      renderFields();
      renderTable();
      syncPager();
    }

    /* ---------- 过滤条件 ---------- */
    function drawChips() {
      chipsBox.innerHTML = '';
      S.filters.forEach(function (f) {
        chipsBox.appendChild(UI.chip(D.filterLabel(f), {
          kind: D.isNegativeOp(f.op) ? 'err' : '',
          onClick: function () { openFilter(f); },
          onClose: function () { S.filters = S.filters.filter(function (x) { return x !== f; }); drawChips(); newSearch(); }
        }));
      });
      chipsBox.hidden = S.dsl || !S.filters.length;
    }
    function openFilter(f) {
      var names = S.mapping.length ? S.mapping.map(function (m) { return m.name; }) : D.topKeys(S.docs);
      D.openFilterDialog({ fields: names, filter: f, onSave: function (d) {
        if (f) {
          var item = Object.assign({ id: f.id }, d), i = S.filters.indexOf(f);
          if (i >= 0) S.filters[i] = item; else S.filters.push(item);
        } else S.filters.push(Object.assign({ id: ++fseq }, d));
        drawChips();
        newSearch();
      } });
    }
    /* 点击单元格值生成的过滤条件，相同条件不重复添加 */
    function quickFilter(field, value, exclude) {
      var op = exclude ? 'isNot' : 'is';
      var dup = S.filters.some(function (f) { return f.field === field && f.op === op && f.value === value; });
      if (!dup) S.filters.push({ id: ++fseq, field: field, op: op, value: value, value2: '', values: [] });
      drawChips();
      newSearch();
    }
    function setDsl(on) {
      S.dsl = on;
      syncControls();
      drawChips();
      renderTable();
    }

    /* ---------- 查询 ---------- */
    function currentQuery() {
      if (S.dsl) return S.dslText.trim();
      return D.buildQuery({ queryString: S.qs, filters: S.filters, timeField: S.timeField, timeRange: rangeMs() });
    }
    function requestBody() {
      return S.dsl ? currentQuery() : D.withTimeSort(currentQuery(), S.timeField);
    }
    /* SearchDocs(index, queryJson, from, size) 返回 ES 原始响应：hits.hits 是文档，hits.total.value 是总数 */
    function search() {
      if (!S.index) { UI.warn('请先选择索引'); return Promise.resolve(); }
      if (S.dsl && S.dslText.trim() && !D.isValidJson(S.dslText)) { UI.err('查询DSL不是合法的JSON'); return Promise.resolve(); }
      var body = requestBody(), index = S.index, from = S.from, size = S.size, tok = ++S.seq;
      searchBtn.setLoading(true);
      return UI.busy(result, api.es.SearchDocs(index, body, from, size)).then(function (res) {
        if (tok !== S.seq) return;
        var hits = (res && res.hits) || {}, docs = hits.hits || [];
        var total = typeof hits.total === 'number' ? hits.total : (hits.total && hits.total.value) || 0;
        var last = total > 0 ? Math.floor((total - 1) / size) * size : 0;
        if (!docs.length && total > 0 && from > last) { // 页码超出总数（数据被删减）：回到最后一页
          S.from = last;
          return search();
        }
        searchBtn.setLoading(false);
        S.docs = docs;
        S.total = total;
        render();
      }, function (e) {
        if (tok !== S.seq) return;
        searchBtn.setLoading(false);
        api.report(e, '查询文档失败：'); // 保留上一次的结果
      });
    }
    function newSearch() { S.from = 0; S.win = null; search(); }
    function resetBrowse() {
      S.from = 0; S.docs = []; S.total = 0;
      render();
      if (S.index) search();
    }
    function defaultTimeField() {
      var dates = dateFields();
      return (dates.filter(function (f) { return f.name === '@timestamp'; })[0] || dates[0] || {}).name || '';
    }
    /* 切换索引：清空查询、过滤、已选字段，GetIndexMappings 取字段，自动选时间字段并按它降序。
       取不到 mapping 时不报错（原应用同样），字段栏退化为当前页文档的字段，查询照常进行 */
    function onIndexChange(index) {
      S.seq++;
      var itok = ++S.itok;
      searchBtn.setLoading(false);
      S.index = index || '';
      S.qs = ''; qsInput.value = '';
      S.dslText = ''; dslArea.value = '';
      S.filters = []; S.range = null; S.win = null; rangeText.textContent = '不限时间';
      S.selected = []; S.fieldSearch = ''; fieldSearchIn.value = '';
      S.mapping = []; S.timeField = '';
      S.docs = []; S.total = 0; S.from = 0;
      drawChips();
      syncControls();
      render();
      if (!S.index) return;
      UI.busy(result, api.es.GetIndexMappings(S.index)).then(D.flattenMappings, function () { return []; }).then(function (fields) {
        if (itok !== S.itok) return;
        S.mapping = fields;
        S.timeField = defaultTimeField();
        syncControls();
        render();
        search();
      });
    }
    /* ---------- 文档操作 ---------- */
    function afterWrite() {
      search();
    }
    function viewDoc(r) {
      var index = S.index;
      UI.busy(result, api.guard(api.es.GetDoc(index, r._id), '获取文档失败：')).then(function (res) {
        if (res === undefined) return;
        var m = UI.modal({
          title: index + ' / ' + r._id, width: '680px',
          body: UI.jsonView(res, { maxHeight: '60vh', wrap: true }),
          footer: UI.btn('关闭', { onClick: function () { m.close(); } })
        });
      });
    }
    /* 保存时把文本框原文交给后端（UpdateDoc 自己校验 JSON），成功后重新查询当前页 */
    function editDoc(r) {
      var index = S.index;
      var ta = UI.textarea({ rows: 16, mono: true, value: JSON.stringify(r._source || {}, null, 2) });
      var saveBtn = UI.btn('保存', { kind: 'primary', onClick: save });
      var m = UI.modal({
        title: index + ' / ' + r._id, width: '680px', body: ta,
        footer: [UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } }), saveBtn]
      });
      function save() {
        if (!D.isValidJson(ta.value)) { UI.err('文档内容不是合法的JSON'); return; }
        saveBtn.setLoading(true);
        UI.busy(m.body, api.guard(api.es.UpdateDoc(index, r._id, ta.value), '保存文档失败：')).then(function (res) {
          saveBtn.setLoading(false);
          if (res === undefined) return;
          UI.ok('文档保存成功');
          m.close();
          afterWrite();
        });
      }
    }
    function addDoc() {
      if (!S.index) { UI.warn('请先选择索引'); return; }
      var index = S.index;
      var ta = UI.textarea({ rows: 14, mono: true, placeholder: JSON.stringify({ field1: 'value1' }, null, 2) });
      var saveBtn = UI.btn('保存', { kind: 'primary', onClick: save });
      var m = UI.modal({
        title: '添加文档', width: '640px', body: ta,
        footer: [UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } }), saveBtn]
      });
      function save() {
        if (!D.isValidJson(ta.value)) { UI.err('文档内容不是合法的JSON'); return; }
        saveBtn.setLoading(true);
        UI.busy(m.body, api.guard(api.es.AddDocument(index, ta.value), '添加文档失败：')).then(function (res) {
          saveBtn.setLoading(false);
          if (res === undefined) return;
          UI.ok('文档添加成功，id：' + (res && res._id));
          m.close();
          afterWrite();
        });
      }
    }
    function deleteDoc(r) {
      var index = S.index;
      UI.confirm({ title: '警告', message: '确定要删除文档 ' + r._id + ' 吗？', kind: 'danger', okText: '删除', cancelText: '取消' }).then(function (ok) {
        if (!ok) return;
        UI.busy(result, api.guard(api.es.DeleteDoc(index, r._id), '删除文档失败：')).then(function (res) {
          if (res === undefined) return;
          UI.ok('文档 ' + r._id + ' 已删除');
          if (S.docs.length <= 1 && S.from > 0) S.from = Math.max(0, S.from - S.size);
          search();
        });
      });
    }
    /* DeleteByQuery 在后端异步执行（wait_for_completion=false），空查询由前端和后端双重拒绝。
       传的是查询子句本身（不带时间排序包装）；DSL 模式下传文本框原文 */
    function deleteByQuery() {
      if (!S.index) { UI.warn('请先选择索引'); return; }
      if (S.dsl && S.dslText.trim() && !D.isValidJson(S.dslText)) { UI.err('查询DSL不是合法的JSON'); return; }
      var q = currentQuery(), index = S.index;
      if (!q.trim()) { UI.warn('按查询删除必须先输入查询条件，防止误删全量数据'); return; }
      UI.confirm({
        title: '警告', kind: 'danger', okText: '确定', cancelText: '取消',
        message: '确定要按查询条件删除索引 ' + index + ' 中的文档吗？删除将在后台异步执行，不可恢复！'
      }).then(function (ok) {
        if (!ok) return;
        UI.busy(result, api.guard(api.es.DeleteByQuery(index, q), '按查询删除失败：')).then(function (res) {
          if (res === undefined) return;
          UI.ok('删除任务已提交（异步执行）');
        });
      });
    }

    /* ---------- 查看 DSL：展示 SearchDocs 实际发给 ES 的请求体 ---------- */
    function viewDsl() {
      var body;
      try { body = D.parseBody(requestBody()); } catch (e) { UI.err('查询DSL不是合法的JSON'); return; }
      var out = { from: S.from, size: S.size, track_total_hits: true, query: body.query };
      if (body.sort) out.sort = body.sort;
      var text = JSON.stringify(out, null, 2);
      var m = UI.modal({
        title: '当前查询 DSL', width: '640px',
        body: UI.jsonView(text, { maxHeight: '60vh', wrap: true }),
        footer: [UI.btn('复制', { kind: 'ghost', icon: 'copy', onClick: function () { UI.copy(text); } }), UI.btn('关闭', { onClick: function () { m.close(); } })]
      });
    }

    /* ---------- 组装 ---------- */
    panel.appendChild(h('div', { class: 'docs-tab-wrap' },
      UI.toolbar(picker.el, timeBox, UI.spacer(), searchBtn, addBtn, importBtn, delBtn),
      h('div', { class: 'docs-queryrow' }, h('div', { class: 'docs-qs' }, qsInput, dslArea), addFilterBtn, viewBtn, dslSwitch),
      chipsBox,
      h('div', { class: 'docs-main' }, h('div', { class: 'docs-fields' }, fieldSearchIn, flist), result)));
    syncControls();
    render();

    return {
      getIndex: function () { return S.index; },
      afterWrite: function (index) { if (index && index === S.index) afterWrite(); },
      reset: function () {
        picker.set('');
        S.dsl = false;
        dslSwitch.checked = false;
        S.size = 10;
        sizeSel.value = '10';
        onIndexChange('');
      }
    };
  };
})();
