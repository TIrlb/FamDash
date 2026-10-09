/**
 * FamDash API — Google Apps Script web app.
 *
 * Deploy as: Execute as "Me", Who has access "Anyone".
 * Run setup() once from the editor first; it creates the token, ntfy topic,
 * photo folder and default state, and logs what you need.
 *
 * GET  ?action=state|events|calendars|photos|photo&token=...
 * POST {token, action: adjust|setKid|setSettings|setCalendars|upload|deletePhoto, ...}
 *      (sent as text/plain so the browser skips the CORS preflight)
 */

const PROPS = PropertiesService.getScriptProperties();

function setup() {
  if (!PROPS.getProperty('TOKEN')) {
    PROPS.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  if (!PROPS.getProperty('NTFY_TOPIC')) {
    PROPS.setProperty('NTFY_TOPIC', 'famdash-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  }
  if (!PROPS.getProperty('PHOTO_FOLDER_ID')) {
    const folder = DriveApp.createFolder('FamDash Photos');
    PROPS.setProperty('PHOTO_FOLDER_ID', folder.getId());
  }
  if (!PROPS.getProperty('STATE')) {
    PROPS.setProperty('STATE', JSON.stringify(defaultState_()));
  }
  // Touch the services so the authorization prompt covers everything.
  CalendarApp.getDefaultCalendar();
  Logger.log('TOKEN: ' + PROPS.getProperty('TOKEN'));
  Logger.log('NTFY_TOPIC: ' + PROPS.getProperty('NTFY_TOPIC'));
  Logger.log('Photo folder: https://drive.google.com/drive/folders/' + PROPS.getProperty('PHOTO_FOLDER_ID'));
}

function defaultState_() {
  return {
    kids: [
      { id: 'k1', name: 'Ben', count: 0, goal: 50, color: '#2f7fe0' },
      { id: 'k2', name: 'Nate', count: 0, goal: 50, color: '#ef6c2f' }
    ],
    calendars: [CalendarApp.getDefaultCalendar().getId()],
    settings: {
      views: ['calendar', 'jars', 'photo', 'lunch'],
      viewSeconds: 20,
      holdSeconds: 30,
      daysAhead: 30,
      maxEvents: 14,
      lunchUrl: 'https://stpiuscatholicschool.net/lunch',
      lunchFilesBase: 'https://files.ecatholic.com/2970/pictures/',
      lunchImageUrl: ''
    }
  };
}

/* ---------- plumbing ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  if (!token || token !== PROPS.getProperty('TOKEN')) throw new Error('unauthorized');
}

function getState_() {
  const raw = PROPS.getProperty('STATE');
  const s = raw ? JSON.parse(raw) : defaultState_();
  const d = defaultState_().settings;
  s.settings = Object.assign({}, d, s.settings || {});
  return s;
}

function saveState_(s) {
  PROPS.setProperty('STATE', JSON.stringify(s));
}

function publicState_(s) {
  return {
    kids: s.kids,
    calendars: s.calendars,
    settings: s.settings,
    ntfyTopic: PROPS.getProperty('NTFY_TOPIC')
  };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- GET ---------- */

function doGet(e) {
  try {
    const p = e.parameter || {};
    checkToken_(p.token);
    switch (p.action) {
      case 'state': return json_({ ok: true, state: publicState_(getState_()) });
      case 'events': return json_({ ok: true, events: events_() });
      case 'calendars': return json_({ ok: true, calendars: calendars_() });
      case 'photos': return json_({ ok: true, photos: photos_() });
      case 'lunch': return json_(Object.assign({ ok: true }, lunch_(p.fresh === '1')));
      case 'photo': return json_(Object.assign({ ok: true }, photo_(p.id)));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function events_() {
  const s = getState_();
  const now = new Date();
  const end = new Date(now.getTime() + s.settings.daysAhead * 86400000);
  const out = [];
  s.calendars.forEach(function (id) {
    const cal = CalendarApp.getCalendarById(id);
    if (!cal) return;
    const color = cal.getColor();
    const calName = cal.getName();
    cal.getEvents(now, end).forEach(function (ev) {
      out.push({
        title: ev.getTitle(),
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        location: ev.getLocation() || '',
        color: color,
        calendar: calName
      });
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out.slice(0, s.settings.maxEvents);
}

function calendars_() {
  const selected = getState_().calendars;
  return CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName(), color: c.getColor(), selected: selected.indexOf(c.getId()) >= 0 };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function folder_() {
  return DriveApp.getFolderById(PROPS.getProperty('PHOTO_FOLDER_ID'));
}

function photos_() {
  const it = folder_().getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || f.getMimeType().indexOf('image/') !== 0) continue;
    out.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString() });
  }
  out.sort(function (a, b) { return a.created < b.created ? -1 : a.created > b.created ? 1 : 0; });
  return out;
}

function photo_(id) {
  const f = DriveApp.getFileById(id);
  // Only serve files that live in the photo folder.
  const parents = f.getParents();
  let inFolder = false;
  const folderId = PROPS.getProperty('PHOTO_FOLDER_ID');
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw new Error('not a FamDash photo');
  const blob = f.getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- POST ---------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    checkToken_(body.token);
    switch (body.action) {
      case 'adjust': return json_({ ok: true, state: withLock_(function () { return adjust_(body.kidId, Number(body.delta) || 0); }) });
      case 'setKid': return json_({ ok: true, state: withLock_(function () { return setKid_(body); }) });
      case 'setSettings': return json_({ ok: true, state: withLock_(function () { return setSettings_(body.settings || {}); }) });
      case 'setCalendars': return json_({ ok: true, state: withLock_(function () { return setCalendars_(body.ids || []); }) });
      case 'upload': return json_(Object.assign({ ok: true }, upload_(body)));
      case 'deletePhoto': return json_(Object.assign({ ok: true }, deletePhoto_(body.id)));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function findKid_(s, id) {
  const k = s.kids.filter(function (x) { return x.id === id; })[0];
  if (!k) throw new Error('no such kid');
  return k;
}

function adjust_(kidId, delta) {
  const s = getState_();
  const k = findKid_(s, kidId);
  k.count = Math.max(0, Math.min(999, k.count + delta));
  saveState_(s);
  return publicState_(s);
}

function setKid_(b) {
  const s = getState_();
  const k = findKid_(s, b.kidId);
  if (typeof b.name === 'string' && b.name.trim()) k.name = b.name.trim().slice(0, 24);
  if (b.goal != null) k.goal = Math.max(5, Math.min(200, Math.round(Number(b.goal)) || k.goal));
  if (b.count != null) k.count = Math.max(0, Math.min(999, Math.round(Number(b.count)) || 0));
  if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) k.color = b.color;
  saveState_(s);
  return publicState_(s);
}

function setSettings_(n) {
  const s = getState_();
  const st = s.settings;
  if (Array.isArray(n.views)) {
    const allowed = ['calendar', 'jars', 'photo', 'lunch'];
    const v = n.views.filter(function (x) { return allowed.indexOf(x) >= 0; });
    if (v.length) st.views = v;
  }
  if (n.viewSeconds != null) st.viewSeconds = Math.max(5, Math.min(600, Number(n.viewSeconds) || st.viewSeconds));
  if (n.holdSeconds != null) st.holdSeconds = Math.max(5, Math.min(3600, Number(n.holdSeconds) || st.holdSeconds));
  if (n.daysAhead != null) st.daysAhead = Math.max(1, Math.min(120, Number(n.daysAhead) || st.daysAhead));
  if (n.maxEvents != null) st.maxEvents = Math.max(3, Math.min(40, Number(n.maxEvents) || st.maxEvents));
  if (typeof n.lunchUrl === 'string' && /^https:\/\//.test(n.lunchUrl.trim())) {
    st.lunchUrl = n.lunchUrl.trim();
    CacheService.getScriptCache().remove('lunch');
  }
  if (typeof n.lunchImageUrl === 'string') {
    const u = n.lunchImageUrl.trim();
    if (u === '' || /^https:\/\//.test(u)) {
      if (u !== st.lunchImageUrl) PROPS.deleteProperty('LUNCH_LAST');
      st.lunchImageUrl = u;
      CacheService.getScriptCache().remove('lunch');
    }
  }
  saveState_(s);
  return publicState_(s);
}

function setCalendars_(ids) {
  const s = getState_();
  s.calendars = ids.filter(function (id) { return !!CalendarApp.getCalendarById(id); });
  saveState_(s);
  return publicState_(s);
}

function upload_(b) {
  if (!b.data || !/^image\//.test(b.mime || '')) throw new Error('bad upload');
  const bytes = Utilities.base64Decode(b.data);
  const name = (b.name || ('photo-' + Date.now() + '.jpg')).replace(/[^\w.\- ]/g, '_');
  const f = folder_().createFile(Utilities.newBlob(bytes, b.mime, name));
  return { id: f.getId() };
}

function deletePhoto_(id) {
  const f = DriveApp.getFileById(id);
  const folderId = PROPS.getProperty('PHOTO_FOLDER_ID');
  const parents = f.getParents();
  let inFolder = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw new Error('not a FamDash photo');
  f.setTrashed(true); // goes to Drive trash, recoverable for 30 days
  return { deleted: id };
}

/* ---------- school lunch calendar ---------- */

/**
 * Finds the lunch-calendar image on the school's lunch page. The image's folder
 * and file name change every month, so pick by content rather than by path:
 * eCatholic "pictures" images (not staff thumbnails), preferring names with
 * lunch/menu, newest by the ?t= upload timestamp. Cached 3h.
 */
function lunch_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('lunch');
    if (hit) return JSON.parse(hit);
  }
  const st = getState_().settings;
  const notes = [];
  // 1. The page itself. The school site sits behind a Cloudflare bot challenge, so this
  //    usually 403s from Google's servers; kept in case that's ever relaxed.
  let out = null;
  try {
    const res = UrlFetchApp.fetch(st.lunchUrl, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() === 200) {
      const pick = pickLunchImage_(res.getContentText());
      if (pick) out = { url: pick.url, name: pick.name, source: 'page' };
      else notes.push('no image on page');
    } else notes.push('page ' + res.getResponseCode());
  } catch (e) { notes.push('page error'); }
  // 2. Guess this month's file from the naming the school has used ("October lunch.png").
  if (!out) {
    const g = guessLunchImage_(st.lunchFilesBase);
    if (g) out = { url: g, name: decodeURIComponent(g.split('/').pop()), source: 'guess' };
    else notes.push('no guess matched');
  }
  // 3. URL pasted in the controller, then the last image that worked.
  if (!out && st.lunchImageUrl) out = { url: st.lunchImageUrl, name: 'manual', source: 'manual' };
  if (!out) {
    const last = PROPS.getProperty('LUNCH_LAST');
    if (last) out = JSON.parse(last);
  }
  if (!out) throw new Error('no lunch image (' + notes.join(', ') + ') — paste the image URL in controller settings');
  out.checked = new Date().toISOString();
  out.notes = notes;
  if (out.source !== 'manual') PROPS.setProperty('LUNCH_LAST', JSON.stringify({ url: out.url, name: out.name, source: 'last good' }));
  cache.put('lunch', JSON.stringify(out), 3 * 3600);
  return out;
}

function guessLunchImage_(base) {
  if (!base) return null;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const name = MONTHS[now.getMonth()];
  const folders = [-1, 0].map(function (off) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/';
  });
  const stems = [name + ' lunch', name + ' Lunch', name + ' Lunch Menu', name + ' lunch menu', name + ' Menu', name + ' menu'];
  const exts = ['.png', '.jpg', '.jpeg'];
  const urls = [];
  folders.reverse().forEach(function (f) {          // newest folder first
    stems.forEach(function (s) { exts.forEach(function (x) { urls.push(base + f + encodeURIComponent(s) + x); }); });
  });
  const res = UrlFetchApp.fetchAll(urls.map(function (u) { return { url: u, muteHttpExceptions: true }; }));
  for (let i = 0; i < res.length; i++) {
    const type = String(res[i].getHeaders()['Content-Type'] || '');
    if (res[i].getResponseCode() === 200 && type.indexOf('image/') === 0) return urls[i];
  }
  return null;
}

function pickLunchImage_(html) {
  const re = /https?:\/\/files\.ecatholic\.com\/\d+\/pictures\/(\d{4})\/(\d{1,2})\/([^"'\s<>?]+?\.(?:png|jpe?g|gif|webp))(?:\?t=(\d+))?/gi;
  const seen = {};
  const list = [];
  let m;
  html = html.replace(/&amp;/g, '&');
  while ((m = re.exec(html))) {
    const url = m[0];
    if (seen[url]) continue;
    seen[url] = true;
    let name;
    try { name = decodeURIComponent(m[3]); } catch (e) { name = m[3]; }
    const lower = name.toLowerCase();
    list.push({
      url: url,
      name: name,
      lunchy: /lunch|menu/.test(lower),
      logo: /logo/.test(lower),
      when: m[4] ? Number(m[4]) : Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)
    });
  }
  const pool = list.filter(function (x) { return x.lunchy; });
  const candidates = pool.length ? pool : list.filter(function (x) { return !x.logo; });
  candidates.sort(function (a, b) { return b.when - a.when; });
  return candidates[0] || null;
}
