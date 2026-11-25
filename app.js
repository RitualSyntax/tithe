'use strict';
// tithe - invoices, expenses, tax estimate. everything lives in indexeddb on the phone

// rates - england/wales/ni, 2026/27. check these every april
const R = {
  pa: 12570, taperFrom: 100000, basicBand: 37700, addFrom: 125140,
  basic: 0.20, higher: 0.40, add: 0.45,
  c4Lo: 12570, c4Hi: 50270, c4Main: 0.06, c4Top: 0.02,
  tradingAllowance: 1000,
  mile1: 0.45, mile2: 0.25, mileCap: 10000,
  vatThreshold: 90000
};

// sa = the box it lands in on the self assessment form
const CATS = [
  { id: 'travel', name: 'Travel & accommodation', sa: 'Car, van and travel expenses' },
  { id: 'mileage', name: 'Mileage', sa: 'Car, van and travel expenses' },
  { id: 'equipment', name: 'Equipment & tools', sa: 'Other allowable business expenses' },
  { id: 'stock', name: 'Materials & consumables', sa: 'Cost of goods bought for resale or goods used' },
  { id: 'office', name: 'Phone, internet & software', sa: 'Phone, fax, stationery and other office costs' },
  { id: 'stationery', name: 'Stationery & postage', sa: 'Phone, fax, stationery and other office costs' },
  { id: 'advertising', name: 'Advertising & website', sa: 'Advertising and business entertainment costs' },
  { id: 'bank', name: 'Bank & card fees', sa: 'Bank, credit card and other financial charges' },
  { id: 'accountancy', name: 'Accountancy & legal', sa: 'Accountancy, legal and other professional fees' },
  { id: 'insurance', name: 'Insurance', sa: 'Other allowable business expenses' },
  { id: 'training', name: 'Training & courses', sa: 'Other allowable business expenses' },
  { id: 'clothing', name: 'Workwear & PPE', sa: 'Other allowable business expenses' },
  { id: 'home', name: 'Working from home', sa: 'Rent, rates, power and insurance costs' },
  { id: 'subcon', name: 'Subcontractors', sa: 'Wages, salaries and other staff costs' },
  { id: 'other', name: 'Other', sa: 'Other allowable business expenses' }
];
const cat = id => CATS.find(c => c.id === id) || CATS[CATS.length - 1];

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

const DEFAULTS = {
  name: '', business: '', address: '', email: '', phone: '',
  bankName: '', accName: '', sortCode: '', accNo: '',
  prefix: 'INV-', nextNum: 1, terms: 30, footer: 'Thank you for your business.',
  otherIncome: 0, basis: 'cash',
  vatReg: false, vatRate: 20, vatNo: '',
  scriptUrl: '', scriptToken: '', bccSelf: true,
  subject: 'Invoice {number} from {business}',
  body: 'Hi {client},\n\nPlease find attached invoice {number} for {total}, due by {due}.\n\nThanks,\n{name}'
};

const S = { settings: { ...DEFAULTS }, clients: [], invoices: [], expenses: [] };

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r2 = n => Math.round((+n || 0) * 100) / 100;
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const money = n => GBP.format(+n || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = s => s ? new Date(s + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const taxYearOf = s => { const [y, m, d] = s.split('-').map(Number); return (m < 4 || (m === 4 && d < 6)) ? y - 1 : y; };
const tyRange = y => [`${y}-04-06`, `${y + 1}-04-05`];
const tyLabel = y => `${y}/${String(y + 1).slice(2)}`;
const clientById = id => S.clients.find(c => c.id === id);
const emailOk = s => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s.trim());

function loadScript(src) {
  loadScript.p = loadScript.p || {};
  return loadScript.p[src] = loadScript.p[src] || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete loadScript.p[src]; rej(new Error('Could not load ' + src.split('/').pop())); };
    document.head.appendChild(s);
  });
}

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

function busy(btn, label) {
  if (!btn) return;
  if (label) { btn.dataset.was = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { btn.textContent = btn.dataset.was || btn.textContent; btn.disabled = false; }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// 9x9 pixel icons
const PX = {
  home: ['....#....', '...#.#...', '..#...#..', '.#.....#.', '#########', '.#.....#.', '.#.###.#.', '.#.#.#.#.', '.###.###.'],
  invoices: ['.######..', '.#....##.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.##..#.', '.#######.'],
  clients: ['...###...', '..#...#..', '..#...#..', '...###...', '.........', '..#####..', '.#.....#.', '#.......#', '#########'],
  expenses: ['.#######.', '.#.....#.', '.#.##..#.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#..##.#.', '.#.#.#.#.', '.##.#.##.'],
  tax: ['..#####..', '.#.....#.', '#...##..#', '#..#....#', '#.####..#', '#..#....#', '#.#####.#', '.#.....#.', '..#####..'],
  gear: ['...#.#...', '.#.###.#.', '..#####..', '.###.###.', '..##.##..', '.###.###.', '..#####..', '.#.###.#.', '...#.#...']
};
const pix = n => `<svg class="px" viewBox="0 0 9 9" shape-rendering="crispEdges">${PX[n].map((row, y) =>
  [...row].map((c, x) => c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>` : '').join('')).join('')}</svg>`;

// ---------- db ----------
const db = {
  open() {
    return this.p = this.p || new Promise((res, rej) => {
      const r = indexedDB.open('tithe', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('receipts'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async req(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), q = fn(t.objectStore(store));
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    });
  },
  get: (s, k) => db.req(s, 'readonly', o => o.get(k)),
  put: (s, k, v) => db.req(s, 'readwrite', o => o.put(v, k)),
  del: (s, k) => db.req(s, 'readwrite', o => o.delete(k)),
  keys: s => db.req(s, 'readonly', o => o.getAllKeys()),
  clear: s => db.req(s, 'readwrite', o => o.clear())
};
const save = k => db.put('kv', k, S[k]).catch(e => toast('Save failed: ' + e.message, 5000));

async function load() {
  for (const k of ['clients', 'invoices', 'expenses']) S[k] = (await db.get('kv', k)) || [];
  S.settings = { ...DEFAULTS, ...((await db.get('kv', 'settings')) || {}) };
}

// ---------- maths ----------
function totals(inv) {
  const sub = r2(sum(inv.items.map(l => (+l.qty || 0) * (+l.rate || 0))));
  const vat = inv.vatRate ? r2(sub * inv.vatRate / 100) : 0;
  return { sub, vat, total: r2(sub + vat) };
}
const statusOf = inv => inv.status === 'sent' && inv.due < today() ? 'overdue' : inv.status;
const tag = s => `<span class="tag ${s}">${s}</span>`;

function incomeTax(total) {
  if (total <= 0) return 0;
  let pa = R.pa;
  if (total > R.taperFrom) pa = Math.max(0, pa - (total - R.taperFrom) / 2);
  const taxable = Math.max(0, total - pa);
  const b = Math.min(taxable, R.basicBand);
  const h = Math.min(Math.max(taxable - R.basicBand, 0), R.addFrom - R.basicBand);
  const a = Math.max(taxable - R.addFrom, 0);
  return b * R.basic + h * R.higher + a * R.add;
}
const class4 = p => Math.max(0, Math.min(p, R.c4Hi) - R.c4Lo) * R.c4Main + Math.max(0, p - R.c4Hi) * R.c4Top;
const mileageAmt = miles => Math.min(miles, R.mileCap) * R.mile1 + Math.max(miles - R.mileCap, 0) * R.mile2;
// vat registered = claim net, otherwise the whole thing
const expNet = e => S.settings.vatReg ? r2((+e.amount || 0) - (+e.vat || 0)) : r2(+e.amount || 0);

function yearData(y) {
  const st = S.settings, [from, to] = tyRange(y);
  const inR = d => d && d >= from && d <= to;
  const incInv = S.invoices.filter(i => st.basis === 'accruals'
    ? i.status !== 'draft' && inR(i.date)
    : i.status === 'paid' && inR(i.paidAt));
  const income = r2(sum(incInv.map(i => totals(i).sub)));
  const outVat = r2(sum(incInv.map(i => totals(i).vat)));

  const exps = S.expenses.filter(e => inR(e.date));
  const miles = sum(exps.filter(e => e.cat === 'mileage').map(e => e.miles));
  const mileage = r2(mileageAmt(miles));
  const byCat = {};
  exps.filter(e => e.cat !== 'mileage').forEach(e => { byCat[e.cat] = r2((byCat[e.cat] || 0) + expNet(e)); });
  const inVat = st.vatReg ? r2(sum(exps.map(e => e.vat))) : 0;
  const expTotal = r2(sum(Object.values(byCat)) + mileage);

  // trading allowance if it beats real expenses
  const useTA = income > 0 && expTotal < R.tradingAllowance;
  const deduction = useTA ? Math.min(R.tradingAllowance, income) : expTotal;
  const profit = r2(Math.max(0, income - deduction));
  const other = +st.otherIncome || 0;
  const it = r2(incomeTax(other + profit) - incomeTax(other));
  const c4 = r2(class4(profit));
  const taxTotal = r2(it + c4);
  return { y, incInv, income, outVat, exps, miles, mileage, byCat, inVat, expTotal, useTA, deduction, profit, other, it, c4, taxTotal };
}

function yearsWithData() {
  const ys = new Set([taxYearOf(today())]);
  S.invoices.forEach(i => { ys.add(taxYearOf(i.date)); if (i.paidAt) ys.add(taxYearOf(i.paidAt)); });
  S.expenses.forEach(e => ys.add(taxYearOf(e.date)));
  return [...ys].sort((a, b) => b - a);
}
const yearSelect = () => `<select data-change="year">${yearsWithData().map(y =>
  `<option value="${y}" ${y === viewYear ? 'selected' : ''}>Tax year ${tyLabel(y)}</option>`).join('')}</select>`;

// ---------- views ----------
let tab = 'home', invFilter = 'all', viewYear = taxYearOf(today());
const TABS = [['home', 'Home'], ['invoices', 'Invoices'], ['clients', 'Clients'], ['expenses', 'Expenses'], ['tax', 'Tax']];

function render() {
  $('#tabs').innerHTML = TABS.map(([k, l]) =>
    `<button data-act="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${pix(k)}${l}</button>`).join('');
  $('#app').innerHTML = VIEWS[tab]();
}

const stat = (label, v, cls = '') => `<div class="stat"><div class="mono muted">${label}</div><div class="v ${cls}">${v}</div></div>`;

function invRow(i) {
  const c = clientById(i.clientId);
  return `<div class="item" data-act="openInv" data-id="${i.id}">
    <div><b>${esc(i.number)}</b> <span class="muted">${esc(c ? c.name : 'No client')}</span>
      <div class="mono muted">${fmtDate(i.date)} · due ${fmtDate(i.due)}</div></div>
    <div class="right"><div class="amt">${money(totals(i).total)}</div>${tag(statusOf(i))}</div>
  </div>`;
}

function expRow(e) {
  const amt = e.cat === 'mileage' ? money((+e.miles || 0) * R.mile1) : money(e.amount);
  return `<div class="item" data-act="openExp" data-id="${e.id}">
    <div><b>${esc(e.supplier || cat(e.cat).name)}</b>
      <div class="mono muted">${fmtDate(e.date)} · ${esc(cat(e.cat).name)}${e.cat === 'mileage' ? ` · ${e.miles} mi` : ''}${e.hasReceipt ? ' · rcpt' : ''}</div></div>
    <div class="right amt">${amt}</div>
  </div>`;
}

const VIEWS = {
  home() {
    const st = S.settings, t = yearData(taxYearOf(today()));
    const owed = S.invoices.filter(i => i.status === 'sent');
    const overdue = owed.filter(i => i.due < today());
    const pct = t.income ? Math.round(t.taxTotal / t.income * 100) : 0;
    const recent = [...S.invoices].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).slice(0, 5);
    return `
      ${!st.name && !st.business ? `<div class="card warn"><p>Set up your details first. They go on every invoice.</p>
        <button class="btn solid" data-act="settings">Set up</button></div>` : ''}
      <div class="quick">
        <button class="btn solid" data-act="newInv">New invoice</button>
        <button class="btn" data-act="scanExp">Scan receipt</button>
        <button class="btn" data-act="newExp">Add expense</button>
      </div>
      <div class="card"><h3>Tax year ${tyLabel(t.y)}</h3>
        <div class="stats">
          ${stat('Income', money(t.income))}${stat(t.useTA ? 'Allowance' : 'Expenses', money(t.deduction))}
          ${stat('Profit', money(t.profit))}${stat('Tax + NI', money(t.taxTotal), 'red')}
        </div>
        ${t.income ? `<p class="small muted" style="margin-top:10px">Set aside about <b class="red">${pct}%</b> of each payment for the taxman.</p>` : ''}
      </div>
      <div class="card"><h3>Owed to you</h3>
        <div class="stats">${stat('Outstanding', money(sum(owed.map(i => totals(i).total))))}
          ${stat('Overdue', `${overdue.length} · ${money(sum(overdue.map(i => totals(i).total)))}`, overdue.length ? 'red' : '')}</div>
      </div>
      <div class="card"><h3>Recent invoices</h3>
        ${recent.length ? recent.map(invRow).join('') : '<div class="empty">Nothing yet. It is waiting.</div>'}
      </div>`;
  },

  invoices() {
    const f = invFilter;
    const list = S.invoices.filter(i => f === 'all' || statusOf(i) === f)
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    return `
      <div class="row spread" style="margin-top:8px">
        <div class="chips">${['all', 'draft', 'sent', 'overdue', 'paid'].map(k =>
          `<button class="chip ${f === k ? 'on' : ''}" data-act="invFilter" data-f="${k}">${k}</button>`).join('')}</div>
      </div>
      <button class="btn solid wide" data-act="newInv" style="margin-top:10px">New invoice</button>
      <div class="card">${list.length ? list.map(invRow).join('') : '<div class="empty">No invoices here.</div>'}</div>`;
  },

  clients() {
    const list = [...S.clients].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <button class="btn solid wide" data-act="newClient" style="margin-top:8px">Add client</button>
      <div class="card">${list.length ? list.map(c => {
        const inv = S.invoices.filter(i => i.clientId === c.id && i.status !== 'draft');
        const owed = sum(inv.filter(i => i.status === 'sent').map(i => totals(i).total));
        return `<div class="item" data-act="openClient" data-id="${c.id}">
          <div><b>${esc(c.name)}</b><div class="mono muted" style="text-transform:none">${esc(c.email || 'No email')}</div></div>
          <div class="right"><div class="amt">${money(sum(inv.map(i => totals(i).total)))}</div>
            <div class="mono ${owed ? 'red' : 'muted'}">${owed ? money(owed) + ' owed' : inv.length + ' inv'}</div></div>
        </div>`;
      }).join('') : '<div class="empty">No clients yet.</div>'}</div>`;
  },

  expenses() {
    const t = yearData(viewYear);
    const list = [...t.exps].sort((a, b) => b.date.localeCompare(a.date));
    const months = {};
    list.forEach(e => { const k = e.date.slice(0, 7); (months[k] = months[k] || []).push(e); });
    return `
      <div style="margin-top:8px">${yearSelect()}</div>
      <div class="quick" style="grid-template-columns:1fr 1fr">
        <button class="btn solid" data-act="scanExp">Scan receipt</button>
        <button class="btn" data-act="newExp">Add manually</button>
      </div>
      <div class="card"><div class="stats">${stat('Expenses', money(t.expTotal))}${stat('Entries', list.length)}</div>
        ${t.miles ? `<p class="small muted" style="margin-top:8px">Includes ${t.miles} miles at ${money(t.mileage)}.</p>` : ''}</div>
      ${Object.keys(months).length ? Object.entries(months).map(([m, es]) => `
        <div class="card"><h3>${new Date(m + '-01T12:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
          ${es.map(expRow).join('')}</div>`).join('') : '<div class="card"><div class="empty">No expenses this tax year.</div></div>'}`;
  },

  tax() {
    const st = S.settings, t = yearData(viewYear);
    const owedOut = S.invoices.filter(i => i.status === 'sent');
    const pct = t.income ? Math.round(t.taxTotal / t.income * 100) : 0;
    const due = `31 Jan ${t.y + 2}`;
    // rolling 12 months for the vat threshold
    const yearAgo = addDays(today(), -365);
    const rolling = sum(S.invoices.filter(i => i.status !== 'draft' && i.date > yearAgo).map(i => totals(i).sub));
    const cats = Object.entries(t.byCat).sort((a, b) => b[1] - a[1]);
    return `
      <div style="margin-top:8px">${yearSelect()}</div>
      <div class="card"><h3>Estimate · ${tyLabel(t.y)}</h3>
        <table class="tbl">
          <tr><td>Income <span class="muted small">(${t.incInv.length} invoice${t.incInv.length === 1 ? '' : 's'}, ${st.basis === 'cash' ? 'by date paid' : 'by invoice date'})</span></td><td>${money(t.income)}</td></tr>
          ${cats.map(([k, v]) => `<tr class="sub"><td>${esc(cat(k).name)}</td><td>${money(v)}</td></tr>`).join('')}
          ${t.miles ? `<tr class="sub"><td>Mileage (${t.miles} mi)</td><td>${money(t.mileage)}</td></tr>` : ''}
          <tr><td>Expenses</td><td>−${money(t.expTotal)}</td></tr>
          ${t.useTA ? `<tr class="sub"><td>Trading allowance used instead (beats your expenses)</td><td>−${money(t.deduction)}</td></tr>` : ''}
          <tr><td><b>Taxable profit</b></td><td><b>${money(t.profit)}</b></td></tr>
          ${t.other ? `<tr class="sub"><td>Other income (uses your allowance first)</td><td>${money(t.other)}</td></tr>` : ''}
          <tr><td>Income tax on profit</td><td>${money(t.it)}</td></tr>
          <tr><td>Class 4 National Insurance</td><td>${money(t.c4)}</td></tr>
          <tr class="total"><td>To pay by ${due}</td><td>${money(t.taxTotal)}</td></tr>
        </table>
        ${t.income ? `<p class="small muted" style="margin-top:10px">That is <b class="red">${pct}%</b> of your income. Put that much aside from each payment.</p>` : ''}
      </div>
      ${t.taxTotal > 1000 ? `<div class="card warn"><h3>Payments on account</h3>
        <p class="small">Your bill is over £1,000, so HMRC will also want an advance on next year: half of this year's bill on ${due} and half on 31 Jul ${t.y + 2}.
        In your first year that makes the January bill roughly <b>${money(t.taxTotal * 1.5)}</b>.</p></div>` : ''}
      ${st.vatReg ? `<div class="card"><h3>VAT</h3><table class="tbl">
          <tr><td>VAT charged on invoices</td><td>${money(t.outVat)}</td></tr>
          <tr><td>VAT paid on expenses</td><td>−${money(t.inVat)}</td></tr>
          <tr class="total"><td>Owed to HMRC</td><td>${money(t.outVat - t.inVat)}</td></tr></table></div>`
        : rolling > R.vatThreshold * 0.8 ? `<div class="card warn"><h3>VAT threshold</h3>
          <p class="small">You've invoiced ${money(rolling)} in the last 12 months. You must register for VAT if this goes over ${money(R.vatThreshold)}.</p></div>` : ''}
      ${st.basis === 'cash' && owedOut.length ? `<p class="small muted" style="margin:0 2px">${owedOut.length} unpaid invoice${owedOut.length === 1 ? '' : 's'} (${money(sum(owedOut.map(i => totals(i).sub)))}) not counted until paid.</p>` : ''}
      <div class="actions"><button class="btn" data-act="exportCsv">Export ${tyLabel(t.y)} as CSV</button></div>
      <p class="small muted foot">Rough estimate on 2026/27 rates for England, Wales and NI. Scotland is different.
        Doesn't cover student loans, pensions or other income types. Check with HMRC or an accountant before you file.</p>`;
  }
};

// ---------- sheets ----------
let sheetBack = null;
function openSheet(html, mount, back = null) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-inner">${html}</div>`;
  el.hidden = false; document.body.classList.add('locked');
  sheetBack = back;
  if (mount) mount(el);
}
function closeSheet(done) {
  const cb = sheetBack; sheetBack = null;
  $('#sheet').hidden = true; $('#sheet').innerHTML = '';
  document.body.classList.remove('locked');
  if (!done && cb) cb();
}
const head = (title, extra = '') => `<div class="sheet-head"><h2>${title}</h2>${extra}<button class="x" data-act="closeSheet">✕</button></div>`;

function ask(msg, yes = 'Yes') {
  return new Promise(res => {
    const el = $('#dialog');
    el.innerHTML = `<div class="dlg"><p>${esc(msg)}</p><div class="row">
      <button class="btn ghost" id="dNo">Cancel</button><button class="btn solid" id="dYes">${esc(yes)}</button></div></div>`;
    el.hidden = false;
    $('#dNo').onclick = () => { el.hidden = true; res(false); };
    $('#dYes').onclick = () => { el.hidden = true; res(true); };
  });
}

// ---------- invoices ----------
let cur = null;

function nextNumber() {
  const st = S.settings;
  let n = +st.nextNum || 1, num;
  do { num = st.prefix + String(n++).padStart(4, '0'); } while (S.invoices.some(i => i.number === num));
  return num;
}

function blankInvoice(clientId) {
  const st = S.settings, d = today();
  return {
    id: uid(), number: nextNumber(), clientId: clientId || '',
    date: d, due: addDays(d, +st.terms || 30),
    items: [{ desc: '', qty: 1, rate: '' }], notes: '',
    status: 'draft', vatRate: st.vatReg ? +st.vatRate || 0 : 0
  };
}

function invoiceSheet(arg) {
  if (arg && typeof arg === 'object') cur = arg;
  else if (arg) cur = structuredClone(S.invoices.find(i => i.id === arg));
  else cur = blankInvoice(S.clients.length === 1 ? S.clients[0].id : '');
  const isNew = !S.invoices.some(i => i.id === cur.id);
  const opts = [...S.clients].sort((a, b) => a.name.localeCompare(b.name)).map(c =>
    `<option value="${c.id}" ${c.id === cur.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  openSheet(`
    ${head(isNew ? 'New invoice' : esc(cur.number), isNew ? '' : tag(statusOf(cur)))}
    <label>Client<select id="fClient">${cur.clientId ? '' : '<option value="">Pick a client</option>'}${opts}<option value="__new">+ New client</option></select></label>
    <label>Invoice number<input id="fNum" value="${esc(cur.number)}"></label>
    <div class="grid2">
      <label>Date<input id="fDate" type="date" value="${cur.date}"></label>
      <label>Due<input id="fDue" type="date" value="${cur.due}"></label>
    </div>
    <div class="mono muted lbl">Line items · qty × rate</div>
    <div id="lines"></div>
    <button class="btn ghost sm" data-act="addLine">+ Add line</button>
    <label>Notes on invoice<textarea id="fNotes" rows="2" placeholder="Optional. e.g. PO number, event name">${esc(cur.notes)}</textarea></label>
    ${cur.status === 'paid' ? `<label>Paid on<input id="fPaid" type="date" value="${cur.paidAt || today()}"></label>` : ''}
    <div id="tots" class="tots"></div>
    <div class="actions">
      <button class="btn ghost" data-act="saveInv">Save</button>
      <button class="btn ghost" data-act="pdfInv">PDF</button>
      <button class="btn solid" data-act="sendInv">${cur.status === 'draft' ? 'Complete & send' : 'Resend'}</button>
    </div>
    ${isNew ? '' : `<div class="actions">
      ${cur.status === 'paid' ? '<button class="btn ghost sm" data-act="unpaidInv">Mark unpaid</button>' : '<button class="btn ghost ok sm" data-act="paidInv">Mark paid</button>'}
      ${cur.status === 'draft' ? '<button class="btn ghost sm" data-act="markSent">Mark sent</button>' : ''}
      <button class="btn ghost sm" data-act="dupInv">Duplicate</button>
      <button class="btn ghost danger sm" data-act="delInv">Delete</button>
    </div>`}
  `, () => {
    drawLines();
    $('#fClient').onchange = e => {
      if (e.target.value !== '__new') return;
      readInv();
      clientSheet(null, c => { cur.clientId = c.id; invoiceSheet(cur); });
    };
    $('#fDate').onchange = e => { if (e.target.value) $('#fDue').value = addDays(e.target.value, +S.settings.terms || 30); };
    $('#lines').oninput = e => {
      const i = e.target.dataset.i, f = e.target.dataset.f;
      if (f) { cur.items[i][f] = e.target.value; updTotals(); }
    };
  });
}

function drawLines() {
  $('#lines').innerHTML = cur.items.map((l, i) => `
    <div class="line">
      <input data-i="${i}" data-f="desc" placeholder="Description" value="${esc(l.desc)}">
      <div class="line-nums">
        <input data-i="${i}" data-f="qty" type="number" inputmode="decimal" step="any" value="${esc(l.qty)}" aria-label="Quantity">
        <span class="muted">×</span>
        <input data-i="${i}" data-f="rate" type="number" inputmode="decimal" step="any" placeholder="£ rate" value="${esc(l.rate)}" aria-label="Rate">
        <span class="amt" id="amt${i}"></span>
        <button class="x sm" data-act="rmLine" data-i="${i}" aria-label="Remove line">✕</button>
      </div>
    </div>`).join('');
  updTotals();
}

function updTotals() {
  cur.items.forEach((l, i) => { const a = $('#amt' + i); if (a) a.textContent = money((+l.qty || 0) * (+l.rate || 0)); });
  const t = totals(cur);
  $('#tots').innerHTML = (t.vat ? `<div><span>Subtotal</span><span>${money(t.sub)}</span></div>
    <div><span>VAT ${cur.vatRate}%</span><span>${money(t.vat)}</span></div>` : '') +
    `<div class="grand"><span>Total</span><span>${money(t.total)}</span></div>`;
}

function readInv() {
  const v = $('#fClient').value;
  if (v !== '__new') cur.clientId = v;
  cur.number = $('#fNum').value.trim();
  cur.date = $('#fDate').value || today();
  cur.due = $('#fDue').value || cur.date;
  cur.notes = $('#fNotes').value.trim();
  if ($('#fPaid')) cur.paidAt = $('#fPaid').value || today();
}

function checkInv() {
  readInv();
  cur.items = cur.items.filter(l => String(l.desc).trim() || +l.rate);
  if (!cur.items.length) cur.items.push({ desc: '', qty: 1, rate: '' });
  if (!cur.clientId || !clientById(cur.clientId)) { toast('Pick a client'); return false; }
  if (!cur.number) { toast('Needs an invoice number'); return false; }
  if (S.invoices.some(i => i.number === cur.number && i.id !== cur.id)) { toast(cur.number + ' is already used'); return false; }
  if (!cur.items.some(l => String(l.desc).trim()) || totals(cur).total <= 0) { drawLines(); toast('Add at least one line with an amount'); return false; }
  return true;
}

function storeInv() {
  const i = S.invoices.findIndex(x => x.id === cur.id);
  cur.items = cur.items.map(l => ({ desc: String(l.desc).trim(), qty: +l.qty || 0, rate: +l.rate || 0 }));
  if (i < 0) {
    S.invoices.push(structuredClone(cur));
    // bump the counter past whatever number got used
    const m = cur.number.match(/(\d+)\s*$/);
    if (m) { S.settings.nextNum = Math.max(+S.settings.nextNum || 1, +m[1] + 1); save('settings'); }
  } else S.invoices[i] = structuredClone(cur);
  save('invoices');
}

function fill(tpl, inv) {
  const st = S.settings, c = clientById(inv.clientId) || {};
  const map = {
    number: inv.number, client: c.contact || c.name || '', total: money(totals(inv).total),
    due: fmtDate(inv.due), date: fmtDate(inv.date), business: st.business || st.name, name: st.name || st.business
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => k in map ? map[k] : m);
}

async function buildPdf(inv) {
  await loadScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const st = S.settings, c = clientById(inv.clientId) || {}, t = totals(inv);
  const L = 18, RR = 192, W = RR - L;
  const red = [196, 0, 0], ink = [22, 22, 22], grey = [115, 115, 115];
  let y = 22;
  const newPageIf = h => { if (y + h > 272) { doc.addPage(); y = 22; } };

  doc.setFillColor(...red); doc.rect(0, 0, 210, 3.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...ink);
  doc.text(st.business || st.name || 'Invoice', L, y);
  doc.setFontSize(22); doc.setTextColor(...red);
  doc.text('INVOICE', RR, y, { align: 'right' });
  y += 9;

  // from (left) + meta (right)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  const from = [st.business && st.name ? st.name : '', ...String(st.address || '').split('\n'), st.email, st.phone].map(s => (s || '').trim()).filter(Boolean);
  doc.setTextColor(...grey);
  from.forEach((l, i) => doc.text(l, L, y + i * 4.6));
  [['Invoice no.', inv.number], ['Date', fmtDate(inv.date)], ['Due', fmtDate(inv.due)]].forEach(([k, v], i) => {
    doc.setTextColor(...grey); doc.text(k, RR - 52, y + i * 5.2);
    doc.setTextColor(...ink); doc.text(v, RR, y + i * 5.2, { align: 'right' });
  });
  y += Math.max(from.length * 4.6, 16) + 8;

  // bill to
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...red);
  doc.text('BILL TO', L, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...ink);
  const to = [c.name, c.contact && c.contact !== c.name ? 'FAO ' + c.contact : '', ...String(c.address || '').split('\n'), c.email]
    .map(s => (s || '').trim()).filter(Boolean);
  to.forEach((l, i) => doc.text(l, L, y + i * 4.8));
  y += to.length * 4.8 + 9;

  // table
  const cQty = 136, cRate = 162;
  doc.setFillColor(244, 244, 244); doc.rect(L, y - 5.2, W, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...grey);
  doc.text('DESCRIPTION', L + 2, y); doc.text('QTY', cQty, y, { align: 'right' });
  doc.text('RATE', cRate, y, { align: 'right' }); doc.text('AMOUNT', RR - 2, y, { align: 'right' });
  y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  for (const l of inv.items) {
    const lines = doc.splitTextToSize(l.desc || '', cQty - L - 18);
    const h = lines.length * 4.8;
    newPageIf(h + 4);
    doc.setTextColor(...ink);
    doc.text(lines, L + 2, y);
    doc.text(String(+l.qty % 1 ? (+l.qty).toFixed(2) : +l.qty), cQty, y, { align: 'right' });
    doc.text(money(l.rate), cRate, y, { align: 'right' });
    doc.text(money((+l.qty || 0) * (+l.rate || 0)), RR - 2, y, { align: 'right' });
    y += h + 1.5;
    doc.setDrawColor(228); doc.line(L, y, RR, y);
    y += 5;
  }

  // totals
  y += 2; newPageIf(30);
  const totRow = (k, v, big) => {
    doc.setFont('helvetica', big ? 'bold' : 'normal'); doc.setFontSize(big ? 12 : 10);
    doc.setTextColor(...(big ? ink : grey)); doc.text(k, RR - 62, y);
    doc.setTextColor(...(big ? red : ink)); doc.text(v, RR - 2, y, { align: 'right' });
    y += big ? 8 : 5.5;
  };
  if (t.vat) { totRow('Subtotal', money(t.sub)); totRow(`VAT ${inv.vatRate}%`, money(t.vat)); }
  doc.setDrawColor(...red); doc.setLineWidth(.5); doc.line(RR - 62, y - 3.5, RR, y - 3.5); doc.setLineWidth(.2);
  y += 2;
  totRow('Total due', money(t.total), true);
  y += 6;

  // payment details
  const pay = [['Bank', st.bankName], ['Account name', st.accName], ['Sort code', st.sortCode], ['Account no.', st.accNo]].filter(r => r[1]);
  if (pay.length) {
    newPageIf(pay.length * 5 + 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...red);
    doc.text('PAYMENT DETAILS', L, y); y += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    [...pay, ['Reference', inv.number]].forEach(([k, v]) => {
      doc.setTextColor(...grey); doc.text(k, L, y);
      doc.setTextColor(...ink); doc.text(String(v), L + 32, y); y += 5;
    });
    doc.setTextColor(...grey); doc.setFontSize(9);
    doc.text(`Payment due by ${fmtDate(inv.due)}.`, L, y + 1); y += 9;
  }

  const notes = [inv.notes, st.footer].filter(Boolean).join('\n\n');
  if (notes) {
    const nl = doc.splitTextToSize(notes, W);
    newPageIf(nl.length * 4.5);
    doc.setFontSize(9.5); doc.setTextColor(...grey); doc.text(nl, L, y);
  }

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(...grey);
    const f = [st.business || st.name, st.vatReg && st.vatNo ? 'VAT reg. ' + st.vatNo : '', pages > 1 ? `Page ${p} of ${pages}` : ''].filter(Boolean).join('  ·  ');
    doc.text(f, 105, 289, { align: 'center' });
  }
  return doc;
}

async function deliver(inv, c) {
  const st = S.settings, doc = await buildPdf(inv), fname = `${inv.number}.pdf`;
  const subject = fill(st.subject, inv), body = fill(st.body, inv);
  if (st.scriptUrl) {
    // text/plain body on purpose, keeps it a simple request so no cors preflight
    const res = await fetch(st.scriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        token: st.scriptToken, to: c.email, cc: c.cc || '', bcc: st.bccSelf && st.email ? st.email : '',
        subject, body, fromName: st.business || st.name, replyTo: st.email || '',
        filename: fname, pdf: doc.output('datauristring').split(',').pop()
      })
    });
    const j = await res.json().catch(() => ({ ok: false, error: 'Odd reply from the mail script. Check the URL.' }));
    if (!j.ok) throw new Error(j.error || 'Mail script refused');
    return 'email';
  }
  // no script: share sheet, email copied so it can be pasted
  const file = new File([doc.output('blob')], fname, { type: 'application/pdf' });
  try { await navigator.clipboard.writeText(c.email); } catch (e) { /* meh */ }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: subject, text: body });
    return 'share';
  }
  doc.save(fname);
  location.href = `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(PDF attached)')}`;
  return 'mailto';
}

// ---------- clients ----------
let cc = null, ccAfter = null;
function clientSheet(id, after) {
  cc = id ? { ...clientById(id) } : { id: uid(), name: '', contact: '', email: '', cc: '', address: '', notes: '' };
  ccAfter = after || null;
  const used = S.invoices.filter(i => i.clientId === cc.id);
  openSheet(`
    ${head(id ? esc(cc.name) : 'New client')}
    <label>Company / name<input id="cName" value="${esc(cc.name)}" autocomplete="organization"></label>
    <label>Contact person<input id="cContact" value="${esc(cc.contact)}" placeholder="Used in the email greeting"></label>
    <label>Email (invoices go here)<input id="cEmail" type="email" inputmode="email" value="${esc(cc.email)}" placeholder="accounts@company.co.uk"></label>
    <label>CC<input id="cCc" value="${esc(cc.cc)}" placeholder="Optional. Comma separated"></label>
    <label>Address<textarea id="cAddr" rows="3">${esc(cc.address)}</textarea></label>
    <label>Notes<textarea id="cNotes" rows="2" placeholder="Private. Day rate, PO rules, etc">${esc(cc.notes)}</textarea></label>
    <div class="actions">
      <button class="btn solid" data-act="saveClient">Save</button>
      ${id ? '<button class="btn ghost" data-act="invForClient">New invoice</button>' : ''}
      ${id ? '<button class="btn ghost danger" data-act="delClient">Delete</button>' : ''}
    </div>
    ${used.length ? `<div class="sec">Invoices</div>${[...used].sort((a, b) => b.date.localeCompare(a.date)).map(invRow).join('')}` : ''}
  `, null, after ? () => invoiceSheet(cur) : null);
}

// ---------- expenses ----------
let ce = null, ceBlob = null, ceTouched = new Set();

function expenseSheet(id, blob) {
  ce = id ? { ...S.expenses.find(e => e.id === id) }
    : { id: uid(), date: today(), supplier: '', cat: 'other', amount: '', vat: '', miles: '', notes: '', hasReceipt: false };
  ceBlob = blob || null; ceTouched = new Set();
  const isNew = !S.expenses.some(e => e.id === ce.id);
  openSheet(`
    ${head(isNew ? 'New expense' : 'Expense')}
    <div class="rcpt" id="rcpt"></div>
    <div id="ocr" class="mono muted"></div>
    <label>Category<select id="eCat">${CATS.map(c => `<option value="${c.id}" ${c.id === ce.cat ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
    <div class="grid2">
      <label>Date<input id="eDate" type="date" value="${ce.date}"></label>
      <label id="eSupL">Supplier<input id="eSup" value="${esc(ce.supplier)}"></label>
    </div>
    <div id="eMoney"></div>
    <label>Notes<textarea id="eNotes" rows="2" placeholder="What it was for">${esc(ce.notes)}</textarea></label>
    <div class="actions">
      <button class="btn solid" data-act="saveExp">Save</button>
      ${isNew ? '' : '<button class="btn ghost danger" data-act="delExp">Delete</button>'}
    </div>
  `, async el => {
    drawMoney();
    el.addEventListener('input', e => { if (e.target.id) ceTouched.add(e.target.id); });
    $('#eCat').onchange = () => { ceTouched.add('eCat'); readExp(); drawMoney(); };
    if (ceBlob) { showThumb(ceBlob); runOcr(ceBlob); }
    else if (ce.hasReceipt) { const b = await db.get('receipts', ce.id); b ? showThumb(b) : showThumb(null); }
    else showThumb(null);
  });
}

function drawMoney() {
  const m = ce.cat === 'mileage';
  $('#eSupL').firstChild.textContent = m ? 'Journey' : 'Supplier';
  $('#eSup').placeholder = m ? 'Castleford → Leeds and back' : '';
  $('#eMoney').innerHTML = m
    ? `<label>Miles<input id="eMiles" type="number" inputmode="decimal" step="any" value="${esc(ce.miles)}"></label>
       <p class="hint">Claimed at 45p a mile, 25p after 10,000 in a tax year. If you claim mileage you can't also claim fuel or car costs.</p>`
    : `<div class="grid2">
        <label>Total paid<input id="eAmt" type="number" inputmode="decimal" step="any" placeholder="£" value="${esc(ce.amount)}"></label>
        ${S.settings.vatReg ? `<label>VAT included<input id="eVat" type="number" inputmode="decimal" step="any" placeholder="£" value="${esc(ce.vat)}"></label>` : '<div></div>'}
      </div>`;
}

function readExp() {
  ce.cat = $('#eCat').value;
  ce.date = $('#eDate').value || today();
  ce.supplier = $('#eSup').value.trim();
  ce.notes = $('#eNotes').value.trim();
  if ($('#eMiles')) ce.miles = $('#eMiles').value;
  if ($('#eAmt')) ce.amount = $('#eAmt').value;
  if ($('#eVat')) ce.vat = $('#eVat').value;
}

function showThumb(blob) {
  const el = $('#rcpt'); if (!el) return;
  el.innerHTML = blob
    ? `<img src="${URL.createObjectURL(blob)}" data-act="viewReceipt" alt="Receipt">
       <div class="row"><button class="btn ghost sm" data-act="addPhoto">Replace</button>
       <button class="btn ghost sm" data-act="rereadReceipt">Read again</button>
       <button class="btn ghost danger sm" data-act="rmPhoto">Remove</button></div>`
    : `<button class="btn ghost rcpt-add" data-act="addPhoto">+ Receipt photo</button>`;
  el._blob = blob;
}

function pickReceipt(inSheet) {
  const inp = $('#receiptPick');
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let b;
    try { b = await shrink(f); } catch (e) { b = f; }
    if (inSheet && $('#rcpt')) { ceBlob = b; ce._rm = false; showThumb(b); runOcr(b); }
    else expenseSheet(null, b);
  };
  inp.click();
}

// resize so receipts don't eat the phone
async function shrink(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
}

async function runOcr(blob) {
  const out = () => $('#ocr');
  if (!out()) return;
  out().textContent = 'Loading reader…';
  try {
    await loadScript(TESS_URL);
    const { data } = await Tesseract.recognize(blob, 'eng', {
      logger: m => { if (m.status === 'recognizing text' && out()) out().textContent = `Reading receipt… ${Math.round(m.progress * 100)}%`; }
    });
    if (!out()) return; // sheet got closed
    const p = parseReceipt(data.text || '');
    const set = (id, v) => { const el = $('#' + id); if (el && v != null && v !== '' && !ceTouched.has(id)) el.value = v; };
    if (p.cat && !ceTouched.has('eCat') && ce.cat === 'other') { $('#eCat').value = p.cat; readExp(); drawMoney(); }
    set('eSup', p.supplier); set('eDate', p.date);
    set('eAmt', p.total != null ? p.total.toFixed(2) : null);
    set('eVat', p.vat != null ? p.vat.toFixed(2) : null);
    out().textContent = p.total != null ? 'Filled in from the receipt. Check it.' : "Couldn't find a total. Fill it in yourself.";
  } catch (e) {
    if (out()) out().textContent = 'Reader failed (offline?). Fill it in yourself.';
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseReceipt(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const amtsIn = l => [...l.replace(/(\d)\s*[,.]\s*(\d{2})\b/g, '$1.$2').matchAll(/(?:£\s?)?(\d{1,5}\.\d{2})\b/g)].map(m => parseFloat(m[1]));
  let total = null, vat = null;

  // prefer lines that say total, ignore subtotal/vat lines
  for (const l of lines) {
    if (/total|amount due|balance due|to pay|amount paid/i.test(l) && !/sub\s*-?\s*total|vat|tax|saving|discount/i.test(l)) {
      const a = amtsIn(l);
      if (a.length) { const v = a[a.length - 1]; if (total === null || v > total) total = v; }
    }
  }
  if (total === null) { const all = lines.flatMap(amtsIn); if (all.length) total = Math.max(...all); }

  for (const l of lines) {
    if (/\bvat\b|\btax\b/i.test(l) && !/reg|no\.|number|#/i.test(l)) {
      const a = amtsIn(l).filter(v => total === null || v < total);
      if (a.length) { vat = a[a.length - 1]; break; }
    }
  }

  let date = null;
  for (const l of lines) {
    let m = l.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (m) {
      let [, d, mo, y] = m.map(Number); if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2000) { date = `${y}-${pad(mo)}-${pad(d)}`; break; }
    }
    m = l.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{2,4})\b/i);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      date = `${y}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(+m[1])}`; break;
    }
  }
  if (date && date > today()) date = null;

  const supplier = (lines.find(l => /[a-z]{3,}/i.test(l) && !/receipt|invoice|tel|phone|www|http|vat|welcome|@/i.test(l)) || '')
    .replace(/[^\w&'’ .\-]/g, '').trim().slice(0, 40) || null;

  const t = text.toLowerCase();
  const guess = [
    ['travel', /trainline|lner|northern|rail|uber|taxi|premier inn|travelodge|hotel|parking|ncp|shell|esso|\bbp\b|texaco|fuel|unleaded|diesel|national express|airbnb/],
    ['equipment', /screwfix|toolstation|thomann|cpc|farnell|gear4music|andertons|maplin|richer sounds|b&q|wickes/],
    ['stock', /gaffer|tape|batteries|cable ties|lamp|fuse/],
    ['office', /\bee\b|\bo2\b|vodafone|three\.co|virgin media|bt\.com|adobe|apple\.com|google|microsoft|dropbox|github/],
    ['stationery', /royal mail|post office|ryman|staples|whsmith|wh smith/],
    ['clothing', /hi-?vis|safety boots|workwear|arco|dickies/]
  ].find(([, re]) => re.test(t));

  return { total, vat, date, supplier, cat: guess ? guess[0] : null };
}

// ---------- settings ----------
const SET_FIELDS = [
  ['#Your details'],
  ['name', 'Your name'], ['business', 'Trading name', 'text', 'Optional. Shown at the top of invoices'],
  ['address', 'Address', 'textarea'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'],
  ['#Bank details', 'Printed on invoices so clients can pay you.'],
  ['bankName', 'Bank'], ['accName', 'Account name'], ['sortCode', 'Sort code'], ['accNo', 'Account number'],
  ['#Invoices'],
  ['prefix', 'Number prefix'], ['nextNum', 'Next number', 'number'], ['terms', 'Payment terms (days)', 'number'],
  ['footer', 'Footer note', 'textarea'],
  ['#Tax'],
  ['otherIncome', 'Other taxable income this tax year', 'number', 'PAYE salary etc. It uses up your tax-free allowance first, so the estimate is right.'],
  ['basis', 'Count income', 'select', [['cash', 'When paid (cash basis, the default)'], ['accruals', 'When invoiced (traditional)']]],
  ['vatReg', 'VAT registered', 'check'], ['vatRate', 'VAT rate %', 'number'], ['vatNo', 'VAT number'],
  ['#Email sending', 'Paste your Google mail script URL and token (see README). Leave blank to use the share sheet instead. Templates can use {number} {client} {total} {due} {date} {name} {business}.'],
  ['scriptUrl', 'Mail script URL', 'url'], ['scriptToken', 'Mail script token'], ['bccSelf', 'BCC me a copy', 'check'],
  ['subject', 'Subject'], ['body', 'Message', 'textarea']
];

function settingsSheet() {
  const st = S.settings;
  const f = ([k, label, type = 'text', extra]) => {
    if (k[0] === '#') return `<div class="sec">${k.slice(1)}</div>${label ? `<p class="hint">${esc(label)}</p>` : ''}`;
    const v = st[k];
    if (type === 'check') return `<label class="check"><input type="checkbox" id="s_${k}" ${v ? 'checked' : ''}>${label}</label>`;
    if (type === 'textarea') return `<label>${label}<textarea id="s_${k}" rows="${k === 'body' ? 6 : 3}">${esc(v)}</textarea></label>`;
    if (type === 'select') return `<label>${label}<select id="s_${k}">${extra.map(([o, t]) => `<option value="${o}" ${v === o ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    return `<label>${label}<input id="s_${k}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(v)}"></label>${extra ? `<p class="hint">${esc(extra)}</p>` : ''}`;
  };
  openSheet(`
    ${head('Settings')}
    ${SET_FIELDS.map(f).join('')}
    <div class="actions"><button class="btn ghost" data-act="testMail">Test mail script</button></div>
    <div class="actions"><button class="btn solid" data-act="saveSettings">Save settings</button></div>
    <div class="sec">Backup</div>
    <p class="hint">Everything lives on this phone only. Export a backup now and then and keep it somewhere safe.</p>
    <div class="actions">
      <button class="btn ghost" data-act="exportBackup">Export backup</button>
      <button class="btn ghost" data-act="importBackup">Restore backup</button>
    </div>
  `);
}

function readSettings() {
  const st = { ...S.settings };
  SET_FIELDS.forEach(([k, , type]) => {
    if (k[0] === '#') return;
    const el = $('#s_' + k); if (!el) return;
    st[k] = type === 'check' ? el.checked : type === 'number' ? (+el.value || 0) : el.value.trim();
  });
  return st;
}

// ---------- backup / export ----------
const blobToData = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

async function exportBackup() {
  const receipts = {};
  for (const k of await db.keys('receipts')) { const b = await db.get('receipts', k); if (b) receipts[k] = await blobToData(b); }
  const data = { app: 'tithe', v: 1, at: new Date().toISOString(), settings: S.settings, clients: S.clients, invoices: S.invoices, expenses: S.expenses, receipts };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `tithe-backup-${today()}.json`);
}

function importBackup() {
  const inp = $('#backupPick');
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch (e) { toast('That file isn\'t a backup'); return; }
    if (d.app !== 'tithe') { toast('That file isn\'t a Tithe backup'); return; }
    if (!await ask(`Restore the backup from ${fmtDate((d.at || '').slice(0, 10))}?\nThis replaces everything on this phone.`, 'Restore')) return;
    S.settings = { ...DEFAULTS, ...d.settings }; S.clients = d.clients || []; S.invoices = d.invoices || []; S.expenses = d.expenses || [];
    await Promise.all(['settings', 'clients', 'invoices', 'expenses'].map(save));
    await db.clear('receipts');
    for (const [k, url] of Object.entries(d.receipts || {})) await db.put('receipts', k, await (await fetch(url)).blob());
    closeSheet(true); render(); toast('Restored');
  };
  inp.click();
}

function exportCsv() {
  const t = yearData(viewYear), cash = S.settings.basis === 'cash';
  const rows = [['Type', 'Date', 'Ref', 'Client / supplier', 'Category', 'Self Assessment box', 'Net', 'VAT', 'Gross', 'Notes']];
  t.incInv.forEach(i => {
    const x = totals(i), c = clientById(i.clientId);
    rows.push(['Income', cash ? i.paidAt : i.date, i.number, c ? c.name : '', 'Sales', 'Turnover', x.sub, x.vat, x.total, i.notes]);
  });
  t.exps.forEach(e => {
    const m = e.cat === 'mileage';
    const gross = m ? r2((+e.miles || 0) * R.mile1) : +e.amount || 0;
    const vat = m || !S.settings.vatReg ? 0 : +e.vat || 0;
    rows.push(['Expense', e.date, '', e.supplier, cat(e.cat).name, cat(e.cat).sa, r2(gross - vat), vat, gross, m ? `${e.miles} miles. ${e.notes || ''}` : e.notes]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv' }), `tithe-${tyLabel(t.y).replace('/', '-')}.csv`);
}

// ---------- actions ----------
const ACTS = {
  tab: d => { tab = d.tab; render(); scrollTo(0, 0); },
  settings: () => settingsSheet(),
  closeSheet: () => closeSheet(),
  closeViewer: () => { $('#viewer').hidden = true; $('#viewer').innerHTML = ''; },

  newInv: () => invoiceSheet(),
  openInv: d => invoiceSheet(d.id),
  invFilter: d => { invFilter = d.f; render(); },
  addLine: () => { cur.items.push({ desc: '', qty: 1, rate: '' }); drawLines(); $(`#lines [data-i="${cur.items.length - 1}"][data-f="desc"]`).focus(); },
  rmLine: d => { cur.items.splice(+d.i, 1); if (!cur.items.length) cur.items.push({ desc: '', qty: 1, rate: '' }); drawLines(); },
  saveInv: () => { if (!checkInv()) return; storeInv(); closeSheet(true); render(); toast('Saved'); },
  pdfInv: async (d, btn) => {
    if (!checkInv()) return;
    storeInv(); busy(btn, '…');
    try { (await buildPdf(cur)).save(`${cur.number}.pdf`); } catch (e) { toast(e.message, 5000); }
    busy(btn);
  },
  sendInv: async (d, btn) => {
    if (!checkInv()) return;
    const c = clientById(cur.clientId);
    if (!c.email) { toast('Add an email address to ' + c.name + ' first'); return; }
    const st = S.settings;
    if (!st.name && !st.business) { toast('Fill in your details in settings first'); return; }
    const msg = st.scriptUrl
      ? `Send ${cur.number} (${money(totals(cur).total)}) to ${c.email}${c.cc ? '\nCC ' + c.cc : ''}?`
      : `No mail script set up, so this opens your share sheet with the PDF.\n${c.email} gets copied so you can paste it in.`;
    if (!await ask(msg, st.scriptUrl ? 'Send' : 'Open')) return;
    storeInv(); busy(btn, 'Sending…');
    try {
      const via = await deliver(cur, c);
      if (cur.status === 'draft') cur.status = 'sent';
      cur.sentAt = today(); storeInv();
      closeSheet(true); render();
      toast(via === 'email' ? `Sent to ${c.email}` : 'Marked as sent');
    } catch (e) {
      busy(btn);
      if (e.name !== 'AbortError') toast('Not sent: ' + e.message, 6000);
    }
  },
  markSent: () => { if (!checkInv()) return; cur.status = 'sent'; cur.sentAt = today(); storeInv(); closeSheet(true); render(); toast('Marked sent'); },
  paidInv: () => { if (!checkInv()) return; cur.status = 'paid'; cur.paidAt = today(); storeInv(); closeSheet(true); render(); toast('Paid. Nice.'); },
  unpaidInv: () => { readInv(); cur.status = 'sent'; delete cur.paidAt; storeInv(); invoiceSheet(cur.id); render(); },
  dupInv: () => {
    readInv();
    const c = structuredClone(cur), d = today();
    Object.assign(c, { id: uid(), number: nextNumber(), date: d, due: addDays(d, +S.settings.terms || 30), status: 'draft', vatRate: S.settings.vatReg ? +S.settings.vatRate || 0 : 0 });
    delete c.paidAt; delete c.sentAt;
    invoiceSheet(c);
  },
  delInv: async () => {
    if (!await ask(`Delete ${cur.number}? Can't undo.`, 'Delete')) return;
    S.invoices = S.invoices.filter(i => i.id !== cur.id); save('invoices'); closeSheet(true); render();
  },

  newClient: () => clientSheet(),
  openClient: d => clientSheet(d.id),
  invForClient: () => invoiceSheet(blankInvoice(cc.id)),
  saveClient: () => {
    cc.name = $('#cName').value.trim(); cc.contact = $('#cContact').value.trim();
    cc.email = $('#cEmail').value.trim(); cc.cc = $('#cCc').value.trim();
    cc.address = $('#cAddr').value.trim(); cc.notes = $('#cNotes').value.trim();
    if (!cc.name) { toast('Needs a name'); return; }
    if (cc.email && !emailOk(cc.email)) { toast('That email looks wrong'); return; }
    if (cc.cc && !cc.cc.split(',').every(emailOk)) { toast('A CC address looks wrong'); return; }
    const i = S.clients.findIndex(c => c.id === cc.id);
    i < 0 ? S.clients.push(cc) : (S.clients[i] = cc);
    save('clients');
    const after = ccAfter; ccAfter = null;
    closeSheet(true); render(); toast('Saved');
    if (after) after(cc);
  },
  delClient: async () => {
    if (S.invoices.some(i => i.clientId === cc.id)) { toast('Has invoices. Delete those first.'); return; }
    if (!await ask(`Delete ${cc.name}?`, 'Delete')) return;
    S.clients = S.clients.filter(c => c.id !== cc.id); save('clients'); closeSheet(true); render();
  },

  newExp: () => expenseSheet(),
  scanExp: () => pickReceipt(false),
  openExp: d => expenseSheet(d.id),
  addPhoto: () => pickReceipt(true),
  rereadReceipt: () => { ceTouched = new Set(); const b = $('#rcpt')._blob; if (b) runOcr(b); },
  rmPhoto: () => { ceBlob = null; ce._rm = true; showThumb(null); $('#ocr').textContent = ''; },
  viewReceipt: () => {
    const b = $('#rcpt')._blob; if (!b) return;
    const v = $('#viewer'); v.innerHTML = `<img src="${URL.createObjectURL(b)}" alt="Receipt">`; v.hidden = false;
  },
  saveExp: async () => {
    readExp();
    if (ce.cat === 'mileage') { if (!(+ce.miles > 0)) { toast('How many miles?'); return; } ce.amount = r2(+ce.miles * R.mile1); ce.vat = ''; }
    else if (!(+ce.amount > 0)) { toast('How much was it?'); return; }
    if (+ce.vat > +ce.amount) { toast("VAT can't be more than the total"); return; }
    if (ceBlob) { await db.put('receipts', ce.id, ceBlob); ce.hasReceipt = true; }
    else if (ce._rm) { await db.del('receipts', ce.id); ce.hasReceipt = false; }
    delete ce._rm;
    const i = S.expenses.findIndex(e => e.id === ce.id);
    i < 0 ? S.expenses.push(ce) : (S.expenses[i] = ce);
    save('expenses');
    viewYear = taxYearOf(ce.date);
    closeSheet(true); render(); toast('Saved');
  },
  delExp: async () => {
    if (!await ask('Delete this expense?', 'Delete')) return;
    S.expenses = S.expenses.filter(e => e.id !== ce.id); save('expenses'); db.del('receipts', ce.id);
    closeSheet(true); render();
  },

  saveSettings: () => {
    const st = readSettings();
    if (st.email && !emailOk(st.email)) { toast('Your email looks wrong'); return; }
    if (st.scriptUrl && !/^https:\/\/script\.google\.com\//.test(st.scriptUrl)) { toast('Mail script URL should start https://script.google.com/'); return; }
    S.settings = st; save('settings'); closeSheet(true); render(); toast('Saved');
  },
  testMail: async (d, btn) => {
    const st = readSettings();
    if (!st.scriptUrl) { toast('Paste the script URL first'); return; }
    busy(btn, 'Testing…');
    try {
      const j = await (await fetch(st.scriptUrl, { method: 'POST', body: JSON.stringify({ token: st.scriptToken, ping: true }) })).json();
      toast(j.ok ? 'Mail script is alive' : 'Script says: ' + j.error, 4000);
    } catch (e) { toast('Could not reach it. Check the URL and that it is deployed for Anyone.', 5000); }
    busy(btn);
  },
  exportBackup: () => exportBackup(),
  importBackup: () => importBackup(),
  exportCsv: () => exportCsv()
};

const CHG = { year: v => { viewYear = +v; render(); } };

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACTS[t.dataset.act]) ACTS[t.dataset.act](t.dataset, t, e);
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-change]');
  if (t && CHG[t.dataset.change]) CHG[t.dataset.change](t.value, t);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// ---------- boot ----------
(async () => {
  $('#gearBtn').innerHTML = pix('gear');
  try { await load(); } catch (e) { toast('Storage broke: ' + e.message, 8000); }
  render();
  // ask chrome not to bin our data when space is low
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // warm up the pdf lib so the share sheet doesn't time out later
  setTimeout(() => loadScript(JSPDF_URL).catch(() => {}), 1500);
})();
