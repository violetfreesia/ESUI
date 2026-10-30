/* 健康 (GET /_cluster/health).
   Main visual: the shard ribbon (UI.ribbon, size lg) beside the cluster identity facts.
   Below it: the full 15-key health table (说明 / 值 / 完整键). Data: ESUI.state.cluster.health + .shards, which the shell fills
   from GetHealth. Refresh goes through ESUI.refreshHealth(), which also updates the top strip and emits 'health'; this page redraws
   on 'health' and 'cluster'. A key the server does not return shows "-". */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;
  var r1 = function (v) { return Math.round(v * 10) / 10; };

  var KEYS = ['cluster_name', 'status', 'timed_out', 'number_of_nodes', 'number_of_data_nodes', 'active_primary_shards',
    'active_shards', 'relocating_shards', 'initializing_shards', 'unassigned_shards', 'delayed_unassigned_shards',
    'number_of_pending_tasks', 'number_of_in_flight_fetch', 'task_max_waiting_in_queue_millis', 'active_shards_percent_as_number'];
  var DESC = {
    cluster_name: '集群名称',
    status: '集群健康状态（绿色、黄色、红色）',
    timed_out: '请求是否超时',
    number_of_nodes: '集群中的节点数',
    number_of_data_nodes: '集群中的数据节点数',
    active_primary_shards: '活跃的主分片数',
    active_shards: '活跃的总分片数',
    relocating_shards: '正在重新定位的分片数',
    initializing_shards: '正在初始化的分片数',
    unassigned_shards: '未分配的分片数',
    delayed_unassigned_shards: '延迟未分配的分片数',
    number_of_pending_tasks: '等待中的集群级任务数',
    number_of_in_flight_fetch: '正在进行的分片数据获取数',
    task_max_waiting_in_queue_millis: '任务在队列中的最长等待时间（毫秒）',
    active_shards_percent_as_number: '活跃分片百分比'
  };
  var STATUS_KIND = { green: 'ok', yellow: 'warn' };
  var WARN_WHEN_POSITIVE = { unassigned_shards: 1, delayed_unassigned_shards: 1, initializing_shards: 1 };

  /* tag colour of a health value. Same as the original app, except: the three shard counters only turn warn when
     greater than 0 (the original paints them amber even at 0), and cluster_name stays neutral (it is a name, not a
     status, and a green name next to a red status would read as healthy). */
  function kindOf(key, v) {
    if (WARN_WHEN_POSITIVE[key]) return Number(v) > 0 ? 'warn' : null;
    if (key === 'timed_out') return v === true ? 'err' : 'ok';
    if (key === 'status') return STATUS_KIND[v] || 'err';
    return null;
  }
  function hasData(hl) { return !!hl && typeof hl === 'object' && Object.keys(hl).length > 0; }
  function toRows(data) {
    if (!hasData(data)) return [];
    var keys = KEYS.concat(Object.keys(data).filter(function (k) { return KEYS.indexOf(k) < 0; }));
    return keys.map(function (k) {
      var v = data[k];
      return { key: k, label: DESC[k] || '暂无说明', value: v == null ? '-' : v, kind: kindOf(k, v) };
    });
  }

  function buildHero() {
    var ribbon = UI.ribbon({}, { size: 'lg', legend: true });
    var total = h('div', { class: 'health-total muted' });
    var facts = h('dl', { class: 'health-facts' });
    var el = h('section', { class: 'health-hero' }, h('div', { class: 'health-vis' }, ribbon, total), facts);
    el.paint = function (c) {
      var hl = c.health || {}, s = c.shards || {};
      var sum = (s.active || 0) + (s.relocating || 0) + (s.initializing || 0) + (s.unassigned || 0);
      var hasShards = ['active_shards', 'relocating_shards', 'initializing_shards', 'unassigned_shards'].some(function (k) { return hl[k] != null; });
      var pct = hl.active_shards_percent_as_number == null ? NaN : Number(hl.active_shards_percent_as_number);
      if (isNaN(pct) && sum) pct = (s.active || 0) / sum * 100;
      if (!isNaN(pct)) pct = r1(pct);
      ribbon.update(s);
      total.textContent = !hasShards ? '未返回分片数量' : '分片共 ' + F.num(sum) + ' 个' +
        (hl.active_primary_shards == null ? '' : '，其中主分片 ' + F.num(hl.active_primary_shards) + ' 个');
      facts.innerHTML = '';
      [
        ['集群', h('strong', { class: 'mono' }, hl.cluster_name || c.cluster)],
        ['状态', UI.tag(String(hl.status || c.status), STATUS_KIND[hl.status || c.status] || 'err', { dot: true })],
        ['节点', hl.number_of_nodes == null ? '-' : h('span', null, F.num(hl.number_of_nodes) + ' 个',
          hl.number_of_data_nodes == null ? null : h('span', { class: 'muted' }, '（数据节点 ' + F.num(hl.number_of_data_nodes) + '）'))],
        ['活跃分片', isNaN(pct) ? '-' : UI.progress(pct, { kind: pct >= 100 ? 'ok' : pct >= 90 ? 'warn' : 'err', width: '170px', text: pct + '%' })]
      ].forEach(function (p) {
        facts.appendChild(h('dt', null, p[0]));
        facts.appendChild(h('dd', null, p[1]));
      });
    };
    return el;
  }

  ESUI.registerPage('health', {
    title: '健康',
    mount: function (root, def) {
      var seq = 0, loading = false, offline = false; // offline: the backend answered "no cluster selected"
      var refresh = UI.btn('刷新', { icon: 'refresh', onClick: function () { load(false); } });
      def.topActions = [refresh]; // shown at the right of the top strip while this page is open
      var hero = buildHero();

      var table = UI.table({
        fill: true, pager: false, resizable: true,
        columns: [
          { key: 'label', title: '健康指标', width: 250 },
          { key: 'value', title: '值', width: 170, render: function (r) {
            var t = UI.tag(String(r.value), r.kind, { mono: true });
            return typeof r.value === 'string' ? UI.tip(t, r.value) : t;
          } },
          { key: 'key', title: '完整键', width: 230, mono: true }
        ]
      });
      table.classList.add('health-table');

      var sub = h('div', { class: 'health-sub' }, h('h2', null, '全部指标'), h('span', { class: 'muted' }, 'GET /_cluster/health'));
      var main = h('div', { class: 'health-main' }, hero, sub, table);
      var goCluster = UI.btn('前往集群', { kind: 'primary', onClick: function () { ESUI.go('cluster'); } });
      var empty = h('div', { class: 'health-empty' });
      /* the loading mask goes on a non-scrolling wrapper (the .page-body inside it scrolls), so it also covers the empty states */
      var host = h('div', { class: 'health-host' }, h('div', { class: 'page-body' }, main, empty));

      function showEmpty(connected) {
        empty.replaceChildren.apply(empty, connected ? [UI.empty('暂无健康数据', '获取集群健康失败，可以点右上角的刷新重试')]
          : [UI.empty('未连接集群', '请先选择一个集群'), goCluster]);
      }
      // everything on screen comes from ESUI.state.cluster (health + shards), which the shell refreshes on connect and on refreshHealth()
      function fill() {
        var c = ESUI.state.cluster, shown = !!c && !offline && hasData(c.health);
        main.hidden = !shown;
        empty.hidden = shown;
        if (!shown) {
          showEmpty(!!c && !offline);
          table.setRows([]);
          return;
        }
        hero.paint(c);
        table.setRows(toRows(c.health));
      }
      // quiet = no "已刷新" toast (page mount; the connect itself was already announced by the shell)
      function load(quiet) {
        if (loading) return;
        if (!ESUI.state.cluster) { if (!quiet) UI.warn('请先选择一个集群'); return; }
        var my = ++seq;
        loading = true;
        refresh.setLoading(true);
        // refreshHealth() = GetHealth + top strip + 'health' event; the 'health' listener below redraws this page
        UI.busy(host, ESUI.refreshHealth(), '正在获取集群健康...').then(function () {
          if (my === seq && !quiet) UI.ok('健康数据已刷新');
        }).catch(function (e) {
          if (my !== seq) return;
          api.report(e, '获取健康失败：'); // a failed refresh keeps the last data on screen, as the original does
          if (api.isNoCluster(e)) { offline = true; fill(); }
        }).then(function () {
          if (my === seq) { loading = false; refresh.setLoading(false); }
        });
      }

      root.append(host);
      fill();
      ESUI.on('health', function () { offline = false; fill(); });
      ESUI.on('cluster', function (c) {
        seq++; loading = false; offline = false; // anything still in flight belongs to the previous cluster
        refresh.setLoading(false);
        fill();
        if (c && !hasData(c.health)) load(true); // the GetHealth done while connecting failed: try once more
      });
      if (ESUI.state.cluster) load(true); // the original loads when the component is mounted
    }
  });
})();
