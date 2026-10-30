/* REST page data: URL endpoints, DSL keywords, 15 query examples, and two pure helpers (statusText, flatten).
   Helper file: only defines data/pure functions and attaches them to ESUI.lib.rest (no registerPage). */
(function () {
  'use strict';
  var L = (ESUI.lib = ESUI.lib || {});
  var R = (L.rest = L.rest || {});

  /* reason phrase for an HTTP status code (used for the status tag when an ES error body carries `status`) */
  var STATUS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
    406: 'Not Acceptable', 409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
  R.statusText = function (c) { return STATUS[c] || ''; };

  /* nested objects -> dotted keys (same as the old flattenObject); arrays and scalars are kept as values */
  function flatten(obj, prefix, out) {
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
    });
    return out;
  }
  R.flatten = function (o) { return flatten(o, '', {}); };

  R.endpoints = [
    '_search', '_cluster/health', '_cluster/state', '_cluster/stats',
    '_cat/indices', '_cat/nodes', '_cat/shards', '_cat/allocation',
    '_cat/count', '_cat/health', '_nodes/stats', '_tasks', '_flush',
    '_refresh', '_mapping', '_settings', '_stats', '_bulk', '_update',
    '_msearch', '_aliases', '_rollover', '_reindex', '_forcemerge',
    '_count', '_analyze'
  ];

  function kw(meta, words) { return words.split(' ').map(function (w) { return { word: w, meta: meta }; }); }
  R.keywords = [].concat(
    kw('keyword', 'query bool filter must should must_not term terms match match_phrase multi_match range exists prefix wildcard regexp'),
    kw('keyword', 'match_all aggs aggregations'),
    kw('aggregation', 'terms sum avg min max stats cardinality histogram date_histogram top_hits'),
    kw('keyword', 'size from'),
    kw('keyword', 'sort track_total_hits _source fields script'),
    kw('range', 'gte lte gt lt'),
    kw('keyword', 'boost minimum_should_match nested path score_mode'),
    kw('aggregation', 'bucket'),
    kw('keyword', 'order'),
    kw('sort', 'asc desc'),
    kw('keyword', 'highlight search_after')
  );

  var E = [
    ['Term查询', { query: { term: { status: 'active' } }, size: 10, track_total_hits: true }],
    ['Terms查询', { query: { terms: { user_id: [1, 2, 3, 4] } }, size: 10 }],
    ['Match查询', { query: { match: { description: 'quick brown fox' } }, size: 20 }],
    ['Match Phrase查询', { query: { match_phrase: { description: { query: 'quick brown fox', slop: 1 } } } }],
    ['Range查询', { query: { range: { age: { gte: 20, lte: 30 } } } }],
    ['Bool复合查询', { query: { bool: {
      must: [{ term: { status: 'active' } }],
      must_not: [{ term: { type: 'deleted' } }],
      should: [{ term: { category: 'electronics' } }, { term: { category: 'computers' } }],
      minimum_should_match: 1 } } }],
    ['Terms Aggregation', { aggs: { status_counts: { terms: { field: 'status', missing: 'N/A', size: 10 } } }, size: 0 }],
    ['Date Histogram聚合', { aggs: { sales_over_time: { date_histogram: { field: 'created_at', calendar_interval: '1d', format: 'yyyy-MM-dd' } } }, size: 0 }],
    ['Nested查询', { query: { nested: { path: 'comments', query: { bool: { must: [
      { match: { 'comments.text': 'great' } }, { term: { 'comments.rating': 5 } }] } } } } }],
    ['Exists查询', { query: { exists: { field: 'email' } } }],
    ['Multi-match查询', { query: { multi_match: { query: 'quick brown fox', fields: ['title', 'description^2'], type: 'best_fields' } } }],
    ['Wildcard查询', { query: { wildcard: { email: '*@gmail.com' } } }],
    ['Metrics聚合', { aggs: {
      avg_price: { avg: { field: 'price' } }, max_price: { max: { field: 'price' } },
      min_price: { min: { field: 'price' } }, sum_quantity: { sum: { field: 'quantity' } } }, size: 0 }],
    ['Cardinality聚合', { aggs: { unique_users: { cardinality: { field: 'user_id', precision_threshold: 100 } } }, size: 0 }],
    ['Script查询', { query: { script_score: { query: { match_all: {} },
      script: { source: "doc['price'].value * doc['rating'].value", lang: 'painless' } } } }]
  ];
  R.examples = E.map(function (e) { return { title: e[0], code: JSON.stringify(e[1], null, 2) }; });
})();
