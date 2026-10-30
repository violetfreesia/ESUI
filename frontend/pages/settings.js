/* 设置 (window size, theme, process info). Mirrors Settings.vue; the language selector is gone (Chinese only).
   - width / height come from AppConfig.GetConfig and are written back with SaveConfig + WindowSetSize.
   - The theme switch drives ESUI.theme and persists it with SaveTheme;
     the 'theme' event drives the switch back, so it also follows the theme restored from the saved config.
   - Process info comes from Update.GetProcessInfo when the page opens and on every refresh. */
(function () {
  'use strict';
  var h = ESUI.h, api = ESUI.api;
  var DEFAULTS = { width: 1180, height: 760 };
  var WIDTH = [800, 1920], HEIGHT = [600, 1080];

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) || n <= 0 ? fallback : Math.min(max, Math.max(min, n));
  }

  /* ---------- small builders ---------- */
  // group title, optional control pushed to the right edge
  function group(title, extra) { return h('div', { class: 'settings-group' }, h('h2', null, title), extra || null); }
  function row(label, control, hint) {
    return h('div', { class: 'settings-row' }, h('div', { class: 'settings-label' }, label),
      h('div', { class: 'settings-control' }, control, hint ? h('span', { class: 'settings-hint' }, hint) : null));
  }
  // number box that clamps to [min, max] on commit and falls back to the last good value
  function numField(value, min, max) {
    var last = value;
    var inp = UI.input({ type: 'number', value: value, width: '120px', mono: true });
    inp.input.min = min; inp.input.max = max;
    function commit() { last = clampInt(inp.value, min, max, last); inp.value = last; return last; }
    inp.input.addEventListener('change', commit);
    return { el: inp, get: commit, set: function (v) { last = clampInt(v, min, max, last); inp.value = last; } };
  }

  ESUI.registerPage('settings', {
    title: '设置',
    mount: function (root) {
      var cfg0 = ESUI.state.config || {};
      var width = numField(clampInt(cfg0.width, WIDTH[0], WIDTH[1], DEFAULTS.width), WIDTH[0], WIDTH[1]);
      var height = numField(clampInt(cfg0.height, HEIGHT[0], HEIGHT[1], DEFAULTS.height), HEIGHT[0], HEIGHT[1]);
      var saving = false, loadingInfo = false, lastAt = '';

      // The switch drives ESUI.theme, the 'theme' event drives the switch.
      var themeText = h('span', { class: 'row settings-theme' });
      var themeSw = UI.switch({ checked: ESUI.theme.get() === 'dark', onChange: function (on) {
        var t = on ? 'dark' : 'light';
        ESUI.theme.set(t);
        api.guard(api.config.SaveTheme(t), '保存主题失败：');
      } });
      function syncTheme(t) {
        var dark = t === 'dark';
        themeSw.checked = dark;
        themeText.innerHTML = '';
        themeText.append(UI.icon(dark ? 'moon' : 'sun', 14), dark ? '深色' : '浅色');
      }
      syncTheme(ESUI.theme.get());
      ESUI.on('theme', syncTheme);

      var saveBtn = UI.btn('保存设置', { kind: 'primary', icon: 'save', onClick: save });
      var form = h('div', { class: 'settings-form' },
        group('窗口'),
        row('窗口宽度', width.el, '像素，范围 ' + WIDTH[0] + '–' + WIDTH[1]),
        row('窗口高度', height.el, '像素，范围 ' + HEIGHT[0] + '–' + HEIGHT[1]),
        group('界面'),
        row('主题', h('div', { class: 'row' }, themeSw, themeText), '切换后立即生效，无需保存'),
        h('div', { class: 'settings-actions' }, saveBtn));

      var refreshBtn = UI.btn('刷新', { size: 'sm', icon: 'refresh', onClick: loadInfo });
      UI.tip(refreshBtn, function () { return lastAt ? '点击刷新，上次刷新 ' + lastAt : '点击刷新'; });
      var infoHost = h('div', { class: 'settings-info' });

      // Settings.vue onMounted: GetConfig fills the two size boxes (the mask keeps them from being edited meanwhile)
      function loadConfig() {
        UI.busy(form, api.guard(api.config.GetConfig(), '读取配置失败：'), '读取中...').then(function (cfg) {
          if (!cfg) return;
          width.set(cfg.width);
          height.set(cfg.height);
        });
      }

      // Re-read the latest config and change only width / height / theme, so language and connects stay as they are.
      function save() {
        if (saving) return;
        var w = width.get(), hgt = height.get();
        saving = true; saveBtn.setLoading(true);
        var job = api.config.GetConfig().then(function (cfg) {
          if (!cfg) throw new Error('读取配置失败');
          cfg.width = w; cfg.height = hgt; cfg.theme = ESUI.theme.get();
          return api.config.SaveConfig(cfg);
        });
        UI.busy(form, job, '保存中...').then(function () {
          api.runtime.WindowSetSize(w, hgt);
          UI.ok('保存成功');
          return ESUI.loadConnections().catch(function () { /* the save worked; only the shared snapshot stays stale */ });
        }, function (e) {
          api.report(e, '保存失败：');
        }).then(function () { saving = false; saveBtn.setLoading(false); });
      }

      function loadInfo() {
        if (loadingInfo) return;
        loadingInfo = true; refreshBtn.setLoading(true);
        UI.busy(infoHost, api.guard(api.sys.GetProcessInfo(), '读取进程信息失败：'), '刷新中...').then(function (text) {
          if (typeof text === 'string') {
            infoHost.innerHTML = '';
            infoHost.appendChild(UI.textView(text, { lineNumbers: false }));
            lastAt = UI.fmt.date(new Date());
          } else if (!infoHost.firstChild) {
            infoHost.appendChild(UI.empty('读取失败', '点击右上角刷新重试'));
          }
          loadingInfo = false; refreshBtn.setLoading(false);
        });
      }

      root.append(UI.pageHead({ title: '设置' }),
        h('div', { class: 'page-body' }, h('div', { class: 'settings-wrap' }, form, group('进程信息', refreshBtn), infoHost)));
      loadConfig();
      loadInfo();
    }
  });
})();
