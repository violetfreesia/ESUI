/* 模板：索引模板 + 组件模板两个标签页。
   后端：GetIndexTemplates、GetComponentTemplates、CreateIndexTemplate、DeleteIndexTemplate（旧版 ES 由后端回退到 /_template）。
   与原应用一致：进入页面就加载两个列表，切换集群后清空并重新加载；组件模板只读。
   行结构：{name, index_patterns, composed_of, priority, version, _template}（组件模板只有 name、version、_template）。 */
(function () {
  'use strict';
  var h = ESUI.h, es = ESUI.api.es;

  function list(a) { return Array.isArray(a) && a.length ? a.join(', ') : '-'; }
  function connected() { return !!ESUI.state.cluster; }
  function mark(el, bad) { el.classList.toggle('tpl-invalid', !!bad); }
  /* 调用后端：成功得到 result，失败时错误已提示并得到 undefined（与原应用一样直接显示后端返回的错误文本） */
  function call(name, args) { return ESUI.api.guard(es[name].apply(es, args), ''); }
  function detailBody(row) {
    // undefined 字段会被 JSON.stringify 省略，与原应用一致
    return { index_patterns: row.index_patterns, composed_of: row.composed_of, priority: row.priority, version: row.version, template: row._template };
  }

  function showDetail(title, body) {
    var text = JSON.stringify(body, null, 2), m;
    m = UI.modal({
      title: title, width: '720px',
      body: UI.jsonView(text, { maxHeight: '62vh', wrap: true }),
      footer: [
        UI.btn('复制', { icon: 'copy', kind: 'ghost', onClick: function () { UI.copy(text); } }),
        UI.btn('关闭', { onClick: function () { m.close(); } })
      ]
    });
  }

  function parseBody(text) {
    if (!text.trim()) return { err: '请输入模板内容' };
    var v;
    try { v = JSON.parse(text); } catch (e) { return { err: '模板内容不是合法的 JSON' }; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { err: '模板内容必须是 JSON 对象' };
    return { value: v };
  }

  /* 创建模板：CreateIndexTemplate(名称, 模板内容原文)。existing() 返回当前已加载的模板名，用于提示"覆盖更新" */
  function openCreate(existing, onDone) {
    var name = UI.input({ placeholder: 'my-template', mono: true });
    var body = UI.textarea({ rows: 14, mono: true, placeholder: JSON.stringify({ index_patterns: ['logs-*'], template: { settings: {}, mappings: {} } }, null, 2) });
    var save = UI.btn('创建', { kind: 'primary', onClick: submit });
    var m = UI.modal({
      title: '创建模板', width: '640px',
      body: [
        UI.field('模板名称', name, { required: true }),
        UI.field('模板内容（JSON）', body, { required: true, hint: '需包含 index_patterns，可选 template、composed_of、priority、version。同名模板会被覆盖。' })
      ],
      footer: [UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } }), save]
    });
    name.input.addEventListener('input', function () { mark(name, false); });
    body.addEventListener('input', function () { mark(body, false); });
    setTimeout(function () { name.input.focus(); }, 60);

    function submit() {
      var n = name.value.trim();
      if (!n) { mark(name, true); name.input.focus(); return UI.warn('请输入模板名称'); }
      var p = parseBody(body.value);
      if (p.err) { mark(body, true); body.focus(); return UI.warn(p.err); }
      save.setLoading(true);
      call('CreateIndexTemplate', [n, body.value]).then(function (r) {
        save.setLoading(false);
        if (r === undefined) return; // 错误已提示，弹窗保持打开以便修改
        UI.ok(existing().indexOf(n) >= 0 ? '模板「' + n + '」已存在，已覆盖更新' : '模板创建成功');
        m.close();
        if (onDone) onDone();
      });
    }
  }

  /* 一个标签页的列表：表格 + 刷新按钮 + 按序号丢弃过期响应的加载 */
  function section(o) {
    var s = { rows: [], seq: 0, failed: false };
    s.table = UI.table({ fill: true, pageSize: 10, pageSizes: [10, 20, 50], columns: o.columns });
    s.refresh = UI.btn('刷新', { icon: 'refresh', kind: 'ghost', onClick: function () {
      if (!connected()) return UI.warn('请先连接集群');
      s.load();
    } });
    s.paintEmpty = function () {
      s.table.setEmpty(!connected() ? UI.empty('请先连接集群', '在「集群」页连接一个集群后再查看模板', 'cluster')
        : s.failed ? UI.empty('加载失败', '请根据提示处理后点击「刷新」重试')
        : UI.empty(o.emptyTitle, o.emptyHint));
    };
    s.clear = function () { // 集群切换：丢弃进行中的请求和旧数据
      s.seq++; s.rows = []; s.failed = false;
      s.refresh.setLoading(false);
      s.paintEmpty();
      s.table.setRows([]);
    };
    s.load = function () {
      if (!connected()) return Promise.resolve(false);
      var my = ++s.seq;
      s.refresh.setLoading(true);
      return UI.busy(s.table, call(o.method, []), '加载中...').then(function (res) {
        if (my !== s.seq) return false;
        s.refresh.setLoading(false);
        if (res === undefined) { s.failed = true; s.paintEmpty(); return false; }
        s.failed = false; s.rows = res;
        s.paintEmpty();
        s.table.setRows(res);
        return true;
      });
    };
    return s;
  }
  ESUI.registerPage('templates', {
    title: '模板',
    mount: function (root) {
      var idx, comp, epoch = 0; // epoch：每次切换集群加一，确认框期间切换了集群就不再删除

      function removeTpl(row) {
        var ep = epoch;
        UI.confirm({ title: '删除模板', kind: 'danger', message: '确定要删除模板「' + row.name + '」吗？', okText: '删除模板' }).then(function (yes) {
          if (!yes || ep !== epoch) return;
          UI.busy(idx.table, call('DeleteIndexTemplate', [row.name]), '加载中...').then(function (r) {
            if (r === undefined) return;
            UI.ok('模板已删除');
            idx.load();
          });
        });
      }

      idx = section({
        method: 'GetIndexTemplates', emptyTitle: '暂无索引模板', emptyHint: '点击「创建模板」新增一个',
        columns: [
          { key: 'name', title: '模板名称', width: 210, mono: true, fixed: 'left' },
          { key: 'index_patterns', title: '匹配模式', width: 250, mono: true, sortValue: function (r) { return list(r.index_patterns); }, render: function (r) { return list(r.index_patterns); } },
          { key: 'composed_of', title: '组合组件', width: 250, mono: true, sortValue: function (r) { return list(r.composed_of); }, render: function (r) { return list(r.composed_of); } },
          { key: 'priority', title: '优先级', width: 90, align: 'right', mono: true, render: function (r) { return r.priority == null ? '-' : String(r.priority); } },
          { key: 'actions', title: '操作', width: 150, sortable: false, render: function (r) {
            return h('div', { class: 'row', style: { gap: '4px' } },
              UI.btn('详情', { size: 'sm', kind: 'ghost', onClick: function () { showDetail(r.name, detailBody(r)); } }),
              UI.btn('删除', { size: 'sm', kind: 'ghost err', onClick: function () { removeTpl(r); } }));
          } }
        ]
      });
      comp = section({
        method: 'GetComponentTemplates', emptyTitle: '暂无组件模板', emptyHint: '',
        columns: [
          { key: 'name', title: '模板名称', width: 220, mono: true, fixed: 'left' },
          { key: 'version', title: 'version', width: 100, align: 'right', mono: true, render: function (r) { return r.version == null ? '-' : String(r.version); } },
          { key: 'actions', title: '操作', width: 100, sortable: false, render: function (r) {
            return UI.btn('详情', { size: 'sm', kind: 'ghost', onClick: function () { showDetail(r.name, r._template || {}); } });
          } }
        ]
      });

      var add = UI.btn('创建模板', { icon: 'plus', kind: 'primary', onClick: function () {
        if (!connected()) return UI.warn('请先连接集群');
        openCreate(function () { return idx.rows.map(function (t) { return t.name; }); }, function () { idx.load(); });
      } });
      var tabs = UI.tabs({
        items: [
          { key: 'index', label: '索引模板', render: function (panel) { panel.append(UI.toolbar(idx.refresh, add), idx.table); } },
          { key: 'component', label: '组件模板', render: function (panel) { panel.append(UI.toolbar(comp.refresh), comp.table); } }
        ],
        active: 'index'
      });
      root.append(h('div', { class: 'page-body' }, tabs));

      // 进入页面和切换集群时：先清空，已连接则两个列表一起加载（与原应用的 onMounted / selectNode 一致）
      function sync() {
        epoch++;
        idx.clear(); comp.clear();
        if (connected()) { idx.load(); comp.load(); }
      }
      sync();
      ESUI.on('cluster', sync);
    }
  });
})();
