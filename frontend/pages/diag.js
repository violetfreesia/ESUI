/* 诊断 (key: diag). Tabs: 分片分布 / 线程池 / 热点线程 / 挂起任务.
   Backend (ESUI.api.es): GetShards, ExplainAllocation (raw), GetThreadPool, GetNodeNames, GetHotThreads, GetPendingTasks.
   Nothing is requested while no cluster is connected; a cluster switch clears every tab. */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;

  var STATE_KIND = { STARTED: 'ok', INITIALIZING: 'info', RELOCATING: 'info', UNASSIGNED: 'err' };
  var PRIORITY_KIND = { URGENT: 'err', HIGH: 'warn' };
  var ALL = '__all__';
  var MSG_SHARDS_PROMPT = '为避免数十万分片全量扫描冲击 Master 节点，默认不自动拉取全量分片。请输入索引名精确查询，或点击【查询全量分片】。';
  var MSG_ALL_SHARDS = '当前未指定索引名，将全量拉取全集群所有物理分片。在大型集群（如数万至数十万分片）中，该操作将请求 Master 节点序列化完整路由表，可能引起短时间 Master 负载上升，确定要继续全量查询吗？';
  var MSG_HOT_NOTE = '推荐选择具体节点进行定向采样。全集群采样会对所有数据节点并发采集 JVM 线程堆栈，在大型集群中可能产生瞬时 CPU 波动。';
  var MSG_HOT_ALL = '您当前未指定具体节点，即将对全集群【所有节点】同时发起热点线程采样。在大型集群中，这会对所有节点同时施加 JVM 栈采集压力并可能耗时较长，确定继续吗？';
  var HOT_HINT = '尚未采样。选择节点后点击“开始采样”。';

  var gen = 0; // bumped on every cluster switch; responses that belong to the old cluster are dropped

  function connected() { return !!ESUI.state.cluster; }
  function note(text) { return h('div', { class: 'diag-note' }, UI.icon('info', 16), h('span', null, text)); }
  /* container for a table's empty state whose wording changes with the data state */
  function emptyBox() {
    var box = h('div');
    box.set = function (title, hint, icon) { box.innerHTML = ''; box.appendChild(UI.empty(title, hint, icon)); };
    return box;
  }
  function noCluster(box) { box.set('未连接集群', '请先在“集群”页连接一个集群'); }
  function fmtQueue(ms) { ms = Number(ms) || 0; return ms < 1000 ? ms + ' ms' : F.millis(ms); }

  /* _cat endpoints answer with strings ("12", "1048576"); sorting and the formatters need numbers */
  function toNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function withNums(r, keys) {
    var o = Object.assign({}, r);
    keys.forEach(function (k) { o[k] = toNum(r[k]); });
    return o;
  }

  /* index filter: without '*' a substring, with '*' an anchored wildcard (logs-*); commas separate several patterns */
  function matchIndex(pat, name) {
    pat = String(pat || '').trim().toLowerCase();
    if (!pat) return true;
    name = String(name || '').toLowerCase();
    return pat.split(',').some(function (p) {
      p = p.trim();
      if (!p) return false;
      if (p.indexOf('*') < 0) return name.indexOf(p) >= 0;
      var src = p.split('*').map(function (s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*');
      return new RegExp('^' + src + '$').test(name);
    });
  }

  function showExplain(view) {
    var m = UI.modal({
      title: '分片分配解释', width: 'min(800px, 92vw)', body: view,
      footer: [UI.btn('关闭', { onClick: function () { m.close(); } })]
    });
  }
  /* env = {result, err}. For an assigned shard ES answers 400 and the explanation is in the body, so err is shown as is
     (pretty-printed when it is JSON, plain text otherwise) */
  function explainView(env) {
    if (!env.err) return UI.jsonView(env.result == null ? {} : env.result, { wrap: true, maxHeight: '65vh' });
    var parsed;
    try { parsed = JSON.parse(env.err); } catch (e) { return UI.textView(env.err, { wrap: true, maxHeight: '65vh' }); }
    return UI.jsonView(parsed, { wrap: true, maxHeight: '65vh' });
  }

  /* ---------- 分片分布 ---------- */
  function buildShards() {
    var st = { rows: [], queried: false, n: 0, seq: 0 };
    var emptyEl = emptyBox(), noteEl, input, stateSel, searchBtn, allBtn, table;

    function matchRow(r) {
      var q = input.value.trim(), s = stateSel.value;
      return (!q || matchIndex(q, r.index)) && (!s || r.state === s);
    }
    function syncEmpty() {
      if (!connected()) noCluster(emptyEl);
      else if (!st.queried) emptyEl.set('尚未查询分片', '输入索引名后查询，或点击“查询全量分片”');
      else if (st.rows.length) emptyEl.set('没有符合筛选条件的分片', '调整索引名或状态后重试');
      else emptyEl.set('没有分片数据', '查询范围内没有分片');
    }
    function applyFilter() { syncEmpty(); table.setFilter(matchRow); }
    function busy(on) {
      st.n += on ? 1 : -1;
      var v = st.n > 0;
      searchBtn.setLoading(v); allBtn.setLoading(v);
    }
    /* target '' = every shard of the cluster; GetShards also takes ES patterns such as logs-* */
    function fetchShards(target) {
      if (!connected()) return UI.warn('未连接集群');
      var g = gen, seq = ++st.seq;
      st.queried = true; noteEl.hidden = true;
      busy(true);
      return api.guard(UI.busy(table, api.es.GetShards(target), '正在查询分片...'), '查询分片失败：').then(function (rows) {
        busy(false);
        if (g !== gen || seq !== st.seq) return; // cluster switched, or a newer query is in flight
        if (rows !== undefined) st.rows = rows.map(function (r) { return withNums(r, ['shard', 'docs', 'store']); });
        syncEmpty(); table.setRows(st.rows); table.setFilter(matchRow);
        if (rows !== undefined) UI.ok('已加载 ' + st.rows.length + ' 个分片');
      });
    }
    function confirmAll() {
      if (!connected()) return UI.warn('未连接集群');
      UI.confirm({ title: '全量查询分片风险提示', message: MSG_ALL_SHARDS, kind: 'warn', okText: '继续查询', cancelText: '取消' })
        .then(function (ok) { if (ok) fetchShards(''); });
    }
    function search() {
      var t = input.value.trim();
      if (!t) confirmAll(); else fetchShards(t);
    }
    function explain(row) {
      if (!connected()) return UI.warn('未连接集群');
      var g = gen;
      UI.busy(table, api.raw.ExplainAllocation(row.index, parseInt(row.shard, 10), row.prirep === 'p'), '正在获取分配解释...').then(function (env) {
        if (g !== gen) return;
        env = env || {};
        if (env.err === api.NO_CLUSTER) return api.report(new api.ApiError(env.err));
        showExplain(explainView(env));
      }, function (e) { if (g === gen) api.report(e, '获取分配解释失败：'); });
    }
    function explainFirst() {
      if (!st.rows.length) return UI.warn(MSG_SHARDS_PROMPT);
      var t = st.rows.filter(function (r) { return r.state === 'UNASSIGNED'; })[0];
      if (!t) return UI.info('当前没有未分配的分片');
      explain(t);
    }

    function render(panel) {
      noteEl = note(MSG_SHARDS_PROMPT);
      noteEl.hidden = st.queried;
      input = UI.input({ placeholder: '输入索引名称（支持通配符 *）', width: '260px', mono: true, clearable: true, onInput: applyFilter, onEnter: search });
      stateSel = UI.select(['STARTED', 'INITIALIZING', 'RELOCATING', 'UNASSIGNED'], { placeholder: '按状态过滤', width: '160px', onChange: applyFilter });
      searchBtn = UI.btn('搜索', { kind: 'primary', icon: 'search', onClick: search });
      allBtn = UI.btn('查询全量分片', { icon: 'refresh', onClick: confirmAll });
      syncEmpty();
      table = UI.table({
        fill: true, striped: true, pageSize: 20, pageSizes: [10, 20, 50, 100], empty: emptyEl,
        columns: [
          { key: 'index', title: '索引', width: 180, mono: true },
          { key: 'shard', title: '分片', width: 70, align: 'right', mono: true },
          { key: 'prirep', title: '主/副', width: 90, render: function (r) {
            var t = UI.tag(r.prirep === 'p' ? 'primary' : 'replica');
            if (r.prirep === 'p') t.classList.add('diag-prim'); // primary is a role, not a status: stress it with weight instead of a status colour
            return t;
          } },
          { key: 'state', title: '状态', width: 130, render: function (r) { return UI.tag(r.state, STATE_KIND[r.state]); } },
          { key: 'docs', title: '文档总数', width: 100, align: 'right', mono: true, render: function (r) { return F.num(r.docs); } },
          { key: 'store', title: '占用存储', width: 100, align: 'right', mono: true, render: function (r) { return F.bytes(r.store); } },
          { key: 'node', title: 'node', width: 150, mono: true },
          { key: 'ip', title: 'ip', width: 110, mono: true },
          { key: 'ops', title: '操作', width: 110, sortable: false, render: function (r) {
            return UI.btn('分配解释', { size: 'sm', kind: 'ghost info', onClick: function () { explain(r); } });
          } }
        ]
      });
      table.classList.add('diag-tbl', 'diag-pin');
      table.setFilter(matchRow);
      panel.append(noteEl, UI.toolbar(input, stateSel, searchBtn, allBtn, UI.btn('解释未分配分片', { kind: 'warn', onClick: explainFirst })), table);
    }
    function reset() {
      st.rows = []; st.queried = false; st.seq++;
      if (!table) return;
      noteEl.hidden = false;
      syncEmpty(); table.setRows([]);
    }
    return { render: render, reset: reset };
  }

  /* ---------- 线程池 ---------- */
  function buildPool() {
    var st = { rows: [], loaded: false, n: 0, lg: -1, seq: 0 };
    var emptyEl = emptyBox(), input, refreshBtn, table;

    function match(r) {
      var q = input.value.trim().toLowerCase();
      return !q || String(r.name || '').toLowerCase().indexOf(q) >= 0 || String(r.node_name || '').toLowerCase().indexOf(q) >= 0;
    }
    function syncEmpty() {
      if (!connected()) noCluster(emptyEl);
      else if (!st.loaded) emptyEl.set('尚未加载线程池', '点击“刷新”获取线程池状态');
      else if (st.rows.some(match)) emptyEl.set('暂无数据');
      else if (st.rows.length) emptyEl.set('没有符合条件的线程池', '调整过滤词后重试');
      else emptyEl.set('没有线程池数据');
    }
    function applyFilter() { syncEmpty(); table.setFilter(match); }
    function load(manual) {
      if (!table) return;
      if (!connected()) { if (manual) UI.warn('未连接集群'); syncEmpty(); return; }
      var g = gen, my = ++st.seq;
      st.n++; st.lg = g; refreshBtn.setLoading(true);
      api.guard(UI.busy(table, api.es.GetThreadPool()), '获取线程池失败：').then(function (rows) {
        if (--st.n === 0) refreshBtn.setLoading(false);
        if (st.lg === g) st.lg = -1;
        if (g !== gen || my !== st.seq || rows === undefined) return; // cluster switched, or a newer refresh is in flight
        st.rows = rows.map(function (r) { return withNums(r, ['active', 'queue', 'rejected']); });
        st.loaded = true;
        syncEmpty(); table.setRows(st.rows); table.setFilter(match);
        if (manual) UI.ok('已刷新线程池，共 ' + st.rows.length + ' 行');
      });
    }
    function render(panel) {
      input = UI.input({ placeholder: '按线程池/节点名过滤', width: '240px', clearable: true, onInput: applyFilter, onEnter: function () { load(true); } });
      refreshBtn = UI.btn('刷新', { icon: 'refresh', onClick: function () { load(true); } });
      syncEmpty();
      var numCell = function (key, kind) {
        return function (r) { return r[key] ? UI.tag(F.num(r[key]), kind) : (r[key] == null ? '' : '0'); };
      };
      // GET _cat/thread_pool is requested without h=, so ES only returns node_name, name, active, queue, rejected
      table = UI.table({
        fill: true, striped: true, pageSize: 20, pageSizes: [10, 20, 50, 100], empty: emptyEl,
        columns: [
          { key: 'node_name', title: '节点名', width: 160, mono: true },
          { key: 'name', title: '线程池', width: 200, mono: true },
          { key: 'active', title: '活跃', width: 100, align: 'right', mono: true },
          { key: 'queue', title: '队列', width: 100, align: 'right', mono: true, render: numCell('queue', 'warn') },
          { key: 'rejected', title: '拒绝', width: 100, align: 'right', mono: true, render: numCell('rejected', 'err') }
        ]
      });
      table.classList.add('diag-tbl');
      panel.append(UI.toolbar(input, refreshBtn), table);
    }
    function reset() {
      st.rows = []; st.loaded = false;
      if (!table) return;
      syncEmpty(); table.setRows([]);
    }
    return {
      render: render, reset: reset, load: function () { load(false); },
      // as in the Vue page: entering the tab loads when there is nothing to show
      onShow: function () { if (!st.rows.length && st.lg !== gen) load(false); }
    };
  }

  /* ---------- 挂起任务 ---------- */
  function buildPending() {
    var st = { rows: [], loaded: false, n: 0, lg: -1, seq: 0 };
    var emptyEl = emptyBox(), refreshBtn, table;

    function syncEmpty() {
      if (!connected()) noCluster(emptyEl);
      else if (!st.loaded) emptyEl.set('尚未加载挂起任务', '点击“刷新”获取集群级挂起任务');
      else emptyEl.set('当前没有挂起任务', '集群状态更新队列为空', 'checkCircle');
    }
    function load(manual) {
      if (!table) return;
      if (!connected()) { if (manual) UI.warn('未连接集群'); syncEmpty(); return; }
      var g = gen, my = ++st.seq;
      st.n++; st.lg = g; refreshBtn.setLoading(true);
      api.guard(UI.busy(table, api.es.GetPendingTasks()), '获取挂起任务失败：').then(function (rows) {
        if (--st.n === 0) refreshBtn.setLoading(false);
        if (st.lg === g) st.lg = -1;
        if (g !== gen || my !== st.seq || rows === undefined) return; // cluster switched, or a newer refresh is in flight
        st.rows = rows; st.loaded = true;
        syncEmpty(); table.setRows(st.rows);
        if (manual) UI.ok(st.rows.length ? '已刷新，共 ' + st.rows.length + ' 个挂起任务' : '已刷新，没有挂起任务');
      });
    }
    function render(panel) {
      refreshBtn = UI.btn('刷新', { icon: 'refresh', onClick: function () { load(true); } });
      syncEmpty();
      table = UI.table({
        fill: true, striped: true, pager: false, empty: emptyEl,
        columns: [
          { key: 'insert_order', title: '插入顺序', width: 110, align: 'right', mono: true },
          { key: 'priority', title: '优先级', width: 110, render: function (r) { return UI.tag(r.priority, PRIORITY_KIND[r.priority]); } },
          { key: 'source', title: '来源', width: 560, mono: true },
          { key: 'time_in_queue_millis', title: '排队时间', width: 120, align: 'right', mono: true, render: function (r) { return fmtQueue(r.time_in_queue_millis); } }
        ]
      });
      table.classList.add('diag-tbl');
      panel.append(UI.toolbar(refreshBtn), table);
    }
    function reset() {
      st.rows = []; st.loaded = false;
      if (!table) return;
      syncEmpty(); table.setRows([]);
    }
    return {
      render: render, reset: reset, load: function () { load(false); },
      // as in the Vue page: entering the tab loads when there is nothing to show
      onShow: function () { if (!st.rows.length && st.lg !== gen) load(false); }
    };
  }

  /* ---------- 热点线程 ---------- */
  function buildHot() {
    var st = { n: 0, nodes: [], loaded: false, nl: -1 };
    var sel, btn, host, pre;

    function setText(text, lineNumbers) {
      var next = UI.textView(text, { lineNumbers: lineNumbers });
      pre.replaceWith(next); pre = next;
    }
    /* the select is rendered with the tab, the node list can arrive before that */
    function fillNodes() {
      if (!sel) return;
      var opts = [{ value: ALL, label: '全集群所有节点（高开销）' }].concat(st.nodes);
      var keep = sel.value;
      UI.setOptions(sel, opts, null, '选择节点（推荐单节点采样）');
      if (keep && opts.some(function (o) { return o.value === keep; })) sel.value = keep;
    }
    /* GetNodeNames rows: {name, ip, master, node.role}. The value sent to GetHotThreads is the node name (ip when unnamed). */
    function loadNodes() {
      if (!connected()) return;
      var g = gen;
      st.nl = g;
      api.es.GetNodeNames().then(function (rows) {
        if (st.nl === g) st.nl = -1;
        if (g !== gen) return;
        st.nodes = rows.map(function (n) {
          return { value: n.name || n.ip, label: n.name ? n.name + ' (' + n.ip + ')' : n.ip };
        });
        st.loaded = true; fillNodes();
      }, function () { if (st.nl === g) st.nl = -1; /* the node list is optional, the Vue page ignores a failure here */ });
    }
    function run(node) {
      var g = gen;
      st.n++; btn.setLoading(true);
      api.guard(UI.busy(host, api.es.GetHotThreads(node), '正在采样...'), '采样热点线程失败：').then(function (text) {
        if (--st.n === 0) btn.setLoading(false);
        if (g !== gen || text === undefined) return;
        setText(text || '', true);
        UI.ok(node ? '已完成 ' + node + ' 的热点线程采样' : '已完成全集群热点线程采样');
      });
    }
    function sample() {
      if (!connected()) return UI.warn('未连接集群');
      var v = sel.value;
      if (!v || v === ALL) {
        UI.confirm({ title: '全集群采样风险提示', message: MSG_HOT_ALL, kind: 'warn', okText: '继续采样', cancelText: '取消' })
          .then(function (ok) { if (ok) run(''); });
      } else run(v);
    }
    function render(panel) {
      sel = UI.select([], { width: '280px' });
      btn = UI.btn('开始采样', { kind: 'primary', icon: 'play', onClick: sample });
      pre = UI.textView(HOT_HINT, { lineNumbers: false });
      host = h('div', { class: 'diag-hot' }, pre);
      fillNodes();
      panel.append(note(MSG_HOT_NOTE), UI.toolbar(sel, btn), host);
    }
    function reset() {
      st.nodes = []; st.loaded = false;
      if (!sel) return;
      sel.value = '';
      fillNodes();
      setText(HOT_HINT, false);
    }
    return {
      render: render, reset: reset, loadNodes: loadNodes,
      // as in the Vue page: entering the tab loads the node list when it is empty
      onShow: function () { if (!st.loaded && st.nl !== gen) loadNodes(); }
    };
  }

  ESUI.registerPage('diag', {
    title: '诊断',
    mount: function (root) {
      var shards = buildShards(), pool = buildPool(), hot = buildHot(), pend = buildPending();
      var tabs = UI.tabs({
        items: [
          { key: 'shards', label: '分片分布', render: shards.render },
          { key: 'threadPool', label: '线程池', render: pool.render, onShow: pool.onShow },
          { key: 'hotThreads', label: '热点线程', render: hot.render, onShow: hot.onShow },
          { key: 'pending', label: '挂起任务', render: pend.render, onShow: pend.onShow }
        ]
      });
      root.append(h('div', { class: 'page-body diag-body' }, tabs));

      // the Vue page loads the node list when it is mounted; the other tabs load when they are entered
      hot.loadNodes();

      ESUI.on('cluster', function () {
        gen++;
        shards.reset(); pool.reset(); hot.reset(); pend.reset();
        hot.loadNodes();
        var k = tabs.active();
        if (k === 'threadPool') pool.load();
        else if (k === 'pending') pend.load();
      });
    }
  });
})();
