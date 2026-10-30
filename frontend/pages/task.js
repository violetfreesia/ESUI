/* Task (key: task). Backend (ESUI.api.es): GetTasks -> rows {task_id, parent_task_id, node_name, node_ip, type, action,
   start_time_in_millis, running_time_in_nanos, cancellable}; CancelTasks(taskId) -> the _cancel response.
   Loads when the page is first opened, on refresh, after a cancel and on cluster switch (like the Vue page, which is kept alive). */
(function () {
  'use strict';
  var h = ESUI.h, F = UI.fmt, api = ESUI.api;

  function fmtRun(nanos) {
    var ms = Math.round(nanos / 1e6);
    return ms < 1000 ? ms + ' ms' : F.millis(ms);
  }
  function has(s, q) { return !q || String(s == null ? '' : s).toLowerCase().indexOf(q) >= 0; }

  ESUI.registerPage('task', {
    title: 'Task',
    mount: function (root, def) {
      var st = { rows: [], n: 0, gen: 0, seq: 0 };
      var flt = { id: '', node: '', act: '' };
      var drawer = null;
      var emptyEl = h('div');

      var refreshBtn = UI.btn('刷新', { icon: 'refresh', onClick: function () { load(true); } });
      var exportBtn = UI.btn('导出 CSV', { icon: 'download', onClick: exportCsv });
      def.topActions = [refreshBtn, exportBtn]; // shown at the right of the top strip while this page is open

      var idIn = UI.input({ placeholder: '任务ID', width: '160px', mono: true, clearable: true, onEnter: apply, onClear: apply });
      var nodeIn = UI.input({ placeholder: '任务节点', width: '160px', clearable: true, onEnter: apply, onClear: apply });
      var actIn = UI.input({ placeholder: '任务行为', width: '160px', mono: true, clearable: true, onEnter: apply, onClear: apply });
      var queryBtn = UI.btn('查询', { kind: 'primary', icon: 'search', onClick: apply });

      var table = UI.table({
        fill: true, striped: true, pageSize: 10, pageSizes: [5, 10, 20, 30, 40], empty: emptyEl,
        columns: [
          { key: 'task_id', title: '任务ID', width: 260, mono: true, fixed: 'left' },
          { key: 'parent_task_id', title: '父任务ID', width: 260, mono: true, render: function (r) {
            return r.parent_task_id ? r.parent_task_id : h('span', { class: 'muted' }, '-');
          } },
          { key: 'node_name', title: '任务节点', width: 120, mono: true },
          { key: 'node_ip', title: 'IP', width: 110, mono: true },
          { key: 'type', title: '类型', width: 90 },
          { key: 'action', title: '任务行为', width: 260, render: function (r) { return UI.tag(r.action, null, { mono: true }); } },
          { key: 'start_time_in_millis', title: '开始时间', width: 160, mono: true, render: function (r) { return F.date(r.start_time_in_millis); } },
          { key: 'running_time_in_nanos', title: '运行时间', width: 100, align: 'right', mono: true, render: function (r) { return fmtRun(r.running_time_in_nanos); } },
          { key: 'cancellable', title: '是否可取消', width: 110, sortValue: function (r) { return r.cancellable ? 1 : 0; }, render: function (r) {
            return r.cancellable ? UI.tag('是') : h('span', { class: 'muted' }, '否');
          } },
          { key: 'ops', title: '操作', width: 100, sortable: false, render: function (r) {
            var b = UI.btn('终止', { size: 'sm', kind: 'ghost err', icon: 'stop', disabled: !r.cancellable, onClick: function () { cancelTask(r); } });
            // a disabled button swallows pointer events, so the hint hangs on a wrapper
            return r.cancellable ? b : UI.tip(h('span', { class: 'task-nocancel' }, b), '该任务不支持取消');
          } }
        ]
      });
      table.classList.add('task-tbl');

      function match(r) { return has(r.task_id, flt.id) && has(r.node_name, flt.node) && has(r.action, flt.act); }
      function syncEmpty() {
        emptyEl.innerHTML = '';
        var e;
        if (!ESUI.state.cluster) e = UI.empty('未连接集群', '请先在“集群”页连接一个集群');
        else if (!st.rows.length) e = UI.empty('当前没有运行中的任务', '提交 Reindex、按查询更新等后台任务后，会显示在这里');
        else e = UI.empty('没有符合条件的任务', '调整筛选条件后重新查询');
        emptyEl.appendChild(e);
      }
      function readFilters() {
        flt.id = idIn.value.trim().toLowerCase();
        flt.node = nodeIn.value.trim().toLowerCase();
        flt.act = actIn.value.trim().toLowerCase();
      }
      /* a fresh list is filtered with whatever the three inputs hold, as the Vue page does */
      function fill(rows) {
        st.rows = rows;
        readFilters(); syncEmpty(); table.setRows(st.rows); table.setFilter(match);
      }
      function apply() { readFilters(); syncEmpty(); table.setFilter(match); }
      function load(manual) {
        if (!ESUI.state.cluster) { fill([]); if (manual) UI.warn('未连接集群'); return; }
        var g = st.gen, my = ++st.seq;
        st.n++; refreshBtn.setLoading(true);
        return api.guard(UI.busy(table, api.es.GetTasks()), '获取任务失败：').then(function (rows) {
          if (--st.n === 0) refreshBtn.setLoading(false);
          if (g !== st.gen || my !== st.seq || rows === undefined) return; // cluster switched, or a newer load is in flight
          // the backend walks a Go map, so the order changes from call to call: keep the list stable
          rows = rows.slice().sort(function (a, b) {
            return (a.start_time_in_millis - b.start_time_in_millis) || String(a.task_id).localeCompare(String(b.task_id));
          });
          fill(rows);
          if (manual) UI.ok('已刷新，共 ' + rows.length + ' 个任务');
        });
      }
      function showResult(result) {
        if (drawer) drawer.close();
        drawer = UI.drawer({ title: '终止结果', width: 'min(640px, 50vw)', body: UI.jsonView(result == null ? {} : result, { wrap: true }) });
      }
      /* number of tasks below `id` in the parent_task_id tree (all levels), cancelling the parent cancels them too */
      function descendants(id) {
        var kids = {}, seen = {}, n = 0;
        seen[id] = true;
        st.rows.forEach(function (x) { if (x.parent_task_id) (kids[x.parent_task_id] = kids[x.parent_task_id] || []).push(x.task_id); });
        (function walk(p) {
          (kids[p] || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; n++; walk(c); } });
        })(id);
        return n;
      }
      function cancelTask(r) {
        var kids = descendants(r.task_id);
        UI.confirm({
          title: '终止任务', kind: 'danger', okText: '终止任务',
          message: '确定要终止任务 ' + r.task_id + '（' + r.action + '）吗？' + (kids ? '它的 ' + kids + ' 个子任务会一并取消。' : '') + '已经写入的数据不会回滚。'
        }).then(function (ok) {
          if (!ok) return;
          var g = st.gen;
          return api.guard(UI.busy(table, api.es.CancelTasks(r.task_id), '正在终止任务...'), '终止任务失败：').then(function (res) {
            if (g !== st.gen) return;
            if (res !== undefined) { UI.ok('已发送终止请求'); showResult(res); }
            return load(false); // refresh after success and failure alike, as the Vue page does
          });
        });
      }
      function exportCsv() {
        var rows = table.getView();
        if (!rows.length) return UI.warn('暂无数据可导出');
        UI.exportCsv('任务列表.csv',
          ['任务ID', '父任务ID', '任务节点', 'IP', '类型', '任务行为', '开始时间', '运行时间(ns)', '是否可取消'],
          rows.map(function (r) {
            return [r.task_id, r.parent_task_id, r.node_name, r.node_ip, r.type, r.action, F.date(r.start_time_in_millis),
              r.running_time_in_nanos, r.cancellable ? '是' : '否'];
          }));
        UI.ok('已导出 ' + rows.length + ' 个任务');
      }

      root.append(h('div', { class: 'page-body task-body' }, UI.toolbar(idIn, nodeIn, actIn, queryBtn), table));
      syncEmpty();
      load(false);

      ESUI.on('cluster', function () {
        st.gen++;
        if (drawer) { drawer.close(); drawer = null; }
        fill([]);
        load(false);
      });
    }
  });
})();
