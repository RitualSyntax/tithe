// tithe mailer. lives at script.google.com, sends invoices from your own gmail
// change TOKEN to something long and random, then paste the same thing into the app settings
const TOKEN = 'CHANGE-ME-to-something-long-and-random';

// run this once from the editor so google asks for gmail permission
function authorise() {
  GmailApp.getAliases();
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return out({ ok: false, error: 'Wrong token' });
    if (d.ping) return out({ ok: true });
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

function doGet() {
  return out({ ok: true, note: 'tithe mailer is up' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
