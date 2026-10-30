/* UI kit part 5: drawer, modal, confirm, toast. Overlays mount into #overlay-root. */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI;
  var stack = [];

  function root() {
    var r = document.getElementById('overlay-root');
    if (!r) { r = h('div', { id: 'overlay-root' }); document.body.appendChild(r); }
    return r;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && stack.length) { var top = stack[stack.length - 1]; if (top.esc !== false) top.close(); }
  });

  /* shared builder for drawer + modal. Returns {el, body, footer, close, setTitle}. */
  function overlay(kind, o) {
    var title = h('h2', { class: 'ov-title' }, o.title || '');
    var closeBtn = UI.btn('', { icon: 'close', kind: 'ghost', title: '关闭', onClick: function () { api.close(); } });
    var body = h('div', { class: 'ov-body' }, o.body);
    var footer = o.footer ? h('footer', { class: 'ov-foot' }, o.footer) : null;
    var mask = h('div', { class: 'mask', onclick: function () { if (o.closeOnMask !== false) api.close(); } });
    var panel = h('div', { class: kind, role: 'dialog', 'aria-modal': 'true', style: { width: o.width || (kind === 'drawer' ? 'min(560px, 42vw)' : '520px') } },
      h('header', { class: 'ov-head' }, title, closeBtn), body, footer);
    var wrap = h('div', { class: 'ov' + (kind === 'modal' ? ' ov-modal' : ''), style: { zIndex: 50 + stack.length * 2 } }, mask, panel);
    var closed = false, prevFocus = document.activeElement;
    var api = {
      el: wrap, body: body, footer: footer, esc: o.closeOnEsc,
      setTitle: function (t) { title.textContent = t; },
      close: function () {
        if (closed) return;
        closed = true;
        stack.splice(stack.indexOf(api), 1);
        wrap.classList.remove('open');
        setTimeout(function () { wrap.remove(); }, 200);
        if (o.onClose) o.onClose();
        if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus(); // give focus back
      }
    };
    stack.push(api);
    root().appendChild(wrap);
    // keyboard: keep Tab inside the dialog, focus the first field on open
    var FOCUSABLE = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)';
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE));
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    requestAnimationFrame(function () {
      wrap.classList.add('open');
      var f = body.querySelector('input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)') || closeBtn;
      if (f && f.focus) f.focus();
    });
    return api;
  }
  /* UI.drawer({title, width, body, footer, onClose, closeOnMask, closeOnEsc}) */
  UI.drawer = function (o) { return overlay('drawer', o); };
  /* UI.modal({title, width, body, footer, onClose}) */
  UI.modal = function (o) { return overlay('modal', o); };

  /* UI.confirm({title, message, kind:'warn'|'danger'|'info', okText, cancelText, width}) -> Promise<boolean> */
  UI.confirm = function (o) {
    return new Promise(function (resolve) {
      var kind = o.kind || 'warn', m;
      var done = function (v) { resolve(v); m.close(); };
      var ok = UI.btn(o.okText || '确定', { kind: kind === 'danger' ? 'danger' : 'primary', onClick: function () { done(true); } });
      var cancel = o.cancelText === null ? null : UI.btn(o.cancelText || '取消', { kind: 'ghost', onClick: function () { done(false); } });
      m = UI.modal({
        title: o.title || '确认', width: o.width || '420px', onClose: function () { resolve(false); },
        body: h('div', { class: 'confirm-body confirm-' + kind }, UI.icon(kind === 'info' ? 'info' : 'alert', 20), h('div', { class: 'confirm-msg' }, o.message)),
        footer: [cancel, ok]
      });
      setTimeout(function () { if (ok.focus) ok.focus(); }, 40); // Enter confirms, Esc cancels
    });
  };

  /* toast: UI.toast(msg, 'ok'|'err'|'warn'|'info', ms); shortcuts UI.ok / UI.err / UI.warn / UI.info */
  var ICON = { ok: 'checkCircle', err: 'xCircle', warn: 'alert', info: 'info' };
  var host = null;
  UI.toast = function (msg, kind, ms) {
    kind = kind || 'info';
    if (!host || !host.isConnected) { host = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
    var t = h('div', { class: 'toast toast-' + kind }, UI.icon(ICON[kind], 16), h('span', null, msg));
    host.appendChild(t);
    setTimeout(function () { t.classList.add('leaving'); setTimeout(function () { t.remove(); }, 220); }, ms || (kind === 'err' ? 4200 : 2600));
  };
  ['ok', 'err', 'warn', 'info'].forEach(function (k) { UI[k] = function (m, ms) { UI.toast(m, k, ms); }; });
})();
