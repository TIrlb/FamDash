/* FamDash shared client. Kept to ES2017 (no ?. / ??) so old tablets can run it. */
(function (global) {
  'use strict';

  var KEY = 'famdash.config';

  function loadConfig() {
    var cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cfg = null; }

    // Provisioning: ?api=...&token=...  or ?demo=1  — saved, then stripped from the URL.
    var q = new URLSearchParams(location.search);
    if (q.get('demo') === '1') cfg = { api: 'demo', token: 'demo' };
    if (q.get('api') && q.get('token')) cfg = { api: q.get('api'), token: q.get('token') };
    if (q.get('reset') === '1') cfg = null;
    if (q.has('api') || q.has('token') || q.has('demo') || q.has('reset')) {
      try {
        if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY);
      } catch (e) { /* private mode: config lives for this page load only */ }
      history.replaceState(null, '', location.pathname);
    }
    return cfg;
  }

  var config = loadConfig();

  function saveConfig(api, token) {
    config = { api: api, token: token };
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {}
  }

  function unwrap(res) {
    return res.json().then(function (j) {
      if (!j.ok) throw new Error(j.error || 'request failed');
      return j;
    });
  }

  function get(action, params) {
    if (config.api === 'demo') return Demo.get(action, params || {});
    var url = config.api + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(config.token);
    if (params) Object.keys(params).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(params[k]); });
    return fetch(url).then(unwrap);
  }

  function post(action, body) {
    if (config.api === 'demo') return Demo.post(action, body || {});
    var payload = Object.assign({ token: config.token, action: action }, body || {});
    // String body => text/plain, which avoids a CORS preflight Apps Script can't answer.
    return fetch(config.api, { method: 'POST', body: JSON.stringify(payload) }).then(unwrap);
  }

  /* ---- ntfy relay: pokes only, never data ---- */
  function poke(topic, msg) {
    if (!topic || config.api === 'demo') { Demo.emit(msg); return Promise.resolve(); }
    return fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: JSON.stringify(msg) })
      .catch(function () {});
  }

  function listen(topic, onMsg) {
    if (config.api === 'demo') { Demo.listeners.push(onMsg); return; }
    if (!topic || !global.EventSource) return;
    var es;
    function open() {
      es = new EventSource('https://ntfy.sh/' + encodeURIComponent(topic) + '/sse');
      es.onmessage = function (ev) {
        try {
          var outer = JSON.parse(ev.data);
          if (outer.event && outer.event !== 'message') return;
          onMsg(JSON.parse(outer.message));
        } catch (e) {}
      };
      es.onopen = function () { onMsg({ type: 'refresh' }); };
      es.onerror = function () {
        if (es.readyState === 2) setTimeout(open, 15000);
      };
    }
    open();
  }

  /* ---- Demo backend (no Google needed) ---- */
  var Demo = (function () {
    var KEYD = 'famdash.demo';
    var state;
    try { state = JSON.parse(localStorage.getItem(KEYD) || 'null'); } catch (e) {}
    if (!state) state = {
      kids: [
        { id: 'k1', name: 'Ben', count: 23, goal: 50, color: '#2f7fe0' },
        { id: 'k2', name: 'Nate', count: 37, goal: 50, color: '#ef6c2f' }
      ],
      calendars: ['family', 'team', 'school'],
      settings: { views: ['calendar', 'jars', 'photo'], viewSeconds: 15, holdSeconds: 30, daysAhead: 30, maxEvents: 14 },
      ntfyTopic: 'demo'
    };
    function save() { try { localStorage.setItem(KEYD, JSON.stringify(state)); } catch (e) {} }
    function clone() { return JSON.parse(JSON.stringify(state)); }

    function at(days, h, m, dur) {
      var d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m || 0, 0, 0);
      var e = new Date(d.getTime() + (dur || 60) * 60000);
      return { start: d.toISOString(), end: e.toISOString() };
    }
    function allDay(days) {
      var d = new Date(); d.setDate(d.getDate() + days); d.setHours(0, 0, 0, 0);
      var e = new Date(d.getTime() + 86400000);
      return { start: d.toISOString(), end: e.toISOString(), allDay: true };
    }
    function ev(t, when, cal, color, loc) {
      return Object.assign({ title: t, allDay: false, location: loc || '', calendar: cal, color: color }, when);
    }
    var F = '#3f8cff', T = '#22a06b', S = '#c05ec7';
    var events = [
      ev('Flag football practice', at(0, 18, 0, 75), 'Team', T, 'Bittersweet Park'),
      ev('Pizza night', at(0, 19, 30), 'Family', F),
      ev('Game vs. Raiders', at(1, 9, 0, 60), 'Team', T, 'Field 3'),
      ev('Grandma visiting', allDay(1), 'Family', F),
      ev('Ben — dentist', at(3, 15, 40, 45), 'Family', F, 'Granger Family Dental'),
      ev('Picture day', allDay(4), 'School', S),
      ev('Nate — swim lesson', at(4, 17, 0, 45), 'Family', F),
      ev('Fall break — no school', allDay(7), 'School', S),
      ev('Pumpkin patch', at(8, 11, 0, 180), 'Family', F),
      ev('Practice', at(9, 18, 0, 75), 'Team', T)
    ];
    var photos = [
      { id: 'p1', grad: ['#ffb36b', '#e0567b'] },
      { id: 'p2', grad: ['#6bc5ff', '#3f5bd8'] },
      { id: 'p3', grad: ['#9be38f', '#2a8f6b'] }
    ];
    function photoSvg(p, i) {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + p.grad[0] + '"/><stop offset="1" stop-color="' + p.grad[1] + '"/></linearGradient></defs>' +
        '<rect width="1600" height="1067" fill="url(#g)"/>' +
        '<circle cx="1250" cy="260" r="120" fill="#fff" opacity=".55"/>' +
        '<path d="M0 820 Q400 640 800 800 T1600 760 V1067 H0Z" fill="#000" opacity=".18"/>' +
        '<text x="800" y="560" font-family="sans-serif" font-size="96" fill="#fff" text-anchor="middle" opacity=".9">Demo photo ' + (i + 1) + '</text></svg>';
      return btoa(svg);
    }

    var api = {
      listeners: [],
      emit: function (msg) { setTimeout(function () { api.listeners.forEach(function (f) { f(msg); }); }, 50); },
      get: function (action, p) {
        var r;
        if (action === 'state') r = { ok: true, state: clone() };
        else if (action === 'events') r = { ok: true, events: events };
        else if (action === 'calendars') r = { ok: true, calendars: [
          { id: 'family', name: 'Family', color: F },
          { id: 'team', name: 'Team', color: T },
          { id: 'school', name: 'School', color: S }].map(function (c) {
            c.selected = state.calendars.indexOf(c.id) >= 0;
            return c;
          }) };
        else if (action === 'photos') r = { ok: true, photos: photos.map(function (x) { return { id: x.id }; }) };
        else if (action === 'photo') {
          var i = 0; photos.forEach(function (x, j) { if (x.id === p.id) i = j; });
          r = { ok: true, mime: 'image/svg+xml', data: photoSvg(photos[i], i) };
        }
        return new Promise(function (res) { setTimeout(function () { res(r); }, 150); });
      },
      post: function (action, b) {
        if (action === 'adjust') state.kids.forEach(function (k) { if (k.id === b.kidId) k.count = Math.max(0, k.count + b.delta); });
        if (action === 'setKid') state.kids.forEach(function (k) {
          if (k.id !== b.kidId) return;
          if (b.name) k.name = b.name; if (b.goal != null) k.goal = +b.goal; if (b.count != null) k.count = +b.count;
        });
        if (action === 'setSettings') Object.assign(state.settings, b.settings);
        if (action === 'setCalendars') state.calendars = b.ids;
        save();
        return new Promise(function (res) { setTimeout(function () { res({ ok: true, state: clone() }); }, 200); });
      }
    };
    // Cross-tab demo relay so control.html in one tab drives index.html in another.
    global.addEventListener('storage', function (e) {
      if (e.key === KEYD + '.poke' && e.newValue) {
        try { state = JSON.parse(localStorage.getItem(KEYD)) || state; } catch (x) {}
        var m = JSON.parse(e.newValue).msg;
        api.listeners.forEach(function (f) { f(m); });
      }
    });
    var origEmit = api.emit;
    api.emit = function (msg) {
      try { localStorage.setItem(KEYD + '.poke', JSON.stringify({ t: Date.now(), msg: msg })); } catch (e) {}
      origEmit(msg);
    };
    return api;
  })();

  global.FamDash = {
    get config() { return config; },
    saveConfig: saveConfig,
    get: get,
    post: post,
    poke: poke,
    listen: listen
  };
})(window);
