/* 分词调试 (key: analyze).
   Backend: ESService.GetIndexes('') for the index dropdown (names are also cached for the REST page's URL suggestions via ESUI.api.cacheIndexes),
   ESService.AnalyzeText(index, text, analyzer, field) for a run. */
(function () {
  'use strict';
  var h = ESUI.h, api = ESUI.api;
  var ANALYZERS = ['standard', 'simple', 'whitespace', 'stop', 'keyword', 'pattern', 'english', 'french', 'german', 'cjk', 'ik_max_word', 'ik_smart', 'pinyin'];
  var SAMPLES = [
    ['英文', 'The Quick Brown Foxes jumped over the lazy dogs, 3 times!'],
    ['中文', '中华人民共和国成立了，我爱北京天安门'],
    ['中英混合', 'Elasticsearch是一个分布式搜索引擎，支持全文检索']
  ];

  /* Filterable dropdown on a text input.
     o: {options:[{value, hint}], placeholder, value, mono, strict, width, onChange(value)}.
     strict: only listed values are accepted (reverts on blur); otherwise any typed text is kept (like a tag select).
     API on the returned element: getValue() setValue(v) setOptions(list) setDisabled(bool) */
  function combo(o) {
    var options = o.options || [], committed = o.value || '', dirty = false, act = -1, shown = [];
    var list = h('div', { class: 'analyze-combo-list', hidden: true, role: 'listbox' });
    var input = UI.input({ placeholder: o.placeholder, value: committed, mono: o.mono, clearable: true, width: '100%', onInput: onType });
    var box = h('div', { class: 'analyze-combo' + (o.mono ? ' is-mono' : ''), style: o.width ? { width: o.width } : null }, input, list);
    var inp = input.input;
    list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus while dragging the list scrollbar
    function commit(v) { if (v !== committed) { committed = v; if (o.onChange) o.onChange(v); } }
    function paint() {
      list.innerHTML = '';
      shown.forEach(function (it, i) {
        list.appendChild(h('div', { class: 'analyze-combo-item' + (i === act ? ' active' : '') + (it.value === committed ? ' selected' : ''), role: 'option',
          onmousedown: function (e) { e.preventDefault(); pick(it); } },
          h('span', { class: o.mono ? 'mono' : '' }, it.value), it.hint ? h('span', { class: 'analyze-combo-hint' }, it.hint) : null));
      });
      var row = list.children[act];
      if (row) {
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    }
    function open() {
      var q = dirty ? inp.value.trim().toLowerCase() : '';
      shown = options.filter(function (it) { return !q || it.value.toLowerCase().indexOf(q) >= 0 || (it.hint || '').toLowerCase().indexOf(q) >= 0; });
      act = o.strict && q && shown.length ? 0 : -1; // strict list: Enter takes the first match after typing
      paint();
      list.hidden = !shown.length;
    }
    function close() { list.hidden = true; act = -1; }
    function pick(it) { input.value = it.value; dirty = false; commit(it.value); close(); }
    function onType(v) {
      dirty = true;
      if (!o.strict) commit(v.trim()); else if (!v) commit('');
      open();
    }
    inp.addEventListener('focus', function () { dirty = false; open(); });
    inp.addEventListener('click', function () { if (list.hidden) { dirty = false; open(); } });
    inp.addEventListener('blur', function () {
      close();
      if (o.strict) {
        var v = inp.value.trim(), hit = options.filter(function (it) { return it.value === v; })[0];
        if (hit) commit(hit.value); else input.value = committed;
      }
    });
    inp.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var d = e.key === 'ArrowDown' ? 1 : -1;
        if (list.hidden) { dirty = false; open(); }
        if (shown.length) { act = act < 0 ? (d > 0 ? 0 : shown.length - 1) : (act + d + shown.length) % shown.length; paint(); }
      } else if (e.key === 'Enter' && !list.hidden && act >= 0) { e.preventDefault(); pick(shown[act]); }
      else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    });

    box.getValue = function () { return committed; };
    box.setValue = function (v) { committed = v || ''; input.value = committed; };
    box.setOptions = function (l) { options = l || []; };
    box.setDisabled = function (b) { inp.disabled = !!b; box.classList.toggle('is-disabled', !!b); if (b) close(); };
    return box;
  }

  ESUI.registerPage('analyze', {
    title: '分词',
    mount: function (root, def) {
      var tokens = [], running = false, gen = 0, loadSeq = 0, indexCount = 0;

      /* form */
      var indexBox = combo({ placeholder: '选择索引（可选，可测字段分词）', strict: true, mono: true, width: '100%' });
      var refreshBtn = UI.btn('', { icon: 'refresh', title: '刷新索引列表', onClick: function () { loadIndexes(true); } });
      var analyzerBox = combo({ placeholder: 'standard / ik_max_word / …', value: 'standard', mono: true, width: '100%',
        options: ANALYZERS.map(function (n) { return { value: n }; }) });
      var fieldBox = combo({ placeholder: '使用索引中某字段的分词器，填写则忽略分析器', mono: true, width: '100%',
        onChange: function (v) { analyzerBox.setDisabled(v !== ''); } });
      var textArea = UI.textarea({ rows: 3, placeholder: '输入要分词的文本，回车执行' });
      var runBtn = UI.btn('分析', { kind: 'primary', icon: 'search', onClick: run });
      var sampleRow = h('div', { class: 'row analyze-samples' }, h('span', { class: 'muted' }, '填入示例'));
      SAMPLES.forEach(function (s) {
        sampleRow.appendChild(UI.btn(s[0], { size: 'sm', kind: 'ghost info', onClick: function () { textArea.value = s[1]; autosize(); textArea.focus(); } }));
      });
      function autosize() {
        textArea.style.height = 'auto';
        var hgt = Math.min(textArea.scrollHeight + 2, 190);
        textArea.style.height = hgt + 'px';
        textArea.style.overflowY = textArea.scrollHeight + 2 > 190 ? 'auto' : 'hidden';
      }
      textArea.addEventListener('input', autosize);
      textArea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); run(); }
      });
      var form = h('div', { class: 'analyze-form' },
        h('div', { class: 'analyze-row' },
          UI.field('索引', h('div', { class: 'row' }, indexBox, refreshBtn)),
          UI.field('分析器', analyzerBox),
          UI.field('字段', fieldBox)),
        UI.field('文本', textArea, { hint: 'Enter 执行分析，Shift + Enter 换行' }),
        h('div', { class: 'row analyze-actions' }, runBtn, sampleRow));

      /* result */
      var countEl = h('span', { class: 'muted' });
      var metaEl = h('span', { class: 'muted mono analyze-meta' });
      var copyBtn = UI.btn('复制分词', { size: 'sm', icon: 'copy', disabled: true, onClick: function () { UI.copy(tokens.map(function (t) { return t.token; }).join(' | ')); } });
      var table = UI.table({
        fill: true, striped: true, pageSize: 20, pageSizes: [10, 20, 50, 100],
        empty: UI.empty('暂无分词结果', '输入文本并点击“分析”', 'inbox'),
        onView: function (n) { countEl.textContent = n ? '共 ' + n + ' 个分词' : ''; },
        columns: [
          { key: 'token', title: '分词结果', width: 240, render: function (r) { var t = UI.tag(r.token, null, { mono: true }); t.title = r.token; return t; } },
          { key: 'type', title: '类型', width: 170, mono: true },
          { key: 'position', title: 'position', width: 110, align: 'right', mono: true },
          { key: 'start_offset', title: 'start_offset', width: 130, align: 'right', mono: true },
          { key: 'end_offset', title: 'end_offset', width: 130, align: 'right', mono: true }
        ]
      });
      var result = h('section', { class: 'analyze-result' },
        h('div', { class: 'analyze-result-head' }, h('span', { class: 'analyze-result-title' }, '分词结果'), countEl, metaEl, UI.spacer(), copyBtn), table);
      root.append(h('div', { class: 'page-body' }, form, result));

      /* behaviour */
      function emptyState() {
        table.setEmpty(ESUI.state.cluster ? UI.empty('暂无分词结果', '输入文本并点击“分析”', 'inbox') : UI.empty('请先连接集群', '在顶栏选择一个集群后，再进行分词', 'inbox'));
      }
      /* rows: _cat/indices entries ({index, status, ...}); returns the index names */
      function setIndexes(rows) {
        var list = rows.filter(function (r) { return r && r.index; });
        var names = list.map(function (r) { return r.index; });
        indexCount = names.length;
        indexBox.setOptions(list.map(function (r) { return { value: r.index, hint: r.status === 'close' ? '已关闭' : '' }; }));
        var cur = indexBox.getValue();
        if (cur && names.indexOf(cur) < 0) indexBox.setValue('');
        return names;
      }
      /* GetIndexes(''): on page mount, on cluster switch, on show when the list is empty, and from the refresh button (manual) */
      function loadIndexes(manual) {
        if (!ESUI.state.cluster) { if (manual) UI.warn('请先在顶栏连接集群'); return Promise.resolve(); }
        var my = ++loadSeq;
        refreshBtn.setLoading(true);
        return api.guard(api.es.GetIndexes(''), '获取索引列表失败：').then(function (rows) {
          if (my !== loadSeq) return; // a newer load or a cluster switch superseded this one
          refreshBtn.setLoading(false);
          if (rows === undefined) return; // the error is already shown
          var names = setIndexes(rows);
          api.cacheIndexes(names);
          if (manual) UI.ok('已刷新索引列表，共 ' + names.length + ' 个');
        });
      }
      function setBusy(on) {
        running = on;
        runBtn.setLoading(on);
        table.setLoading(on, '分析中...');
      }
      function clearResult() {
        tokens = [];
        table.setRows([]);
        copyBtn.disabled = true;
        metaEl.textContent = '';
      }
      function run() {
        if (running) return;
        var text = textArea.value, analyzer = analyzerBox.getValue().trim(), field = fieldBox.getValue().trim(), index = indexBox.getValue();
        if (!text.trim()) return UI.warn('请输入要分析的文本');
        if (!analyzer && !field) return UI.warn('请填写分析器或字段');
        if (field && !index) return UI.warn('指定字段时需先选择索引');
        if (!ESUI.state.cluster) return UI.warn('请先在顶栏连接集群');
        var my = gen;
        clearResult();
        setBusy(true);
        // AnalyzeText(indexName, text, analyzer, field); the backend uses `field` when set and ignores the analyzer
        api.guard(api.es.AnalyzeText(index, text, field ? '' : analyzer, field), '分词失败：').then(function (res) {
          if (my !== gen) return; // cluster switched meanwhile
          setBusy(false);
          if (res === undefined) return; // the error is already shown
          tokens = (res && res.tokens) || [];
          table.setRows(tokens);
          copyBtn.disabled = !tokens.length;
          metaEl.textContent = (field ? '字段 ' + field : '分析器 ' + analyzer) + (index ? '（索引 ' + index + '）' : '');
          if (!tokens.length) UI.info('没有产生任何分词');
        });
      }

      emptyState();
      loadIndexes(false);
      ESUI.on('cluster', function () {
        gen++; loadSeq++;
        setBusy(false); refreshBtn.setLoading(false); clearResult();
        indexBox.setValue(''); setIndexes([]); emptyState();
        loadIndexes(false);
      });
      def.refreshIndexes = function () { if (ESUI.state.cluster && !indexCount && !refreshBtn.classList.contains('is-loading')) loadIndexes(false); };
    },
    onShow: function (root) {
      var def = ESUI.pages.analyze;
      if (def && def.refreshIndexes) def.refreshIndexes();
    }
  });
})();
