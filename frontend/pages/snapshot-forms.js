/* 快照页弹窗构建函数（创建仓库 / 创建快照 / 快照详情 / 创建 SLM 策略 / 创建 ILM 策略 / ILM 详情），挂到 ESUI.lib.snapshot.forms。
   只定义函数，不注册页面，也不直接调用后端：页面把真实的调用回调传进来。
   回调约定：submit(...) 返回 Promise<boolean>，true 表示后端成功（失败时页面已经提示错误，弹窗保持打开）；done() 在成功并关闭弹窗后调用。 */
(function () {
  'use strict';
  var h = ESUI.h;
  var L = ((ESUI.lib = ESUI.lib || {}).snapshot = ESUI.lib.snapshot || {});
  var F = (L.forms = L.forms || {});

  var TYPES = [
    { value: 'fs', label: 'fs（共享文件系统）' }, { value: 's3', label: 's3（AWS S3）' }, { value: 'hdfs', label: 'hdfs（Hadoop HDFS）' },
    { value: 'azure', label: 'azure（Azure Blob）' }, { value: 'gcs', label: 'gcs（Google Cloud Storage）' }, { value: 'url', label: 'url（只读 URL）' }
  ];
  var EXAMPLE = {
    fs: '{"location": "/mount/backups/my_backup"}', s3: '{"bucket": "my-es-snapshots", "region": "cn-north-1"}',
    hdfs: '{"uri": "hdfs://namenode:8020", "path": "/es/snapshots"}', azure: '{"container": "es-snapshots"}',
    gcs: '{"bucket": "my-es-snapshots"}', url: '{"url": "https://backup.example.com/snapshots"}'
  };
  // PUT _ilm/policy/<id> 的请求体必须带最外层的 policy，后端原样转发输入框里的 JSON
  var ILM_SAMPLE = { policy: { phases: { hot: { actions: {} }, delete: { min_age: '30d', actions: { delete: {} } } } } };

  /* 逗号分隔的索引表达式 -> 数组（去空白、去空项）。join 后再传给后端，避免 "a, b" 里的空格被当成名称的一部分 */
  function split(s) { return String(s == null ? '' : s).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  L.util = { split: split, join: function (s) { return split(s).join(','); } };

  /* 带校验、提交遮罩和成功/失败处理的表单弹窗。
     o: {title, width, body, okText, okMsg, validate()->错误文案|null, submit()->Promise<boolean>, done()} */
  function dialog(o) {
    var closed = false, m;
    var okBtn = UI.btn(o.okText || '创建', { kind: 'primary', onClick: run });
    var cancel = UI.btn('取消', { kind: 'ghost', onClick: function () { m.close(); } });
    function run() {
      if (okBtn.classList.contains('is-loading')) return;
      var msg = o.validate ? o.validate() : null;
      if (msg) { UI.warn(msg); return; }
      okBtn.setLoading(true);
      Promise.resolve(o.submit()).then(function (ok) {
        okBtn.setLoading(false);
        if (!ok) return;                    // 失败时保持弹窗打开，与原应用一致
        if (!closed) m.close();
        UI.ok(o.okMsg);
        if (o.done) o.done();
      }, function (e) { okBtn.setLoading(false); ESUI.api.report(e); });
    }
    m = UI.modal({ title: o.title, width: o.width, body: o.body, footer: [cancel, okBtn], onClose: function () { closed = true; } });
    return m;
  }
  function repoOptions(names) { return (names || []).map(function (n) { return { value: n, label: n }; }); }
  function focusLater(wrap) { setTimeout(function () { if (wrap.input) wrap.input.focus(); }, 80); }

  /* 可点击的索引名 chip 列表：点击把名称追加到逗号分隔的 input 中。返回元素，带 update(names) */
  F.pickList = function (input, names, limit) {
    var box = h('div', { class: 'snap-picks' });
    function add(n) {
      var cur = split(input.value);
      if (cur.indexOf(n) < 0) cur.push(n);
      input.value = cur.join(',');
    }
    box.update = function (list) {
      box.innerHTML = '';
      box.style.display = list.length ? '' : 'none';
      if (!list.length) return;
      var shown = list.slice(0, limit || 8);
      box.appendChild(h('span', { class: 'muted' }, '点击添加'));
      shown.forEach(function (n) { box.appendChild(UI.chip(n, { onClick: function () { add(n); } })); });
      if (list.length > shown.length) box.appendChild(h('span', { class: 'muted' }, '共 ' + list.length + ' 项'));
    };
    box.update(names || []);
    return box;
  };
  /* 创建快照 / SLM 时的索引建议。rows 是 GetIndexes 的结果（_cat/indices 的行）：
     先给出至少匹配两个索引的前缀通配符（如 logs-*），再列出已打开的非隐藏索引名 */
  F.indexSuggest = function (rows) {
    var names = (rows || []).filter(function (r) { return r && r.index && r.status !== 'close' && r.index.charAt(0) !== '.'; })
      .map(function (r) { return r.index; }).sort();
    var count = {};
    names.forEach(function (n) { var m = /^[^-_.]+[-_.]/.exec(n); if (m) count[m[0]] = (count[m[0]] || 0) + 1; });
    var wild = Object.keys(count).filter(function (p) { return count[p] > 1; }).sort().map(function (p) { return p + '*'; });
    return wild.concat(names);
  };
  /* 索引输入框 + 建议 chip。o.indexRows 是返回 Promise<rows|undefined> 的回调，到达后填充 chip */
  function indexField(indexRows, limit) {
    var input = UI.input({ placeholder: '留空表示所有索引', mono: true });
    var picks = F.pickList(input, [], limit);
    if (indexRows) Promise.resolve(indexRows()).then(function (rows) { if (rows) picks.update(F.indexSuggest(rows)); });
    return { input: input, node: h('div', { class: 'col', style: { gap: '6px' } }, input, picks) };
  }

  /* ---- 创建仓库 ----
     o: {submit(name, type, settingsJson)->Promise<boolean>, done()} */
  F.createRepo = function (o) {
    var name = UI.input({ placeholder: 'my_backup_repo', mono: true });
    var settings = UI.textarea({ rows: 5, mono: true, placeholder: '例如: ' + EXAMPLE.fs });
    var type = UI.select(TYPES, { value: 'fs', onChange: function (v) { settings.placeholder = '例如: ' + EXAMPLE[v]; } });
    dialog({
      title: '创建仓库', width: '520px', okMsg: '仓库创建成功', done: o.done,
      body: [UI.field('仓库名称', name, { required: true }), UI.field('仓库类型', type, { required: true }),
        UI.field('Settings (JSON)', settings, { hint: '留空表示不设置参数。fs 需要 location，s3 和 gcs 需要 bucket，hdfs 需要 uri 和 path，url 需要 url' })],
      validate: function () {
        if (!name.value.trim()) return '请填写仓库名称';
        var s = settings.value.trim();
        if (s) { try { var v = JSON.parse(s); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); } catch (e) { return 'Settings 不是有效的 JSON 对象'; } }
        return null;
      },
      submit: function () { return o.submit(name.value.trim(), type.value, settings.value.trim()); }
    });
    focusLater(name);
  };

  /* ---- 创建快照 ----
     o: {repos: [仓库名], indexRows()->Promise<GetIndexes 结果>, submit(repo, snapshot, indices, includeGlobalState)->Promise<boolean>, done()} */
  F.createSnapshot = function (o) {
    var opts = repoOptions(o.repos);
    var repo = UI.select(opts, { placeholder: '选择目标仓库' });
    var snap = UI.input({ placeholder: 'snapshot_2026', mono: true });
    var ix = indexField(o.indexRows, 8);
    var gs = UI.switch({ checked: false });
    dialog({
      title: '创建快照', width: '520px', okMsg: '快照开始创建（异步），请稍后刷新查看状态', done: o.done,
      body: [UI.field('仓库名称', repo, { required: true, hint: opts.length ? null : '暂无仓库，请先在“仓库管理”中创建' }),
        UI.field('快照名称', snap, { required: true }),
        UI.field('索引（逗号分隔）', ix.node),
        UI.field('包含全局状态', gs),
        h('div', { class: 'muted' }, '快照将在后台异步创建，可在快照列表中查看进度。')],
      validate: function () {
        if (!repo.value) return '请选择仓库';
        if (!snap.value.trim()) return '请填写快照名称';
        return null;
      },
      submit: function () { return o.submit(repo.value, snap.value.trim(), L.util.join(ix.input.value), gs.checked); }
    });
    focusLater(snap);
  };

  /* ---- 快照详情：result 是 GetSnapshotDetail 返回的完整响应 ---- */
  F.snapshotDetail = function (result) {
    var m = UI.modal({ title: '详情', width: 'min(600px, 90vw)', body: UI.jsonView(result, { maxHeight: '65vh', wrap: true }),
      footer: [UI.btn('关闭', { onClick: function () { m.close(); } })] });
  };

  /* ---- 创建 SLM 策略 ----
     o: {repos, indexRows(), submit({policyId, name, schedule, repository, indices, expireAfter, minCount, maxCount})->Promise<boolean>, done()} */
  F.createSlm = function (o) {
    var opts = repoOptions(o.repos);
    var id = UI.input({ placeholder: 'daily-snapshots', mono: true });
    var tpl = UI.input({ value: '<daily-snap-{now/d}>', mono: true });
    var cron = UI.input({ value: '0 30 1 * * ?', mono: true });
    var repo = UI.select(opts, { placeholder: '选择目标仓库' });
    var ix = indexField(o.indexRows, 6);
    var expire = UI.input({ value: '30d', placeholder: '例如: 30d', mono: true });
    var minI = UI.input({ type: 'number', value: 5, placeholder: '5', mono: true });
    var maxI = UI.input({ type: 'number', value: 50, placeholder: '50', mono: true });
    minI.input.min = '0'; maxI.input.min = '0';
    function count(w) { var s = String(w.value).trim(); return s === '' ? 0 : Number(s); }
    function bad(n) { return isNaN(n) || n < 0 || Math.floor(n) !== n; }
    dialog({
      title: '创建策略', width: '520px', okMsg: 'SLM 策略创建成功', done: o.done,
      body: [UI.field('策略ID', id, { required: true }),
        UI.field('快照名称模板', tpl, { required: true }),
        UI.field('调度计划', cron, { required: true, hint: 'cron 表达式，例如 0 30 1 * * ?（每天凌晨 1:30）' }),
        UI.field('仓库名称', repo, { required: true, hint: opts.length ? null : '暂无仓库，请先在“仓库管理”中创建' }),
        UI.field('索引（逗号分隔）', ix.node),
        UI.field('过期时间', expire),
        h('div', { class: 'snap-row2' }, UI.field('最少保留数', minI), UI.field('最多保留数', maxI))],
      validate: function () {
        if (!id.value.trim()) return '请填写策略ID';
        if (!tpl.value.trim()) return '请填写快照名称模板';
        if (!cron.value.trim()) return '请填写调度计划';
        if (!repo.value) return '请选择仓库';
        if (bad(count(minI)) || bad(count(maxI))) return '保留数必须是不小于 0 的整数';
        return null;
      },
      submit: function () {
        return o.submit({ policyId: id.value.trim(), name: tpl.value.trim(), schedule: cron.value.trim(), repository: repo.value,
          indices: L.util.join(ix.input.value), expireAfter: expire.value.trim(), minCount: count(minI), maxCount: count(maxI) });
      }
    });
    focusLater(id);
  };

  /* ---- 创建 ILM 策略 ----
     o: {submit(policyId, policyJson)->Promise<boolean>, done()}。policyJson 是输入框里的原文，后端原样转发 */
  F.createIlm = function (o) {
    var id = UI.input({ placeholder: 'logs-lifecycle', mono: true });
    var body = UI.textarea({ rows: 12, mono: true, placeholder: JSON.stringify(ILM_SAMPLE, null, 2) });
    body.style.maxHeight = '420px';
    var sample = UI.btn('填入示例', { kind: 'ghost', size: 'sm', onClick: function () { body.value = JSON.stringify(ILM_SAMPLE, null, 2); } });
    dialog({
      title: '创建ILM策略', width: '640px', okText: '保存', okMsg: 'ILM 策略创建成功', done: o.done,
      body: [UI.field('策略ID', id, { required: true }),
        UI.field('策略内容（JSON）', h('div', { class: 'col', style: { gap: '6px', alignItems: 'flex-start' } }, body, sample), { required: true }),
        h('div', { class: 'muted' }, 'ILM策略包含 phases（hot/warm/cold/delete 等），将按索引匹配策略自动执行滚动、缩减、删除等操作')],
      validate: function () {
        if (!id.value.trim() || !body.value.trim()) return '请填写策略ID和策略内容';
        try { JSON.parse(body.value); } catch (e) { return '策略内容不是有效的 JSON：' + e.message; }
        return null;
      },
      submit: function () { return o.submit(id.value.trim(), body.value); }
    });
    focusLater(id);
  };

  /* ---- ILM 详情 ---- */
  F.ilmDetail = function (row) {
    var m = UI.modal({ title: row.name, width: 'min(680px, 90vw)',
      body: UI.jsonView({ policy: row.policy, in_use_by: row.in_use_by }, { maxHeight: '65vh', wrap: true }),
      footer: [UI.btn('关闭', { onClick: function () { m.close(); } })] });
  };
})();
