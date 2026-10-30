/* 集群 (saved connections, default landing page). Mirrors Conn.vue: list, add, edit, delete,
   click-to-connect, import and export of connections.
   Data source: ESUI.state.connections (the shell reads it from AppConfig.GetConfig). Every change re-reads the
   config, edits `connects`, calls SaveConfig, then ESUI.loadConnections() emits 'connections' and this page redraws. */
(function () {
  'use strict';
  var h = ESUI.h, api = ESUI.api;
  // File-format identifiers are kept exactly as the original app writes them.
  var EXPORT_APP = 'ES-King', EXPORT_TYPE = 'es-king-connections';

  function list() { return ESUI.state.connections; }
  function blank() { return { name: '', host: '', username: '', password: '', useSSL: false, skipSSLVerify: false, caCert: '' }; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function named(c) { return !!c && !!c.name; }
  // 2026-10-30 15:04:05 -> 2026-10-30-15-04-05
  function stamp(d) { return UI.fmt.date(d).replace(/[ :]/g, '-'); }
  // same test the shell uses for the active connection
  function sameConn(a, b) { return !!a && !!b && a.id === b.id && a.name === b.name && a.host === b.host; }
  function indexOf(conns, target) {
    for (var i = 0; i < conns.length; i++) if (sameConn(conns[i], target)) return i;
    return -1;
  }
  function nextId(conns) { return conns.reduce(function (m, c) { return Math.max(m, c.id || 0); }, 0) + 1; }

  /* Read the latest config, let edit(copy of its named connections) return the new list, SaveConfig it, then
     reload ESUI.state.connections. Rejects with the SaveConfig / GetConfig error; callers report it. */
  function updateConnects(edit) {
    return api.config.GetConfig().then(function (cfg) {
      if (!cfg) throw new Error('读取配置失败');
      var conns = (cfg.connects || []).filter(named).map(function (c) { return Object.assign({}, c); });
      cfg.connects = edit(conns);
      return api.config.SaveConfig(cfg);
    }).then(function () {
      return ESUI.loadConnections().catch(function (e) { api.report(e, '刷新连接列表失败：'); });
    });
  }

  /* ---------- export ---------- */
  function buildExport(withPassword) {
    var connects = list().map(function (n) {
      var item = { name: n.name, host: n.host, useSSL: !!n.useSSL, skipSSLVerify: !!n.skipSSLVerify, caCert: n.caCert || '' };
      if (n.username) item.username = n.username;
      if (withPassword && n.password) item.password = n.password;
      return item;
    });
    return { app: EXPORT_APP, type: EXPORT_TYPE, version: 1, exportedAt: new Date().toISOString(), connects: connects };
  }

  /* Three-way choice: true = include password, false = without, null = cancelled
     (cancel button, Esc, mask click or the close icon). UI.confirm cannot tell "no" from "cancel". */
  function askExportMode() {
    return new Promise(function (resolve) {
      var settled = false, m;
      function pick(v) { if (settled) return; settled = true; resolve(v); m.close(); }
      m = UI.modal({
        title: '导出连接配置', width: '440px',
        onClose: function () { if (!settled) { settled = true; resolve(null); } },
        body: h('div', { class: 'confirm-body confirm-warn' }, UI.icon('alert', 20),
          h('div', { class: 'confirm-msg' }, '是否在导出文件中包含密码？\n包含密码的文件请妥善保管。')),
        footer: [
          UI.btn('取消', { kind: 'ghost', onClick: function () { pick(null); } }),
          UI.btn('不含密码', { onClick: function () { pick(false); } }),
          UI.btn('包含密码', { kind: 'primary', onClick: function () { pick(true); } })
        ]
      });
    });
  }

  /* ---------- import ---------- */
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file, 'utf-8');
    });
  }
  /* A bare array or {connects: [...]}; anything else (including bad JSON) gives null. */
  function parseImport(text) {
    try {
      var data = JSON.parse(text);
      return Array.isArray(data) ? data : (data && Array.isArray(data.connects) ? data.connects : null);
    } catch (e) { return null; }
  }
  function isValid(n) {
    return !!n && typeof n === 'object' && typeof n.name === 'string' && n.name.trim() !== '' && typeof n.host === 'string' && n.host.trim() !== '';
  }
  /* Merge into `conns` (a private copy). Same name: update in place. host is always replaced; other fields only
     when present / non-empty, so a file exported without passwords never wipes saved ones.
     New name: append with id = max(id) + 1. Returns {list, added, updated}. */
  function mergeImported(conns, valid) {
    var byName = new Map(), toAdd = [], updated = 0, id = nextId(conns) - 1;
    conns.forEach(function (c) { if (!byName.has(c.name)) byName.set(c.name, c); });
    valid.forEach(function (raw) {
      var name = raw.name.trim(), host = raw.host.trim(), exist = byName.get(name);
      if (exist) {
        exist.host = host;
        if (str(raw.username)) exist.username = raw.username;
        if (str(raw.password)) exist.password = raw.password;
        if (str(raw.caCert)) exist.caCert = raw.caCert;
        if ('useSSL' in raw) exist.useSSL = !!raw.useSSL;
        if ('skipSSLVerify' in raw) exist.skipSSLVerify = !!raw.skipSSLVerify;
        updated++;
      } else {
        var node = { name: name, host: host, username: str(raw.username), password: str(raw.password),
          useSSL: !!raw.useSSL, skipSSLVerify: !!raw.skipSSLVerify, caCert: str(raw.caCert) };
        byName.set(name, node);
        toAdd.push(node);
      }
    });
    toAdd.forEach(function (n) { n.id = ++id; });
    return { list: conns.concat(toAdd), added: toAdd.length, updated: updated };
  }

  /* ---------- add / edit drawer ----------
     conn: record to edit, or null to add. The list redraws through the 'connections' event after a save. */
  function openEditor(conn) {
    var editing = !!conn, d = Object.assign(blank(), conn || {}), saving = false, testing = false;
    // Enter inside an open IME composition (pinyin etc.) only commits the text; it must not submit the form
    var save = function (v, e) { if (e && (e.isComposing || e.keyCode === 229)) return; saveBtn.click(); };
    var name = UI.input({ placeholder: '例如 prod-es', value: d.name, onEnter: save });
    var host = UI.input({ placeholder: 'http://127.0.0.1:9200', value: d.host, mono: true, onEnter: save });
    var user = UI.input({ placeholder: '输入用户名', value: d.username, onEnter: save });
    var pwd = UI.input({ placeholder: '输入密码', value: d.password, type: 'password', onEnter: save });
    var ssl = UI.switch({ checked: d.useSSL });
    var skip = UI.switch({ checked: d.skipSSLVerify });
    var ca = UI.textarea({ rows: 6, mono: true, value: d.caCert, placeholder: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----' });
    user.input.setAttribute('autocomplete', 'off');
    pwd.input.setAttribute('autocomplete', 'new-password');

    var eye = UI.btn('显示', { size: 'sm', kind: 'ghost info', icon: 'eye', onClick: function () { setPwdVisible(pwd.input.type === 'password'); } });
    function setPwdVisible(on) {
      pwd.input.type = on ? 'text' : 'password';
      eye.innerHTML = '';
      eye.append(UI.icon(on ? 'eyeOff' : 'eye', 14), h('span', null, on ? '隐藏' : '显示'));
    }

    // Required fields: red border plus a message under the field. Checked on blur (like the original's
    // trigger: 'blur'), again on save / test, and cleared as soon as the field has content.
    var nameErr = h('div', { class: 'cluster-err', hidden: true }, '请输入昵称');
    var hostErr = h('div', { class: 'cluster-err', hidden: true }, '请输入协议://主机:端口');
    var nameField = UI.field('昵称', name, { required: true });
    var hostField = UI.field('协议://主机:端口', host, { required: true });
    nameField.appendChild(nameErr);
    hostField.appendChild(hostErr);
    function mark(wrap, err, bad) { wrap.classList.toggle('cluster-invalid', !!bad); err.hidden = !bad; }
    function watch(wrap, err) {
      wrap.input.addEventListener('input', function () { if (wrap.value.trim()) mark(wrap, err, false); });
      wrap.input.addEventListener('blur', function () { mark(wrap, err, !wrap.value.trim()); });
    }
    watch(name, nameErr);
    watch(host, hostErr);
    function validate() {
      var badName = !name.value.trim(), badHost = !host.value.trim();
      mark(name, nameErr, badName); mark(host, hostErr, badHost);
      if (!badName && !badHost) return true;
      UI.warn('请填写必填项');
      (badName ? name : host).input.focus();
      return false;
    }
    function collect() {
      return { name: name.value.trim(), host: host.value.trim(), username: user.value.trim(), password: pwd.value,
        useSSL: ssl.checked, skipSSLVerify: skip.checked, caCert: ca.value };
    }

    // TestClient answers with the error text, "" means reachable
    var testBtn = UI.btn('测试连接', { icon: 'link', onClick: function () {
      if (testing || !validate()) return;
      var c = collect();
      testing = true; testBtn.setLoading(true);
      api.raw.TestClient(c.host, c.username, c.password, c.caCert, c.useSSL, c.skipSSLVerify).then(function (err) {
        if (err) UI.err('连接失败：' + new api.ApiError(err).message); else UI.ok('连接成功');
      }, function (e) {
        api.report(e, '连接失败：');
      }).then(function () { testing = false; testBtn.setLoading(false); });
    } });

    var saveBtn = UI.btn('保存', { kind: 'primary', onClick: function () {
      if (saving || !validate()) return;
      saving = true; saveBtn.setLoading(true);
      var data = collect();
      var job = updateConnects(function (conns) {
        if (!editing) return conns.concat([Object.assign({ id: nextId(conns) }, data)]);
        var i = indexOf(conns, d);
        if (i < 0) { var gone = new Error('该连接已不存在'); gone.gone = true; throw gone; }
        conns[i] = Object.assign({ id: d.id }, data);
        return conns;
      });
      UI.busy(dr.body, job, '保存中...').then(function () {
        dr.close();
        UI.ok('保存成功');
      }, function (e) {
        if (e && e.gone) { dr.close(); ESUI.loadConnections().catch(function () { /* list stays as it was */ }); }
        api.report(e, '保存失败：');
      }).then(function () { saving = false; saveBtn.setLoading(false); });
    } });

    var dr = UI.drawer({
      title: editing ? '编辑连接' : '添加连接', width: 'min(480px, 94vw)',
      body: h('div', null,
        nameField,
        hostField,
        UI.field('用户名', user),
        UI.field('密码', h('div', { class: 'cluster-pwd' }, pwd, eye)),
        h('div', { class: 'cluster-pair' }, UI.field('使用 SSL', ssl), UI.field('跳过 SSL 验证', skip)),
        UI.field('CA 证书', ca)),
      footer: [testBtn, UI.spacer(), UI.btn('取消', { kind: 'ghost', onClick: function () { dr.close(); } }), saveBtn]
    });
    name.input.focus();
  }

  ESUI.registerPage('cluster', {
    title: '集群',
    mount: function (root) {
      var busy = false;
      // "current" follows the active cluster: a row is marked while it matches ESUI.state.cluster.conn (id + name + host).
      // Deleting or editing the active connection therefore drops the marker, while the top bar keeps the old cluster.
      var isCurrent = function (c) { var cur = ESUI.state.cluster; return !!cur && sameConn(cur.conn, c); };

      var head = UI.pageHead({ title: '集群', desc: '点击一行即可连接', actions: [
        UI.btn('添加集群', { kind: 'primary', icon: 'plus', onClick: add }),
        UI.btn('导入配置', { icon: 'upload', onClick: pickFile }),
        UI.btn('导出配置', { icon: 'download', onClick: exportConn })
      ] });

      var table = UI.table({
        pager: false,
        onRowClick: connectTo,
        rowClass: function (c) { return isCurrent(c) ? 'is-selected cluster-current' : ''; },
        columns: [
          { key: 'name', title: '昵称', width: 240, render: function (c) {
            return h('div', { class: 'cluster-name' }, h('span', { class: 'cluster-name-text', title: c.name }, c.name),
              isCurrent(c) ? UI.tag('当前连接', 'ok') : null);
          } },
          { key: 'host', title: '主机地址', width: 340, mono: true },
          { key: 'actions', title: '操作', width: 150, sortable: false, render: function (c) {
            return h('div', { class: 'cluster-ops' },
              UI.btn('编辑', { size: 'sm', kind: 'ghost info', icon: 'edit', onClick: function (e) { e.stopPropagation(); edit(c); } }),
              UI.btn('删除', { size: 'sm', kind: 'ghost err', icon: 'trash', onClick: function (e) { e.stopPropagation(); remove(c); } }));
          } }
        ]
      });
      var emptyView = h('div', { class: 'cluster-empty', hidden: true },
        UI.empty('还没有集群连接', '添加一个 Elasticsearch 集群，或导入已有的连接配置', 'cluster'),
        h('div', { class: 'cluster-empty-actions' },
          UI.btn('添加集群', { kind: 'primary', icon: 'plus', onClick: add }),
          UI.btn('导入配置', { icon: 'upload', onClick: pickFile })));
      var fileInput = h('input', { type: 'file', accept: '.json', hidden: true, onchange: onImportFile });
      var body = h('div', { class: 'page-body' }, table, emptyView, fileInput);

      function sync() {
        var n = list().length;
        head.setCount('共 ' + n + ' 个');
        table.hidden = !n;
        emptyView.hidden = !!n;
        table.setRows(list().slice());
      }

      function add() { openEditor(null); }
      function edit(c) { openEditor(c); }

      // ESUI.connect runs TestClient -> SetConnect -> GetHealth and reports success or failure itself
      function connectTo(c) {
        if (busy) return;
        busy = true;
        UI.busy(body, ESUI.connect(c), '正在连接 ' + c.name + '...').then(function (ok) {
          busy = false;
          if (ok) ESUI.go('nodes');
        }, function () { busy = false; });
      }

      function remove(c) {
        var extra = isCurrent(c) ? '\n这是当前连接，删除后顶栏仍显示该集群，直到切换到其他集群。' : '';
        UI.confirm({ title: '删除集群', kind: 'danger', okText: '删除', message: '确定删除「' + c.name + '」吗？' + extra }).then(function (ok) {
          if (!ok) return;
          var job = updateConnects(function (conns) {
            var i = indexOf(conns, c);
            if (i >= 0) conns.splice(i, 1);
            return conns;
          });
          UI.busy(body, job, '删除中...').then(function () {
            UI.ok('已删除 ' + c.name);
          }, function (e) { api.report(e, '保存失败：'); });
        });
      }

      function exportConn() {
        if (!list().length) { UI.warn('暂无可导出的连接'); return; }
        askExportMode().then(function (withPassword) {
          if (withPassword === null) return;
          var payload = buildExport(withPassword);
          UI.download('es-king-connections-' + stamp(new Date()) + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
          UI.ok('已导出 ' + payload.connects.length + ' 个连接');
        });
      }

      function pickFile() { fileInput.click(); }
      function onImportFile() {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        readText(file).then(parseImport, function () { return null; }).then(function (arr) {
          if (!arr) { UI.err('文件格式不正确，请选择 ESUI 导出的连接配置 JSON 文件'); return; }
          var valid = arr.filter(isValid);
          if (!valid.length) { UI.warn('文件中没有有效的连接（缺少名称或主机地址）'); return; }
          var r;
          var job = updateConnects(function (conns) { r = mergeImported(conns, valid); return r.list; });
          return UI.busy(body, job, '导入中...').then(function () {
            UI.ok(r.added ? '新增 ' + r.added + ' 个连接，更新 ' + r.updated + ' 个同名连接' : '已更新 ' + r.updated + ' 个同名连接，没有新增');
          }, function (e) { api.report(e, '保存失败：'); });
        });
      }

      root.append(head, body);
      sync();
      ESUI.on('connections', sync);
      // connecting or switching cluster (also from the top bar) moves the "current" marker
      ESUI.on('cluster', function () { table.refresh(); });
    }
  });
})();
