/* App shell: sidebar, top strip (cluster switcher + shard ribbon + theme), connect(), boot.
   State owned here:
     ESUI.state.config       last config read from the backend (AppConfig.GetConfig)
     ESUI.state.connections  saved connections (config.connects without empty names)
     ESUI.state.cluster      active cluster or null: {conn, id, name, host, cluster, status, health, shards}
   Events: 'connections' (list reloaded), 'cluster' (connected / switched / disconnected), 'health' (health refreshed) */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI, api = ESUI.api;

  ESUI.nav = [
    { group: '概览', items: [['cluster', '集群'], ['nodes', '节点'], ['health', '健康'], ['metrics', '指标']] },
    { group: '数据', items: [['index', '索引'], ['docs', '文档'], ['templates', '模板'], ['analyze', '分词']] },
    { group: '运维', items: [['rest', 'REST'], ['diag', '诊断'], ['task', 'Task'], ['snapshot', '快照']] }
  ];
  var SETTINGS = ['settings', '设置'];
  var navBtns = {}, ui = {}, connectSeq = 0, SUPERSEDED = new Error('superseded by a newer connect');
  ESUI.state.config = null;
  ESUI.state.connections = [];

  /* reload config.yaml and refresh the saved connection list */
  ESUI.loadConnections = function () {
    return api.config.GetConfig().then(function (cfg) {
      ESUI.state.config = cfg;
      ESUI.state.connections = ((cfg && cfg.connects) || []).filter(function (c) { return c && c.name; });
      ESUI.emit('connections', ESUI.state.connections);
      return ESUI.state.connections;
    });
  };
  function sameConn(a, b) { return !!a && !!b && a.id === b.id && a.name === b.name && a.host === b.host; }

  function clusterFrom(conn, hl) {
    hl = hl || {};
    var reloc = hl.relocating_shards || 0;
    return {
      conn: conn, id: conn.id, name: conn.name, host: conn.host, cluster: hl.cluster_name || conn.name, status: hl.status || 'unknown', health: hl,
      shards: { active: Math.max(0, (hl.active_shards || 0) - reloc), relocating: reloc, initializing: hl.initializing_shards || 0, unassigned: hl.unassigned_shards || 0 }
    };
  }

  /* Connect to a saved connection: TestClient -> SetConnect -> GetHealth. Pass null to disconnect.
     Resolves true when connected. Failures are reported here, callers only need the boolean. */
  ESUI.connect = function (conn, o) {
    var seq = ++connectSeq;
    if (!conn) {
      ESUI.state.cluster = null; drawTop(); ESUI.emit('cluster', null);
      return Promise.resolve(true);
    }
    return api.raw.TestClient(conn.host, conn.username, conn.password, conn.caCert, !!conn.useSSL, !!conn.skipSSLVerify).then(function (err) {
      if (err) throw new api.ApiError(err);
      // a slow test must not switch the backend after the user already picked another cluster
      if (seq !== connectSeq) throw SUPERSEDED;
      return api.raw.SetConnect(conn.name, conn.host, conn.username, conn.password, conn.caCert, !!conn.useSSL, !!conn.skipSSLVerify);
    }).then(function () {
      // the backend client now points at the new cluster: drop the old one from the UI right away, so nothing
      // issued while GetHealth is pending can look like it targets the old cluster
      if (seq === connectSeq) { ESUI.state.cluster = null; drawTop(); ESUI.emit('cluster', null); }
      return api.es.GetHealth().catch(function () { return null; }); // connected, health is a best effort
    }).then(function (hl) {
      if (seq !== connectSeq) return false; // a newer connect superseded this one
      ESUI.state.cluster = clusterFrom(conn, hl);
      drawTop();
      if (!o || !o.silent) UI.ok('已连接 ' + conn.name);
      ESUI.emit('cluster', ESUI.state.cluster);
      return true;
    }, function (e) {
      if (seq === connectSeq) UI.err('连接失败：' + (e && e.message ? e.message : e));
      return false;
    });
  };

  /* re-read GET /_cluster/health and update the top strip */
  ESUI.refreshHealth = function () {
    var c = ESUI.state.cluster;
    if (!c) return Promise.resolve(null);
    return api.es.GetHealth().then(function (hl) {
      if (ESUI.state.cluster !== c) return hl;
      ESUI.state.cluster = clusterFrom(c.conn, hl);
      drawTop();
      ESUI.emit('health', ESUI.state.cluster);
      return hl;
    });
  };

  function navItem(def) {
    var b = h('button', { class: 'nav-item', type: 'button', title: def[1], dataset: { key: def[0] }, onclick: function () { ESUI.go(def[0]); } },
      UI.icon(def[0], 16), h('span', { class: 'nav-label' }, def[1]));
    navBtns[def[0]] = b;
    return b;
  }
  function buildNav() {
    var nav = document.getElementById('nav'), scroll = h('div', { class: 'nav-scroll' });
    ESUI.nav.forEach(function (g) {
      scroll.appendChild(h('div', { class: 'nav-group' }, g.group));
      g.items.forEach(function (it) { scroll.appendChild(navItem(it)); });
    });
    var collapse = h('button', { class: 'nav-item', type: 'button', title: '收起/展开侧栏', onclick: function () { setCollapsed(!document.getElementById('app').classList.contains('nav-collapsed')); } },
      UI.icon('chevronsLeft', 16), h('span', { class: 'nav-label' }, '收起侧栏'));
    ui.collapseIcon = collapse.firstChild;
    nav.append(h('div', { class: 'brand' }, UI.logo(24), h('span', { class: 'brand-name' }, 'ESUI')), scroll, h('div', { class: 'nav-foot' }, navItem(SETTINGS), collapse));
  }
  function setCollapsed(on) {
    document.getElementById('app').classList.toggle('nav-collapsed', on);
    var fresh = UI.icon(on ? 'chevronsRight' : 'chevronsLeft', 16);
    ui.collapseIcon.replaceWith(fresh); ui.collapseIcon = fresh;
    ESUI.store.set('nav-collapsed', on);
  }

  var STATUS_TAG = { green: 'ok', yellow: 'warn', red: 'err' };
  /* page buttons in the top strip: a page sets def.topActions = [nodes] in mount(); drawTop() rebuilds the strip, so the slot is re-attached each time */
  var acts = h('div', { class: 'topbar-acts' });
  function paintActs() {
    var def = ESUI.pages[ESUI.state.page];
    acts.replaceChildren.apply(acts, (def && def.topActions) || []);
  }
  function drawTop() {
    var c = ESUI.state.cluster, top = document.getElementById('topbar');
    top.innerHTML = '';
    var label = c ? [h('span', { class: 'tag tag-dot' + (STATUS_TAG[c.status] ? ' tag-' + STATUS_TAG[c.status] : ''), title: '集群状态 ' + c.status }, ''), h('strong', null, c.name), h('span', { class: 'host mono' }, c.host.replace(/^https?:\/\//, ''))]
      : [h('strong', null, '未连接集群')];
    var sw = h('button', { class: 'cluster-switch', type: 'button', title: '切换集群' }, label, UI.icon('chevronDown', 14));
    UI.dropdown(sw, function () {
      var items = ESUI.state.connections.map(function (cn) {
        var cur = sameConn(c && c.conn, cn);
        return { label: cn.name + (cur ? '  ✓' : ''), onClick: function () { if (!cur) ESUI.connect(cn); } };
      });
      return items.concat([{ divider: true }, { label: '管理集群…', icon: 'cluster', onClick: function () { ESUI.go('cluster'); } }]);
    });
    top.appendChild(sw);
    if (c) {
      top.append(UI.ribbon(c.shards), h('span', { class: 'topbar-meta' }, (c.health.number_of_nodes != null ? c.health.number_of_nodes + ' 节点 · ' : '') + c.cluster));
    } else if (!api.available()) {
      top.append(h('span', { class: 'topbar-meta' }, '未检测到 Wails 后端：当前是静态预览，数据不可用'));
    }
    paintActs();
    top.append(UI.spacer(), acts);
  }

  function init() {
    buildNav();
    setCollapsed(!!ESUI.store.get('nav-collapsed', false));
    ESUI.on('route', function (key) {
      Object.keys(navBtns).forEach(function (k) { navBtns[k].classList.toggle('active', k === key); });
      paintActs();
    });
    ESUI.on('connections', drawTop);
    drawTop();
    // config first (saved connections + theme), then show the first page; the app starts disconnected, as before
    ESUI.loadConnections().then(function () {
      var t = ESUI.state.config && ESUI.state.config.theme;
      if ((t === 'light' || t === 'dark') && t !== ESUI.theme.get()) ESUI.theme.set(t);
    }, function (e) {
      if (api.available()) api.report(e, '读取配置失败：');
    }).then(function () { ESUI.start(); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
