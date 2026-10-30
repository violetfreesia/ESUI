/* 节点 (GET /_nodes/stats/indices,os,fs,process,jvm, via ESUI.api.es.GetNodes).
   Parses the response the way Nodes.vue does (same field paths, the same `?? 0` defaults, the same units) and shows the 12-column
   node table: name fixed on the left, role tags, heap / disk bars, performance + system tooltips, cache, docs, segments, uptime.
   Loads when the page is mounted while connected and again on every 'cluster' event; not connected shows an empty state.
   The tooltip rows and the CSV columns come from the same GROUPS table so they cannot drift apart.
   Every field is read through at() / N(), so a field that this Elasticsearch version does not return becomes 0, never a TypeError. */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;
  // roles are mapped by their full name (the original looked only at the first letter, so data_hot and data_cold both became 数据)
  var ROLE = { master: '主节点', data: '数据', data_content: '内容', data_hot: '热', data_warm: '温', data_cold: '冷', data_frozen: '冻结',
    ingest: 'Ingest', ml: 'ML', remote_cluster_client: '远程', transform: '转换', voting_only: '投票' };
  var roleName = function (r) { return ROLE[r] || r; };
  // a node whose `roles` is an empty array is coordinating-only; a response without `roles` says nothing about the roles
  var roleText = function (n) { return !n.rolesKnown ? '-' : n.roles.length ? n.roles.map(roleName).join('/') : '协调'; };

  var isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
  var obj = function (v) { return isObj(v) ? v : {}; };
  /* safe deep read: undefined as soon as a step is missing */
  function at(o, path) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (o == null || typeof o !== 'object') return undefined;
      o = o[parts[i]];
    }
    return o;
  }
  /* number read with the original's `?? 0` default (also 0 for NaN / non-numeric values) */
  function N(o, k) { var x = o == null ? NaN : Number(o[k]); return isFinite(x) ? x : 0; }

  /* one /_nodes/stats node -> table row. Field names follow Nodes.vue; the group objects keep the raw ES keys. */
  function parseNode(node) {
    node = obj(node);
    var ix = obj(node.indices), jvm = obj(node.jvm), mem = obj(jvm.mem), proc = obj(node.process), seg = obj(ix.segments);
    var fsT = obj(at(node, 'fs.total')), addr = typeof node.transport_address === 'string' ? node.transport_address : '';
    var diskTotal = N(fsT, 'total_in_bytes'), diskFree = N(fsT, 'available_in_bytes');
    var row = {
      name: node.name == null ? '-' : String(node.name),
      ip: addr ? addr.replace(/:\d+$/, '') : 'N/A', // strips the port; also right for "[::1]:9300"
      roles: Array.isArray(node.roles) ? node.roles.map(String) : [], rolesKnown: Array.isArray(node.roles),
      uptime: N(jvm, 'uptime_in_millis'),
      docs_count: N(ix.docs, 'count'), store_size: N(ix.store, 'size_in_bytes'),
      disk_total: diskTotal, disk_free: diskFree,
      disk_percent: diskTotal > 0 ? Math.round((diskTotal - diskFree) / diskTotal * 100) : 0,
      load_5m: N(at(node, 'os.cpu.load_average'), '5m'),
      heap_used_in_bytes: N(mem, 'heap_used_in_bytes'), heap_max_in_bytes: N(mem, 'heap_max_in_bytes'), heap_percent: N(mem, 'heap_used_percent'),
      segments_count: N(seg, 'count'),
      search: obj(ix.search), merges: obj(ix.merges), segments: seg, fs_io: obj(at(node, 'fs.io_stats.total')),
      open_fd: N(proc, 'open_file_descriptors'), max_fd: N(proc, 'max_file_descriptors'),
      cpu_percent: N(proc.cpu, 'percent'), virt_mem: N(proc.mem, 'total_virtual_in_bytes'),
      cache_query: N(ix.query_cache, 'memory_size_in_bytes'), cache_fielddata: N(ix.fielddata, 'memory_size_in_bytes'),
      cache_request: N(ix.request_cache, 'memory_size_in_bytes'), cache_segments: N(seg, 'memory_in_bytes')
    };
    row.stats_cache_size = row.cache_query + row.cache_fielddata + row.cache_request + row.cache_segments;
    return row;
  }

  // value formats: display text in tooltips, header unit in the CSV (the CSV keeps raw numbers so a spreadsheet can sort and sum them)
  var FMT = { num: F.num, ms: F.millis, bytes: F.bytes, pct: function (v) { return v + '%'; }, raw: function (v) { return v; } };
  var UNIT = { ms: '(ms)', bytes: '(B)', pct: '(%)' };
  var S = function (src, key, mul) { return function (n) { return N(n[src], key) * (mul || 1); }; };
  // [tag text, [label, getter, format, {tip: custom tooltip text, csvOnly: true}]]
  var GROUPS = {
    search: ['搜索', [
      ['查询总数', S('search', 'query_total'), 'num'], ['查询耗时', S('search', 'query_time_in_millis'), 'ms'],
      ['拉取总数', S('search', 'fetch_total'), 'num'], ['拉取耗时', S('search', 'fetch_time_in_millis'), 'ms'],
      ['滚动总数', S('search', 'scroll_total'), 'num'], ['滚动耗时', S('search', 'scroll_time_in_millis'), 'ms']]],
    merge: ['合并', [
      ['合并总数', S('merges', 'total'), 'num'], ['合并总耗时', S('merges', 'total_time_in_millis'), 'ms'],
      ['合并文档总数', S('merges', 'total_docs'), 'num'], ['合并总大小', S('merges', 'total_size_in_bytes'), 'bytes'],
      ['当前合并数', S('merges', 'current'), 'raw']]],
    seg: ['段', [
      ['段总数', function (n) { return n.segments_count; }, 'num'], ['总内存占用', S('segments', 'memory_in_bytes'), 'bytes'],
      ['词项 (Terms)', S('segments', 'terms_memory_in_bytes'), 'bytes'], ['存储字段 (Stored Fields)', S('segments', 'stored_fields_memory_in_bytes'), 'bytes'],
      ['Doc Values', S('segments', 'doc_values_memory_in_bytes'), 'bytes'], ['Norms', S('segments', 'norms_memory_in_bytes'), 'bytes']]],
    proc: ['进程', [
      ['打开文件描述符', function (n) { return n.open_fd; }, 'num', { tip: function (n) { return F.num(n.open_fd) + ' / ' + F.num(n.max_fd); } }],
      ['最大文件描述符', function (n) { return n.max_fd; }, 'num', { csvOnly: true }],
      ['进程CPU使用率', function (n) { return n.cpu_percent; }, 'pct'], ['虚拟内存占用', function (n) { return n.virt_mem; }, 'bytes']]],
    fs: ['FS', [
      ['总空间', function (n) { return n.disk_total; }, 'bytes'], ['可用空间', function (n) { return n.disk_free; }, 'bytes'],
      ['IO读操作', S('fs_io', 'read_operations'), 'num'], ['IO写操作', S('fs_io', 'write_operations'), 'num'],
      ['IO读流量', S('fs_io', 'read_kilobytes', 1024), 'bytes'], ['IO写流量', S('fs_io', 'write_kilobytes', 1024), 'bytes']]]
  };
  var CSV_ORDER = ['search', 'merge', 'seg', 'proc', 'fs'];

  function tipPairs(key, n) {
    return GROUPS[key][1].filter(function (r) { return !(r[3] && r[3].csvOnly); }).map(function (r) {
      return [r[0], r[3] && r[3].tip ? r[3].tip(n) : FMT[r[2]](r[1](n))];
    });
  }
  function tagWithTip(key, n) {
    var t = UI.tag(GROUPS[key][0]); t.style.cursor = 'help';
    return UI.tip(t, function () { return UI.kvList(tipPairs(key, n)); });
  }
  function tagRow(keys, n) {
    return h('div', { class: 'row', style: { gap: '4px' } }, keys.map(function (k) { return tagWithTip(k, n); }));
  }
  function usage(text, pctVal) {
    return h('div', { class: 'nodes-usage' }, h('span', { class: 'mono' }, text), UI.progress(pctVal, { width: '100%' }));
  }
  function cacheText(n) {
    return '查询缓存: ' + F.bytes(n.cache_query) + ' | Fielddata: ' + F.bytes(n.cache_fielddata) + ' | 请求缓存: ' + F.bytes(n.cache_request) + ' | 段内存: ' + F.bytes(n.cache_segments);
  }

  // CSV columns that are not part of a tooltip group: [title, getter, format]
  var BASE = [
    ['节点名', function (n) { return n.name; }, 'raw'], ['IP', function (n) { return n.ip; }, 'raw'],
    ['角色', roleText, 'raw'],
    ['CPU负载(5m)', function (n) { return n.load_5m; }, 'raw'], ['运行时间', function (n) { return n.uptime; }, 'ms'],
    ['总文档数', function (n) { return n.docs_count; }, 'raw'], ['段总数', function (n) { return n.segments_count; }, 'raw'],
    ['堆内存使用率', function (n) { return n.heap_percent; }, 'pct'], ['堆内存已用', function (n) { return n.heap_used_in_bytes; }, 'bytes'],
    ['堆内存上限', function (n) { return n.heap_max_in_bytes; }, 'bytes'], ['磁盘使用率', function (n) { return n.disk_percent; }, 'pct'],
    ['已用空间', function (n) { return n.store_size; }, 'bytes'], ['总空间', function (n) { return n.disk_total; }, 'bytes'],
    ['缓存总大小', function (n) { return n.stats_cache_size; }, 'bytes'], ['缓存详情', cacheText, 'raw']
  ];
  function csvColumns() {
    var cols = BASE.map(function (c) { return { title: c[0] + (UNIT[c[2]] || ''), get: c[1] }; });
    CSV_ORDER.forEach(function (k) {
      GROUPS[k][1].forEach(function (r) { cols.push({ title: GROUPS[k][0] + ' - ' + r[0] + (UNIT[r[2]] || ''), get: r[1] }); });
    });
    return cols;
  }

  ESUI.registerPage('nodes', {
    title: '节点',
    mount: function (root, def) {
      var seq = 0, loading = false, clusterName = '';
      var refresh = UI.btn('刷新', { icon: 'refresh', onClick: function () {
        if (loading) return;
        if (!ESUI.state.cluster) return UI.warn('请先选择一个集群');
        load();
      } });
      var exp = UI.btn('导出 CSV', { icon: 'download', onClick: exportCsv });
      def.topActions = [refresh, exp]; // shown at the right of the top strip while this page is open
      var emptyHost = h('div'); // swapped between "no data" and "not connected"

      var table = UI.table({
        fill: true, pageSize: 10, pageSizes: [5, 10, 20, 30, 40], empty: emptyHost,
        columns: [
          { key: 'name', title: '节点名', width: 130, fixed: 'left' },
          { key: 'ip', title: 'IP', width: 120, mono: true },
          { key: 'roles', title: '角色', width: 190, sortValue: function (n) { return n.roles.join(); }, render: function (n) {
            if (!n.rolesKnown) return '-';
            return h('div', { class: 'row', style: { gap: '4px' } }, n.roles.length ? n.roles.map(function (r) { return UI.tag(roleName(r)); }) : UI.tag('协调'));
          } },
          { key: 'load_5m', title: 'CPU负载', tip: '5 分钟平均负载', width: 100, align: 'right', mono: true },
          { key: 'heap_percent', title: '堆内存使用率', width: 170, render: function (n) {
            return usage(F.bytes(n.heap_used_in_bytes) + ' / ' + F.bytes(n.heap_max_in_bytes), n.heap_percent);
          } },
          { key: 'disk_percent', title: '磁盘使用率', width: 170, render: function (n) {
            // the text is the index data size (as in the original) while the bar is disk usage, so the tooltip reconciles the two
            return UI.tip(usage(F.bytes(n.store_size) + ' / ' + F.bytes(n.disk_total), n.disk_percent), UI.kvList([['索引数据', F.bytes(n.store_size)],
              ['磁盘已用', F.bytes(n.disk_total - n.disk_free)], ['可用空间', F.bytes(n.disk_free)], ['总空间', F.bytes(n.disk_total)]]));
          } },
          { key: 'perf', title: '性能指标', width: 160, sortable: false, render: function (n) { return tagRow(['search', 'merge', 'seg'], n); } },
          { key: 'sys', title: '系统指标', width: 120, sortable: false, render: function (n) { return tagRow(['proc', 'fs'], n); } },
          { key: 'stats_cache_size', title: '缓存', width: 110, align: 'right', mono: true, render: function (n) {
            var s = h('span', { style: { cursor: 'help' } }, F.bytes(n.stats_cache_size));
            return UI.tip(s, UI.kvList([['查询缓存', F.bytes(n.cache_query)], ['Fielddata', F.bytes(n.cache_fielddata)],
              ['请求缓存', F.bytes(n.cache_request)], ['段内存', F.bytes(n.cache_segments)]]));
          } },
          { key: 'docs_count', title: '总文档数', width: 110, align: 'right', mono: true, render: function (n) { return F.num(n.docs_count); } },
          { key: 'segments_count', title: '段总数', width: 100, align: 'right', mono: true, render: function (n) { return F.num(n.segments_count); } },
          { key: 'uptime', title: '运行时间', width: 100, align: 'right', render: function (n) { return F.days(n.uptime); } }
        ]
      });
      // heaviest heap first, as the original page does. Set once: the table keeps the sort a user picks across refreshes and cluster switches.
      table.sortBy('heap_percent', 'desc');

      function showEmpty(connected) {
        emptyHost.replaceChildren(connected ? UI.empty('暂无节点数据') : h('div', { class: 'nodes-off' }, UI.empty('未连接集群', '请先选择一个集群'),
          UI.btn('前往集群', { kind: 'primary', onClick: function () { ESUI.go('cluster'); } })));
      }
      // drop whatever is shown (cluster switched / disconnected): old data never stays on screen
      function reset() {
        clusterName = '';
        showEmpty(!!ESUI.state.cluster); // connected: "no data" (a failed first load must not say "not connected")
        table.setRows([]);
      }
      function apply(res) {
        var nodes = isObj(res) ? obj(res.nodes) : {};
        clusterName = isObj(res) && res.cluster_name != null ? String(res.cluster_name) : '';
        showEmpty(true);
        table.setRows(Object.keys(nodes).map(function (id) { return parseNode(nodes[id]); }), { keepPage: true }); // a refresh stays on the page the user is on (reset() already went back to page 1 on a cluster switch)
      }
      // GetNodes. A newer call (refresh, cluster switch) supersedes an older one, whose result is dropped.
      // A failed refresh keeps the rows on screen (as the original does); a failed first load after a switch leaves the table empty.
      function load() {
        var my = ++seq;
        if (!ESUI.state.cluster) { loading = false; refresh.setLoading(false); showEmpty(false); return Promise.resolve(); }
        loading = true;
        refresh.setLoading(true);
        return UI.busy(table, api.es.GetNodes(), '连接中...').then(function (res) {
          if (my === seq) apply(res);
        }).catch(function (e) {
          if (my !== seq) return;
          api.report(e, '获取节点失败：');
          if (api.isNoCluster(e)) { reset(); showEmpty(false); }
        }).then(function () {
          if (my === seq) { loading = false; refresh.setLoading(false); }
        });
      }
      function exportCsv() {
        var rows = table.getView(); // every node in the current sort order, not just the visible page
        if (!rows.length) return UI.warn('没有数据可以导出');
        try {
          var cols = csvColumns();
          UI.exportCsv('es-nodes-' + (clusterName || 'export') + '.csv',
            cols.map(function (c) { return c.title; }),
            rows.map(function (n) { return cols.map(function (c) { return c.get(n); }); }));
          UI.ok('CSV 文件导出成功');
        } catch (e) {
          UI.err('导出失败：' + (e && e.message ? e.message : e));
        }
      }

      root.append(h('div', { class: 'page-body' }, table));
      showEmpty(!!ESUI.state.cluster);
      ESUI.on('cluster', function () { reset(); load(); });
      load(); // the original loads when the component is mounted
    }
  });
})();
