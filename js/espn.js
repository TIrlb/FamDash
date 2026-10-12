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
  function summary(t) {
    var base = SITE + t.league + '/teams/' + t.id;
    return Promise.all([getJson(base), getJsonOrNull(base + '/schedule')]).then(function (r) {
      var team = r[0].team, sched = r[1] || {};
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
        return {
          league: t.league, leagueName: LEAGUES[t.league], id: t.id,
          name: team.displayName,
          short: (team.shortDisplayName || team.displayName) + (t.league.indexOf('womens-') >= 0 ? ' (W)' : ''),
          logo: logoOf(team), color: team.color ? '#' + team.color : '',
          record: rec ? rec.summary : '', standing: team.standingSummary || '',
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

  // ESPN fantasy football, public league.
  function fantasy(leagueId) {
    if (!leagueId) return Promise.resolve({ league: null });
    var now = new Date();
    var season = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear(); // NFL season runs into Jan/Feb
    var url = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + season + '/segments/0/leagues/' +
      encodeURIComponent(leagueId) + '?view=mTeam&view=mMatchupScore&view=mScoreboard&view=mSettings';
    return fetch(url).then(function (r) {
      if (r.status === 401) throw new Error('fantasy league is private — make it public in ESPN league settings');
      if (!r.ok) throw new Error('ESPN fantasy ' + r.status);
      return r.json();
    }).then(function (j) {
      var members = {};
      (j.members || []).forEach(function (m) { members[m.id] = m.firstName || m.displayName || ''; });
      var byId = {};
      (j.teams || []).forEach(function (t) {
        var o = (t.record || {}).overall || {};
        byId[t.id] = {
          id: t.id, name: t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim(), abbrev: t.abbrev,
          logo: t.logo || '', owner: members[t.primaryOwner] || '',
          wins: o.wins || 0, losses: o.losses || 0, ties: o.ties || 0,
          pf: Math.round((o.pointsFor || 0) * 10) / 10, seed: t.playoffSeed || 99
        };
      });
      var week = (j.status || {}).currentMatchupPeriod || j.scoringPeriodId;
      function side(x) {
        if (!x) return null;
        var pts = x.totalPointsLive != null ? x.totalPointsLive : x.totalPoints;
        return {
          team: byId[x.teamId],
          points: Math.round((pts || 0) * 100) / 100,
          projected: x.totalProjectedPointsLive != null ? Math.round(x.totalProjectedPointsLive * 10) / 10 : null
        };
      }
      var matchups = (j.schedule || []).filter(function (m) { return m.matchupPeriodId === week; })
        .map(function (m) { return { home: side(m.home), away: side(m.away), winner: m.winner }; });
      var standings = Object.keys(byId).map(function (k) { return byId[k]; })
        .sort(function (a, b) { return a.seed - b.seed || b.wins - a.wins || b.pf - a.pf; });
      return { league: (j.settings || {}).name || 'Fantasy', season: season, week: week, matchups: matchups, standings: standings };
    });
  }

  global.ESPN = { LEAGUES: LEAGUES, teams: teams, sports: sports, fantasy: fantasy };
})(window);
