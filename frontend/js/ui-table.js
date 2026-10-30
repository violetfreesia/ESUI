/* UI kit part 4: data table.
   UI.table({columns, rows, pageSize, pageSizes, pager:false, selectable, maxHeight, fill, striped,
             onRowClick(row), rowClass(row), onSelect(rows), onView(total), empty:Node, resizable:false})
   column: {key, title, width, align:'right', mono, sortable:false, sortValue(row), render(row,i)->Node|string,
            fixed:'left', ellipsis:false, tip}
   API: setRows setFilter getSelected clearSelection getRows getView setColumns refresh sortBy setLoading setPage */
(function () {
  'use strict';
  var h = ESUI.h, UI = window.UI;

  UI.table = function (o) {
    var cols = (o.columns || []).slice();
    var st = { rows: o.rows || [], sortKey: null, sortDir: null, page: 1, size: o.pageSize || 10, sel: new Set(), filter: null };
    var table = h('table', { class: 'tbl' + (o.striped ? ' striped' : '') });
    var thead = h('thead'), tbody = h('tbody');
    table.append(thead, tbody);
    var info = h('span');
    var pager = o.pager === false ? null : UI.pager({
      total: 0, page: 1, size: st.size, sizes: o.pageSizes || [10, 20, 50, 100],
      onChange: function (p, s) { st.page = p; st.size = s; body(); if (o.onPage) o.onPage(p, s); }
    });
    var scroll = h('div', { class: 'tbl-scroll', style: o.maxHeight ? { maxHeight: o.maxHeight } : null }, table);
    var root = h('div', { class: 'tbl-wrap', style: o.fill ? { flex: '1 1 0' } : null }, scroll, o.footer === false ? null : h('div', { class: 'tbl-foot' }, info, pager));
    var allBox = null;

    function selW() { return o.selectable ? 40 : 0; }
    function fit() {
      var sum = selW();
      cols.forEach(function (c) { sum += c.width || 120; });
      table.style.minWidth = sum + 'px';
    }
    function view() {
      var rows = st.rows;
      if (st.filter) rows = rows.filter(st.filter);
      if (st.sortKey) {
        var col = cols.filter(function (c) { return c.key === st.sortKey; })[0];
        if (col) {
          var get = col.sortValue || function (r) { return r[col.key]; }, dir = st.sortDir === 'desc' ? -1 : 1;
          rows = rows.slice().sort(function (a, b) {
            var x = get(a), y = get(b);
            if (x === y) return 0;
            if (x == null) return 1;
            if (y == null) return -1;
            return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-CN', { numeric: true })) * dir;
          });
        }
      }
      return rows;
    }
    function head() {
      thead.innerHTML = '';
      var tr = h('tr'), left = selW(), right = 0;
      for (var ci = cols.length - 1; ci >= 0; ci--) { // right-pinned columns stack from the right edge
        if (cols[ci].fixed === 'right') { cols[ci]._right = right; right += cols[ci].width || 120; }
      }
      var anyLeft = cols.some(function (c) { return c.fixed && c.fixed !== 'right'; });
      if (o.selectable) {
        allBox = h('input', { type: 'checkbox', title: '选择本页' });
        allBox.addEventListener('change', function () {
          pageRows().forEach(function (r) { allBox.checked ? st.sel.add(r) : st.sel.delete(r); });
          body(); changed();
        });
        tr.appendChild(h('th', { class: 'sel' + (anyLeft ? ' fixed' : ''), style: { left: '0px' } }, allBox));
      }
      cols.forEach(function (col) {
        var sortable = o.sortable !== false && col.sortable !== false && col.key && col.title;
        var isR = col.fixed === 'right', isL = !!col.fixed && !isR;
        var th = h('th', { class: (sortable ? 'sortable ' : '') + (col.align === 'right' ? 'num ' : '') + (col.fixed ? 'fixed' : '') + (isR ? ' fixed-r' : ''), title: col.tip,
          style: { width: col.width ? col.width + 'px' : null, left: isL ? left + 'px' : null, right: isR ? col._right + 'px' : null } },
          h('span', null, col.title));
        if (isL) { col._left = left; left += col.width || 120; }
        if (sortable) {
          if (st.sortKey === col.key) th.appendChild(h('span', { class: 'sort-ind' }, st.sortDir === 'asc' ? '↑' : '↓'));
          th.addEventListener('click', function () { root.sortBy(col.key, st.sortKey !== col.key ? 'asc' : st.sortDir === 'asc' ? 'desc' : null); });
        }
        if (o.resizable !== false && col.resizable !== false) {
          var rs = h('span', { class: 'col-resizer' });
          rs.addEventListener('click', function (e) { e.stopPropagation(); });
          rs.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
            var x0 = e.clientX, w0 = th.offsetWidth;
            var mv = function (ev) { col.width = Math.max(60, w0 + ev.clientX - x0); th.style.width = col.width + 'px'; fit(); };
            var up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
          });
          th.appendChild(rs);
        }
        tr.appendChild(th);
      });
      thead.appendChild(tr); fit();
    }
    function pageRows() {
      var all = view();
      return pager ? all.slice((st.page - 1) * st.size, st.page * st.size) : all;
    }
    function changed() {
      if (o.onSelect) o.onSelect(Array.from(st.sel));
      syncInfo();
    }
    function syncInfo() {
      var n = view().length;
      info.textContent = '共 ' + n + ' 条' + (o.selectable ? '，已选 ' + st.sel.size + ' 条' : '');
      if (allBox) {
        var pr = pageRows(), k = pr.filter(function (r) { return st.sel.has(r); }).length;
        allBox.checked = pr.length > 0 && k === pr.length;
        allBox.indeterminate = k > 0 && k < pr.length;
      }
    }
    function body() {
      var all = view(), total = all.length;
      var pages = Math.max(1, Math.ceil(total / st.size));
      if (st.page > pages) st.page = pages;
      if (pager) pager.update({ total: total, page: st.page, size: st.size });
      var rows = pageRows(), frag = document.createDocumentFragment();
      if (!rows.length) {
        frag.appendChild(h('tr', null, h('td', { class: 'empty-cell', colspan: cols.length + (o.selectable ? 1 : 0) }, o.empty || UI.empty())));
      }
      rows.forEach(function (row, i) {
        var tr = h('tr', { class: (o.onRowClick ? 'clickable ' : '') + (st.sel.has(row) ? 'is-selected ' : '') + ((o.rowClass && o.rowClass(row)) || '') });
        if (o.selectable) {
          var cb = h('input', { type: 'checkbox', checked: st.sel.has(row) });
          cb.addEventListener('click', function (e) { e.stopPropagation(); });
          cb.addEventListener('change', function () { cb.checked ? st.sel.add(row) : st.sel.delete(row); tr.classList.toggle('is-selected', cb.checked); changed(); });
          tr.appendChild(h('td', { class: 'sel' + (cols.some(function (c) { return c.fixed && c.fixed !== 'right'; }) ? ' fixed' : ''), style: { left: '0px' } }, cb));
        }
        cols.forEach(function (col) {
          var v = col.render ? col.render(row, (st.page - 1) * st.size + i) : row[col.key];
          var isR = col.fixed === 'right';
          var td = h('td', { class: (col.align === 'right' ? 'num ' : '') + (col.mono ? 'mono ' : '') + (col.fixed ? 'fixed' : '') + (isR ? ' fixed-r' : ''),
            style: col.fixed ? (isR ? { right: col._right + 'px' } : { left: col._left + 'px' }) : null }, v);
          if (col.ellipsis !== false && (typeof v === 'string' || typeof v === 'number')) td.title = String(v);
          tr.appendChild(td);
        });
        if (o.onRowClick) tr.addEventListener('click', function () { o.onRowClick(row); });
        frag.appendChild(tr);
      });
      tbody.innerHTML = ''; tbody.appendChild(frag);
      syncInfo();
      if (o.onView) o.onView(total);
    }

    // opts: {keepPage, keepSelection}. Selection is kept for row objects that are still in `rows` (compared by reference).
    root.setRows = function (rows, opts) {
      opts = opts || {};
      st.rows = rows || [];
      var keep = new Set();
      if (opts.keepSelection) st.rows.forEach(function (r) { if (st.sel.has(r)) keep.add(r); });
      st.sel = keep;
      if (!opts.keepPage) st.page = 1;
      body(); changed();
    };
    root.getPage = function () { return { page: st.page, size: st.size }; };
    root.setEmpty = function (node) { o.empty = node; body(); };
    root.setFilter = function (fn) { st.filter = fn || null; st.page = 1; body(); };
    root.setColumns = function (c) { cols = c.slice(); head(); body(); };
    root.setPage = function (p) { st.page = p; body(); };
    root.sortBy = function (key, dir) { st.sortKey = dir ? key : null; st.sortDir = dir || null; head(); body(); };
    root.getSelected = function () { return Array.from(st.sel); };
    root.clearSelection = function () { st.sel.clear(); body(); changed(); };
    root.getRows = function () { return st.rows; };
    root.getView = view;
    root.refresh = body;
    root.setLoading = function (on, text) { UI.spin(root, on, text); };
    head(); body();
    return root;
  };
})();
