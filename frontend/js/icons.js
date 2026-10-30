/* Icon paths (24x24 viewBox, stroke icons). Used by UI.icon(name, size). */
(function () {
  'use strict';
  window.ESUI = window.ESUI || {};
  ESUI.icons = {
    // navigation
    cluster: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 4.5M12 11.5l5.5 4.5"/>',
    nodes: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    health: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    metrics: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    index: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    docs: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    templates: '<rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="15" y="13" width="6" height="8" rx="1.5"/>',
    analyze: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
    rest: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 9 4 3-4 3M13 16h5"/>',
    diag: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/>',
    task: '<path d="M9 6h11M9 12h11M9 18h11M3.5 6l1.5 1.5L7 5M3.5 12l1.5 1.5L7 11M3.5 18l1.5 1.5L7 17"/>',
    snapshot: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    // actions
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronsLeft: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
    chevronsRight: '<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
    upload: '<path d="M12 15V3m0 0 4 4m-4-4-4 4M4 17v3h16v-3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    play: '<path d="M7 5v14l12-7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a16 16 0 0 1-3.2 3.9M6.6 6.7C3.8 8.5 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v5l3 2"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    // status
    alert: '<path d="M12 3 2 20h20L12 3zM12 10v4M12 17v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    inbox: '<path d="M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z"/>'
  };
})();
