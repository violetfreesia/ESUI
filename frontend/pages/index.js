/* 索引 (GET /_cat/indices?format=json&bytes=b)。行字段是 _cat 的真实列：index、health、status、pri、rep、docs.count、
   docs.deleted、store.size（字节），值都是字符串，关闭的索引没有统计列。
   与原应用一致：进入页面不请求，点「搜索」才加载；切换集群清空数据；未连接显示空状态。
   弹层在 index-dialogs.js（ESUI.lib.index），本页把后端调用封装成 api 回调传给它。 */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, es = ESUI.api.es;
  var SIZES = [5, 10, 15, 20, 25, 30, 40], SIZE_KEY = 'index:pageSize', MASK = '连接中...';
  var HEALTH = { green: 'ok', yellow: 'warn' };

  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function connected() { return !!ESUI.state.cluster; }
  function dash() { return h('span', { class: 'muted' }, '-'); }
  /* 调用后端：成功得到 result，失败时错误已提示并得到 undefined（与原应用一样直接显示后端返回的错误文本） */
  function call(name, args) { return ESUI.api.guard(es[name].apply(es, args), ''); }
  function ok(p) { return p.then(function (r) { return r !== undefined; }); }

  ESUI.registerPage('index', {
    title: '索引',
    mount: function (root) {
      var L = ESUI.lib && ESUI.lib.index;
      if (!L || !L.dialogs) {
        root.append(h('div', { class: 'page-body' }, UI.empty('缺少辅助文件', '请在 index.html 中引入 pages/index-dialogs.js')));
        return;
      }
      var dlg = null, rows = [], aliasCache = {}; // aliasCache: 索引名 -> "a,b"，只在点「读取别名」或管理别名后才有值
      var seq = 0, loaded = false, failed = false;
      var epoch = 0; // 每次切换集群加一；进行中的操作记下自己开始时的值，回来时不一致就说明属于旧集群，丢弃结果、不再继续发请求
      var pageSize = ESUI.store.get(SIZE_KEY, 10);
      if (SIZES.indexOf(pageSize) < 0) pageSize = 10;
      var bulkText = h('span', { class: 'muted' }, '你选中了 0 行');
      var searchInput = UI.input({ placeholder: '模糊搜索索引', icon: 'search', clearable: true, width: '280px',
        onEnter: function () { search(); }, onClear: function () { if (loaded) search(); } }); // 已加载过时，点清除按钮立即恢复完整列表
      var searchBtn = UI.btn('搜索', { icon: 'search', onClick: function () { search(); } });

      var table = UI.table({
        selectable: true, fill: true, pageSize: pageSize, pageSizes: SIZES,
        onSelect: function (sel) { bulkText.textContent = '你选中了 ' + sel.length + ' 行'; },
        columns: [
          { key: 'index', title: '索引名', width: 200, fixed: 'left', render: function (r) {
            return h('span', { class: 'cell-link mono', title: r.index, onclick: function () { viewDocs(r); } }, r.index);
          } },
          { key: 'alias', title: '别名', width: 118, sortValue: function (r) { return aliasCache[r.index] || null; }, render: function (r) {
            var a = aliasCache[r.index];
            return a ? h('span', { class: 'mono idx-alias', title: a }, a) : dash();
          } },
          { key: 'health', title: '健康', width: 96, render: function (r) { return r.health ? UI.tag(r.health, HEALTH[r.health] || 'err', { dot: true }) : dash(); } },
          { key: 'status', title: '状态', width: 84, render: function (r) { return r.status ? UI.tag(r.status, r.status === 'open' ? 'ok' : 'err', { dot: true }) : dash(); } },
          { key: 'pri', title: '主分片', width: 80, align: 'right', mono: true, sortValue: function (r) { return num(r.pri); } },
          { key: 'rep', title: '副本', width: 70, align: 'right', mono: true, sortValue: function (r) { return num(r.rep); } },
          { key: 'docs.count', title: '文档总数', width: 110, align: 'right', mono: true,
            sortValue: function (r) { return num(r['docs.count']); }, render: function (r) { return F.num(num(r['docs.count'])); } },
          { key: 'docs.deleted', title: '软删除文档', width: 110, align: 'right', mono: true,
            sortValue: function (r) { return num(r['docs.deleted']); }, render: function (r) { return F.num(num(r['docs.deleted'])); } },
          { key: 'store.size', title: '占用存储', width: 100, align: 'right', mono: true, // bytes=b：store.size 是字节数
            sortValue: function (r) { return num(r['store.size']); }, render: function (r) { return F.bytes(num(r['store.size'])); } },
          { key: 'actions', title: '操作', width: 96, fixed: 'right', sortable: false, render: function (r) {
            return UI.actionMenu(function () { return menuItems(r); }, '操作');
          } }
        ]
      });
      // 每页条数记忆：UI.table 没有回调，这里监听分页器里 select 的 change。
      // 必须用捕获阶段：分页器在 select 自己的处理函数里会整体重绘，冒泡到这里时 select 已脱离 DOM，closest 会失败。
      table.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.tagName === 'SELECT' && t.closest('.pager') && SIZES.indexOf(+t.value) >= 0) ESUI.store.set(SIZE_KEY, +t.value);
      }, true);

      var bulkBtn = UI.dropdown(UI.btn('批量操作', { icon: 'more' }), [{ label: '删除', icon: 'trash', danger: true, onClick: function () { bulkDelete(); } }]);
      var bar = UI.toolbar(searchInput, searchBtn, UI.spacer(),
        UI.btn('读取别名', { icon: 'link', onClick: function () { readAlias(); } }),
        UI.btn('导出 CSV', { icon: 'download', onClick: function () { exportCsv(); } }),
        UI.btn('索引备份（预览）', { icon: 'save', onClick: function () { dlg.openBackup(); } }),
        UI.btn('添加索引', { icon: 'plus', kind: 'primary', onClick: function () { openCreate(); } }));

      function busy(p) { return UI.busy(table, p, MASK); }

      /* ---------- 状态 / 列表加载 ---------- */
      function setEmpty() {
        table.setEmpty(!connected() ? UI.empty('请先连接集群', '在「集群」页连接一个集群后再查看索引', 'cluster')
          : failed ? UI.empty('加载失败', '请根据提示处理后再次点击「搜索」')
          : !loaded ? UI.empty('尚未加载索引', '点击「搜索」加载索引列表，可先输入关键字过滤', 'search')
          : UI.empty('暂无索引', '没有匹配的索引'));
      }
      /* 集群切换（含断开）：丢弃进行中的请求和全部数据，不自动加载，与原应用的 selectNode 一致 */
      function reset() {
        seq++; epoch++; rows = []; aliasCache = {}; loaded = false; failed = false;
        searchBtn.setLoading(false);
        setEmpty();
        table.setRows([]);
      }
      /* GetIndexes(搜索词)：后端按 *词* 做模糊匹配。o.keepPage：写操作后刷新时停在原页码 */
      function load(o) {
        if (!connected()) { UI.warn('请先连接集群'); return Promise.resolve(false); }
        var my = ++seq;
        searchBtn.setLoading(true);
        return busy(call('GetIndexes', [searchInput.value.trim()])).then(function (res) {
          if (my !== seq) return false; // 期间切换了集群，或已有更新的请求
          searchBtn.setLoading(false);
          if (res === undefined) { if (!loaded) { failed = true; setEmpty(); } return false; }
          rows = res; loaded = true; failed = false;
          ESUI.api.cacheIndexes(rows.map(function (r) { return r.index; }));
          setEmpty();
          table.setRows(rows, { keepPage: !!(o && o.keepPage) });
          return true;
        });
      }
      function search() {
        if (!connected()) return UI.warn('请先连接集群');
        load();
      }
      function reload() { return load({ keepPage: true }); }
      /* ---------- 工具栏动作 ---------- */
      function openCreate() {
        if (!connected()) return UI.warn('请先连接集群');
        dlg.openCreate();
      }
      function exportCsv() {
        var list = table.getRows();
        if (!list.length) return UI.warn('暂无数据可导出');
        UI.exportCsv('索引列表.csv', ['索引名', '别名', '健康', '状态', '主分片', '副本', '文档总数', '软删除文档', '占用存储(字节)'],
          list.map(function (r) { return [r.index, aliasCache[r.index] || '', r.health, r.status, r.pri, r.rep, r['docs.count'], r['docs.deleted'], r['store.size']]; }));
        UI.ok('已导出 ' + list.length + ' 个索引');
      }
      /* GetIndexAliases(当前页的索引名)：只读取当前页，结果合并进 aliasCache */
      function readAlias() {
        if (!connected()) return UI.warn('请先连接集群');
        var pg = table.getPage(), view = table.getView().slice((pg.page - 1) * pg.size, pg.page * pg.size), ep = epoch;
        if (!view.length) return UI.warn('当前页没有索引');
        busy(call('GetIndexAliases', [view.map(function (r) { return r.index; })])).then(function (res) {
          if (res === undefined || ep !== epoch) return; // 期间切换了集群：别名属于旧集群，不能写进新集群的缓存
          view.forEach(function (r) { aliasCache[r.index] = (res && res[r.index]) || ''; });
          table.refresh();
          UI.ok('已读取当前页 ' + view.length + ' 个索引的别名');
        });
      }
      /* 逐个 DeleteIndex，任何一个失败就停止（错误已提示），随后提示已删除的数量并刷新 */
      function bulkDelete() {
        var sel = table.getSelected();
        if (!sel.length) return UI.warn('请先选择要删除的索引');
        var names = h('ul', { class: 'idx-names mono' }, sel.map(function (r) { return h('li', null, r.index); })), ep = epoch;
        UI.confirm({ title: '批量删除索引', kind: 'danger', okText: '删除 ' + sel.length + ' 个索引',
          message: h('div', null, h('div', null, '确定要删除以下 ' + sel.length + ' 个索引吗？此操作不可恢复。'), names) }).then(function (yes) {
          if (!yes || ep !== epoch) return;
          var n = 0, stopped = false;
          function step(i) {
            if (i >= sel.length) return Promise.resolve();
            if (ep !== epoch) { stopped = true; return Promise.resolve(); } // 删除途中切换了集群：不能把剩下的同名索引删到新集群上
            return call('DeleteIndex', [sel[i].index]).then(function (r) { if (r === undefined) return; n++; return step(i + 1); });
          }
          busy(step(0)).then(function () {
            if (n) UI.ok('成功删除 ' + n + ' 个索引');
            if (stopped) UI.warn('集群已切换，其余索引未删除');
            if (ep === epoch) reload();
          });
        });
      }

      /* ---------- 行操作 ---------- */
      /* 调用后端，成功后在抽屉里展示响应（标题为索引名），再执行 after */
      function show(row, name, args, after) {
        var ep = epoch;
        return busy(call(name, args)).then(function (r) {
          if (r === undefined || ep !== epoch) return false; // 失败（已提示），或期间切换了集群：不展示旧集群的结果，也不刷新新集群的列表
          dlg.showJson(row.index, r);
          if (after) after(r);
          return true;
        });
      }
      function viewDocs(row) { show(row, 'GetDoc10', [row.index]); }
      function viewInfo(row) { show(row, 'GetIndexInfo', [row.index]); }
      function viewAlias(row) { show(row, 'GetIndexAliases', [[row.index]]); }
      function simpleOp(row, name, refreshAfter) { // Refresh / Flush / CacheClear；清理缓存后按原应用重新加载列表
        show(row, name, [row.index], refreshAfter ? reload : null);
      }
      /* 编辑 Mapping / Settings：先 GetIndexInfo 读取当前内容，再打开弹窗 */
      function openEditor(row, which) {
        var ep = epoch;
        busy(call('GetIndexInfo', [row.index])).then(function (info) {
          if (info === undefined || ep !== epoch) return;
          var body = (info && info[row.index]) || {};
          if (which === 'mapping') dlg.openMapping(row.index, body.mappings || {});
          else dlg.openSettings(row.index, { index: (body.settings && body.settings.index) || {} });
        });
      }
      function mergeSegments(row) {
        var ep = epoch;
        UI.confirm({ title: '段合并', kind: 'warn', okText: '执行段合并',
          message: '确定要对索引 ' + row.index + ' 执行段合并吗？段合并非常耗资源，将提交给 ES 后台执行' }).then(function (yes) {
          if (!yes || ep !== epoch) return;
          show(row, 'MergeSegments', [row.index], function () {
            UI.ok('已提交段合并请求，段合并是重IO任务，请注意集群负载');
            reload();
          });
        });
      }
      function deleteOne(row) {
        var ep = epoch;
        UI.confirm({ title: '删除索引', kind: 'danger', okText: '删除索引', message: '确定要删除索引 ' + row.index + ' 吗？此操作不可恢复。' }).then(function (yes) {
          if (!yes || ep !== epoch) return;
          show(row, 'DeleteIndex', [row.index], function () {
            UI.ok('已删除索引 ' + row.index);
            reload();
          });
        });
      }
      function toggleOpen(row) { // OpenCloseIndex(索引名, 当前状态)：open 则关闭，close 则打开
        var wasClosed = row.status === 'close';
        show(row, 'OpenCloseIndex', [row.index, row.status], function () {
          UI.ok((wasClosed ? '已打开索引 ' : '已关闭索引 ') + row.index);
          reload();
        });
      }
      function menuItems(row) {
        return [
          { label: '添加文档', onClick: function () { dlg.openAddDoc(row.index); } },
          { label: '查看索引构成', onClick: function () { viewInfo(row); } },
          { label: '别名', onClick: function () { viewAlias(row); } },
          { label: '查看 10 条文档', onClick: function () { viewDocs(row); } },
          { label: '管理别名', onClick: function () { dlg.openAlias(row.index); } },
          { label: '编辑 Mapping', onClick: function () { openEditor(row, 'mapping'); } },
          { label: '编辑 Settings', onClick: function () { openEditor(row, 'settings'); } },
          { label: 'Reindex 复制数据', onClick: function () { dlg.openReindex(row.index); } },
          { label: '段合并', onClick: function () { mergeSegments(row); } },
          { label: '删除索引', danger: true, onClick: function () { deleteOne(row); } },
          { label: row.status === 'close' ? '打开索引' : '关闭索引', onClick: function () { toggleOpen(row); } },
          { label: 'Refresh', onClick: function () { simpleOp(row, 'Refresh'); } },
          { label: 'Flush', onClick: function () { simpleOp(row, 'Flush'); } },
          { label: '清理缓存', onClick: function () { simpleOp(row, 'CacheClear', true); } }
        ];
      }
      /* ---------- 提供给弹层的后端回调；失败时错误已提示（返回 undefined / false / {err}） ---------- */
      var api = {
        templates: function () { return call('GetIndexTemplates', []); }, // 打开创建抽屉时读取，行结构 {name, index_patterns, ...}
        createIndex: function (cfg) { // 选了模板走 CreateIndexFromTemplate，否则 CreateIndex(名称, 主分片, 副本, mapping 原文)
          var ep = epoch;
          var p = cfg.template ? call('CreateIndexFromTemplate', [cfg.name, cfg.template, cfg.shards, cfg.replicas])
            : call('CreateIndex', [cfg.name, cfg.shards, cfg.replicas, cfg.mapping]);
          return ok(p).then(function (done) { if (done && ep === epoch) load(); return done; });
        },
        addDoc: function (index, text) { // 成功时得到 {_id, ...}
          var ep = epoch;
          return call('AddDocument', [index, text]).then(function (r) { if (r !== undefined && ep === epoch) reload(); return r; });
        },
        aliasesOf: function (index) { // GetIndexAliases 返回 {索引: "a,b"}；读过别名的行同步刷新表格里的别名列
          var ep = epoch;
          return call('GetIndexAliases', [[index]]).then(function (r) {
            if (r === undefined) return undefined;
            var joined = (r && r[index]) || '';
            if (ep === epoch && index in aliasCache) { aliasCache[index] = joined; table.refresh(); }
            return joined ? joined.split(',') : [];
          });
        },
        addAlias: function (index, alias, extraText) { return ok(call('AddIndexAlias', [index, alias, extraText])); },
        removeAlias: function (index, alias) { return ok(call('RemoveIndexAlias', [index, alias])); },
        reindex: function (src, dest, queryText) { return ok(call('Reindex', [src, dest, queryText])); },
        saveMapping: function (index, text) { return ok(call('UpdateIndexMappings', [index, text])); },
        saveSettings: function (index, text) { return ok(call('UpdateIndexSettings', [index, text])); },
        backup: function (index, dslText) { // 路径写法同原应用：以 / 开头，后端会把它放到用户主目录下；成功时 result 是实际保存路径
          var path = '/' + index + '-' + Math.floor(Date.now() / 1000) + '.json';
          return es.DownloadESIndex(index, dslText, path).then(function (saved) { return { path: saved || path }; },
            function (e) { return { err: (e && e.message) || String(e) }; });
        }
      };

      dlg = L.dialogs(api);
      root.append(h('div', { class: 'page-body' }, bar, table, h('div', { class: 'row idx-bulk' }, bulkBtn, bulkText)));
      reset();
      ESUI.on('cluster', function () { reset(); });
    }
  });
})();
