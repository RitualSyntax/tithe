// ritual syntax helper. lives at script.google.com
// tithe: sends invoices from your gmail. grimoire: grabs recipe pages
// change TOKEN to something long and random, then paste the same thing into the app settings
const TOKEN = 'CHANGE-ME-to-something-long-and-random';

// run this once from the editor so google asks for permissions
function authorise() {
  GmailApp.getAliases();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return out({ ok: false, error: 'Wrong token' });
    if (d.ping) return out({ ok: true });
    if (d.fetchRecipe) return out(recipePage(d.fetchRecipe));
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

function doGet() {
  return out({ ok: true, note: 'helper is up' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
