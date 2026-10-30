/* REST 调试台 (key: rest). Needs helper scripts rest-data.js and rest-editor.js (both attach to ESUI.lib.rest);
   they are only read when the page mounts or a request is sent. Each tab owns a full console (request bar, body editor, response).
   Backend: ESService.Search(method, path, body) for every request (called through ESUI.api.raw so the ES error text is shown as the response),
   AppConfig.GetHistory / SaveHistory for the history drawer. */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;
  var HISTORY_MAX = 100;
  var METHODS = ['GET', 'POST', 'PUT', 'HEAD', 'PATCH', 'OPTIONS', 'DELETE'];
  var URL_HINT = '输入rest api，以/开头；查询请用POST请求；GET不会携带body';
  function lib() { return (ESUI.lib && ESUI.lib.rest) || {}; }
  function pretty(text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; } }
  function stripSlash(v) { return v.replace(/^\//, ''); }

  /* URL completion: 26 built-in endpoints + every cached index (written by the Index / Docs / Analyze pages) and its /_search /_mapping /_settings /_count variants */
  function urlCandidates(cur) {
    var list = (lib().endpoints || []).slice(), cached = api.cachedIndexes();
    (Array.isArray(cached) ? cached : []).forEach(function (name) {
      list.push(name, name + '/_search', name + '/_mapping', name + '/_settings', name + '/_count');
    });
    if (!cur) return list.slice(0, 20).map(function (v) { return '/' + stripSlash(v); });
    var q = stripSlash(cur).toLowerCase();
    return list.filter(function (v) { return v.toLowerCase().indexOf(q) >= 0; }).slice(0, 25)
      .map(function (v) { return cur.charAt(0) === '/' ? '/' + stripSlash(v) : v; });
  }

  /* history: newest first, at most 100, stored by the backend (AppConfig.GetHistory / SaveHistory).
     Read once when the page mounts and kept in memory; each successful request is prepended and the whole list is saved back. */
  var historyLoad = null;
  function ensureHistory() {
    if (!historyLoad) {
      var read = api.available() ? api.guard(api.config.GetHistory(), '读取历史记录失败：') : Promise.resolve([]);
      historyLoad = read.then(function (list) { return Array.isArray(list) ? list : []; });
    }
    return historyLoad;
  }
  function pushHistory(method, path, dsl) {
    return ensureHistory().then(function (list) {
      list.unshift({ timestamp: Date.now(), method: method, path: path, dsl: dsl || '' });
      if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
      return api.guard(api.config.SaveHistory(list.slice()), '保存历史记录失败：');
    });
  }

  /* ES error bodies carry the HTTP status as `status` ({"error":{...},"status":404}); the Search binding itself returns no status code */
  function errorStatus(text) {
    try {
      var s = JSON.parse(text).status;
      return typeof s === 'number' && s >= 100 && s <= 599 ? s : 0;
    } catch (e) { return 0; }
  }

  function createConsole(panel, ctx) {
    var gen = 0, tableOn = false, hits = [], cur = -1;
    var st = fresh();
    /* done: a response (or ES error) is on screen; ok: Search returned no err; code: HTTP status read from the error body, 0 when unknown */
    function fresh() { return { done: false, ok: false, code: 0, ms: 0, size: 0, text: '', data: null, isText: false }; }

    /* request bar */
    var methodSel = UI.select(METHODS, { value: 'POST', width: '104px', onChange: updateHint });
    var urlPop = lib().popup({ onPick: pickUrl });
    var urlInput = UI.input({ placeholder: URL_HINT, mono: true, clearable: true, width: '100%', onInput: suggestUrl, onEnter: onUrlEnter });
    var sendBtn = UI.btn('发送', { kind: 'primary', icon: 'play', title: '发送 (Ctrl/⌘ + Enter)', onClick: send });
    var bar = h('div', { class: 'rest-bar' }, methodSel, h('div', { class: 'rest-url' }, urlInput, urlPop.el), sendBtn,
      UI.btn('历史记录', { icon: 'history', onClick: ctx.openHistory }), UI.btn('ES 查询示例', { icon: 'file', onClick: ctx.openExamples }));

    /* request pane */
    var editor = lib().editor({ placeholder: '请求body', onSubmit: send });
    var hint = h('span', { class: 'muted rest-hint', hidden: true }, 'GET 不携带请求体');
    var reqPane = h('section', { class: 'rest-pane' },
      h('div', { class: 'rest-pane-head' }, h('span', { class: 'rest-pane-title' }, '请求体'), hint, UI.spacer(),
        UI.btn('格式化', { size: 'sm', kind: 'ghost', icon: 'code', onClick: function () { if (editor.format(false)) UI.ok('已格式化'); } })),
      editor);

    /* response pane */
    var statusEl = h('div', { class: 'rest-stat' });
    var hitInfo = h('span', { class: 'muted mono rest-hitinfo' });
    var searchBox = UI.input({ placeholder: '搜索响应', icon: 'search', clearable: true, width: '150px', onInput: runSearch,
      onEnter: function (v, e) { stepHit(e && e.shiftKey ? -1 : 1); } });
    var tableBtn = UI.btn('表格视图', { size: 'sm', icon: 'table', onClick: toggleTable });
    var content = h('div', { class: 'rest-content' });
    var resp = h('div', { class: 'rest-resp' }, content);
    var respPane = h('section', { class: 'rest-pane' },
      h('div', { class: 'rest-pane-head' }, h('span', { class: 'rest-pane-title' }, '响应'), statusEl,
        h('div', { class: 'rest-tools' }, hitInfo, searchBox, tableBtn, UI.btn('导出结果', { size: 'sm', icon: 'download', onClick: exportJson }))),
      resp);
    panel.append(bar, h('div', { class: 'rest-split' }, reqPane, respPane));

    /* ---- URL suggestions ---- */
    function suggestUrl(v) {
      var c = (v || '').trim(), list = urlCandidates(c);
      if (!list.length || (list.length === 1 && list[0] === c)) return urlPop.hide();
      urlPop.show(list.map(function (x) { return { label: x }; }), null, null, -1);
    }
    function pickUrl(it) { urlInput.value = it.label; urlPop.hide(); urlInput.input.focus(); }
    function onUrlEnter() {
      var it = urlPop.isOpen() ? urlPop.active() : null;
      if (it) pickUrl(it); else { urlPop.hide(); send(); }
    }
    urlInput.input.addEventListener('focus', function () { suggestUrl(urlInput.value); });
    urlInput.input.addEventListener('blur', function () { urlPop.hide(); });
    urlInput.input.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229 || !urlPop.isOpen()) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); urlPop.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); urlPop.move(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); urlPop.hide(); }
      else if (e.key === 'Tab' && urlPop.active()) { e.preventDefault(); pickUrl(urlPop.active()); }
    });
    function updateHint() { hint.hidden = methodSel.value !== 'GET'; }

    /* ---- response search ---- */
    function clearMarks() {
      hits.forEach(function (el) { el.classList.remove('rest-hit', 'rest-hit-cur'); });
      hits = []; cur = -1; hitInfo.textContent = '';
    }
    function stepHit(d, first) {
      if (!hits.length) return;
      if (cur >= 0) hits[cur].classList.remove('rest-hit-cur');
      cur = first ? 0 : (cur + d + hits.length) % hits.length;
      var el = hits[cur];
      el.classList.add('rest-hit-cur');
      /* scroll only the response box; scrollIntoView would also scroll the page / tab panel that contains it */
      var top = el.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      if (top < content.scrollTop) content.scrollTop = Math.max(0, top - 8);
      else if (top + el.offsetHeight > content.scrollTop + content.clientHeight) content.scrollTop = top + el.offsetHeight - content.clientHeight + 8;
      hitInfo.textContent = (cur + 1) + '/' + hits.length;
    }
    function runSearch(v) {
      clearMarks();
      v = (v || '').toLowerCase();
      if (!v || tableOn) return;
      Array.prototype.forEach.call(content.querySelectorAll('.code-line'), function (el) {
        if (el.textContent.toLowerCase().indexOf(v) >= 0) { el.classList.add('rest-hit'); hits.push(el); }
      });
      if (hits.length) stepHit(1, true); else hitInfo.textContent = '无匹配';
    }

    /* ---- response rendering ---- */
    /* Search returns no HTTP status: success means 2xx (the backend accepts every 2xx), failures carry the code only inside the ES error body */
    function statusUpdate() {
      statusEl.innerHTML = '';
      if (!st.done) return;
      var s = st.code, name, kind;
      if (st.ok) { name = '2xx 成功'; kind = 'ok'; }
      else if (s) { name = (s + ' ' + (lib().statusText ? lib().statusText(s) : '')).trim(); kind = s >= 500 ? 'err' : s >= 400 ? 'warn' : s >= 300 ? 'info' : 'ok'; }
      else { name = '请求失败'; kind = 'err'; }
      statusEl.append(UI.tag(name, kind, { dot: true, mono: true }), h('span', { class: 'muted mono' }, st.ms + ' ms'), h('span', { class: 'muted mono' }, F.bytes(st.size)));
    }
    /* hits.hits flattened: _id, _index, then _source fields (dotted keys), most common keys first, at most 20 columns */
    function buildTable() {
      var list = st.data && st.data.hits && st.data.hits.hits;
      if (!st.ok) return UI.empty('上次请求失败', (st.code ? '状态码 ' + st.code + '，' : '') + '没有可展示的 hits', 'table');
      if (!Array.isArray(list)) return UI.empty('没有可展示的 hits', '表格视图只展示 _search 响应里的 hits.hits，当前响应不包含 hits', 'table');
      if (!list.length) return UI.empty('hits 为空', '本次查询没有命中文档', 'table');
      var rows = list.map(function (x) { return Object.assign({ _id: x._id, _index: x._index }, lib().flatten(x._source || {})); });
      var count = {};
      rows.slice(0, 50).forEach(function (r) { Object.keys(r).forEach(function (k) { count[k] = (count[k] || 0) + 1; }); });
      var keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b); }).slice(0, 20);
      var cols = keys.map(function (k) {
        return { key: k, title: k, width: k === '_id' || k === '_index' ? 220 : 180, mono: true, fixed: k === '_id' ? 'left' : undefined,
          render: function (r) { var v = r[k]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); } };
      });
      return UI.table({ columns: cols, rows: rows, fill: true, striped: true, pageSize: 20, pageSizes: [20, 50, 100] });
    }
    function renderResp() {
      content.innerHTML = '';
      content.classList.toggle('is-table', tableOn);
      clearMarks();
      statusUpdate();
      if (!st.done) {
        content.appendChild(ESUI.state.cluster ? UI.empty('尚未发送请求', '填写请求后点击“发送”，响应会显示在这里', 'inbox')
          : UI.empty('请先连接集群', '在顶栏选择一个集群后，再发送请求', 'inbox'));
        return;
      }
      if (tableOn) { content.appendChild(buildTable()); return; }
      if (!st.text) { content.appendChild(UI.empty('响应体为空', 'HEAD、OPTIONS 等请求可能没有响应体', 'inbox')); return; }
      content.appendChild(st.isText ? UI.textView(st.text, { lineNumbers: false }) : UI.jsonView(st.text));
      runSearch(searchBox.value);
    }
    function toggleTable() {
      tableOn = !tableOn;
      tableBtn.classList.toggle('btn-primary', tableOn);
      searchBox.input.disabled = tableOn;
      renderResp();
    }
    function exportJson() {
      if (!st.done) return UI.warn('暂无响应可导出');
      UI.download('response.json', st.text, 'application/json');
      UI.ok('已导出 response.json');
    }

    /* ---- send ---- */
    function byteSize(s) { return typeof Blob === 'function' ? new Blob([s]).size : s.length; }
    /* env = {result, err} from ESService.Search. err is the ES error body (or a transport error text) and is shown as the response, as the old app did. */
    function okState(result, ms) {
      var isText = typeof result === 'string', text = result == null ? '' : isText ? result : JSON.stringify(result, null, 2);
      return { done: true, ok: true, code: 0, ms: ms, size: byteSize(result == null ? '' : isText ? result : JSON.stringify(result)), text: text, data: isText ? null : result, isText: isText };
    }
    function errState(err, ms) {
      var text = String(err), isText = true;
      try { text = JSON.stringify(JSON.parse(err), null, 2); isText = false; } catch (e) { /* not JSON: show as is */ }
      return { done: true, ok: false, code: errorStatus(err), ms: ms, size: byteSize(String(err)), text: text, data: null, isText: isText };
    }
    function settle(next) { st = next; sendBtn.setLoading(false); renderResp(); }
    function send() {
      var path = urlInput.value.trim();
      if (!path) return UI.warn('请输入请求路径');
      if (path.charAt(0) !== '/') { path = '/' + path; urlInput.value = path; }
      if (!ESUI.state.cluster) return UI.warn('请先在顶栏连接集群');
      if (sendBtn.classList.contains('is-loading')) return;
      urlPop.hide();
      var method = methodSel.value, text = editor.getValue(), body = method === 'GET' ? '' : text, my = gen, t0 = performance.now();
      sendBtn.setLoading(true);
      UI.busy(resp, api.raw.Search(method, path, body), '请求中...').then(function (env) {
        var ms = Math.round(performance.now() - t0), err = env && env.err;
        if (err === api.NO_CLUSTER) { // the backend lost the connection; same hint as the page-level check
          if (my === gen) { api.report(new api.ApiError(err)); settle(fresh()); }
          return;
        }
        if (!err) pushHistory(method, path, text); // only successful requests are recorded, like the old app
        if (my !== gen) return; // cluster switched while waiting; reset() already cleaned up
        settle(err ? errState(err, ms) : okState(env && env.result, ms));
      }).catch(function (e) {
        if (my !== gen) return;
        api.report(e, '请求失败：');
        settle(fresh());
      });
    }

    updateHint();
    renderResp();
    return {
      setRequest: function (method, path, body) {
        if (METHODS.indexOf(method) >= 0) methodSel.value = method;
        urlInput.value = path || '';
        editor.setValue(body || '');
        updateHint();
      },
      setBody: function (text) { editor.setValue(text); editor.focus(); },
      reset: function () { gen++; st = fresh(); sendBtn.setLoading(false); UI.spin(resp, false); renderResp(); }
    };
  }

  ESUI.registerPage('rest', {
    title: 'REST',
    mount: function (root) {
      var consoles = {}, seq = 0, tabs;
      ensureHistory(); // old app: GetHistory when the page mounts
      var ctx = { openHistory: openHistory, openExamples: openExamples };

      function makeItem() {
        seq++;
        var key = 'req-' + seq;
        return { key: key, label: 'Tab ' + seq, render: function (panel) { consoles[key] = createConsole(panel, ctx); } };
      }
      function activeConsole() { return consoles[tabs.active()]; }

      /* history drawer: search (method / path / dsl), 10 per page, click to restore into the current tab */
      function openHistory() {
        var c = activeConsole();
        if (!c) return;
        ensureHistory().then(function (list) { showHistory(c, list.slice()); });
      }
      function showHistory(c, all) {
        var keyword = '', page = 1, SIZE = 10, drawer;
        var list = h('div', { class: 'rest-hist' });
        var pager = UI.pager({ total: all.length, page: 1, size: SIZE, onChange: function (p) { page = p; draw(); } });
        var search = UI.input({ placeholder: '搜索历史记录，同时支持method、path、dsl', icon: 'search', clearable: true, width: '100%',
          onInput: function (v) { keyword = v.toLowerCase(); page = 1; draw(); } });
        function filtered() {
          if (!keyword) return all;
          return all.filter(function (it) {
            return [it.method, it.path, it.dsl].some(function (s) { return String(s || '').toLowerCase().indexOf(keyword) >= 0; });
          });
        }
        function restore(it) {
          c.setRequest(it.method, it.path, it.dsl);
          drawer.close();
          UI.info('已恢复到当前标签');
        }
        function draw() {
          var f = filtered(), pages = Math.max(1, Math.ceil(f.length / SIZE));
          page = Math.min(page, pages);
          pager.update({ total: f.length, page: page, size: SIZE });
          list.innerHTML = '';
          if (!f.length) {
            list.appendChild(UI.empty(all.length ? '没有匹配的记录' : '暂无历史记录', all.length ? '换个关键词试试' : '发送成功的请求会记录在这里'));
            return;
          }
          f.slice((page - 1) * SIZE, page * SIZE).forEach(function (it) {
            var row = h('div', { class: 'rest-hist-item', tabindex: '0', onclick: function () { restore(it); },
              onkeydown: function (e) { if (e.key === 'Enter') restore(it); } },
              UI.tag(it.method, it.method === 'DELETE' ? 'err' : null, { mono: true }),
              h('span', { class: 'mono rest-hist-path' }, it.path),
              h('span', { class: 'muted rest-hist-time' }, F.date(it.timestamp)));
            if (it.dsl) UI.tip(row, function () { return UI.jsonView(pretty(it.dsl), { maxHeight: '420px', lineNumbers: false }); });
            list.appendChild(row);
          });
        }
        drawer = UI.drawer({ title: '历史记录', body: h('div', { class: 'rest-hist-wrap' }, search, pager, list) });
        draw();
        search.input.focus();
      }

      /* examples drawer: 15 collapsible items; "插入" replaces only the request body and closes the drawer */
      function openExamples() {
        var c = activeConsole();
        if (!c) return;
        var drawer;
        var items = (lib().examples || []).map(function (ex, i) {
          var code = h('div', { class: 'rest-ex-code', hidden: true }, UI.jsonView(ex.code, { lineNumbers: false }));
          var chev = h('span', { class: 'rest-ex-chev' }, UI.icon('chevronRight', 14));
          var headEl = h('div', { class: 'rest-ex-head', role: 'button', tabindex: '0', 'aria-expanded': 'false' }, chev,
            h('span', { class: 'grow' }, (i + 1) + '. ' + ex.title),
            UI.btn('插入', { size: 'sm', kind: 'primary', onClick: function (e) {
              e.stopPropagation();
              c.setBody(ex.code);
              drawer.close();
              UI.ok('已插入：' + ex.title);
            } }));
          function toggle() {
            var open = code.hidden;
            code.hidden = !open;
            chev.innerHTML = '';
            chev.appendChild(UI.icon(open ? 'chevronDown' : 'chevronRight', 14));
            headEl.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
          headEl.addEventListener('click', toggle);
          headEl.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === headEl) { e.preventDefault(); toggle(); }
          });
          return h('div', { class: 'rest-ex' }, headEl, code);
        });
        drawer = UI.drawer({ title: 'ES DSL查询示例', body: h('div', { class: 'rest-ex-list' }, items) });
      }

      tabs = UI.tabs({ variant: 'card', addable: true, closable: true, items: [makeItem()],
        onAdd: function () { tabs.add(makeItem()); },
        onClose: function (key) { delete consoles[key]; tabs.remove(key); } });
      root.append(h('div', { class: 'page-body rest-body' }, tabs));
      ESUI.on('cluster', function () { Object.keys(consoles).forEach(function (k) { consoles[k].reset(); }); });
    }
  });
})();
