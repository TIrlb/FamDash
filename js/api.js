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
      settings: { views: ['calendar', 'jars', 'photo', 'lunch'], viewSeconds: 15, holdSeconds: 30, daysAhead: 30, maxEvents: 14, lunchUrl: 'https://stpiuscatholicschool.net/lunch' },
      gratitude: [],
      ntfyTopic: 'demo'
    };
    if (state.settings.views.indexOf('lunch') < 0 && !state.lunchSeen) { state.settings.views.push('lunch'); state.lunchSeen = true; }
    if (!state.settings.lunchUrl) state.settings.lunchUrl = 'https://stpiuscatholicschool.net/lunch';
    var ALL = ['calendar', 'jars', 'photo', 'lunch', 'weather', 'sports', 'fantasy', 'quotes', 'gratitude'];
    var seenV = state.settings.seenViews || ['calendar', 'jars', 'photo', 'lunch'];
    ALL.forEach(function (v) { if (seenV.indexOf(v) < 0) { seenV.push(v); if (state.settings.views.indexOf(v) < 0) state.settings.views.push(v); } });
    state.settings.seenViews = seenV;
    if (!state.settings.sportsTeams) state.settings.sportsTeams = [
      { league: 'football/college-football', id: '87', name: 'Notre Dame Fighting Irish' },
      { league: 'football/nfl', id: '3', name: 'Chicago Bears' },
      { league: 'basketball/nba', id: '4', name: 'Chicago Bulls' },
      { league: 'baseball/mlb', id: '16', name: 'Chicago Cubs' }];
    if (state.settings.fantasyLeagueId == null) state.settings.fantasyLeagueId = 'demo';
    if (!state.gratitude || !state.gratitude.length) state.gratitude = [
      { id: 'g1', who: 'Ben', text: 'That Nate let me pick the movie on Friday.', created: new Date(Date.now() - 86400000).toISOString() },
      { id: 'g2', who: 'Mom', text: 'A warm fall afternoon and nobody had anywhere to be.', created: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 'g3', who: 'Nate', text: 'Grandma\'s chocolate chip cookies.', created: new Date(Date.now() - 3 * 86400000).toISOString() }];
    if (!state.settings.jarMode) { state.settings.jarMode = 'separate'; state.settings.jarGoal = 100; state.settings.jarTitle = 'Family jar'; }
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
      ev('Practice', at(9, 18, 0, 75), 'Team', T),
      ev('Varsity Football 2026 vs Mishawaka Catholic', at(1, 13, 0, 120), 'Team', T, '1311 S Logan St, Mishawaka, IN 46544, United States'),
      ev('Varsity Football 2026 - Team Pictures', at(3, 17, 45, 30), 'Team', T, '52553 Fir Rd, Granger, IN 46530'),
      ev('Ben - Morning Band', at(3, 7, 0, 45), 'Family', F),
      ev('Soccer practice', at(3, 17, 30, 60), 'Family', F),
      ev('Varsity Football 2026 - Practice', at(5, 18, 0, 90), 'Team', T, '52553 Fir Rd, Granger, IN 46530'),
      ev('Ben - Afternoon Band', at(5, 15, 0, 60), 'Family', F),
      ev('Nate Conference', at(5, 16, 10, 20), 'School', S)
    ];
    events.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var photos = [
      { id: 'p1', grad: ['#ffb36b', '#e0567b'] },
      { id: 'p2', grad: ['#6bc5ff', '#3f5bd8'] },
      { id: 'p3', grad: ['#9be38f', '#2a8f6b'] }
    ];
    var quotes = [
      { id: 'q1', grad: ['#2b3a55', '#1b2232'], text: ['Be kind whenever possible.', 'It is always possible.'] },
      { id: 'q2', grad: ['#4a2c40', '#24151f'], text: ['Do small things', 'with great love.'] },
      { id: 'q3', grad: ['#2c4a3e', '#15241e'], text: ['The best way out', 'is always through.'] }
    ];
    function quoteSvg(q) {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + q.grad[0] + '"/><stop offset="1" stop-color="' + q.grad[1] + '"/></linearGradient></defs>' +
        '<rect width="1600" height="1000" fill="url(#g)"/>' +
        '<text x="800" y="300" font-family="Georgia,serif" font-size="220" fill="#ffc56b" text-anchor="middle" opacity=".7">&#8220;</text>' +
        q.text.map(function (l, i) { return '<text x="800" y="' + (500 + i * 110) + '" font-family="Georgia,serif" font-size="88" fill="#fff" text-anchor="middle">' + l + '</text>'; }).join('') +
        '</svg>';
      return btoa(svg);
    }
    var LOGO = function (path) { return 'https://a.espncdn.com/i/teamlogos/' + path; };
    function dayAt(d, h, m) { var x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m || 0, 0, 0); return x.toISOString(); }
    var SPORTS = {
      'football/college-football:87': { name: 'Notre Dame Fighting Irish', short: 'Notre Dame', logo: LOGO('ncaa/500/87.png'), color: '#0c2340', record: '6-0', standing: 'FBS Independent',
        last: { date: dayAt(-2, 15, 30), state: 'post', detail: 'Final', home: true, opp: { name: 'Stanford', logo: LOGO('ncaa/500/24.png') }, us: '58', them: '7', result: 'W' },
        next: { date: dayAt(5, 19, 30), state: 'pre', detail: '', home: false, opp: { name: 'BYU', logo: LOGO('ncaa/500/252.png') }, tv: 'ABC' } },
      'football/nfl:3': { name: 'Chicago Bears', short: 'Bears', logo: LOGO('nfl/500/chi.png'), color: '#0b162a', record: '3-2', standing: '3rd in NFC North',
        last: { date: dayAt(-1, 13, 0), state: 'post', detail: 'Final', home: false, opp: { name: 'Packers', logo: LOGO('nfl/500/gb.png') }, us: '7', them: '31', result: 'L' },
        next: { date: dayAt(6, 13, 0), state: 'pre', detail: '', home: false, opp: { name: 'Falcons', logo: LOGO('nfl/500/atl.png') }, tv: 'FOX' } },
      'basketball/nba:4': { name: 'Chicago Bulls', short: 'Bulls', logo: LOGO('nba/500/chi.png'), color: '#ce1141', record: '1-2', standing: 'Preseason',
        live: { date: dayAt(0, 19, 0), state: 'in', detail: '3rd 4:12', home: true, opp: { name: 'Bucks', logo: LOGO('nba/500/mil.png') }, us: '78', them: '74' },
        last: { date: dayAt(-1, 21, 0), state: 'post', detail: 'Final', home: false, opp: { name: 'Nuggets', logo: LOGO('nba/500/den.png') }, us: '128', them: '133', result: 'L' },
        next: { date: dayAt(2, 20, 0), state: 'pre', detail: '', home: false, opp: { name: 'Bucks', logo: LOGO('nba/500/mil.png') }, tv: '' } },
      'baseball/mlb:16': { name: 'Chicago Cubs', short: 'Cubs', logo: LOGO('mlb/500/chc.png'), color: '#0e3386', record: '89-73', standing: 'Season over',
        last: { date: dayAt(-11, 22, 0), state: 'post', detail: 'Final', home: false, opp: { name: 'Padres', logo: LOGO('mlb/500/sd.png') }, us: '1', them: '4', result: 'L' }, next: null }
    };
    var LEAGUE_NAMES = { 'football/nfl': 'NFL', 'football/college-football': 'College football', 'basketball/mens-college-basketball': "Men's college basketball",
      'basketball/womens-college-basketball': "Women's college basketball", 'basketball/nba': 'NBA', 'basketball/wnba': 'WNBA', 'baseball/mlb': 'MLB' };
    var DEMO_TEAMS = {
      'football/college-football': [['87', 'Notre Dame Fighting Irish'], ['130', 'Michigan Wolverines'], ['194', 'Ohio State Buckeyes'], ['2509', 'Purdue Boilermakers'], ['84', 'Indiana Hoosiers']],
      'basketball/mens-college-basketball': [['87', 'Notre Dame Fighting Irish'], ['2509', 'Purdue Boilermakers'], ['84', 'Indiana Hoosiers']],
      'basketball/womens-college-basketball': [['87', 'Notre Dame Fighting Irish'], ['41', 'UConn Huskies'], ['2509', 'Purdue Boilermakers']],
      'basketball/nba': [['4', 'Chicago Bulls'], ['11', 'Indiana Pacers'], ['15', 'Milwaukee Bucks']],
      'basketball/wnba': [['19', 'Chicago Sky'], ['5', 'Indiana Fever']],
      'baseball/mlb': [['16', 'Chicago Cubs'], ['4', 'Chicago White Sox'], ['5', 'Cleveland Guardians']],
      'football/nfl': [['3', 'Chicago Bears'], ['11', 'Indianapolis Colts'], ['8', 'Detroit Lions']]
    };
    var FANTASY_TEAMS = [
      { id: 1, name: 'Touchdown Turtles', abbrev: 'TT', owner: 'Dad', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/3.svg', wins: 3, losses: 1, ties: 0, pf: 512.4, seed: 1 },
      { id: 2, name: 'Blitz Bros', abbrev: 'BB', owner: 'Ben', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/19.svg', wins: 2, losses: 2, ties: 0, pf: 488.1, seed: 2 },
      { id: 3, name: 'End Zone Express', abbrev: 'EZE', owner: 'Nate', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/7.svg', wins: 2, losses: 2, ties: 0, pf: 470.9, seed: 3 },
      { id: 4, name: 'Fourth & Long', abbrev: 'FL', owner: 'Mom', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/12.svg', wins: 1, losses: 3, ties: 0, pf: 431.6, seed: 4 }
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
        else if (action === 'photos') r = { ok: true, photos: (p.kind === 'quotes' ? quotes : photos).map(function (x) { return { id: x.id }; }) };
        else if (action === 'gratitude') r = { ok: true, notes: state.gratitude.slice() };
        else if (action === 'teams') r = { ok: true, teams: (DEMO_TEAMS[p.league] || []).map(function (t) { return { id: t[0], name: t[1] }; }) };
        else if (action === 'sports') r = { ok: true, teams: state.settings.sportsTeams.map(function (t) {
          var d = SPORTS[t.league + ':' + t.id];
          return Object.assign({ league: t.league, leagueName: LEAGUE_NAMES[t.league], id: t.id, name: t.name, short: t.name, logo: '', record: '', last: null, next: null }, d || {});
        }) };
        else if (action === 'fantasy') r = state.settings.fantasyLeagueId ? { ok: true, league: 'Demo League', season: 2026, week: 5,
          matchups: [
            { home: { team: FANTASY_TEAMS[0], points: 112.46, projected: 131.2 }, away: { team: FANTASY_TEAMS[2], points: 98.3, projected: 120.5 }, winner: 'UNDECIDED' },
            { home: { team: FANTASY_TEAMS[1], points: 121.08, projected: 124.9 }, away: { team: FANTASY_TEAMS[3], points: 87.72, projected: 101.4 }, winner: 'UNDECIDED' }],
          standings: FANTASY_TEAMS } : { ok: true, league: null };
        else if (action === 'lunch') r = { ok: true, name: 'October lunch.png',
          url: 'https://files.ecatholic.com/2970/pictures/2026/9/October%20lunch.png?t=1790092656000' };
        else if (action === 'photo') {
          var qi = -1; quotes.forEach(function (x, j) { if (x.id === p.id) qi = j; });
          if (qi >= 0) r = { ok: true, mime: 'image/svg+xml', data: quoteSvg(quotes[qi]) };
          else {
            var i = 0; photos.forEach(function (x, j) { if (x.id === p.id) i = j; });
            r = { ok: true, mime: 'image/svg+xml', data: photoSvg(photos[i], i) };
          }
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
        if (action === 'addGratitude') state.gratitude.unshift({ id: 'g' + Date.now(), who: b.who || '', text: b.text, created: new Date().toISOString() });
        if (action === 'deleteGratitude') state.gratitude = state.gratitude.filter(function (g) { return g.id !== b.id; });
        save();
        var out = { ok: true, state: clone() };
        if (action === 'addGratitude' || action === 'deleteGratitude') out = { ok: true, notes: state.gratitude.slice() };
        if (action === 'upload') out = { ok: true, id: 'demo' };
        return new Promise(function (res) { setTimeout(function () { res(out); }, 200); });
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

  // ESPN data comes straight from the browser (see js/espn.js); demo mode serves canned data.
  function demoOr(action, params, live) {
    if (config && config.api === 'demo') return Demo.get(action, params || {});
    return live();
  }
  function sports(list) {
    return demoOr('sports', {}, function () { return global.ESPN.sports(list).then(function (t) { return { ok: true, teams: t }; }); });
  }
  function fantasy(leagueId) {
    return demoOr('fantasy', {}, function () { return global.ESPN.fantasy(leagueId).then(function (f) { return Object.assign({ ok: true }, f); }); });
  }
  function teams(league) {
    return demoOr('teams', { league: league }, function () { return global.ESPN.teams(league).then(function (t) { return { ok: true, teams: t }; }); });
  }

  global.FamDash = {
    get config() { return config; },
    sports: sports,
    fantasy: fantasy,
    teams: teams,
    saveConfig: saveConfig,
    get: get,
    post: post,
    poke: poke,
    listen: listen
  };
})(window);
