/* 文档 (docs)：文档浏览 / 字段统计 / 导入数据三个标签页。
   逻辑分布在辅助文件里（均挂在 ESUI.lib.docs，mount 时才读取）：
   docs-query.js 查询构建与 CSV，docs-ui.js 下拉/标签输入/过滤弹窗，
   docs-browse.js 浏览页，docs-tabs.js 统计页与导入页。后端调用都走 ESUI.api.es。 */
(function () {
  'use strict';
  var h = ESUI.h, api = ESUI.api;
  var onShowFn = null;

  ESUI.registerPage('docs', {
    title: '文档',
    mount: function (root) {
      var D = ESUI.lib && ESUI.lib.docs;
      if (!D || !D.browseTab || !D.statsTab || !D.importTab || !D.indexPicker) {
        root.append(h('div', { class: 'page-body' }, UI.empty('缺少依赖脚本', '请在 index.html 中引入 pages/docs-*.js')));
        return;
      }

      var ctx = { names: [], pickers: [], resets: [], state: { statsIndex: '', importIndex: '' }, loading: false, seq: 0, gen: 0 };
      var browse = null, stats = null, imp = null, tabs = null;

      ctx.browseIndex = function () { return browse ? browse.getIndex() : ''; };
      ctx.dataChanged = function (index) { if (browse) browse.afterWrite(index); };
      /* 浏览页的"导入数据"：切到导入标签页并带上当前索引 */
      ctx.openImport = function (index) {
        tabs.select('import');
        if (index && imp) imp.setIndex(index);
      };
      function setNames(names) {
        ctx.names = names;
        ctx.pickers.forEach(function (p) { p.setOptions(names); });
      }
      function setPickersLoading(on) { ctx.pickers.forEach(function (p) { p.setLoading(on); }); }
      /* 读取索引列表（GetIndexes("")，取每行的 index）。manual 为 true 时给出提示。未连接时不发请求 */
      ctx.loadIndexes = function (manual) {
        if (!ESUI.state.cluster) {
          if (manual) UI.warn('未连接集群');
          return Promise.resolve();
        }
        if (ctx.loading) return Promise.resolve();
        var tok = ++ctx.seq;
        ctx.loading = true;
        setPickersLoading(true);
        return api.guard(api.es.GetIndexes(''), '获取索引列表失败：').then(function (rows) {
          if (tok !== ctx.seq) return; // 期间切换了集群，结果已作废
          ctx.loading = false;
          setPickersLoading(false);
          if (rows === undefined) return;
          var names = (rows || []).map(function (r) { return r && r.index; }).filter(Boolean);
          api.cacheIndexes(names);
          setNames(names);
          if (manual) UI.ok('索引列表已刷新');
        });
      };

      tabs = UI.tabs({
        active: 'browse',
        items: [
          { key: 'browse', label: '文档浏览', render: function (panel) { browse = D.browseTab(panel, ctx); } },
          { key: 'stats', label: '字段统计', render: function (panel) { stats = D.statsTab(panel, ctx); }, onShow: function () { if (stats) stats.onShow(); } },
          { key: 'import', label: '导入数据', render: function (panel) { imp = D.importTab(panel, ctx); }, onShow: function () { if (imp) imp.onShow(); } }
        ]
      });
      var offline = UI.empty('请先连接集群', '在「集群」页连接一个集群后，即可浏览、统计和导入文档', 'docs');

      function sync(c) {
        tabs.hidden = !c;
        offline.hidden = !!c;
      }
      sync(ESUI.state.cluster);
      root.append(h('div', { class: 'page-body docs-body' }, tabs, offline));

      /* 切换集群：丢弃进行中的索引列表请求，清空三个标签页的状态；已连接则重新读取索引列表 */
      ESUI.on('cluster', function (c) {
        ctx.gen++; // results of writes started on the previous cluster are not announced
        ctx.seq++;
        ctx.loading = false;
        setPickersLoading(false);
        sync(c);
        ctx.resets.forEach(function (fn) { fn(); });
        if (browse) browse.reset();
        ctx.state.statsIndex = '';
        ctx.state.importIndex = '';
        setNames([]);
        if (c) ctx.loadIndexes(false);
      });

      onShowFn = function () {
        if (!ctx.names.length && ESUI.state.cluster) ctx.loadIndexes(false);
      };
    },
    onShow: function () { if (onShowFn) onShowFn(); }
  });
})();
