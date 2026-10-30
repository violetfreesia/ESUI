/* index 页辅助：弹层（抽屉/弹窗）。只定义函数并挂到 ESUI.lib.index，不调用 registerPage。
   index.js 在 mount 时调用 ESUI.lib.index.dialogs(api) 取得各弹层的打开函数，后端读写全部通过 api 回调完成。
   api 回调都返回 Promise；失败时 index.js 已经弹出错误提示：返回 undefined / false，弹层保持打开以便修改后重试。 */
(function () {
  'use strict';
  var h = ESUI.h;
  var L = ((ESUI.lib = ESUI.lib || {}).index = ESUI.lib.index || {});

  function mark(el, bad) { el.classList.toggle('idx-invalid', !!bad); }
  function watch(ctrl) {
    var t = ctrl.input || ctrl;
    t.addEventListener('input', function () { mark(ctrl, false); });
  }
  function parseJson(text) { try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false }; } }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function sample(o) { return JSON.stringify(o, null, 2); }
  function note(kind, text) {
    return h('div', { class: 'idx-note idx-note-' + kind }, UI.icon(kind === 'warn' ? 'alert' : 'info', 14), h('span', null, text));
  }
  /* 索引名的明显错误，返回错误文案；合法返回空串。只拦所有 ES 版本都不接受的写法（冒号在 7.x 起才禁用，所以不拦），其余交给 ES 报错 */
  L.badName = function (n) {
    if (/[A-Z]/.test(n)) return '索引名称必须为小写';
    if (/[\\\/*?"<>|\s,#]/.test(n)) return '索引名称包含非法字符（空格 , # * ? " < > | / \\）';
    if (/^[-_+]/.test(n) || n === '.' || n === '..') return '索引名称不能以 - _ + 开头，也不能是 . 或 ..';
    if (n.length > 255) return '索引名称不能超过 255 个字符';
    return '';
  };

  /* 取消 + 主按钮 */
  function foot(getOv, main) {
    return [UI.btn('取消', { kind: 'ghost', onClick: function () { getOv().close(); } }), main];
  }

  L.dialogs = function (api) {
    var mem = { index: '', dsl: '', msg: '', kind: '' }; // 备份抽屉的记忆值

    function showJson(title, data) {
      var text = typeof data === 'string' ? data : JSON.stringify(data == null ? {} : data, null, 2), ov;
      ov = UI.drawer({
        title: title, width: 'min(640px, 52vw)', body: UI.jsonView(text, { wrap: true }),
        footer: [
          UI.btn('复制', { icon: 'copy', kind: 'ghost', onClick: function () { UI.copy(text); } }),
          UI.btn('关闭', { onClick: function () { ov.close(); } })
        ]
      });
      return ov;
    }

    function openCreate() {
      var tpl = UI.select([], { placeholder: '选择索引模板（可选）', onChange: function (v) { mapping.disabled = !!v; } });
      var tplField = UI.field('从模板创建', tpl, { hint: '正在读取索引模板...' });
      var tplHint = tplField.querySelector('.field-hint');
      var name = UI.input({ placeholder: 'my-index', mono: true });
      var shards = UI.input({ type: 'number', value: 1, mono: true });
      var reps = UI.input({ type: 'number', value: 0, mono: true });
      var mapping = UI.textarea({ rows: 12, mono: true, placeholder: sample({ properties: { created_at: { type: 'date', format: 'yyyy-MM-dd HH:mm:ss' } } }) });
      var save = UI.btn('创建', { kind: 'primary', onClick: submit });
      var ov = UI.drawer({
        title: '创建索引', width: 'min(560px, 46vw)',
        body: [
          tplField,
          UI.field('索引名称', name, { required: true }),
          h('div', { class: 'idx-pair' }, UI.field('主分片', shards, { required: true }), UI.field('副本数量', reps, { required: true })),
          UI.field('mapping', mapping, { hint: '留空则不预设 mapping' })
        ],
        footer: foot(function () { return ov; }, save)
      });
      [name, shards, reps, mapping].forEach(watch);
      setTimeout(function () { name.input.focus(); }, 60);
      // 打开抽屉时读取索引模板（GetIndexTemplates）
      api.templates().then(function (list) {
        if (!list) { tplHint.textContent = '读取索引模板失败'; return; }
        var opts = list.map(function (t) {
          var p = Array.isArray(t.index_patterns) && t.index_patterns.length ? ' (' + t.index_patterns.join(', ') + ')' : '';
          return { value: t.name, label: t.name + p };
        });
        UI.setOptions(tpl, opts, '', '选择索引模板（可选）');
        tplHint.textContent = opts.length ? '选择模板后将忽略下方的 mapping' : '当前集群没有索引模板';
      });

      function submit() {
        var n = name.value.trim(), sh = shards.value.trim(), rp = reps.value.trim();
        var badName = n ? L.badName(n) : '请输入索引名称';
        var badSh = !/^\d+$/.test(sh) || +sh < 1, badRp = !/^\d+$/.test(rp);
        mark(name, !!badName); mark(shards, badSh); mark(reps, badRp);
        if (badName) { name.input.focus(); return UI.warn(badName); }
        if (badSh) return UI.warn('请输入主分片（不小于 1 的整数）');
        if (badRp) return UI.warn('请输入副本数量（不小于 0 的整数）');
        var mp = '';
        if (!tpl.value && mapping.value.trim()) {
          var p = parseJson(mapping.value);
          if (!p.ok || !isObj(p.value)) { mark(mapping, true); return UI.warn('mapping不是合法的json格式'); }
          mp = mapping.value;
        }
        save.setLoading(true);
        api.createIndex({ name: n, shards: +sh, replicas: +rp, template: tpl.value, mapping: mp }).then(function (done) {
          save.setLoading(false);
          if (!done) return;
          UI.ok('索引【' + n + '】创建成功');
          ov.close();
        });
      }
    }

    function openAddDoc(index) {
      var doc = UI.textarea({ rows: 16, mono: true, placeholder: sample({ field1: 'value1', field2: 'value2' }) });
      var save = UI.btn('保存', { kind: 'primary', onClick: submit });
      var ov = UI.drawer({
        title: '添加文档 - ' + index, width: 'min(560px, 46vw)',
        body: [UI.field('文档内容', doc, { required: true, hint: 'JSON 对象，文档 ID 由 Elasticsearch 自动生成' })],
        footer: foot(function () { return ov; }, save)
      });
      watch(doc);
      setTimeout(function () { doc.focus(); }, 60);

      function submit() {
        if (!doc.value.trim()) { mark(doc, true); return UI.warn('请输入文档内容'); }
        var p = parseJson(doc.value);
        if (!p.ok) { mark(doc, true); return UI.warn('文档内容不是合法的 JSON'); }
        if (!isObj(p.value)) { mark(doc, true); return UI.warn('文档内容必须是 JSON 对象'); }
        save.setLoading(true);
        api.addDoc(index, doc.value).then(function (r) {
          save.setLoading(false);
          if (r === undefined) return;
          UI.ok('文档添加成功，id：' + (r && r._id));
          ov.close();
        });
      }
    }

    function openAlias(index) {
      var listBox = h('div', { class: 'idx-alias-list' });
      var name = UI.input({ placeholder: 'my-alias', mono: true, onEnter: function () { add(); } });
      var extra = UI.textarea({ rows: 3, mono: true, placeholder: sample({ filter: { term: { env: 'prod' } }, routing: '1' }) });
      var addBtn = UI.btn('添加别名', { kind: 'primary', onClick: function () { add(); } });
      var ov = UI.modal({
        title: '别名管理 - ' + index, width: '560px',
        body: [
          listBox, h('div', { class: 'idx-sep' }),
          UI.field('新别名', name),
          UI.field('别名参数（可选，如 filter、routing）', extra)
        ],
        footer: [UI.btn('关闭', { kind: 'ghost', onClick: function () { ov.close(); } }), addBtn]
      });
      watch(name); watch(extra);

      function renderList(list) {
        listBox.innerHTML = '';
        if (!list || !list.length) { listBox.appendChild(UI.empty('暂无别名')); return; }
        list.forEach(function (a) {
          listBox.appendChild(h('div', { class: 'idx-alias-row' },
            UI.tag(a, '', { mono: true }), // 别名只是名称，不是状态，用中性标签
            UI.btn('删除', { size: 'sm', kind: 'ghost err', onClick: function () { remove(a); } })));
        });
      }
      // GetIndexAliases([index])：读取失败时（错误提示已由 index.js 弹出）按原应用显示为空列表
      function reload() { return UI.busy(listBox, api.aliasesOf(index), '加载中...').then(renderList); }
      function remove(a) {
        UI.confirm({ title: '移除别名', kind: 'warn', message: '确定要移除别名 ' + a + ' 吗？', okText: '移除别名' }).then(function (ok) {
          if (!ok) return;
          UI.busy(listBox, api.removeAlias(index, a), '加载中...').then(function (done) {
            if (!done) return;
            UI.ok('别名已移除');
            reload();
          });
        });
      }
      function add() {
        var a = name.value.trim();
        if (!a) { mark(name, true); name.input.focus(); return UI.warn('请输入别名'); }
        if (extra.value.trim()) {
          var p = parseJson(extra.value);
          if (!p.ok || !isObj(p.value)) { mark(extra, true); return UI.warn('别名参数不是合法的JSON'); }
        }
        addBtn.setLoading(true);
        api.addAlias(index, a, extra.value.trim()).then(function (done) {
          addBtn.setLoading(false);
          if (!done) return;
          UI.ok('别名添加成功');
          name.value = ''; extra.value = '';
          reload();
        });
      }
      reload();
    }

    function openReindex(index) {
      var src = UI.input({ value: index, mono: true });
      src.input.disabled = true;
      var dest = UI.input({ placeholder: '目标索引名称（可以不存在）', mono: true });
      var query = UI.textarea({ rows: 5, mono: true, placeholder: sample({ term: { status: 'active' } }) });
      var run = UI.btn('执行', { kind: 'primary', onClick: submit });
      var ov = UI.modal({
        title: 'Reindex', width: '560px',
        body: [
          UI.field('源索引', src),
          UI.field('目标索引', dest, { required: true }),
          UI.field('过滤条件（可选，查询子句 JSON）', query),
          h('div', { class: 'idx-hint' }, '数据复制将在后台异步执行，可在 Task 页查看进度')
        ],
        footer: foot(function () { return ov; }, run)
      });
      watch(dest); watch(query);
      setTimeout(function () { dest.input.focus(); }, 60);

      function submit() {
        var d = dest.value.trim();
        if (!d) { mark(dest, true); dest.input.focus(); return UI.warn('请输入目标索引'); }
        var bad = L.badName(d);
        if (bad) { mark(dest, true); return UI.warn(bad); }
        if (query.value.trim()) {
          var p = parseJson(query.value);
          if (!p.ok || !isObj(p.value)) { mark(query, true); return UI.warn('查询DSL不是合法的JSON'); }
        }
        run.setLoading(true);
        api.reindex(index, d, query.value.trim()).then(function (done) {
          run.setLoading(false);
          if (!done) return;
          UI.ok('Reindex 任务已提交（异步执行）');
          ov.close();
        });
      }
    }

    /* Mapping 与 Settings 的编辑弹窗结构相同，只是提示、读取与保存不同；o.value 由 index.js 先用 GetIndexInfo 读好 */
    function openJsonEditor(o) {
      var area = UI.textarea({ rows: 18, mono: true, value: sample(o.value) });
      var save = UI.btn('保存', { kind: 'primary', onClick: submit });
      var ov = UI.modal({
        title: o.title, width: '640px',
        body: [note(o.noteKind, o.note), area],
        footer: foot(function () { return ov; }, save)
      });
      watch(area);
      function submit() {
        var p = parseJson(area.value);
        if (!p.ok || !isObj(p.value)) { mark(area, true); return UI.warn(o.invalid); }
        save.setLoading(true);
        o.save(area.value).then(function (done) {
          save.setLoading(false);
          if (!done) return;
          UI.ok(o.done);
          ov.close();
        });
      }
    }
    function openMapping(index, value) {
      openJsonEditor({
        title: '编辑 Mapping - ' + index, noteKind: 'warn', value: value,
        note: '只能新增字段或修改动态参数，不能修改已有字段的类型，否则 ES 会报错',
        invalid: 'mapping不是合法的json格式', done: 'Mapping 保存成功',
        save: function (text) { return api.saveMapping(index, text); }
      });
    }
    function openSettings(index, value) {
      openJsonEditor({
        title: '编辑 Settings - ' + index, noteKind: 'info', value: value,
        note: '仅支持动态可更新的设置（如 number_of_replicas、refresh_interval）',
        invalid: 'settings不是合法的json格式', done: 'Settings 保存成功',
        save: function (text) { return api.saveSettings(index, text); }
      });
    }

    function openBackup() {
      var idx = UI.input({ placeholder: 'my-index', mono: true, value: mem.index });
      var dsl = UI.textarea({ rows: 14, mono: true, value: mem.dsl, placeholder: sample({ match_all: {} }) });
      var status = h('div', { class: 'idx-status' });
      var start = UI.btn('开始下载', { kind: 'primary', icon: 'download', onClick: go });
      var ov = UI.drawer({
        title: '索引备份（预览）', width: 'min(560px, 46vw)',
        body: [
          h('p', { class: 'idx-hint' }, '按查询条件将索引数据导出为 JSON 文件，保存在用户主目录下。该功能处于预览阶段。'),
          UI.field('备份索引名称', idx, { required: true }),
          UI.field('查询 DSL（查询子句，留空导出全部）', dsl),
          status
        ],
        footer: foot(function () { return ov; }, start)
      });
      watch(idx); watch(dsl); paint();

      function paint() { status.textContent = mem.msg; status.className = 'idx-status' + (mem.kind ? ' idx-status-' + mem.kind : ''); }
      function go() {
        var n = idx.value.trim();
        mem.index = idx.value; mem.dsl = dsl.value;
        if (!n) { mark(idx, true); idx.input.focus(); return UI.warn('请填写索引名'); }
        // 后端把名称原样拼进请求路径：# ? 会截断路径（可能备份到另一个索引），空格和 / \ 无意义。通配符 * 和逗号分隔仍可用
        if (/[#?\s\\\/]/.test(n)) { mark(idx, true); idx.input.focus(); return UI.warn('备份索引名称不能包含空格 # ? / \\，匹配多个索引请用 * 或逗号分隔'); }
        if (dsl.value.trim()) {
          var p = parseJson(dsl.value);
          if (!p.ok || !isObj(p.value)) { mark(dsl, true); return UI.warn('查询DSL不是合法的JSON'); }
        }
        start.setLoading(true);
        mem.msg = '正在备份 ' + n + ' ...'; mem.kind = ''; paint();
        api.backup(n, dsl.value.trim()).then(function (r) {
          start.setLoading(false);
          if (r.err) { mem.msg = r.err; mem.kind = 'err'; paint(); return UI.err(r.err); }
          mem.msg = '备份成功 ' + r.path; mem.kind = 'ok'; paint();
          UI.ok(mem.msg);
          ov.close();
        });
      }
    }

    return { showJson: showJson, openCreate: openCreate, openAddDoc: openAddDoc, openAlias: openAlias, openReindex: openReindex,
      openMapping: openMapping, openSettings: openSettings, openBackup: openBackup };
  };
})();
