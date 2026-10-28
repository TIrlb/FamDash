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
    var KEYD = 'famdash.demo2';   // bumped when the demo data changes shape
    var state;
    try { state = JSON.parse(localStorage.getItem(KEYD) || 'null'); } catch (e) {}
    if (!state) state = {
      kids: [
        { id: 'k1', name: 'Emma', count: 23, goal: 50, color: '#2f7fe0' },
        { id: 'k2', name: 'Leo', count: 37, goal: 50, color: '#ef6c2f' }
      ],
      calendars: ['family', 'team', 'school'],
      settings: { views: ['calendar', 'jars', 'photo', 'lunch'], viewSeconds: 15, holdSeconds: 30, daysAhead: 30, maxEvents: 14, lunchUrl: 'https://example.org/lunch' },
      gratitude: [],
      ntfyTopic: 'demo'
    };
    if (state.settings.views.indexOf('lunch') < 0 && !state.lunchSeen) { state.settings.views.push('lunch'); state.lunchSeen = true; }
    if (!state.settings.lunchUrl) state.settings.lunchUrl = 'https://example.org/lunch';
    var ALL = ['calendar', 'jars', 'photo', 'lunch', 'weather', 'sports', 'fantasy', 'quotes', 'gratitude', 'today'];
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
      { id: 'g1', who: 'Emma', text: 'That Leo let me pick the movie on Friday.', created: new Date(Date.now() - 86400000).toISOString() },
      { id: 'g2', who: 'Mom', text: 'A warm fall afternoon and nobody had anywhere to be.', created: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 'g3', who: 'Leo', text: 'Grandma\'s chocolate chip cookies.', created: new Date(Date.now() - 3 * 86400000).toISOString() }];
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
      ev('Soccer practice', at(0, 18, 0, 75), 'Team', T, 'Riverside Park'),
      ev('Pizza night', at(0, 19, 30), 'Family', F),
      ev('Game vs. Raiders', at(1, 9, 0, 60), 'Team', T, 'Field 3'),
      ev('Grandma visiting', allDay(1), 'Family', F),
      ev('Emma — dentist', at(3, 15, 40, 45), 'Family', F, 'Main Street Dental'),
      ev('Picture day', allDay(4), 'School', S),
      ev('Leo — swim lesson', at(4, 17, 0, 45), 'Family', F, 'Community Pool'),
      ev('Fall break — no school', allDay(7), 'School', S),
      ev('Pumpkin patch', at(8, 11, 0, 180), 'Family', F),
      ev('Practice', at(9, 18, 0, 75), 'Team', T),
      ev('Emma — piano recital', at(2, 18, 30, 90), 'Family', F, 'Lincoln Middle School'),
      ev('Book fair', at(3, 8, 0, 420), 'School', S),
      ev('Leo — morning band', at(3, 7, 15, 45), 'School', S),
      ev('Movie night', at(5, 19, 0, 120), 'Family', F),
      ev('Parent-teacher conferences', at(5, 16, 10, 20), 'School', S)
    ];
    events.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    // Demo gallery: free-to-use photos from Unsplash (Unsplash License), hotlinked from their CDN as Unsplash asks.
    var photos = ['1542037104857-ffbb0b9155fb', '1609220136736-443140cffec6', '1531983412531-1f49a365ffed',
      '1511895426328-dc8714191300', '1503454537195-1dcabb73ffb9', '1536640712-4d4c36ff0e4e'].map(function (id) {
      return { id: 'u' + id, url: 'https://images.unsplash.com/photo-' + id + '?w=1600&q=80&auto=format' };
    });

    // A made-up school lunch flyer for the current month, drawn on a canvas, so the weekly lunch view works in the demo.
    var flyerCache = null;
    function demoFlyer() {
      var now = new Date(), key = now.getFullYear() + '-' + now.getMonth();
      if (flyerCache && flyerCache.key === key) return flyerCache;
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var MENU = [['Pizza Day', 'Side Salad'], ['Chicken Nuggets', 'Mac & Cheese'], ['Walking Tacos', 'Spanish Rice'], ['Pancakes & Sausage', 'Hash Browns'],
        ['Spaghetti', 'Garlic Bread'], ['Grilled Cheese', 'Tomato Soup'], ['Turkey Burger', 'Sweet Potato Fries'], ['Orange Chicken', 'Fried Rice'],
        ['Hot Dogs', 'Baked Beans'], ['Chicken Alfredo', 'Breadstick'], ['Sloppy Joes', 'Chips'], ['French Toast Sticks', 'Yogurt & Fruit']];
      var y = now.getFullYear(), m = now.getMonth(), weeks = [], cur = null, d = new Date(y, m, 1);
      while (d.getMonth() === m) {
        var wd = d.getDay();
        if (wd >= 1 && wd <= 5) { if (!cur || wd === 1) { cur = [0, 0, 0, 0, 0]; weeks.push(cur); } cur[wd - 1] = d.getDate(); }
        d.setDate(d.getDate() + 1);
      }
      var W = 1600, H = 1236, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f3a5f'; x.font = 'bold 40px Georgia, serif'; x.textAlign = 'left';
      x.fillText('Maple Grove Elementary  ·  ' + MONTHS[m] + ' ' + y + ' Lunch', 100, 80);
      var xs = [100, 390, 680, 970, 1260, 1550], top = 110, head = 70, bottom = 1000;
      var rowH = (bottom - top - head) / weeks.length;
      var ys = [top, top + head]; for (var i = 1; i <= weeks.length; i++) ys.push(Math.round(top + head + rowH * i));
      x.strokeStyle = '#000'; x.lineWidth = 3;
      xs.forEach(function (gx) { x.beginPath(); x.moveTo(gx, top); x.lineTo(gx, ys[ys.length - 1]); x.stroke(); });
      ys.forEach(function (gy) { x.beginPath(); x.moveTo(xs[0], gy); x.lineTo(xs[5], gy); x.stroke(); });
      x.textAlign = 'center'; x.fillStyle = '#000'; x.font = 'italic 30px Georgia, serif';
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(function (n, j) { x.fillText(n, (xs[j] + xs[j + 1]) / 2, top + 47); });
      var k = 0;
      weeks.forEach(function (wk, wi) {
        wk.forEach(function (day, j) {
          if (!day) return;
          var cx = (xs[j] + xs[j + 1]) / 2, cy = ys[wi + 1] + rowH * 0.28;
          x.fillStyle = '#000'; x.font = 'bold 30px sans-serif'; x.fillText(String(day), cx, cy);
          var item = MENU[(day * 5) % MENU.length];   // neighbouring days always differ
          x.font = 'bold 28px sans-serif'; x.fillText(item[0], cx, cy + 40);
          x.font = '24px sans-serif'; x.fillStyle = '#333'; x.fillText(item[1], cx, cy + 74);
        });
      });
      x.textAlign = 'left'; x.fillStyle = '#000'; x.font = 'bold 22px sans-serif';
      x.fillText('Additional Daily Lunch Options:', 100, 1040);
      x.font = '21px sans-serif';
      ['Ham or Turkey Sandwich', 'Sunbutter and Jelly Sandwich', 'Salad Bar with Roll', 'Fresh Fruit and Milk'].forEach(function (t, j) { x.fillText(t, 170, 1070 + j * 28); });
      x.font = 'italic 18px sans-serif'; x.fillText('*Menu items are subject to change. This is a sample menu for the FamDash demo.', 100, 1200);
      flyerCache = { key: key, name: MONTHS[m] + ' lunch.png', url: c.toDataURL('image/png') };
      return flyerCache;
    }
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
      { id: 2, name: 'Blitz Bros', abbrev: 'BB', owner: 'Emma', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/19.svg', wins: 2, losses: 2, ties: 0, pf: 488.1, seed: 2 },
      { id: 3, name: 'End Zone Express', abbrev: 'EZE', owner: 'Leo', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/7.svg', wins: 2, losses: 2, ties: 0, pf: 470.9, seed: 3 },
      { id: 4, name: 'Fourth & Long', abbrev: 'FL', owner: 'Mom', logo: 'https://g.espncdn.com/lm-static/ffl/images/default_logos/12.svg', wins: 1, losses: 3, ties: 0, pf: 431.6, seed: 4 }
    ];
    function g(lg, st, detail, a, h, extra) {
      var T = function (x) { return { name: x[0], abbr: x[1], logo: LOGO(x[2]), rank: x[3] || null, score: x[4] != null ? String(x[4]) : null, winner: !!x[5], record: x[6] || '' }; };
      return Object.assign({ id: lg + a[1] + h[1], league: lg, leagueShort: { 'football/college-football': 'CFB', 'football/nfl': 'NFL', 'basketball/nba': 'NBA', 'baseball/mlb': 'MLB' }[lg],
        state: st, detail: detail, date: dayAt(0, 19, 0), away: T(a), home: T(h), tv: '' }, extra || {});
    }
    function DEMO_GAMES() {
      return [
        g('baseball/mlb', 'in', 'Top 7th', ['Dodgers', 'LAD', 'mlb/500/lad.png', null, 3], ['Brewers', 'MIL', 'mlb/500/mil.png', null, 2], { tv: 'TBS', note: 'NLCS - Game 3', series: 'MIL leads 2-0' }),
        g('basketball/nba', 'in', '3rd 4:12', ['Bucks', 'MIL', 'nba/500/mil.png', null, 74], ['Bulls', 'CHI', 'nba/500/chi.png', null, 78], { tv: 'NBC Sports' }),
        g('football/nfl', 'pre', '', ['Bills', 'BUF', 'nfl/500/buf.png', null, null, false, '4-1'], ['Chiefs', 'KC', 'nfl/500/kc.png', null, null, false, '4-1'], { date: dayAt(0, 20, 15), tv: 'ESPN' }),
        g('baseball/mlb', 'pre', '', ['Guardians', 'CLE', 'mlb/500/cle.png'], ['Rays', 'TB', 'mlb/500/tb.png'], { date: dayAt(0, 20, 8), tv: 'FS1', note: 'ALCS - Game 2', series: 'CLE leads 1-0' }),
        g('football/college-football', 'pre', '', ['Ohio State', 'OSU', 'ncaa/500/194.png', 2, null, false, '6-0'], ['Indiana', 'IU', 'ncaa/500/84.png', 9, null, false, '6-0'], { date: dayAt(0, 21, 0), tv: 'FOX' }),
        g('basketball/nba', 'post', 'Final', ['Thunder', 'OKC', 'nba/500/okc.png', null, 112, true], ['Hawks', 'ATL', 'nba/500/atl.png', null, 104], { date: dayAt(-1, 19, 0), yesterday: true })
      ];
    }
    function P(name, pos, pts, id) { return { name: name, pos: pos, pts: pts, img: id ? 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/' + id + '.png&w=96&h=70&cb=1' : '' }; }
    function DEMO_FANTASY() {
      var T = FANTASY_TEAMS;
      return { league: 'Demo League', season: 2026, week: 5, final: true, nextWeek: 6,
        high: { team: T[1], points: 157.6 },
        matchups: [
          { winner: 'AWAY', home: { team: T[0], points: 150.22, won: false, top: [P('J. Goff', 'QB', 28.9, 3046779), P('J. Myers', 'K', 23, 2473037), P('T. McBride', 'TE', 21.6, 4361307)] },
            away: { team: T[1], points: 157.6, won: true, top: [P('J. Warren', 'RB', 36.8, 4569987), P('J. Burrow', 'QB', 24.6, 3915511), P('D. Adams', 'WR', 22.1, 16800)] } },
          { winner: 'HOME', home: { team: T[2], points: 132.4, won: true, top: [P('J. Allen', 'QB', 31.2, 3918298), P('J. Chase', 'WR', 24.9, 4362628), P('Steelers', 'D/ST', 14, 0)] },
            away: { team: T[3], points: 118.7, won: false, top: [P('S. Barkley', 'RB', 27.5, 3929630), P('A. St. Brown', 'WR', 19.3, 4374302), P('T. Kelce', 'TE', 12.4, 15847)] } }],
        upNext: [{ home: T[1], away: T[3] }, { home: T[2], away: T[0] }],
        benchMvp: { team: T[3], player: Object.assign(P('P. Nacua', 'WR', 25.4, 4426515), { over: P('J. Smith-Njigba', 'WR', 9.8), cost: 15.6 }) },
        standings: T };
    }
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
        else if (action === 'today') r = { ok: true, date: (function () { var n = new Date(); return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2); })(), days: ['National Potato Day', 'National Civics Day', 'National Parmigiano Reggiano Day', 'Navy Day', 'Cranky Co-Workers Day', 'Vote Early Day'] };
        else if (action === 'teams') r = { ok: true, teams: (DEMO_TEAMS[p.league] || []).map(function (t) { return { id: t[0], name: t[1] }; }) };
        else if (action === 'sports') r = { ok: true, teams: state.settings.sportsTeams.map(function (t) {
          var d = SPORTS[t.league + ':' + t.id];
          return Object.assign({ league: t.league, leagueName: LEAGUE_NAMES[t.league], id: t.id, name: t.name, short: t.name, logo: '', record: '', last: null, next: null }, d || {});
        }) };
        else if (action === 'scores') {
          var nd = SPORTS['football/college-football:87'], bulls = SPORTS['basketball/nba:4'];
          r = { ok: true,
            featured: [Object.assign({}, nd, { league: 'football/college-football', id: '87', game: Object.assign({}, nd.next, { date: dayAt(1, 19, 30) }), why: 'tomorrow' }),
                       Object.assign({}, bulls, { league: 'basketball/nba', id: '4', game: bulls.live, why: 'live' })],
            games: DEMO_GAMES() };
        }
        else if (action === 'fantasy') r = state.settings.fantasyLeagueId ? Object.assign({ ok: true }, DEMO_FANTASY()) : { ok: true, league: null };
        else if (action === 'lunch') { var fl = demoFlyer(); r = { ok: true, name: fl.name, url: fl.url }; }
        else if (action === 'photo') {
          var qi = -1; quotes.forEach(function (x, j) { if (x.id === p.id) qi = j; });
          if (qi >= 0) r = { ok: true, mime: 'image/svg+xml', data: quoteSvg(quotes[qi]) };
          else {
            var ph = photos.filter(function (x) { return x.id === p.id; })[0] || photos[0];
            r = { ok: true, url: ph.url };
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
  function scores(leagues, favorites) {
    return demoOr('scores', {}, function () {
      return Promise.all([global.ESPN.topGames(leagues, favorites, 9), global.ESPN.featured(favorites)]).then(function (r) {
        return { ok: true, games: r[0], featured: r[1] };
      });
    });
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
    scores: scores,
    fantasy: fantasy,
    teams: teams,
    saveConfig: saveConfig,
    get: get,
    post: post,
    poke: poke,
    listen: listen
  };
})(window);
