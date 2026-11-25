// ritual syntax helper. lives at script.google.com
// tithe: sends invoices from your gmail. grimoire: grabs recipe pages. rite: calendar reminders + morning email
// change TOKEN to something long and random, then paste the same thing into the app settings
const TOKEN = 'CHANGE-ME-to-something-long-and-random';

const TZ = 'Europe/London';

// run this once from the editor so google asks for permissions. also sets up the morning email
function authorise() {
  GmailApp.getAliases();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  CalendarApp.getDefaultCalendar();
  morningTrigger(7);
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return out({ ok: false, error: 'Wrong token' });
    if (d.ping) return out({ ok: true });
    if (d.fetchRecipe) return out(recipePage(d.fetchRecipe));
    if (d.rite) return out(riteSave(d.rite));
    if (d.riteEvents) return out({ ok: true, events: riteEvents(d.riteEvents) });
    if (!d.to || !d.pdf) return out({ ok: false, error: 'Missing email or PDF' });

    const pdf = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', d.filename || 'invoice.pdf');
    const opts = { attachments: [pdf], name: d.fromName || '' };
    if (d.replyTo) opts.replyTo = d.replyTo;
    if (d.cc) opts.cc = d.cc;
    if (d.bcc) opts.bcc = d.bcc;

    GmailApp.sendEmail(d.to, d.subject || 'Invoice', d.body || '', opts);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

// pull the recipe json-ld out of a page, plus plain text as a fallback
function recipePage(url) {
  if (!/^https?:\/\//.test(url)) return { ok: false, error: 'Bad link' };
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36' }
  });
  if (res.getResponseCode() >= 400) return { ok: false, error: 'That site said ' + res.getResponseCode() };
  const html = res.getContentText();
  const ld = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) ld.push(m[1]);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const img = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  let text = '';
  if (!ld.length) {
    text = html.replace(/<(script|style|nav|header|footer|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 30000);
  }
  return { ok: true, ld: ld, title: t ? t[1].trim() : '', image: img ? img[1] : '', text: text };
}

// ---- rite ----
function riteSave(r) {
  const p = PropertiesService.getScriptProperties();
  const old = JSON.parse(p.getProperty('rite') || '{}');
  const data = { email: r.email || Session.getEffectiveUser().getEmail(), hour: +r.hour || 7, tasks: (r.tasks || []).slice(0, 80) };
  p.setProperty('rite', JSON.stringify(data));
  if (old.hour !== data.hour) morningTrigger(data.hour);
  const synced = r.calendar ? riteCalendar(data.tasks) : riteCalendar([]);
  return { ok: true, synced: synced, events: riteEvents(14) };
}

// timed tasks -> events in a "Rite" calendar with a popup on the dot
function riteCalendar(tasks) {
  const p = PropertiesService.getScriptProperties();
  const map = JSON.parse(p.getProperty('riteEvents') || '{}');
  const timed = tasks.filter(function (t) { return t.d && t.tm; });
  if (!timed.length && !Object.keys(map).length) return 0;
  const cal = CalendarApp.getCalendarsByName('Rite')[0] || CalendarApp.createCalendar('Rite', { color: CalendarApp.Color.RED, timeZone: TZ });
  const keep = {};
  timed.forEach(function (t) {
    const sig = t.d + ' ' + t.tm + ' ' + t.t;
    const old = map[t.id];
    if (old && old.s === sig) { keep[t.id] = old; return; }
    if (old) killEvent(cal, old.e);
    const start = Utilities.parseDate(t.d + ' ' + t.tm, TZ, 'yyyy-MM-dd HH:mm');
    if (start.getTime() < Date.now() - 3600000) return; // already gone
    const ev = cal.createEvent(t.t, start, new Date(start.getTime() + 15 * 60000));
    ev.removeAllReminders();
    ev.addPopupReminder(0);
    keep[t.id] = { e: ev.getId(), s: sig };
  });
  Object.keys(map).forEach(function (id) { if (!keep[id]) killEvent(cal, map[id].e); });
  p.setProperty('riteEvents', JSON.stringify(keep));
  return Object.keys(keep).length;
}

// your other calendars, so rite can show them. skips its own + hidden ones
function riteEvents(days) {
  days = Math.min(+days || 14, 60);
  const start = new Date(Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'00:00:00"));
  const end = new Date(start.getTime() + days * 86400000);
  const f = function (d) { return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm"); };
  const out = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.getName() === 'Rite' || cal.isHidden() || !cal.isSelected()) return;
    cal.getEvents(start, end).forEach(function (ev) {
      out.push({ id: ev.getId() + '|' + ev.getStartTime().getTime(), t: ev.getTitle() || '(No title)', cal: cal.getName(), col: cal.getColor(),
        all: ev.isAllDayEvent(), s: f(ev.getStartTime()), e: f(ev.getEndTime()), loc: (ev.getLocation() || '').slice(0, 80) });
    });
  });
  return out.sort(function (a, b) { return a.s.localeCompare(b.s); }).slice(0, 250);
}

function killEvent(cal, id) {
  try { const ev = cal.getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { }
}

function morningTrigger(hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'riteMorning') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('riteMorning').timeBased().atHour(hour).everyDays(1).inTimezone(TZ).create();
}

// runs every morning, emails today's list
function riteMorning() {
  const raw = PropertiesService.getScriptProperties().getProperty('rite');
  if (!raw) return;
  const d = JSON.parse(raw);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const tod = d.tasks.filter(function (t) { return t.d === today; }).sort(function (a, b) { return (a.tm || '99').localeCompare(b.tm || '99'); });
  const over = d.tasks.filter(function (t) { return t.d && t.d < today; });
  if (!tod.length && !over.length) return;
  const line = function (t) { return '  ' + (t.tm ? t.tm + '  ' : '') + t.t; };
  let body = '';
  if (tod.length) body += 'TODAY\n' + tod.map(line).join('\n') + '\n\n';
  if (over.length) body += 'OVERDUE\n' + over.map(line).join('\n') + '\n\n';
  body += 'https://ritualsyntax.github.io/rite/';
  const subj = tod.length + ' thing' + (tod.length === 1 ? '' : 's') + ' today' + (over.length ? ', ' + over.length + ' overdue' : '');
  GmailApp.sendEmail(d.email, subj, body, { name: 'Rite' });
}

function doGet() {
  return out({ ok: true, note: 'helper is up' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
