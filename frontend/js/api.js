/* ESUI.api: thin layer over the Wails bindings (window.go.* and window.runtime.*).
   Bindings are looked up at call time, so this file can load before Wails has injected them.

   Backend methods return {result, err} (ResultResp) or {results, err} (ResultsResp); err is "" on success
   and is usually the raw Elasticsearch response body.
     ESUI.api.es.GetNodes()          -> Promise of `result` (or `results` array); throws ApiError when err is set
     ESUI.api.raw.GetNodes()         -> Promise of the whole envelope, never throws on err (use when err text matters)
     ESUI.api.raw.TestClient(...)    -> Promise<string> ("" = ok, otherwise the error text)
     ESUI.api.raw.SetConnect(...)    -> Promise<void>
     ESUI.api.config.GetConfig() / SaveConfig(cfg) / GetHistory() / SaveHistory(list) / SaveTheme(name)
     ESUI.api.sys.GetProcessInfo()
     ESUI.api.runtime.WindowSetSize(w, h) / BrowserOpenURL(url)
     ESUI.api.guard(promise, '失败前缀：') -> resolves to the value, or to undefined after showing an error toast
   Typical page code:
     UI.busy(host, ESUI.api.guard(ESUI.api.es.GetNodes(), '获取节点失败：')).then(function (res) { if (res === undefined) return; ... }) */
(function () {
  'use strict';
  var NO_CLUSTER = '请先选择一个集群'; // text returned by the Go service when no cluster is connected

  // turns an Elasticsearch error body into one readable line
  function pretty(raw) {
    if (typeof raw !== 'string') return String(raw);
    try {
      var j = JSON.parse(raw), e = j && j.error;
      if (e) return typeof e === 'string' ? e : ((e.type ? e.type + ': ' : '') + (e.reason || JSON.stringify(e)));
    } catch (x) { /* plain text */ }
    return raw;
  }

  class ApiError extends Error {
    constructor(raw, code) {
      super(pretty(raw));
      this.name = 'ApiError';
      this.raw = raw;
      this.code = code || (raw === NO_CLUSTER ? 'NO_CLUSTER' : 'ES');
    }
  }

  function invoke(pkg, struct, method, args) {
    var g = window.go, f = g && g[pkg] && g[pkg][struct] && g[pkg][struct][method];
    if (typeof f !== 'function') {
      return Promise.reject(new ApiError('后端方法 ' + struct + '.' + method + ' 不可用，需要在 Wails 应用中运行', 'NO_BINDING'));
    }
    try { return Promise.resolve(f.apply(null, args)); } catch (e) { return Promise.reject(e); }
  }
  function unwrap(env) {
    if (env && env.err) throw new ApiError(env.err);
    if (env && 'results' in env) return env.results || [];
    return env ? env.result : env;
  }
  function failIfText(s) { if (s) throw new ApiError(s); }
  function methods(pkg, struct, post) {
    return new Proxy({}, { get: function (_, m) {
      if (typeof m !== 'string') return undefined;
      return function () { return invoke(pkg, struct, m, Array.prototype.slice.call(arguments)).then(post); };
    } });
  }
  function call(pkg, struct, method, post) {
    return function () { return invoke(pkg, struct, method, Array.prototype.slice.call(arguments)).then(post); };
  }

  var lastNoCluster = 0;
  var api = (ESUI.api = {
    ApiError: ApiError,
    NO_CLUSTER: NO_CLUSTER,
    available: function () { return !!(window.go && window.go.service && window.go.service.ESService); },
    es: methods('service', 'ESService', unwrap),
    raw: methods('service', 'ESService', function (v) { return v; }),
    config: {
      GetConfig: call('config', 'AppConfig', 'GetConfig'),
      SaveConfig: call('config', 'AppConfig', 'SaveConfig', failIfText),
      GetHistory: call('config', 'AppConfig', 'GetHistory'),
      SaveHistory: call('config', 'AppConfig', 'SaveHistory', failIfText),
      SaveTheme: call('config', 'AppConfig', 'SaveTheme', failIfText)
    },
    sys: { GetProcessInfo: call('system', 'Update', 'GetProcessInfo') },
    runtime: {
      WindowSetSize: function (w, h) { if (window.runtime && window.runtime.WindowSetSize) window.runtime.WindowSetSize(w, h); },
      BrowserOpenURL: function (url) { if (window.runtime && window.runtime.BrowserOpenURL) window.runtime.BrowserOpenURL(url); }
    },
    isNoCluster: function (e) { return !!e && e.code === 'NO_CLUSTER'; },
    // index names seen by the Index/Docs/Analyze pages, used for URL suggestions in the REST page (last 1000, kept across runs)
    cacheIndexes: function (names) {
      var seen = new Set(ESUI.store.get('indexes', []).concat(names || []));
      ESUI.store.set('indexes', Array.from(seen).slice(-1000));
    },
    cachedIndexes: function () { return ESUI.store.get('indexes', []); },
    // one place that decides how a failed call is shown
    report: function (e, prefix) {
      if (!(e instanceof ApiError)) console.error(e);
      if (api.isNoCluster(e)) {
        var now = Date.now();
        if (now - lastNoCluster > 3000) { lastNoCluster = now; UI.warn('请先在「集群」页连接一个集群'); }
        return;
      }
      UI.err((prefix || '') + (e && e.message ? e.message : String(e)));
    },
    guard: function (p, prefix) {
      return Promise.resolve(p).catch(function (e) { api.report(e, prefix); return undefined; });
    }
  });
})();
