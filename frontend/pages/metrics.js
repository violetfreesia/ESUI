/* 指标 (GET /_cluster/stats, via ESUI.api.es.GetStats).
   The original Core.vue listed the flattened keys of the response in six collapsible tables. This page keeps every key the server
   returns and adds: an identity strip, six sections (节点 内存 索引 文档 分片 存储) drawn with inline bars / stacked bars / range plots,
   and a filterable table of all flattened keys (说明 / 值 / 完整键) at the bottom.
   Loads when the page is mounted while connected and again on every 'cluster' event. Which keys exist depends on the Elasticsearch
   version: the key table lists only what came back, and the sections read every field through at() and show "-" (or a muted
   "no data" line for a whole chart) for a missing one, so a short response never throws. */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;

  /* Descriptions of the flattened keys, from the original Core.vue. Reworded: indices.shards.replication (a ratio, not a count) and
     indices.query_cache.total_count (hits + misses). Added: nodes.discovery_types.single-node. */
  var DESC = {
    '_nodes.failed': '报告中失败的节点数量',
    '_nodes.successful': '报告中成功的节点数量',
    '_nodes.total': '集群中报告的总节点数',
    'cluster_name': '集群名称',
    'cluster_uuid': '集群的唯一标识符',
    'indices.analysis.analyzer_types': '分析器类型列表',
    'indices.analysis.built_in_analyzers': '内置分析器列表',
    'indices.analysis.built_in_char_filters': '内置字符过滤器列表',
    'indices.analysis.built_in_filters': '内置过滤器列表',
    'indices.analysis.built_in_tokenizers': '内置分词器列表',
    'indices.analysis.char_filter_types': '字符过滤器类型列表',
    'indices.analysis.filter_types': '过滤器类型列表',
    'indices.analysis.tokenizer_types': '分词器类型列表',
    'indices.completion.size_in_bytes': '完成建议字段使用的内存大小（字节）',
    'indices.count': '索引总数',
    'indices.docs.count': '文档总数',
    'indices.docs.deleted': '已删除文档的数量',
    'indices.fielddata.evictions': '字段数据缓存驱逐次数',
    'indices.fielddata.memory_size_in_bytes': '字段数据缓存使用的内存大小（字节）',
    'indices.mappings.field_types': '映射字段类型列表',
    'indices.mappings.runtime_field_types': '运行时字段类型列表',
    'indices.mappings.total_deduplicated_field_count': '去重后的字段计数',
    'indices.mappings.total_deduplicated_mapping_size_in_bytes': '去重后的映射大小（字节）',
    'indices.mappings.total_field_count': '字段计数',
    'indices.query_cache.cache_count': '查询缓存条目数',
    'indices.query_cache.cache_size': '查询缓存大小',
    'indices.query_cache.evictions': '查询缓存驱逐次数',
    'indices.query_cache.hit_count': '查询缓存命中次数',
    'indices.query_cache.memory_size_in_bytes': '查询缓存使用的内存大小（字节）',
    'indices.query_cache.miss_count': '查询缓存未命中次数',
    'indices.query_cache.total_count': '查询缓存命中与未命中的总次数',
    'indices.segments.count': '段数',
    'indices.segments.doc_values_memory_in_bytes': '文档值使用的内存大小（字节）',
    'indices.segments.fixed_bit_set_memory_in_bytes': '固定位集使用的内存大小（字节）',
    'indices.segments.index_writer_memory_in_bytes': '索引写入器使用的内存大小（字节）',
    'indices.segments.max_unsafe_auto_id_timestamp': '最大不安全的自动 ID 时间戳',
    'indices.segments.memory_in_bytes': '段使用的内存大小（字节）',
    'indices.segments.norms_memory_in_bytes': '规范化因子使用的内存大小（字节）',
    'indices.segments.points_memory_in_bytes': '点使用的内存大小（字节）',
    'indices.segments.stored_fields_memory_in_bytes': '存储字段使用的内存大小（字节）',
    'indices.segments.term_vectors_memory_in_bytes': '词条向量使用的内存大小（字节）',
    'indices.segments.terms_memory_in_bytes': '词条使用的内存大小（字节）',
    'indices.segments.version_map_memory_in_bytes': '版本映射使用的内存大小（字节）',
    'indices.shards.index.primaries.avg': '主分片平均数量',
    'indices.shards.index.primaries.max': '主分片最大数量',
    'indices.shards.index.primaries.min': '主分片最小数量',
    'indices.shards.index.replication.avg': '副本平均数量',
    'indices.shards.index.replication.max': '副本最大数量',
    'indices.shards.index.replication.min': '副本最小数量',
    'indices.shards.index.shards.avg': '分片平均数量',
    'indices.shards.index.shards.max': '分片最大数量',
    'indices.shards.index.shards.min': '分片最小数量',
    'indices.shards.primaries': '主分片总数',
    'indices.shards.replication': '副本比（副本分片数 / 主分片数）',
    'indices.shards.total': '分片总数',
    'indices.store.reserved_in_bytes': '保留的空间大小（字节）',
    'indices.store.size_in_bytes': '存储大小（字节）',
    'indices.store.total_data_set_size_in_bytes': '总数据集大小（字节）',
    'indices.versions': '索引版本信息',
    'nodes.count.coordinating_only': '仅协调节点的数量',
    'nodes.count.data': '数据节点的数量',
    'nodes.count.data_cold': '冷数据节点的数量',
    'nodes.count.data_content': '数据内容节点的数量',
    'nodes.count.data_frozen': '冻结数据节点的数量',
    'nodes.count.data_hot': '热数据节点的数量',
    'nodes.count.data_warm': '温数据节点的数量',
    'nodes.count.ingest': '摄取节点的数量',
    'nodes.count.master': '主节点的数量',
    'nodes.count.ml': '机器学习节点的数量',
    'nodes.count.remote_cluster_client': '远程集群客户端节点的数量',
    'nodes.count.transform': '转换节点的数量',
    'nodes.count.voting_only': '仅投票节点的数量',
    'nodes.count.total': '节点总数',
    'nodes.discovery_types.multi_node': '多节点发现类型数量',
    'nodes.discovery_types.single-node': '单节点发现类型数量',
    'nodes.fs.available_in_bytes': '可用磁盘空间大小（字节）',
    'nodes.fs.free_in_bytes': '空闲磁盘空间大小（字节）',
    'nodes.fs.total_in_bytes': '总磁盘空间大小（字节）',
    'nodes.indexing_pressure.memory.current.all_in_bytes': '当前所有索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.current.combined_coordinating_and_primary_in_bytes': '当前组合协调和主要索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.current.coordinating_in_bytes': '当前协调索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.current.primary_in_bytes': '当前主要索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.current.replica_in_bytes': '当前副本索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.limit_in_bytes': '索引压力内存限制大小（字节）',
    'nodes.indexing_pressure.memory.total.all_in_bytes': '总计所有索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.total.combined_coordinating_and_primary_in_bytes': '总计组合协调和主要索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.total.coordinating_in_bytes': '总计协调索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.total.coordinating_rejections': '总计协调索引拒绝次数',
    'nodes.indexing_pressure.memory.total.primary_in_bytes': '总计主要索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.total.primary_rejections': '总计主要索引拒绝次数',
    'nodes.indexing_pressure.memory.total.replica_in_bytes': '总计副本索引压力内存大小（字节）',
    'nodes.indexing_pressure.memory.total.replica_rejections': '总计副本索引拒绝次数',
    'nodes.ingest.number_of_pipelines': '摄取管道数量',
    'nodes.jvm.max_uptime_in_millis': 'JVM 上线时间（毫秒）',
    'nodes.jvm.mem.heap_max_in_bytes': '堆内存最大大小（字节）',
    'nodes.jvm.mem.heap_used_in_bytes': '堆内存使用大小（字节）',
    'nodes.jvm.threads': 'JVM 线程数',
    'nodes.jvm.versions': 'JVM 版本信息',
    'nodes.network_types.http_types.netty4': 'HTTP 类型为 Netty 4 的节点数量',
    'nodes.network_types.transport_types.netty4': '传输类型为 Netty 4 的节点数量',
    'nodes.os.allocated_processors': '分配的处理器数量',
    'nodes.os.architectures': '操作系统架构信息',
    'nodes.os.available_processors': '可用处理器数量',
    'nodes.os.mem.adjusted_total_in_bytes': '调整后的总内存大小（字节）',
    'nodes.os.mem.free_in_bytes': '空闲内存大小（字节）',
    'nodes.os.mem.free_percent': '空闲内存百分比',
    'nodes.os.mem.total_in_bytes': '总内存大小（字节）',
    'nodes.os.mem.used_in_bytes': '使用内存大小（字节）',
    'nodes.os.mem.used_percent': '使用内存百分比',
    'nodes.os.names': '操作系统名称',
    'nodes.os.pretty_names': '操作系统友好名称',
    'nodes.packaging_types': '打包类型信息',
    'nodes.plugins': '插件信息',
    'nodes.process.cpu.percent': 'CPU 使用率',
    'nodes.process.open_file_descriptors.avg': '平均打开的文件描述符数量',
    'nodes.process.open_file_descriptors.max': '最大打开的文件描述符数量',
    'nodes.process.open_file_descriptors.min': '最小打开的文件描述符数量',
    'nodes.versions': '节点版本信息',
    'status': '集群健康状态（绿色、黄色、红色）',
    'timestamp': '报告的时间戳'
  };

  /* Groups. The original matched keys by substring, so one key could appear in several tables
     (and cluster_name / cluster_uuid / status / timestamp in none). Here every key has exactly one group;
     the _nodes.* report counters moved from 节点 to the identity strip (集群). */
  var GROUPS = [['cluster', '集群'], ['node', '节点'], ['memory', '内存'], ['indices', '索引'], ['doc', '文档'], ['shard', '分片'], ['store', '存储']];
  var GROUP_LABEL = {};
  GROUPS.forEach(function (g) { GROUP_LABEL[g[0]] = g[1]; });
  function groupOf(k) {
    if (/^(cluster_name|cluster_uuid|status|timestamp)$/.test(k) || k.indexOf('_nodes.') === 0) return 'cluster';
    if (k.indexOf('memory') >= 0 || k === 'indices.completion.size_in_bytes' || /^nodes\.(jvm|os)\.mem\./.test(k)) return 'memory';
    if (k.indexOf('indices.docs.') === 0) return 'doc';
    if (k.indexOf('indices.shards.') === 0) return 'shard';
    if (k.indexOf('indices.store.') === 0 || k.indexOf('nodes.fs.') === 0) return 'store';
    if (k.indexOf('indices.') === 0) return 'indices';
    return 'node';
  }
  /* same rule as the original flattenObject: nested objects are expanded, arrays stay as values */
  function flatten(obj, prefix, out) {
    out = out || {};
    Object.keys(obj).forEach(function (k) {
      var key = prefix ? prefix + '.' + k : k, v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
    });
    return out;
  }

  /* ---------- real data: GET /_cluster/stats ---------- */
  function sum(arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); }
  /* ---------- helpers that tolerate missing fields ---------- */
  var isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var list = function (v) { return Array.isArray(v) ? v : []; };
  /* safe deep read: undefined as soon as one step is missing (different Elasticsearch versions return different fields) */
  function at(o, path) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (o == null || typeof o !== 'object') return undefined;
      o = o[parts[i]];
    }
    return o;
  }
  /* GetStats result -> {raw (nested, as returned), flat (flattened keys, sorted)}. Only keys the server returned appear in flat. */
  function expand(res) {
    var raw = isObj(res) ? res : {}, flat = flatten(raw), sorted = {};
    Object.keys(flat).sort().forEach(function (k) { sorted[k] = flat[k]; });
    return { raw: raw, flat: sorted };
  }
  /* ---------- drawing helpers: CSS bars, stacked bars, SVG range plots, small tables ---------- */
  var DASH = '-', STATUS_KIND = { green: 'ok', yellow: 'warn' };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var pctOf = function (a, b) { return b ? a / b * 100 : 0; };
  // formatters: a missing (or non-numeric) value shows "-"
  var num = function (v) { return isNum(v) ? F.num(v) : DASH; };
  var B = function (v) { return isNum(v) && v >= 0 ? F.bytes(v) : DASH; };
  var str = function (v) { return v == null || v === '' ? DASH : String(v); };

  function section(key, counts, kids) {
    return h('section', { class: 'mt-sec', dataset: { group: key } },
      h('div', { class: 'mt-sec-head' }, h('h2', null, GROUP_LABEL[key]), h('span', { class: 'muted' }, (counts[key] || 0) + ' 项指标')), kids);
  }
  function sub(text, hint) { return h('h3', { class: 'mt-sub' }, text, hint ? h('span', { class: 'muted' }, hint) : null); }
  function kv(pairs) {
    var dl = h('dl', { class: 'mt-kv' });
    pairs.forEach(function (p) {
      if (!p) return;
      dl.appendChild(h('dt', null, p[0]));
      dl.appendChild(h('dd', { class: p[1] && p[1].nodeType ? '' : 'mono' }, p[1]));
    });
    return dl;
  }
  /* muted line shown instead of a chart whose source fields the server did not return */
  function none(text) { return h('p', { class: 'mt-note muted' }, text || '此集群没有返回这项数据'); }
  /* capacity meter: label + value text, then a status-coloured UI.progress (<60 ok, <80 warn, else err) */
  function meter(label, text, pct) {
    return h('div', { class: 'mt-meter' }, h('div', { class: 'mt-meter-h' }, h('span', null, label), h('span', { class: 'mono' }, text)), UI.progress(pct));
  }
  /* meter from used / total bytes (pct is the server's own percentage when it has one); a "-" row when either number is missing */
  function usedMeter(label, used, total, pct) {
    if (!isNum(used) || !isNum(total)) return kv([[label, DASH]]);
    return meter(label, B(used) + ' / ' + B(total), isNum(pct) ? pct : pctOf(used, total));
  }
  /* horizontal bar list: rows = [{label, value, text, title}] */
  function bars(rows, max) {
    rows = rows.filter(function (r) { return isNum(r.value); });
    if (!rows.length) return none();
    max = max || Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    return h('div', { class: 'mt-bars' }, rows.map(function (r) {
      return h('div', { class: 'mt-bar' + (r.value ? '' : ' is-zero') },
        h('span', { class: 'mt-bar-l' + (r.mono ? ' mono' : ''), title: r.title }, r.label),
        h('span', { class: 'mt-bar-t' }, h('i', { style: { width: (r.value ? Math.max(1.5, r.value / max * 100) : 0) + '%' } })),
        h('span', { class: 'mt-bar-v mono' }, r.text != null ? r.text : num(r.value)));
    }));
  }
  /* stacked bar + legend: parts = [{label, value, text}]. Neutral ramp (.mt-c0 ... .mt-c5), composition is not a status.
     Parts without a numeric value are left out; when none is left a "no data" line is returned. */
  function stack(parts) {
    parts = parts.filter(function (p) { return isNum(p.value) && p.value >= 0; });
    if (!parts.length) return none();
    var total = sum(parts, function (p) { return p.value; }) || 1;
    var bar = h('div', { class: 'mt-stack' }, parts.map(function (p, i) {
      return p.value > 0 ? h('i', { class: 'mt-c' + Math.min(i, 5), style: { width: p.value / total * 100 + '%' }, title: p.label + ' ' + (p.text || num(p.value)) }) : null;
    }));
    var legend = h('ul', { class: 'mt-legend' }, parts.map(function (p, i) {
      return h('li', null, h('i', { class: 'mt-c' + Math.min(i, 5) }), h('span', null, p.label), h('b', { class: 'mono' }, p.text || num(p.value)),
        h('span', { class: 'muted mono' }, r1(p.value / total * 100) + '%'));
    }));
    return h('div', { class: 'mt-stackbox' }, bar, legend);
  }
  /* min / avg / max plot on an inline SVG (shapes only; the numbers are HTML text beside it). null when r lacks a number. */
  function range(label, r) {
    if (!isObj(r) || !isNum(r.min) || !isNum(r.max) || !isNum(r.avg)) return null;
    var hi = Math.max(1, r.max * 1.1), sc = function (v) { return Math.max(0, Math.min(100, v / hi * 100)); };
    var svg = '<svg class="mt-range-svg" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">' +
      '<line class="ax" x1="0" y1="7" x2="100" y2="7"/>' +
      '<rect class="band" x="' + sc(r.min) + '" y="3" width="' + Math.max(0.8, sc(r.max) - sc(r.min)) + '" height="8"/>' +
      '<line class="avg" x1="' + sc(r.avg) + '" y1="0" x2="' + sc(r.avg) + '" y2="14"/></svg>';
    return h('div', { class: 'mt-range' }, h('span', { class: 'mt-range-l' }, label), h('div', { class: 'mt-range-p', html: svg }),
      h('span', { class: 'mt-range-v mono' }, '最小 ' + r2(r.min) + ' / 平均 ' + r2(r.avg) + ' / 最大 ' + r2(r.max)));
  }
  function miniTable(heads, rows) {
    return h('table', { class: 'mt-tbl' },
      h('thead', null, h('tr', null, heads.map(function (t, i) { return h('th', { class: i ? 'num' : '' }, t); }))),
      h('tbody', null, rows.map(function (r) { return h('tr', null, r.map(function (cell, i) { return h('td', { class: i ? 'num mono' : '' }, cell); })); })));
  }
  /* collapsible name list for the analysis components: items = [{name, count, index_count}] */
  function details(title, items) {
    items = list(items).filter(function (x) { return isObj(x) && x.name != null; });
    return h('details', { class: 'mt-det' },
      h('summary', null, h('span', null, title), h('span', { class: 'muted' }, items.length + ' 项')),
      items.length ? h('div', { class: 'mt-items' }, items.map(function (x) {
        return h('span', { class: 'mt-item mono', title: '使用 ' + num(x.count) + ' 次，涉及 ' + num(x.index_count) + ' 个索引' }, String(x.name),
          isNum(x.count) ? h('em', null, '×' + x.count) : null);
      })) : h('div', { class: 'muted mt-none' }, '无'));
  }
  function rejTag(v) { return !isNum(v) ? DASH : v > 0 ? UI.tag(num(v), 'err', { mono: true }) : h('span', { class: 'muted' }, '0'); }

  /* ---------- the six sections ---------- */
  var ROLE_ORDER = ['master', 'data', 'data_content', 'data_hot', 'data_warm', 'data_cold', 'data_frozen', 'ingest', 'ml', 'remote_cluster_client', 'transform', 'voting_only', 'coordinating_only'];
  var ROLE_ZH = { master: '主节点', data: '数据节点', data_content: '数据内容', data_hot: '热数据', data_warm: '温数据', data_cold: '冷数据', data_frozen: '冻结数据',
    ingest: '摄取', ml: '机器学习', remote_cluster_client: '远程集群客户端', transform: '转换', voting_only: '仅投票', coordinating_only: '仅协调' };
  /* "name × count" for a list of {<key>, count} objects, "prefix key × value" for a {key: value} object; missing parts are skipped */
  var times = function (items, key) {
    return list(items).filter(function (x) { return isObj(x) && x[key] != null; }).map(function (x) { return x[key] + (x.count == null ? '' : ' × ' + x.count); }).join('、');
  };
  var pairs = function (o, prefix) { o = isObj(o) ? o : {}; return Object.keys(o).map(function (k) { return prefix + k + ' × ' + o[k]; }); };

  function secNode(s, counts) {
    var cnt = isObj(at(s, 'nodes.count')) ? s.nodes.count : {}, total = cnt.total, os = at(s, 'nodes.os'), jv = list(at(s, 'nodes.jvm.versions'))[0];
    var fd = at(s, 'nodes.process.open_file_descriptors'), cpu = at(s, 'nodes.process.cpu.percent'), plugins = at(s, 'nodes.plugins');
    var order = ROLE_ORDER.concat(Object.keys(cnt).filter(function (k) { return k !== 'total' && ROLE_ORDER.indexOf(k) < 0 && isNum(cnt[k]); }));
    var roleZh = function (k) { return ROLE_ZH[k] || k; };
    var used = order.filter(function (k) { return cnt[k] > 0; }), idle = order.filter(function (k) { return isNum(cnt[k]) && !(cnt[k] > 0); });
    var netText = pairs(at(s, 'nodes.network_types.http_types'), 'HTTP ').concat(pairs(at(s, 'nodes.network_types.transport_types'), '传输 ')).join('、');
    var pack = list(at(s, 'nodes.packaging_types')).filter(isObj).map(function (x) {
      return [x.flavor, x.type].filter(Boolean).join(' / ') + (x.count == null ? '' : ' × ' + x.count);
    }).join('、');
    var disc = pairs(at(s, 'nodes.discovery_types'), '').join('、');
    var jvmText = isObj(jv) ? [jv.version, jv.vm_name].filter(Boolean).join(' ') + (jv.using_bundled_jdk ? '（内置 JDK）' : '') + (jv.count == null ? '' : ' × ' + jv.count) : '';
    var cpuNum = at(os, 'allocated_processors'), cpuAvail = at(os, 'available_processors');
    return section('node', counts, [
      sub('节点角色', (isNum(total) ? '共 ' + total + ' 个节点，' : '') + '一个节点可兼任多个角色'),
      bars(used.map(function (k) { return { label: roleZh(k), title: 'nodes.count.' + k, value: cnt[k], text: cnt[k] + (isNum(total) ? ' / ' + total : '') }; }), isNum(total) ? total : 0),
      idle.length ? h('p', { class: 'mt-note muted' }, '数量为 0：' + idle.map(roleZh).join('、')) : null,
      sub('运行环境'),
      kv([
        ['节点版本', str(list(at(s, 'nodes.versions')).join('、'))],
        ['操作系统', str(times(at(os, 'pretty_names'), 'pretty_name') || times(at(os, 'names'), 'name'))],
        ['系统架构', str(times(at(os, 'architectures'), 'arch'))],
        ['处理器', isNum(cpuNum) || isNum(cpuAvail) ? num(cpuNum) + ' 已分配 / ' + num(cpuAvail) + ' 可用' : DASH],
        ['JVM', str(jvmText)],
        ['JVM 线程数', num(at(s, 'nodes.jvm.threads'))],
        ['JVM 最长运行', isNum(at(s, 'nodes.jvm.max_uptime_in_millis')) ? F.millis(s.nodes.jvm.max_uptime_in_millis) : DASH],
        ['进程 CPU', isNum(cpu) ? UI.progress(cpu, { width: '180px' }) : DASH],
        ['文件描述符', isObj(fd) ? '最小 ' + num(fd.min) + ' / 平均 ' + num(fd.avg) + ' / 最大 ' + num(fd.max) : DASH],
        ['网络类型', str(netText)],
        ['打包类型', str(pack)],
        ['发现类型', str(disc)],
        ['摄取管道', num(at(s, 'nodes.ingest.number_of_pipelines'))],
        ['插件', !Array.isArray(plugins) ? DASH : plugins.length ? h('span', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } }, plugins.filter(isObj).map(function (p) {
          return UI.tag(str(p.name) + (p.version ? ' ' + p.version : ''), null, { mono: true });
        })) : '无']
      ])
    ]);
  }

  function secMemory(s, counts) {
    var jm = at(s, 'nodes.jvm.mem'), om = at(s, 'nodes.os.mem'), sg = at(s, 'indices.segments'), ip = at(s, 'nodes.indexing_pressure.memory');
    var cur = at(ip, 'current'), tot = at(ip, 'total'), fd = at(s, 'indices.fielddata'), qc = at(s, 'indices.query_cache');
    var parts = [['词项', at(sg, 'terms_memory_in_bytes')], ['文档值', at(sg, 'doc_values_memory_in_bytes')], ['存储字段', at(sg, 'stored_fields_memory_in_bytes')],
      ['点', at(sg, 'points_memory_in_bytes')], ['规范化因子', at(sg, 'norms_memory_in_bytes')], ['词条向量', at(sg, 'term_vectors_memory_in_bytes')]]
      .map(function (p) { return { label: p[0], value: p[1], text: B(p[1]) }; })
      .filter(function (p) { return isNum(p.value); })
      .sort(function (a, b) { return b.value - a.value; });
    var press = [['协调', at(cur, 'coordinating_in_bytes'), at(tot, 'coordinating_in_bytes'), at(tot, 'coordinating_rejections')],
      ['主分片', at(cur, 'primary_in_bytes'), at(tot, 'primary_in_bytes'), at(tot, 'primary_rejections')],
      ['副本', at(cur, 'replica_in_bytes'), at(tot, 'replica_in_bytes'), at(tot, 'replica_rejections')],
      ['协调 + 主分片', at(cur, 'combined_coordinating_and_primary_in_bytes'), at(tot, 'combined_coordinating_and_primary_in_bytes'), null],
      ['合计', at(cur, 'all_in_bytes'), at(tot, 'all_in_bytes'), null]];
    var free = at(om, 'free_in_bytes'), freePct = at(om, 'free_percent');
    var freeText = !isNum(free) ? DASH : B(free) + (isNum(freePct) ? '（' + freePct + '%）' : '');
    var limit = at(ip, 'limit_in_bytes');
    return section('memory', counts, [
      sub('JVM 与系统内存'),
      usedMeter('JVM 堆', at(jm, 'heap_used_in_bytes'), at(jm, 'heap_max_in_bytes')),
      usedMeter('系统内存', at(om, 'used_in_bytes'), at(om, 'total_in_bytes'), at(om, 'used_percent')),
      kv([['调整后总内存', B(at(om, 'adjusted_total_in_bytes'))], ['空闲内存', freeText]]),
      sub('段内存', isNum(at(sg, 'memory_in_bytes')) ? '合计 ' + B(sg.memory_in_bytes) : null),
      stack(parts),
      kv([['索引写入器', B(at(sg, 'index_writer_memory_in_bytes'))], ['版本映射', B(at(sg, 'version_map_memory_in_bytes'))], ['固定位集', B(at(sg, 'fixed_bit_set_memory_in_bytes'))]]),
      sub('缓存'),
      miniTable(['缓存', '内存', '驱逐次数'], [['Fielddata', B(at(fd, 'memory_size_in_bytes')), num(at(fd, 'evictions'))],
        ['查询缓存', B(at(qc, 'memory_size_in_bytes')), num(at(qc, 'evictions'))], ['补全建议', B(at(s, 'indices.completion.size_in_bytes')), DASH]]),
      sub('索引压力', isNum(limit) ? '内存上限 ' + B(limit) : null),
      isObj(ip) ? [
        usedMeter('当前占用 / 上限', at(cur, 'all_in_bytes'), limit),
        miniTable(['来源', '当前', '累计', '拒绝次数'], press.map(function (r) { return [r[0], B(r[1]), B(r[2]), rejTag(r[3])]; }))
      ] : none('此集群没有返回索引压力统计')
    ]);
  }

  var ANALYSIS_ZH = [['分析器类型', 'analyzer_types'], ['分词器类型', 'tokenizer_types'], ['过滤器类型', 'filter_types'], ['字符过滤器类型', 'char_filter_types'],
    ['内置分析器', 'built_in_analyzers'], ['内置分词器', 'built_in_tokenizers'], ['内置过滤器', 'built_in_filters'], ['内置字符过滤器', 'built_in_char_filters']];

  function secIndices(s, counts) {
    var ix = at(s, 'indices'), qc = at(ix, 'query_cache'), mp = at(ix, 'mappings'), rtf = at(mp, 'runtime_field_types');
    var hit = at(qc, 'hit_count'), miss = at(qc, 'miss_count'), total = at(qc, 'total_count');
    var types = list(at(mp, 'field_types')).filter(isObj), versions = list(at(ix, 'versions')).filter(isObj);
    return section('indices', counts, [
      kv([['索引总数', num(at(ix, 'count'))], ['段数', num(at(ix, 'segments.count'))], ['字段总数', num(at(mp, 'total_field_count'))],
        ['去重字段数', num(at(mp, 'total_deduplicated_field_count'))], ['去重映射大小', B(at(mp, 'total_deduplicated_mapping_size_in_bytes'))]]),
      sub('查询缓存命中', isNum(total) ? '共访问 ' + num(total) + ' 次' : null),
      stack([{ label: '命中', value: hit, text: num(hit) }, { label: '未命中', value: miss, text: num(miss) }]),
      kv([['当前条目数', num(at(qc, 'cache_size'))], ['累计写入条目', num(at(qc, 'cache_count'))], ['驱逐次数', num(at(qc, 'evictions'))]]),
      sub('字段类型', '字段数量及涉及的索引数'),
      bars(types.map(function (x) {
        return { label: str(x.name), mono: true, value: x.count, text: num(x.count) + ' / ' + num(x.index_count) + ' 个索引', title: str(x.name) };
      })),
      !Array.isArray(rtf) ? null : rtf.length ? kv([['运行时字段', str(times(rtf, 'name'))]]) : none('没有运行时字段'),
      sub('索引版本'),
      versions.length ? miniTable(['版本', '索引数', '主分片数', '主分片大小'], versions.map(function (v) {
        return [str(v.version), num(v.index_count), num(v.primary_shard_count), B(v.total_primary_bytes)];
      })) : none(),
      isObj(at(ix, 'analysis')) ? [sub('分析组件', '点击展开名称列表'),
        h('div', { class: 'mt-dets' }, ANALYSIS_ZH.map(function (a) { return details(a[0], ix.analysis[a[1]]); }))] : null
    ]);
  }

  function secDoc(s, counts) {
    var cnt = at(s, 'indices.docs.count'), del = at(s, 'indices.docs.deleted'), size = at(s, 'indices.store.size_in_bytes'), rep = at(s, 'indices.shards.replication');
    var avg = isNum(cnt) && cnt > 0 && isNum(size) && isNum(rep) ? size / (1 + rep) / cnt : null;
    return section('doc', counts, [
      stack([{ label: '有效文档', value: cnt, text: num(cnt) }, { label: '已删除', value: del, text: num(del) }]),
      kv([['文档总数', num(cnt)], ['已删除文档', num(del)],
        ['已删除占比', isNum(cnt) && isNum(del) ? r1(pctOf(del, cnt + del)) + '%' : DASH], ['平均文档大小', avg == null ? DASH : B(avg)]]),
      h('p', { class: 'mt-note muted' }, '平均文档大小为估算值：存储大小 ÷ (1 + 副本比) ÷ 文档总数。已删除文档在段合并后释放。')
    ]);
  }

  function secShard(s, counts) {
    var sh = at(s, 'indices.shards'), pri = at(sh, 'primaries'), total = at(sh, 'total'), ix = at(sh, 'index');
    var rep = isNum(total) && isNum(pri) ? total - pri : null;
    var plots = [range('分片数', at(ix, 'shards')), range('主分片数', at(ix, 'primaries')), range('副本数', at(ix, 'replication'))].filter(Boolean);
    return section('shard', counts, [
      stack([{ label: '主分片', value: pri, text: num(pri) }, { label: '副本分片', value: rep, text: num(rep) }]),
      kv([['分片总数', num(total)], ['主分片', num(pri)], ['副本比', num(at(sh, 'replication'))]]),
      sub('每个索引的分布', '细线为平均值，色带为最小到最大'),
      plots.length ? plots : none()
    ]);
  }

  function secStore(s, counts) {
    var fs = at(s, 'nodes.fs'), st = at(s, 'indices.store');
    var total = at(fs, 'total_in_bytes'), free = at(fs, 'free_in_bytes'), avail = at(fs, 'available_in_bytes'), size = at(st, 'size_in_bytes');
    var used = isNum(total) && isNum(avail) ? total - avail : null;
    var other = isNum(total) && isNum(free) && isNum(size) ? Math.max(0, total - free - size) : null, reserved = isNum(free) && isNum(avail) ? free - avail : null;
    return section('store', counts, [
      usedMeter('磁盘使用率', used, total),
      [size, other, reserved, avail].every(isNum) ? stack([{ label: '索引数据', value: size, text: B(size) }, { label: '其他已用', value: other, text: B(other) },
        { label: '系统保留', value: reserved, text: B(reserved) }, { label: '可用', value: avail, text: B(avail) }]) : none(),
      kv([['磁盘总量', B(total)], ['空闲空间', B(free)], ['可用空间', B(avail)],
        ['索引存储大小', B(size)], ['总数据集大小', B(at(st, 'total_data_set_size_in_bytes'))], ['保留空间', B(at(st, 'reserved_in_bytes'))]])
    ]);
  }

  /* ---------- the full key table: every flattened key with 说明 / 值 / 完整键 / 分组 ---------- */
  var BYTE_KEY = /_in_bytes$/, MS_KEY = /_in_millis$/, TS_KEY = /timestamp$/, PCT_KEY = /percent$/;

  function toRows(flat) {
    return Object.keys(flat).map(function (k) {
      var g = groupOf(k);
      return { key: k, label: DESC[k] || '暂无说明', group: g, groupLabel: GROUP_LABEL[g], value: flat[k] };
    });
  }
  function showJson(row) {
    var text = JSON.stringify(row.value, null, 2), m = UI.modal({
      title: row.key, width: '640px',
      body: UI.jsonView(text, { maxHeight: '60vh' }),
      footer: [UI.btn('复制', { icon: 'copy', onClick: function () { UI.copy(text); } }), UI.btn('关闭', { kind: 'ghost', onClick: function () { m.close(); } })]
    });
  }
  /* arrays stay as values (like the original); short ones inline, long ones truncated with a link to the full JSON */
  function arrayCell(row) {
    var v = row.value;
    if (!v.length) return h('span', { class: 'muted' }, '空');
    var text = JSON.stringify(v), short = text.length <= 48;
    var box = h('span', { class: 'mt-arr' }, h('span', { class: 'mt-arr-t mono' }, short ? text : text.slice(0, 48) + '...'));
    if (!short) box.appendChild(h('span', { class: 'cell-link', onclick: function () { showJson(row); } }, '查看全部 ' + v.length + ' 项'));
    return box;
  }
  /* number cells show the raw value like the original, plus a readable form for bytes / millis / timestamps */
  function valueCell(row) {
    var k = row.key, v = row.value, hint = '';
    if (v == null) return h('span', { class: 'muted' }, '-');
    if (Array.isArray(v)) return arrayCell(row);
    if (typeof v === 'number') {
      if (BYTE_KEY.test(k) && v >= 0) hint = B(v);
      else if (MS_KEY.test(k)) hint = F.millis(v);
      else if (TS_KEY.test(k) && v > 0) hint = F.date(v);
      return h('span', { class: 'mt-val mono' }, PCT_KEY.test(k) ? v + '%' : num(v), hint ? h('span', { class: 'muted' }, hint) : null);
    }
    return h('span', { class: 'mt-val mono' }, String(v));
  }
  function valueSort(r) { return typeof r.value === 'number' ? r.value : Array.isArray(r.value) ? r.value.length : r.value == null ? null : String(r.value); }

  function buildTable() {
    var table = UI.table({
      pageSize: 20, pageSizes: [20, 50, 100, 200], resizable: true,
      columns: [
        { key: 'label', title: '指标', width: 270 },
        { key: 'value', title: '值', width: 300, sortValue: valueSort, render: valueCell },
        { key: 'key', title: '完整键', width: 400, mono: true },
        { key: 'groupLabel', title: '分组', width: 80 }
      ]
    });
    var search = UI.input({ placeholder: '搜索说明或完整键', icon: 'search', clearable: true, width: '240px', onInput: apply });
    var groupSel = UI.select([{ value: '', label: '全部分组' }].concat(GROUPS.map(function (g) { return { value: g[0], label: g[1] }; })), { width: '110px', onChange: apply });
    function apply() {
      var q = search.value.trim().toLowerCase(), g = groupSel.value;
      table.setFilter(function (r) {
        return (!g || r.group === g) && (!q || r.key.toLowerCase().indexOf(q) >= 0 || r.label.toLowerCase().indexOf(q) >= 0);
      });
    }
    var bar = h('div', { class: 'mt-tbl-head' }, h('h2', null, '全部指标'), h('span', { class: 'muted mono' }, 'GET /_cluster/stats'), UI.spacer(), groupSel, search);
    return { bar: bar, table: table };
  }
  /* ---------- identity strip: cluster_name / cluster_uuid / status / timestamp / _nodes.* ---------- */
  function idItem(label, val) { return h('div', { class: 'mt-id-i' }, h('span', { class: 'mt-id-l' }, label), val); }
  function identity(s) {
    var uuid = s.cluster_uuid, ok = at(s, '_nodes.successful'), tot = at(s, '_nodes.total'), failed = at(s, '_nodes.failed');
    return h('section', { class: 'mt-id', dataset: { group: 'cluster' } },
      idItem('集群', s.cluster_name == null ? DASH : h('strong', { class: 'mono' }, String(s.cluster_name))),
      idItem('集群 UUID', uuid == null ? DASH : h('span', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'mono' }, String(uuid)),
        UI.btn('', { icon: 'copy', size: 'sm', kind: 'ghost', title: '复制 UUID', onClick: function () { UI.copy(String(uuid)); } }))),
      idItem('状态', s.status == null ? DASH : UI.tag(String(s.status), STATUS_KIND[s.status] || 'err', { dot: true })),
      idItem('报告节点', isNum(ok) && isNum(tot) ? h('span', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'mono' }, ok + ' / ' + tot + ' 成功'),
        isNum(failed) && failed > 0 ? UI.tag(failed + ' 失败', 'err') : null) : DASH),
      idItem('采集时间', isNum(s.timestamp) ? h('span', { class: 'mono' }, F.date(s.timestamp)) : DASH));
  }

  ESUI.registerPage('metrics', {
    title: '指标',
    mount: function (root, def) {
      var seq = 0, loading = false, hasData = false;
      var refresh = UI.btn('刷新', { icon: 'refresh', onClick: function () {
        if (loading) return;
        if (!ESUI.state.cluster) return UI.warn('请先选择一个集群');
        load(true);
      } });
      def.topActions = [refresh]; // shown at the right of the top strip while this page is open
      var idBox = h('div'), grid = h('div', { class: 'mt-grid' });
      var tb = buildTable();
      var main = h('div', { class: 'mt-main' }, idBox, grid, h('section', { class: 'mt-all' }, tb.bar, tb.table));
      var empty = h('div', { class: 'mt-empty' });
      /* the loading mask goes on a non-scrolling wrapper: UI.spin adds .spin-host (position: relative), which must not land on
         the .page root (absolute) or on the scrolling .page-body (the mask would scroll away with the content) */
      var host = h('div', { class: 'mt-host' }, h('div', { class: 'page-body' }, main, empty));

      // what the page shows: 'data' = the sections and the key table; 'off' = not connected; 'failed' = connected but nothing loaded; 'blank' = waiting for the first answer
      function view(kind) {
        main.hidden = kind !== 'data';
        empty.hidden = kind === 'data';
        if (kind === 'off') empty.replaceChildren(UI.empty('未连接集群', '请先选择一个集群'), UI.btn('前往集群', { kind: 'primary', onClick: function () { ESUI.go('cluster'); } }));
        else if (kind === 'failed') empty.replaceChildren(UI.empty('暂无指标数据', '获取集群统计失败，可以点右上角的刷新重试'));
        else if (kind === 'blank') empty.replaceChildren();
      }
      // drop whatever is shown (cluster switched / disconnected): old data never stays on screen
      function reset() {
        hasData = false;
        idBox.replaceChildren();
        grid.replaceChildren();
        tb.table.setRows([]);
      }
      // GetStats result -> sections + key table. Only the keys the server returned are listed; the sections show "-" for the rest.
      function apply(res, c) {
        var st = expand(res), counts = {};
        Object.keys(st.flat).forEach(function (k) { var g = groupOf(k); counts[g] = (counts[g] || 0) + 1; });
        idBox.replaceChildren(identity(st.raw));
        grid.replaceChildren(secNode(st.raw, counts), secMemory(st.raw, counts), secIndices(st.raw, counts),
          secDoc(st.raw, counts), secShard(st.raw, counts), secStore(st.raw, counts));
        tb.table.setRows(toRows(st.flat), { keepPage: true }); // a refresh keeps the page; reset() already went back to page 1 on a cluster switch
        hasData = true;
        view('data');
      }
      // GetStats. A newer call (refresh, cluster switch) supersedes an older one, whose result is dropped.
      // A failed refresh keeps what is on screen (as the original does); a failed first load leaves a "failed" notice.
      // manual = started by the refresh button (shows the "已刷新" toast)
      function load(manual) {
        var my = ++seq, c = ESUI.state.cluster;
        if (!c) { loading = false; refresh.setLoading(false); reset(); view('off'); return Promise.resolve(); }
        loading = true;
        refresh.setLoading(true);
        return UI.busy(host, api.es.GetStats(), '正在获取集群统计...').then(function (res) {
          if (my !== seq) return;
          apply(res, c);
          if (manual) UI.ok('指标已刷新');
        }).catch(function (e) {
          if (my !== seq) return;
          api.report(e, '获取指标失败：');
          if (api.isNoCluster(e)) { reset(); view('off'); } else if (!hasData) view('failed');
        }).then(function () {
          if (my === seq) { loading = false; refresh.setLoading(false); }
        });
      }

      root.append(host);
      reset();
      view(ESUI.state.cluster ? 'blank' : 'off');
      ESUI.on('cluster', function (c) { reset(); view(c ? 'blank' : 'off'); load(false); });
      load(false); // the original loads when the component is mounted
    }
  });
})();
