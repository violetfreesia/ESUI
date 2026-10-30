/* 快照管理 (_snapshot / _slm / _ilm)：仓库、快照、恢复、SLM、ILM 五个标签页。
   数据来自 ESUI.api.es.*（见 js/api.js），弹窗由 snapshot-forms.js 提供（mount 时才读取）。
   与原应用一致：已连接集群时，进入页面一次加载仓库、快照、SLM、ILM；恢复进度只在点“刷新”和提交恢复后读取。 */
(function () {
  'use strict';
  var h = ESUI.h, api = ESUI.api, es = api.es;
  var STATE_KIND = { SUCCESS: 'ok', FAILED: 'err', IN_PROGRESS: 'info' };   // 其他状态（如 PARTIAL）显示 warn
  var STAGE_KIND = { DONE: 'ok', INDEX: 'info' };                          // 其他阶段显示 warn
  var RESTORE_TIP = '仅状态为 SUCCESS 的快照可以恢复';
  var W_TIME = 232;   // ES 返回的是 2026-10-30T01:30:00.123Z 这样的原始字符串（24 个等宽字符），比格式化后的时间更宽

  function acts() { return h('div', { class: 'row', style: { gap: '4px' } }, Array.prototype.slice.call(arguments)); }
  function link(label, kind, onClick, o) { return UI.btn(label, Object.assign({ kind: 'ghost ' + kind, size: 'sm', onClick: onClick }, o || {})); }
  function dash(v) { return v || '-'; }
  function num(v) { return v == null ? '-' : String(v); }
  function pctOf(r) { return r.bytes_total ? Math.round(r.bytes_recovered / r.bytes_total * 100) : -1; }
  function connected() { return !!ESUI.state.cluster; }
  function noClusterEmpty() { return UI.empty('请先连接集群', '在「集群」页连接一个集群后，这里会显示快照数据', 'cluster'); }
  /* SLM 的时间：ES 只有在带 ?human 时才返回 time_string / next_execution，否则只有毫秒值。
     有字符串用字符串，没有就把毫秒值转成同样的 ISO 格式（UTC），整页的时间格式保持一致 */
  function when(text, millis) {
    if (text) return text;
    var d = millis ? new Date(millis) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString() : '';
  }
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* Vue 对 _recovery 响应的解析：{ 索引名: { shards: [...] } } 展开成每个分片一行 */
  function parseRecovery(result) {
    var list = [], all = result || {};
    Object.keys(all).forEach(function (index) {
      var info = all[index] || {}, shards = Array.isArray(info.shards) ? info.shards : [];
      shards.forEach(function (s) {
        var size = s.index && s.index.size;
        list.push({ index: index, shard: s.id, type: s.type, stage: s.stage,
          source_node: (s.source && s.source.name) || '-', target_node: (s.target && s.target.name) || '-',
          bytes_recovered: (size && size.recovered_in_bytes) || 0, bytes_total: (size && size.total_in_bytes) || 0 });
      });
    });
    return list;
  }

  ESUI.registerPage('snapshot', {
    title: '快照管理',
    mount: function (root) {
      var L = ESUI.lib && ESUI.lib.snapshot;
      if (!L || !L.forms) {
        root.append(h('div', { class: 'page-body' }, UI.empty('页面脚本未加载完整', '需要在 index.html 中引入 snapshot-forms.js')));
        return;
      }
      var forms = L.forms, tabs = null, gen = 0, noCluster = false;
      var data = { repos: [], snaps: [] };   // 恢复表单的下拉和创建弹窗都从这里取，来源是最近一次成功的加载
      var ctl = {};

      /* 调用后端：失败时提示并得到 undefined；后端说“请先选择一个集群”时清空页面并显示空状态 */
      function call(p, prefix) {
        return Promise.resolve(p).catch(function (e) {
          api.report(e, prefix);
          if (api.isNoCluster(e)) markNoCluster();
          return undefined;
        });
      }
      function ok(p, prefix) { return call(p, prefix).then(function (r) { return r !== undefined; }); }
      function markNoCluster() {
        if (noCluster) return;
        noCluster = true; gen++;
        data.repos = []; data.snaps = [];
        Object.keys(ctl).forEach(function (k) { ctl[k].reset(); });
      }
      function emptyNode(text) { return connected() && !noCluster ? UI.empty(text[0], text[1]) : noClusterEmpty(); }
      function byText(key, dir) {
        return function (a, b) { return dir * String(a[key] == null ? '' : a[key]).localeCompare(String(b[key] == null ? '' : b[key])); };
      }
      /* the backend builds these lists from Go maps (random order per call), so every list gets a fixed order; ties fall through to the next comparator */
      function thenBy() {
        var fs = arguments;
        return function (a, b) { for (var i = 0; i < fs.length; i++) { var r = fs[i](a, b); if (r) return r; } return 0; };
      }

      /* 加载器：显示遮罩，丢弃已被取代（再次点刷新）或属于旧集群的响应；apply 只在成功时调用 */
      function loader(table, refresh, fetch, apply) {
        var seq = 0;
        return function () {
          if (!connected()) return Promise.resolve();
          var g = gen, my = ++seq;
          refresh.setLoading(true);
          return UI.busy(table, fetch(), '加载中...').then(function (res) {
            if (g !== gen || my !== seq) return;
            refresh.setLoading(false);
            apply(res);
          });
        };
      }
      /* 确认框 -> 带遮罩执行 work()（返回 Promise<boolean>）-> 成功后提示并刷新。切换集群后不再刷新 */
      function confirmThen(opts, tab, work, okMsg, after) {
        return UI.confirm(opts).then(function (yes) {
          if (!yes) return;
          var g = gen;
          return UI.busy(tab.table, work(), '处理中...').then(function (done) {
            if (!done) return;
            UI.ok(okMsg);
            if (g === gen && after) after();
          });
        });
      }
      /* 标准标签页：工具栏（刷新 + 创建）+ 撑满的表格。
         o: {columns, sort, empty:[标题,说明], create:{label,onClick}, fetch()->Promise<rows|undefined>, onData(rows)} */
      function makeTab(o) {
        var refresh = UI.btn('刷新', { icon: 'refresh', onClick: function () { t.load(); } });
        var create = o.create ? UI.btn(o.create.label, { kind: 'primary', icon: 'plus', onClick: o.create.onClick }) : null;
        var table = UI.table({ fill: true, pager: false, striped: true, columns: o.columns, empty: noClusterEmpty() });
        if (o.sort) table.sortBy(o.sort[0], o.sort[1]);
        var t = {
          table: table,
          render: function (panel) { panel.append(UI.toolbar(refresh, create), table); },
          set: function (rows) { table.setEmpty(emptyNode(o.empty)); table.setRows(rows); },
          reset: function () {
            refresh.setLoading(false);
            refresh.disabled = !connected();
            if (create) create.disabled = !connected();
            t.set([]);
          }
        };
        t.load = loader(table, refresh, o.fetch, function (rows) {
          if (rows === undefined) return;
          noCluster = false;
          t.set(rows);
          if (o.onData) o.onData(rows);
        });
        return t;
      }

      /* ---------- 仓库管理 ---------- */
      function verifyRepo(name, btn) {
        btn.setLoading(true);
        call(es.VerifySnapshotRepository(name), '验证失败：').then(function (res) {
          btn.setLoading(false);
          if (res !== undefined) UI.ok('仓库验证通过，所有节点可访问');
        });
      }
      function deleteRepo(name) {
        confirmThen({ title: '警告', kind: 'warn',
          message: '确定要删除快照仓库「' + name + '」吗？这不会删除仓库中已有的快照数据文件，但会从ES集群中移除此仓库的注册信息。' },
          ctl.repo, function () { return ok(es.DeleteSnapshotRepository(name), '删除仓库失败：'); }, '仓库已删除', function () {
            // 仓库注销后它的快照不会再被列出，本地先去掉，免得快照列表和恢复下拉里留着已不存在的仓库
            data.snaps = data.snaps.filter(function (s) { return s.repository !== name; });
            ctl.snap.set(data.snaps);
            ctl.repo.load();
          });
      }
      ctl.repo = makeTab({
        fetch: function () {
          return call(es.GetSnapshotRepositories(), '获取仓库失败：').then(function (rows) { return rows && rows.sort(byText('name', 1)); });
        },
        sort: ['name', 'asc'],
        onData: function (rows) { data.repos = rows; ctl.restore.sync(); },
        empty: ['暂无仓库', '点击“创建仓库”注册一个快照仓库'],
        create: { label: '创建仓库', onClick: function () {
          forms.createRepo({
            submit: function (name, type, settings) { return ok(es.CreateSnapshotRepository(name, type, settings), '创建仓库失败：'); },
            done: function () { ctl.repo.load(); }
          });
        } },
        columns: [
          { key: 'name', title: '仓库名称', width: 180, mono: true },
          { key: 'type', title: '类型', width: 100, mono: true },
          { key: 'settings', title: 'Settings', sortable: false, render: function (r) {
            if (!r.settings) return '-';
            var json = JSON.stringify(r.settings);
            return h('span', { class: 'mono', title: json }, json);
          } },
          { key: 'actions', title: '操作', width: 150, sortable: false, render: function (r) {
            var verify = link('验证', 'info', function () { verifyRepo(r.name, verify); });
            return acts(verify, link('删除', 'err', function () { deleteRepo(r.name); }));
          } }
        ]
      });

      /* ---------- 快照管理 ---------- */
      function indexRows() { return call(es.GetIndexes(''), '获取索引列表失败：'); }   // 创建弹窗里的索引建议
      function repoNames() { return data.repos.map(function (r) { return r.name; }); }
      function showDetail(repo, name, btn) {
        btn.setLoading(true);
        call(es.GetSnapshotDetail(repo, name), '获取快照详情失败：').then(function (res) {
          btn.setLoading(false);
          if (res !== undefined) forms.snapshotDetail(res);
        });
      }
      function deleteSnapshot(repo, name) {
        confirmThen({ title: '警告', kind: 'warn', message: '确定要删除仓库「' + repo + '」中的快照「' + name + '」吗？此操作不可逆。' },
          ctl.snap, function () { return ok(es.DeleteSnapshot(repo, name), '删除快照失败：'); }, '快照已删除', function () { ctl.snap.load(); });
      }
      ctl.snap = makeTab({
        // 与原应用一致：按 start_time 字符串倒序；同一份数据也是恢复下拉的来源
        fetch: function () {
          return call(es.GetSnapshots(), '获取快照失败：').then(function (rows) {
            return rows && rows.sort(thenBy(byText('start_time', -1), byText('repository', 1), byText('snapshot', 1)));
          });
        },
        onData: function (rows) { data.snaps = rows; ctl.restore.sync(); },
        sort: ['start_time', 'desc'],
        empty: ['暂无快照', '点击“创建快照”备份索引'],
        create: { label: '创建快照', onClick: function () {
          forms.createSnapshot({
            repos: repoNames(), indexRows: indexRows,
            submit: function (repo, name, indices, gs) { return ok(es.CreateSnapshot(repo, name, indices, gs), '创建快照失败：'); },
            done: function () { ctl.snap.load(); }
          });
        } },
        columns: [
          { key: 'snapshot', title: '快照名称', width: 240, mono: true },
          { key: 'repository', title: '仓库', width: 130, mono: true },
          { key: 'state', title: '状态', width: 132, render: function (s) { return UI.tag(s.state || '-', STATE_KIND[s.state] || 'warn'); } },
          { key: 'start_time', title: '开始时间', width: W_TIME, mono: true, render: function (s) { return dash(s.start_time); } },
          { key: 'end_time', title: '结束时间', width: W_TIME, mono: true, render: function (s) { return dash(s.end_time); } },
          { key: 'indices', title: '索引数', width: 80, align: 'right', mono: true,
            sortValue: function (s) { return Array.isArray(s.indices) ? s.indices.length : 0; },
            render: function (s) { return String(Array.isArray(s.indices) ? s.indices.length : 0); } },
          { key: 'total_shards', title: '总分片', width: 80, align: 'right', mono: true, render: function (s) { return num(s.total_shards); } },
          { key: 'successful_shards', title: '成功分片', width: 90, align: 'right', mono: true, render: function (s) { return num(s.successful_shards); } },
          { key: 'actions', title: '操作', width: 190, fixed: 'right', sortable: false, render: function (s) {
            var canRestore = s.state === 'SUCCESS';
            // the shared ghost style has no warn colour, so snap-act-warn adds it; a disabled button swallows pointer events,
            // so the "why disabled" hint sits on a wrapper span
            var run = link('执行', 'warn', function () { ctl.restore.prefill(s.repository, s.snapshot); tabs.select('restore'); },
              { class: 'snap-act-warn', disabled: !canRestore, title: canRestore ? '用该快照填写恢复表单' : null });
            var detail = link('详情', 'info', function () { showDetail(s.repository, s.snapshot, detail); });
            return acts(detail, canRestore ? run : h('span', { title: RESTORE_TIP }, run),
              link('删除', 'err', function () { deleteSnapshot(s.repository, s.snapshot); }));
          } }
        ]
      });

      /* ---------- 快照恢复 ---------- */
      ctl.restore = (function () {
        var repoSel = UI.select([], { placeholder: '选择目标仓库', onChange: function () { onRepo(); } });
        var snapSel = UI.select([], { placeholder: '选择要恢复的快照', onChange: function () { updatePicks(); } });
        var idx = UI.input({ placeholder: '留空表示所有索引', mono: true });
        var picks = forms.pickList(idx, [], 8);
        var pat = UI.input({ placeholder: '例如: index_(.+)', mono: true });
        var rep = UI.input({ placeholder: '例如: restored_index_$1', mono: true });
        var gs = UI.switch({ checked: false });
        var run = UI.btn('执行', { kind: 'warn', onClick: function () { submit(); } });
        var refresh = UI.btn('刷新', { icon: 'refresh', onClick: function () { t.load(); } });
        var table = UI.table({ pager: false, striped: true, maxHeight: '320px', empty: noClusterEmpty(),
          columns: [
            { key: 'index', title: '索引', width: 200, mono: true },
            { key: 'shard', title: '分片', width: 70, align: 'right', mono: true },
            { key: 'type', title: '类型', width: 130, mono: true },
            { key: 'stage', title: '阶段', width: 110, render: function (r) { return UI.tag(r.stage || '-', STAGE_KIND[r.stage] || 'warn'); } },
            { key: 'source_node', title: '源节点', width: 140, mono: true },
            { key: 'target_node', title: '目标节点', width: 140, mono: true },
            { key: 'progress', title: '进度', width: 160, sortValue: pctOf, render: function (r) {
              return r.bytes_total === 0 ? '-' : UI.progress(pctOf(r), { kind: r.stage === 'DONE' ? 'ok' : 'info', width: '100%' });
            } }
          ] });

        function snapRow(repo, name) {
          return data.snaps.filter(function (s) { return s.repository === repo && s.snapshot === name; })[0];
        }
        function updatePicks() {
          var s = snapSel.value ? snapRow(repoSel.value, snapSel.value) : null;
          picks.update(s && Array.isArray(s.indices) ? s.indices : []);
        }
        /* 快照下拉：只列出所选仓库中 SUCCESS 的快照（data.snaps 已按开始时间倒序）；keep 为希望保留的选中项 */
        function fillSnaps(keep) {
          var names = repoSel.value ? data.snaps.filter(function (s) { return s.repository === repoSel.value && s.state === 'SUCCESS'; })
            .map(function (s) { return s.snapshot; }) : [];
          UI.setOptions(snapSel, names, names.indexOf(keep) >= 0 ? keep : '', '选择要恢复的快照');
          updatePicks();
        }
        /* 按最新的仓库和快照数据重建两个下拉，尽量保留当前选择 */
        function sync() {
          var names = repoNames(), keep = repoSel.value;
          UI.setOptions(repoSel, names, names.indexOf(keep) >= 0 ? keep : '', '选择目标仓库');
          fillSnaps(snapSel.value);
        }
        function onRepo() {
          fillSnaps('');
          // 与原应用一致：快照列表还是空的就先拉一次，加载完成后 ctl.snap 的 onData 会再同步下拉
          if (repoSel.value && !data.snaps.length) ctl.snap.load();
        }
        function prefill(repo, snap) {
          sync();
          repoSel.value = repo;
          idx.value = '';
          fillSnaps(snap);
        }
        function submit() {
          var repo = repoSel.value, snap = snapSel.value, p = pat.value.trim(), r = rep.value.trim();
          if (!repo || !snap) { UI.warn('请选择仓库和快照'); return; }
          if (!p !== !r) { UI.warn('重命名模式和重命名替换需要同时填写'); return; }
          if (p) { try { new RegExp(p); } catch (e) { UI.warn('重命名模式不是有效的正则表达式'); return; } }
          UI.confirm({ title: '警告', kind: 'warn',
            message: '即将从仓库「' + repo + '」恢复快照「' + snap + '」。恢复操作会在集群中创建索引数据，请确认已了解影响。' }).then(function (yes) {
            if (!yes) return;
            var g = gen;
            run.setLoading(true);
            return call(es.RestoreSnapshot(repo, snap, L.util.join(idx.value), p, r, gs.checked), '恢复失败：').then(function (res) {
              run.setLoading(false);
              if (res === undefined) return;
              UI.ok('恢复任务已提交（异步执行），请查看恢复进度');
              if (g === gen) return t.load();
            });
          });
        }

        var form = h('div', { class: 'snap-form' },
          h('div', { class: 'snap-row2' }, UI.field('仓库名称', repoSel), UI.field('快照名称', snapSel)),
          UI.field('索引（逗号分隔）', h('div', { class: 'col', style: { gap: '6px' } }, idx, picks)),
          h('div', { class: 'snap-row2' }, UI.field('重命名模式', pat), UI.field('重命名替换', rep)),
          UI.field('包含全局状态', gs));
        var warn = h('div', { class: 'snap-warn' }, UI.icon('alert', 14),
          h('span', null, '警告：恢复操作会在集群中创建索引，如果同名索引已存在且未关闭，恢复将失败。建议使用重命名功能避免冲突。'));
        var t = {
          table: table, sync: sync, prefill: prefill,
          render: function (panel) {
            panel.append(UI.toolbar(refresh),
              h('section', { class: 'snap-sec' }, h('h3', { class: 'snap-h' }, '恢复参数'), form, h('div', { class: 'snap-run' }, run, warn)),
              h('section', { class: 'snap-sec' }, h('h3', { class: 'snap-h' }, '结果'), table));
          },
          set: function (rows) {
            table.setEmpty(connected() && !noCluster ? UI.empty('暂无进行中的恢复', '提交恢复任务后点击“刷新”查看进度') : noClusterEmpty());
            table.setRows(rows);
          },
          reset: function () {
            idx.value = ''; pat.value = ''; rep.value = ''; gs.checked = false;
            sync(); t.set([]);
            refresh.setLoading(false);
            refresh.disabled = run.disabled = !connected();
          }
        };
        // 读取 GET _recovery?active_only=true；失败时和原应用一样清空表格
        t.load = loader(table, refresh, function () { return call(es.GetSnapshotRestoreStatus(), '获取恢复进度失败：'); }, function (res) {
          t.set(res === undefined ? [] : parseRecovery(res));
        });
        return t;
      })();

      /* ---------- 自动策略 (SLM) ---------- */
      function executeSlm(id) {
        confirmThen({ title: '确认执行', kind: 'info', message: '确定要立即执行策略「' + id + '」创建一个快照吗？' },
          ctl.slm, function () { return ok(es.ExecuteSLMPolicy(id), '执行策略失败：'); }, '策略已触发执行，快照正在创建');
      }
      function deleteSlm(id) {
        confirmThen({ title: '警告', kind: 'warn', message: '确定要删除自动快照策略「' + id + '」吗？已创建的快照不会被删除。' },
          ctl.slm, function () { return ok(es.DeleteSLMPolicy(id), '删除策略失败：'); }, '策略已删除', function () { ctl.slm.load(); });
      }
      /* 取策略里的字段（policy.xxx）：同时给出排序值和显示内容 */
      function pf(k) {
        return { sortValue: function (p) { return (p.policy || {})[k]; }, render: function (p) { return dash((p.policy || {})[k]); } };
      }
      ctl.slm = makeTab({
        fetch: function () {
          return call(es.GetSLMPolicies(), '获取 SLM 策略失败：').then(function (rows) { return rows && rows.sort(byText('name', 1)); });
        },
        sort: ['name', 'asc'],
        empty: ['暂无自动策略', '点击“创建策略”按计划自动备份'],
        create: { label: '创建策略', onClick: function () {
          forms.createSlm({
            repos: repoNames(), indexRows: indexRows,
            // 参数顺序见 ESService.d.ts：policyId, name, schedule, repository, indices, expireAfter, minCount, maxCount
            submit: function (f) {
              return ok(es.CreateSLMPolicy(f.policyId, f.name, f.schedule, f.repository, f.indices, f.expireAfter, f.minCount || 0, f.maxCount || 0), '创建策略失败：');
            },
            done: function () { ctl.slm.load(); }
          });
        } },
        columns: [
          { key: 'name', title: '策略ID', width: 170, mono: true },
          Object.assign({ key: 'repository', title: '仓库', width: 130, mono: true }, pf('repository')),
          Object.assign({ key: 'schedule', title: '调度计划', width: 150, mono: true }, pf('schedule')),
          Object.assign({ key: 'snapshot_name', title: '快照名称模板', width: 210, mono: true }, pf('name')),
          { key: 'next_execution', title: '下次执行', width: W_TIME, mono: true,
            sortValue: function (p) { return p.next_execution_millis; },
            render: function (p) { return dash(when(p.next_execution, p.next_execution_millis)); } },
          { key: 'last_success', title: '最近成功', width: W_TIME, mono: true,
            sortValue: function (p) { return p.last_success ? p.last_success.time : 0; },
            render: function (p) { var s = p.last_success; return dash(s && when(s.time_string, s.time)); } },
          { key: 'last_failure', title: '最近失败', width: W_TIME,
            sortValue: function (p) { return p.last_failure ? p.last_failure.time : 0; },
            render: function (p) {
              var f = p.last_failure, text = f && when(f.time_string, f.time);
              if (!text) return '-';
              return UI.tip(UI.tag(text, 'err', { mono: true }), function () {
                return UI.kvList([['快照', f.snapshot_name || '-'], ['原因', short(f.details, 500) || '-']]);
              });
            } },
          { key: 'actions', title: '操作', width: 120, fixed: 'right', sortable: false, render: function (p) {
            return acts(link('执行', 'info', function () { executeSlm(p.name); }), link('删除', 'err', function () { deleteSlm(p.name); }));
          } }
        ]
      });

      /* ---------- 生命周期 (ILM) ---------- */
      function phasesOf(p) {
        var ph = p.policy && p.policy.phases;
        return ph && typeof ph === 'object' ? Object.keys(ph).join(', ') : '';
      }
      function usedOf(p) {
        var ix = p.in_use_by && p.in_use_by.indices;
        return Array.isArray(ix) ? ix : [];
      }
      function deleteIlm(id) {
        confirmThen({ title: '警告', kind: 'warn', message: '确定要删除ILM策略「' + id + '」吗？正在使用该策略的索引将不再受生命周期管理。' },
          ctl.ilm, function () { return ok(es.DeleteILMPolicy(id), '删除 ILM 策略失败：'); }, 'ILM 策略已删除', function () { ctl.ilm.load(); });
      }
      ctl.ilm = makeTab({
        fetch: function () {
          return call(es.GetILMPolicies(), '获取 ILM 策略失败：').then(function (rows) { return rows && rows.sort(byText('name', 1)); });
        },
        sort: ['name', 'asc'],
        empty: ['暂无ILM策略', '点击“创建ILM策略”定义索引生命周期'],
        create: { label: '创建ILM策略', onClick: function () {
          forms.createIlm({
            submit: function (id, body) { return ok(es.CreateILMPolicy(id, body), '创建 ILM 策略失败：'); },
            done: function () { ctl.ilm.load(); }
          });
        } },
        columns: [
          { key: 'name', title: '策略ID', width: 180, mono: true },
          { key: 'phases', title: '阶段', width: 190, mono: true, sortValue: phasesOf, render: function (p) { return dash(phasesOf(p)); } },
          { key: 'in_use_by', title: '应用索引', width: 340, sortValue: function (p) { return usedOf(p).length; }, render: function (p) {
            var list = usedOf(p);
            return list.length ? h('div', { class: 'snap-wrap mono' }, list.join(', ')) : '-';   // 全部列出，换行显示，不截断
          } },
          { key: 'modified_date', title: '修改时间', width: W_TIME, mono: true, render: function (p) { return dash(p.modified_date); } },
          { key: 'actions', title: '操作', width: 130, fixed: 'right', sortable: false, render: function (p) {
            return acts(link('详情', 'info', function () { forms.ilmDetail(p); }), link('删除', 'err', function () { deleteIlm(p.name); }));
          } }
        ]
      });

      /* ---------- 标签页与集群切换 ---------- */
      tabs = UI.tabs({
        variant: 'line', active: 'repo',
        items: [
          { key: 'repo', label: '仓库管理', render: ctl.repo.render },
          { key: 'snapshot', label: '快照管理', render: ctl.snap.render },
          { key: 'restore', label: '快照恢复', render: ctl.restore.render, onShow: function () { ctl.restore.sync(); } },
          { key: 'slm', label: '自动策略 (SLM)', render: ctl.slm.render },
          { key: 'ilm', label: '生命周期 (ILM)', render: ctl.ilm.render }
        ]
      });
      /* 切换集群：丢弃旧集群的在途响应，清空所有数据，标签页回到初始状态；已连接则重新加载四类数据（恢复进度除外） */
      function resetAll() {
        gen++; noCluster = false;
        data.repos = []; data.snaps = [];
        var c = ESUI.state.cluster;
        Object.keys(ctl).forEach(function (k) { ctl[k].reset(); });
        tabs.select('repo');
        if (c) { ctl.repo.load(); ctl.snap.load(); ctl.slm.load(); ctl.ilm.load(); }
      }
      root.append(tabs);
      resetAll();
      ESUI.on('cluster', resetAll);
    }
  });
})();
