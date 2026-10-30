/* docs 页辅助：查询构建 / mapping 展开 / CSV 解析 / 导入解析（纯函数，复刻 .legacy/src/utils/docQuery.js 的语义）。
   只定义函数并挂到 ESUI.lib.docs，不调用 registerPage。 */
(function () {
  'use strict';
  var L = (ESUI.lib = ESUI.lib || {});
  var D = (L.docs = L.docs || {});

  D.FILTER_OPS = ['is', 'isNot', 'isOneOf', 'between', 'exists', 'notExists'];
  D.OP_LABEL = { is: '是', isNot: '不是', isOneOf: '是其中之一', between: '介于', exists: '存在', notExists: '不存在' };
  D.DATE_TYPES = ['date', 'date_nanos'];
  var NEG = ['isNot', 'notExists'];

  D.isNegativeOp = function (op) { return NEG.indexOf(op) >= 0; };
  function has(v) { return v !== undefined && v !== null && String(v) !== ''; }
  D.hasValue = has;

  D.isValidJson = function (text) {
    try { JSON.parse(text); return true; } catch (e) { return false; }
  };
  D.isPlainObject = function (o) { return !!o && typeof o === 'object' && !Array.isArray(o); };

  /* 展开 mapping 为 [{name,type,multi}]：嵌套字段点号连接；multi-field 标记 multi:true；nested 整棵跳过。 */
  D.flattenMappings = function (res) {
    var fields = {}, order = [];
    function put(path, type, multi) {
      if (Object.prototype.hasOwnProperty.call(fields, path)) return;
      fields[path] = { type: type, multi: multi };
      order.push(path);
    }
    function walk(props, prefix) {
      Object.keys(props || {}).forEach(function (name) {
        var def = props[name];
        if (!def || typeof def !== 'object' || def.type === 'nested') return;
        var path = prefix ? prefix + '.' + name : name;
        if (def.type && def.type !== 'object') {
          put(path, def.type, false);
          Object.keys(def.fields || {}).forEach(function (sub) {
            var sd = def.fields[sub];
            if (sd && sd.type) put(path + '.' + sub, sd.type, true);
          });
        }
        if (def.properties) walk(def.properties, path);
      });
    }
    Object.keys(res || {}).forEach(function (k) {
      var m = res[k] && res[k].mappings;
      if (!m || typeof m !== 'object') return;
      if (m.properties) walk(m.properties, '');
      else Object.keys(m).forEach(function (t) { if (m[t] && m[t].properties) walk(m[t].properties, ''); });
    });
    return order.map(function (p) { return { name: p, type: fields[p].type, multi: fields[p].multi }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  };

  /* 过滤条件是否填写完整；不完整的条件不参与查询，保存按钮也据此禁用 */
  D.isFilterValid = function (f) {
    if (!f || !f.field) return false;
    switch (f.op) {
      case 'is': case 'isNot': return has(f.value);
      case 'isOneOf': return Array.isArray(f.values) && f.values.length > 0;
      case 'between': return has(f.value) || has(f.value2);
      case 'exists': case 'notExists': return true;
      default: return false;
    }
  };

  /* 过滤标签上的值部分；exists / notExists 没有值 */
  D.filterValueText = function (f) {
    switch (f.op) {
      case 'is': case 'isNot': return String(f.value);
      case 'isOneOf': return (f.values || []).join(', ');
      case 'between': return (f.value == null ? '' : f.value) + ' ~ ' + (f.value2 == null ? '' : f.value2);
      default: return '';
    }
  };
  D.filterLabel = function (f) {
    return [f.field, D.OP_LABEL[f.op], D.filterValueText(f)].filter(Boolean).join(' ');
  };

  function phrase(field, value) { var m = {}; m[field] = value; return { match_phrase: m }; }
  function filterClause(f) {
    switch (f.op) {
      case 'is': case 'isNot': return phrase(f.field, f.value);
      case 'isOneOf': return { bool: { should: f.values.map(function (v) { return phrase(f.field, v); }), minimum_should_match: 1 } };
      case 'between': {
        var range = {}, r = {};
        if (has(f.value)) range.gte = f.value;
        if (has(f.value2)) range.lte = f.value2;
        r[f.field] = range;
        return { range: r };
      }
      default: return { exists: { field: f.field } };
    }
  }

  /* 拼出查询子句 JSON 字符串；没有任何有效条件返回空串（按 match_all 处理）。timeRange = [起毫秒, 止毫秒] */
  D.buildQuery = function (o) {
    var must = [], filter = [], mustNot = [];
    var qs = (o.queryString || '').trim();
    if (qs) must.push({ query_string: { query: qs, default_operator: 'AND', analyze_wildcard: true } });
    (o.filters || []).forEach(function (f) {
      if (!D.isFilterValid(f)) return;
      (D.isNegativeOp(f.op) ? mustNot : filter).push(filterClause(f));
    });
    if (o.timeField && Array.isArray(o.timeRange) && o.timeRange.length === 2) {
      var tr = {};
      tr[o.timeField] = { gte: o.timeRange[0], lte: o.timeRange[1], format: 'epoch_millis' };
      filter.push({ range: tr });
    }
    var bool = {};
    if (must.length) bool.must = must;
    if (filter.length) bool.filter = filter;
    if (mustNot.length) bool.must_not = mustNot;
    return Object.keys(bool).length ? JSON.stringify({ bool: bool }) : '';
  };

  /* 有时间字段时按它倒序：包成 {query, sort} */
  D.withTimeSort = function (query, timeField) {
    if (!timeField) return query;
    var s = {}, o = {};
    s[timeField] = { order: 'desc', unmapped_type: 'date' };
    o.query = query ? JSON.parse(query) : { match_all: {} };
    o.sort = [s];
    return JSON.stringify(o);
  };

  /* 复刻 es.go SearchDocs 对 query 参数的解包：空串 = match_all；{query, sort} 取出 query 和 sort；
     其他对象整体当作查询子句。返回 {query, sort}（sort 缺省为 null）。非法 JSON 抛错（后端也会拒绝）。 */
  D.parseBody = function (text) {
    var t = String(text || '').trim();
    if (!t) return { query: { match_all: {} }, sort: null };
    var o = JSON.parse(t);
    if (D.isPlainObject(o)) {
      if (Object.prototype.hasOwnProperty.call(o, 'query')) return { query: o.query, sort: o.sort === undefined ? null : o.sort };
      return { query: o, sort: null };
    }
    return { query: undefined, sort: null };
  };
  /* ---- 取值：点号路径，路径中遇到数组时对每个元素分别取值 ---- */
  function getByPath(value, parts) {
    if (parts.length === 0) return value;
    if (Array.isArray(value)) {
      var vals = value.map(function (v) { return getByPath(v, parts); }).filter(function (v) { return v !== undefined; });
      return vals.length > 0 ? vals : undefined;
    }
    if (value === null || typeof value !== 'object') return undefined;
    return getByPath(value[parts[0]], parts.slice(1));
  }
  D.readField = function (source, name) {
    if (!source) return undefined;
    return Object.prototype.hasOwnProperty.call(source, name) ? source[name] : getByPath(source, name.split('.'));
  };
  /* 单元格文本：空值为空串，对象 / 数组为 JSON 文本 */
  D.cellText = function (v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  /* 一页文档 _source 的顶层字段，按出现次数降序 */
  D.topKeys = function (docs, limit) {
    var cnt = {};
    docs.forEach(function (d) { Object.keys(d._source || {}).forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; }); });
    var keys = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b); });
    return limit ? keys.slice(0, limit) : keys;
  };

  /* ---- CSV：支持双引号转义（引号内可含逗号 / 换行），首行为表头，值全部为字符串 ---- */
  D.parseCsv = function (text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (v) { return v !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (v) { return v !== ''; })) rows.push(row);
    return rows;
  };
  D.csvToDocs = function (text) {
    var rows = D.parseCsv(String(text).trim());
    if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
    var headers = rows[0].map(function (x) { return x.trim(); });
    return rows.slice(1).map(function (r) {
      var doc = {};
      headers.forEach(function (hd, i) { if (hd !== '') doc[hd] = r[i] === undefined ? '' : r[i]; });
      return doc;
    });
  };

  /* 导入文本解析。返回 {docs, error, notArray}；空文本 docs 为空且无错误 */
  D.parseImport = function (format, raw) {
    var text = String(raw || '').trim();
    if (!text) return { docs: [], error: '', notArray: false };
    if (format === 'csv') {
      try { return { docs: D.csvToDocs(text), error: '', notArray: false }; } catch (e) { return { docs: [], error: e.message, notArray: false }; }
    }
    try {
      var parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return { docs: [], error: '文档数据必须是JSON数组', notArray: true };
      return { docs: parsed, error: '', notArray: false };
    } catch (e) { return { docs: [], error: e.message, notArray: false }; }
  };

  D.sample = function (format) {
    if (format === 'csv') {
      return 'title,category,views,publish_date\nElasticsearch Guide,database,1500,2026-01-15\nNaive UI Tutorial,frontend,820,2026-02-20\nGo Wails Desktop App,golang,2300,2026-03-01';
    }
    return JSON.stringify([
      { title: 'Elasticsearch Guide', category: 'database', views: 1500, publish_date: '2026-01-15' },
      { title: 'Naive UI Tutorial', category: 'frontend', views: 820, publish_date: '2026-02-20' },
      { title: 'Go Wails Desktop App', category: 'golang', views: 2300, publish_date: '2026-03-01' }
    ], null, 2);
  };
  D.placeholder = function (format) {
    return format === 'csv' ? 'name,age,city\n张三,20,北京\n李四,25,上海'
      : '[\n  {"name": "张三", "age": 20},\n  {"name": "李四", "age": 25}\n]';
  };
})();
