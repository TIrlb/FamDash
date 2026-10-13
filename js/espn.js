/* ESPN data, fetched straight from the browser.
   ESPN rejects requests from Google Apps Script (it blocks the "Google-Apps-Script" user agent,
   which Apps Script always sends), so the backend can't proxy these. The schedule, team and
   fantasy endpoints all allow cross-origin browser requests. Team pick-lists come from static
   copies in data/teams/ (ESPN's list endpoint has no CORS); regenerate with tools/update-teams.py.
   ES2017 only. */
(function (global) {
  'use strict';

  var SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
  var LEAGUES = {
    'football/nfl': 'NFL',
    'football/college-football': 'College football',
    'basketball/mens-college-basketball': "Men's college basketball",
    'basketball/womens-college-basketball': "Women's college basketball",
    'basketball/nba': 'NBA',
    'basketball/wnba': 'WNBA',
    'baseball/mlb': 'MLB'
  };

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('ESPN ' + r.status);
      return r.json();
    });
  }
  function getJsonOrNull(url) { return getJson(url).catch(function () { return null; }); }

  function teams(league) {
    if (!LEAGUES[league]) return Promise.reject(new Error('unknown league'));
    return getJson('data/teams/' + league.replace('/', '_') + '.json');
  }

  function stateOf(e) { var c = (e.competitions || [])[0]; return c && c.status && c.status.type ? c.status.type.state : ''; }
  function isDone(e) { var c = (e.competitions || [])[0]; return !!(c && c.status && c.status.type && c.status.type.completed); }
  function logoOf(t) { return (t && t.logos && t.logos[0] && t.logos[0].href) || (t && t.logo) || ''; }
  function scoreOf(s) { return s == null ? null : typeof s === 'object' ? (s.displayValue != null ? s.displayValue : s.value) : String(s); }

  function gameInfo(e, teamId) {
    var c = e.competitions[0], comps = c.competitors || [];
    var me = comps.filter(function (x) { return String(x.team && x.team.id) === String(teamId); })[0] || comps[0];
    var op = comps.filter(function (x) { return x !== me; })[0] || {};
    var tvs = (c.broadcasts || []).map(function (b) { return (b.media && b.media.shortName) || (b.names && b.names[0]) || ''; }).filter(String);
    function rank(x) { var r = x && x.curatedRank && x.curatedRank.current; return r && r <= 25 ? r : null; }
    return {
      date: e.date,
      tbd: c.timeValid === false || e.timeValid === false,   // kickoff not announced yet
      state: c.status.type.state,
      detail: c.status.type.shortDetail,
      home: me.homeAway === 'home',
      neutral: !!c.neutralSite,
      opp: op.team ? { name: op.team.shortDisplayName || op.team.displayName, abbr: op.team.abbreviation, logo: logoOf(op.team), rank: rank(op) } : null,
      us: scoreOf(me.score),
      them: scoreOf(op.score),
      result: me.winner === true ? 'W' : op.winner === true ? 'L' : (c.status.type.completed ? 'T' : ''),
      tv: tvs[0] || ''
    };
  }

  // Last result, live game and next game for one followed team {league, id, name}.
  // The schedule endpoint carries the team's name, logo, color and record and reliably allows CORS;
  // the team endpoint (standing, nextEvent) sometimes comes back without the CORS header, so it's optional.
  function summary(t) {
    var base = SITE + t.league + '/teams/' + t.id;
    return Promise.all([getJson(base + '/schedule'), getJsonOrNull(base)]).then(function (r) {
      var sched = r[0] || {};
      var team = Object.assign({}, sched.team || {}, (r[1] && r[1].team) || {});
      var events = sched.events || [];
      var season = (sched.season || {}).year;
      var extra = Promise.resolve([]);
      // Off-season / postseason-only schedules: also look at the regular season, then last season incl. postseason.
      if (!events.some(isDone)) {
        var urls = [base + '/schedule?seasontype=2'];
        if (season) urls.push(base + '/schedule?season=' + (season - 1) + '&seasontype=2', base + '/schedule?season=' + (season - 1) + '&seasontype=3');
        extra = Promise.all(urls.map(getJsonOrNull));
      }
      return extra.then(function (more) {
        more.forEach(function (j) { if (j && j.events) events = events.concat(j.events); });
        (team.nextEvent || []).forEach(function (e) { events.push(e); });
        var seen = {};
        events = events.filter(function (e) { if (seen[e.id]) return false; seen[e.id] = true; return true; })
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var done = events.filter(isDone);
        var live = events.filter(function (e) { return stateOf(e) === 'in'; })[0];
        var next = events.filter(function (e) { return stateOf(e) === 'pre' && new Date(e.date) > Date.now() - 6 * 3600000; })[0];
        var rec = ((team.record || {}).items || [])[0];
        var college = t.league.indexOf('college') >= 0;
        var short = team.shortDisplayName || (college ? team.location : team.name) || team.displayName || t.name;
        return {
          league: t.league, leagueName: LEAGUES[t.league], id: t.id,
          name: team.displayName || t.name,
          short: short + (t.league.indexOf('womens-') >= 0 ? ' (W)' : ''),
          logo: logoOf(team), color: team.color ? '#' + team.color : '',
          record: rec ? rec.summary : (team.recordSummary || ''), standing: team.standingSummary || '',
          last: done.length ? gameInfo(done[done.length - 1], t.id) : null,
          live: live ? gameInfo(live, t.id) : null,
          next: next ? gameInfo(next, t.id) : null
        };
      });
    }).catch(function (e) {
      return { league: t.league, leagueName: LEAGUES[t.league], id: t.id, name: t.name, short: t.name, error: e.message };
    });
  }

  function sports(list) { return Promise.all((list || []).map(summary)); }

  /* ---------- top games of the day (league scoreboards) ---------- */
  var SHORT = { 'football/nfl': 'NFL', 'football/college-football': 'CFB', 'basketball/mens-college-basketball': 'MBB',
    'basketball/womens-college-basketball': 'WBB', 'basketball/nba': 'NBA', 'basketball/wnba': 'WNBA', 'baseball/mlb': 'MLB' };
  var PRO = { 'football/nfl': 1, 'basketball/nba': 1, 'basketball/wnba': 1, 'baseball/mlb': 1 };
  var NATIONAL_TV = /^(ESPN|ESPN2|ABC|FOX|CBS|NBC|TNT|TBS|truTV|NFL Net|Prime Video|Peacock|NBC Sports|FS1|Big Ten Net|SECN|ACCN|ESPNU)$/i;
  var CLOSE = { football: 8, basketball: 6, baseball: 2 };

  function ymd(d) { return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }

  function gameFromEvent(e, league) {
    var c = (e.competitions || [])[0];
    if (!c || !c.status) return null;
    var comps = c.competitors || [];
    function side(x) {
      if (!x) return null;
      var t = x.team || {};
      var rank = x.curatedRank && x.curatedRank.current;
      var rec = (x.records || [])[0];
      return {
        id: t.id, name: t.shortDisplayName || t.location || t.displayName, abbr: t.abbreviation,
        logo: logoOf(t), rank: rank && rank <= 25 ? rank : null,
        score: scoreOf(x.score), winner: x.winner === true, record: rec ? rec.summary : ''
      };
    }
    var away = side(comps.filter(function (x) { return x.homeAway === 'away'; })[0] || comps[0]);
    var home = side(comps.filter(function (x) { return x.homeAway === 'home'; })[0] || comps[1]);
    var tvs = []; (c.broadcasts || []).forEach(function (b) { (b.names || []).forEach(function (n) { tvs.push(n); }); });
    (c.geoBroadcasts || []).forEach(function (b) { if (b.media && b.media.shortName && b.market && b.market.type === 'National') tvs.push(b.media.shortName); });
    return {
      id: e.id, league: league, leagueShort: SHORT[league], date: e.date,
      tbd: c.timeValid === false || e.timeValid === false,
      state: c.status.type.state, detail: c.status.type.shortDetail, completed: !!c.status.type.completed,
      tv: tvs[0] || '', national: tvs.some(function (t) { return NATIONAL_TV.test(t); }),
      neutral: !!c.neutralSite, postseason: (e.season || {}).type === 3 || (c.type || {}).abbreviation === 'RD16',
      note: ((c.notes || [])[0] || {}).headline || '',
      away: away, home: home
    };
  }

  // How interesting a game is: live and close beats ranked beats national TV beats the rest.
  function interest(g, favIds) {
    var s = 0, sport = g.league.split('/')[0];
    if (g.state === 'in') s += 100;
    if (PRO[g.league]) s += 12;
    if (g.postseason) s += 25;
    [g.away, g.home].forEach(function (t) {
      if (!t) return;
      if (t.rank) s += 30 - t.rank;
      if (favIds[g.league + ':' + t.id]) s += 60;
    });
    if (g.away && g.home && g.away.rank && g.home.rank) s += 15;
    if (g.national) s += 8;
    if (g.state === 'in' && g.away && g.home && Math.abs((+g.away.score || 0) - (+g.home.score || 0)) <= (CLOSE[sport] || 5)) s += 15;
    if (g.yesterday) s -= 20;
    return s;
  }

  // Today's best games across the chosen leagues (plus last night's finals before 11am).
  function topGames(leagues, favorites, limit) {
    var now = new Date(), y = new Date(now.getTime() - 86400000);
    var favIds = {};
    (favorites || []).forEach(function (t) { favIds[t.league + ':' + t.id] = 1; });
    var jobs = [];
    (leagues || []).forEach(function (lg) {
      if (!SHORT[lg]) return;
      jobs.push(getJsonOrNull(SITE + lg + '/scoreboard?limit=300&dates=' + ymd(now)).then(function (j) { return { lg: lg, j: j, y: false }; }));
      if (now.getHours() < 11) jobs.push(getJsonOrNull(SITE + lg + '/scoreboard?limit=300&dates=' + ymd(y)).then(function (j) { return { lg: lg, j: j, y: true }; }));
    });
    return Promise.all(jobs).then(function (rs) {
      var perLeague = {};
      rs.forEach(function (r) {
        ((r.j && r.j.events) || []).forEach(function (e) {
          var g = gameFromEvent(e, r.lg);
          if (!g) return;
          if (r.y && !g.completed) return;            // from yesterday, only finished games
          g.yesterday = r.y;
          g.score = interest(g, favIds);
          (perLeague[r.lg] = perLeague[r.lg] || []).push(g);
        });
      });
      var pool = [];
      Object.keys(perLeague).forEach(function (lg) {
        var seen = {};
        perLeague[lg].sort(function (a, b) { return b.score - a.score; })
          .filter(function (g) { if (seen[g.id]) return false; seen[g.id] = 1; return true; })
          .slice(0, 4).forEach(function (g) { pool.push(g); });   // no single league crowds out the rest
      });
      pool.sort(function (a, b) {
        var la = a.state === 'in' ? 0 : 1, lb = b.state === 'in' ? 0 : 1;
        return la - lb || b.score - a.score || (a.date < b.date ? -1 : 1);
      });
      pool = pool.slice(0, limit || 9);
      // show in a natural order: live, then upcoming by start time, then finals
      var rank = { 'in': 0, 'pre': 1, 'post': 2 };
      return pool.sort(function (a, b) { return (rank[a.state] - rank[b.state]) || (a.date < b.date ? -1 : 1); });
    });
  }

  // Favorites worth featuring right now: playing today or tomorrow, live, or finished today
  // (or last night, until noon).
  function featured(list) {
    return sports(list).then(function (teams) {
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      function dayDiff(iso) { var d = new Date(iso); return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000); }
      return teams.filter(function (t) { return !t.error; }).map(function (t) {
        var g = null, why = '';
        if (t.live) { g = t.live; why = 'live'; }
        else if (t.last && (dayDiff(t.last.date) === 0 || (dayDiff(t.last.date) === -1 && now.getHours() < 12))) { g = t.last; why = 'final'; }
        else if (t.next && dayDiff(t.next.date) >= 0 && dayDiff(t.next.date) <= 1) { g = t.next; why = dayDiff(t.next.date) === 0 ? 'today' : 'tomorrow'; }
        return g ? Object.assign({}, t, { game: g, why: why }) : null;
      }).filter(Boolean);
    });
  }

  /* ---------- ESPN fantasy football (public league) ---------- */
  var FF = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';
  var POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
  var BENCH = { 20: 1, 21: 1, 24: 1 };   // bench, IR, (unused slot ids) never count as performers

  function ffGet(url) {
    return fetch(url).then(function (r) {
      if (r.status === 401) throw new Error('fantasy league is private — make it public in ESPN league settings');
      if (!r.ok) throw new Error('ESPN fantasy ' + r.status);
      return r.json();
    });
  }

  function topPerformers(side, n) {
    var r = side && (side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod);
    if (!r || !r.entries) return [];
    return r.entries.filter(function (e) { return !BENCH[e.lineupSlotId] && e.playerPoolEntry; })
      .map(function (e) {
        var p = e.playerPoolEntry.player || {};
        var parts = String(p.fullName || '').split(' ');
        var short = p.defaultPositionId === 16 ? p.fullName.replace(/ D\/ST$/, '') : (parts.length > 1 ? parts[0][0] + '. ' + parts.slice(1).join(' ') : p.fullName);
        return {
          name: short, full: p.fullName, pos: POS[p.defaultPositionId] || '',
          pts: Math.round((e.playerPoolEntry.appliedStatTotal || 0) * 10) / 10,
          img: p.id > 0 ? 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/' + p.id + '.png&w=96&h=70&cb=1' : ''
        };
      })
      .sort(function (a, b) { return b.pts - a.pts; }).slice(0, n || 3);
  }

  // Shows the live week, except Tue/Wed when it holds last week's final results (ESPN rolls the
  // week over right after Monday night, before anyone at breakfast has seen how it ended).
  function fantasy(leagueId) {
    if (!leagueId) return Promise.resolve({ league: null });
    var now = new Date();
    var season = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear(); // NFL season runs into Jan/Feb
    var base = FF + season + '/segments/0/leagues/' + encodeURIComponent(leagueId);
    return ffGet(base + '?view=mTeam&view=mMatchupScore&view=mSettings').then(function (j) {
      var members = {};
      (j.members || []).forEach(function (m) { members[m.id] = m.firstName || m.displayName || ''; });
      var byId = {};
      (j.teams || []).forEach(function (t) {
        var o = (t.record || {}).overall || {};
        byId[t.id] = {
          id: t.id, name: t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim(), abbrev: t.abbrev,
          logo: t.logo || '', owner: members[t.primaryOwner] || '',
          wins: o.wins || 0, losses: o.losses || 0, ties: o.ties || 0,
          pf: Math.round((o.pointsFor || 0) * 10) / 10, seed: t.playoffSeed || 99,
          streak: o.streakLength ? (o.streakType === 'WIN' ? 'W' : o.streakType === 'LOSS' ? 'L' : 'T') + o.streakLength : ''
        };
      });
      var cur = (j.status || {}).currentMatchupPeriod || j.scoringPeriodId;
      var sched = j.schedule || [];
      function periodGames(p) { return sched.filter(function (m) { return m.matchupPeriodId === p; }); }
      var dow = now.getDay();   // 2 = Tue, 3 = Wed
      var prev = periodGames(cur - 1);
      var holdPrev = (dow === 2 || dow === 3) && prev.length && prev.every(function (m) { return m.winner && m.winner !== 'UNDECIDED'; });
      var week = holdPrev ? cur - 1 : cur;
      var games = periodGames(week);
      var final = games.length > 0 && games.every(function (m) { return m.winner && m.winner !== 'UNDECIDED'; });
      var periods = ((j.settings || {}).scheduleSettings || {}).matchupPeriods || {};
      var sp = (periods[week] || [week]).slice(-1)[0];
      // Boxscore for that week: per-player points for the top-performer chips (best effort).
      return ffGet(base + '?scoringPeriodId=' + sp + '&view=mBoxscore&view=mMatchupScore').catch(function () { return null; }).then(function (box) {
        var boxBy = {};
        ((box && box.schedule) || []).forEach(function (m) { if (m.matchupPeriodId === week) boxBy[m.id] = m; });
        function side(m, which) {
          var x = m[which];
          if (!x) return null;
          var pts = final ? x.totalPoints : (x.totalPointsLive != null ? x.totalPointsLive : x.totalPoints);
          var bx = boxBy[m.id] && boxBy[m.id][which];
          return {
            team: byId[x.teamId],
            points: Math.round((pts || 0) * 100) / 100,
            projected: !final && x.totalProjectedPointsLive != null ? Math.round(x.totalProjectedPointsLive * 10) / 10 : null,
            won: final && ((m.winner === 'HOME' && which === 'home') || (m.winner === 'AWAY' && which === 'away')),
            top: topPerformers(bx, 3)
          };
        }
        var matchups = games.map(function (m) { return { home: side(m, 'home'), away: side(m, 'away'), winner: m.winner }; });
        var high = null;
        matchups.forEach(function (m) { [m.home, m.away].forEach(function (x) { if (x && (!high || x.points > high.points)) high = x; }); });
        var standings = Object.keys(byId).map(function (k) { return byId[k]; })
          .sort(function (a, b) { return a.seed - b.seed || b.wins - a.wins || b.pf - a.pf; });
        var upNext = holdPrev ? periodGames(cur).map(function (m) {
          return { home: byId[m.home && m.home.teamId], away: m.away ? byId[m.away.teamId] : null };
        }) : [];
        return {
          league: (j.settings || {}).name || 'Fantasy', season: season, week: week, final: final,
          matchups: matchups, standings: standings, high: final && high ? { team: high.team, points: high.points } : null,
          upNext: upNext, nextWeek: cur
        };
      });
    });
  }

  global.ESPN = { LEAGUES: LEAGUES, SHORT: SHORT, teams: teams, sports: sports, fantasy: fantasy, topGames: topGames, featured: featured };
})(window);
