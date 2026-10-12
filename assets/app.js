/*
 * The partner's side of the BoomBuy integration, rendered from the same JSON a
 * partner actually receives.
 *
 * Two sources, and the distinction matters:
 *   sample — data/sample-feed.json, committed, so the page works for anyone.
 *   live   — a real GET against the partner API. The key is typed in at
 *            runtime and kept in localStorage; it is never part of the site,
 *            because this page is public and anything shipped in it is public
 *            too. The request leaves the VIEWER's browser, so the viewer's own
 *            IP has to be on the partner's allow-list.
 */
'use strict';

const SAMPLE_URL = 'data/sample-feed.json';
const LS_KEY = 'boombuy.partner.demo';

const state = {
  items: [],
  raw: null,
  source: 'sample',
  base: '',
  key: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) =>
  (typeof n === 'number' ? n : Number(n || 0)).toLocaleString('he-IL', {
    style: 'currency', currency: 'ILS', maximumFractionDigits: 2,
  });

const pretty = (o) => JSON.stringify(o, null, 2);

/* ───────────────────────── loading ───────────────────────── */

async function loadSample() {
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error(`sample feed: HTTP ${res.status}`);
  return res.json();
}

async function loadLive(base, key) {
  const url = `${base.replace(/\/+$/, '')}/api/v1/partner/products?limit=100&page=1`;
  const res = await fetch(url, { headers: { 'X-API-Key': key } });
  const text = await res.text();
  if (!res.ok) {
    // 401 here is nearly always the IP allow-list, not a bad key, so say so.
    const hint = res.status === 401
      ? ' — המפתח שגוי, או שכתובת ה-IP שלך לא ברשימה המורשית של השותף'
      : '';
    throw new Error(`HTTP ${res.status}${hint}\n${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function adopt(payload, source) {
  state.raw = payload;
  state.items = Array.isArray(payload.items) ? payload.items : [];
  state.source = source;

  const badge = $('#sourceBadge');
  badge.textContent = source === 'live' ? 'API חי' : 'נתוני דוגמה';
  badge.className = `badge ${source === 'live' ? 'badge-live' : 'badge-sample'}`;

  $('#rawMeta').textContent =
    `${state.items.length} שורות · total ${payload.total ?? '—'} · page ${payload.page ?? '—'}`;
  $('#rawJson').textContent = pretty(payload);

  renderGrid();
  fillItemPickers();
  renderWebhook();
}

/* ───────────────────────── catalogue ───────────────────────── */

function imagesFor(item) {
  const useMobile = $('#mobileView').checked;
  const imgs = item.images || {};
  // A deliberate pass-through: `mobile` is empty on most of the catalogue, and
  // showing an empty frame is the honest rendering of that — it is exactly what
  // a partner would face.
  return useMobile ? (imgs.mobile || []) : (imgs.desktop || []);
}

function visibleItems() {
  const q = $('#search').value.trim().toLowerCase();
  const onlyAvail = $('#onlyAvailable').checked;

  return state.items.filter((it) => {
    if (onlyAvail && !it.available) return false;
    if (!q) return true;
    const hay = [
      it.product_name, it.sku, it.product_sku, it.variation_sku,
      it.category_name, it.supplier_name, it.item_id,
      ...(it.attributes || []).map((a) => `${a.name} ${a.value}`),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderGrid() {
  const list = visibleItems();
  const grid = $('#grid');

  $('#count').textContent = `${list.length} מתוך ${state.items.length} שורות`;
  $('#emptyState').hidden = list.length > 0;

  grid.innerHTML = list.map((it, i) => {
    const pics = imagesFor(it);
    const thumb = pics.length
      ? `<img src="${esc(pics[0])}" alt="" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'התמונה לא נטענה'}))">`
      : `<span class="noimg">אין תמונה${$('#mobileView').checked ? ' למובייל' : ''}</span>`;

    const attrs = (it.attributes || [])
      .map((a) => `<span class="attr">${esc(a.name)}: ${esc(a.value)}</span>`).join('');

    return `
      <article class="card ${it.available ? '' : 'is-out'}" data-idx="${state.items.indexOf(it)}">
        <div class="thumb">
          ${thumb}
          <span class="pill ${it.available ? 'pill-ok' : 'pill-out'}">${it.available ? 'זמין' : 'לא זמין'}</span>
        </div>
        <div class="card-body">
          <span class="cat">${esc(it.category_name || '—')}</span>
          <h3 class="name">${esc(it.product_name)}</h3>
          ${attrs ? `<div class="attrs">${attrs}</div>` : ''}
          <div class="card-foot">
            <span class="price">${money(it.sale_price)}</span>
            <span class="sku">${esc(it.item_id)}</span>
          </div>
        </div>
      </article>`;
  }).join('');
}

/* ───────────────────────── item detail ───────────────────────── */

function gallery(label, urls) {
  if (!urls || !urls.length) {
    return `<div class="gal"><span class="gal-label">${label}: ריק</span></div>`;
  }
  return `<div class="gal"><span class="gal-label">${label} (${urls.length})</span>${
    urls.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')
  }</div>`;
}

function showItem(idx) {
  const it = state.items[idx];
  if (!it) return;

  const rows = [
    ['item_id', it.item_id],
    ['מוצר', `${esc(it.product_name)} <span class="sku">(#${it.product_id})</span>`],
    ['מק״ט מוצר', it.product_sku || '—'],
    ['וריאציה', it.variation_id ? `#${it.variation_id} ${esc(it.variation_name || '(ללא שם)')}` : '— מוצר פשוט —'],
    ['מק״ט וריאציה', it.variation_sku || '—'],
    ['מק״ט בשימוש', it.sku || '—'],
    ['מאפיינים', (it.attributes || []).length
      ? it.attributes.map((a) => `<span class="attr">${esc(a.name)}: ${esc(a.value)}</span>`).join(' ')
      : '—'],
    ['קטגוריה', `${esc(it.category_name || '—')} <span class="sku">(#${it.category_id ?? '—'})</span>`],
    ['ספק', esc(it.supplier_name || '—')],
    ['מחיר', `<b>${money(it.sale_price)}</b>`],
    ['זמין למכירה', it.available ? '✅ כן' : '⛔ לא'],
    ['עודכן', it.modified_date || '—'],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  const delivery = (it.delivery_options || []).length
    ? `<table class="kv"><tbody>${it.delivery_options.map((d) => `
        <tr><th>${esc(d.code)}</th><td>
          <b>${esc(d.description)}</b> · ${money(d.cost)}
          ${d.is_individual ? ' · <b>לכל יחידה</b>' : ''}
          ${d.timeframe ? `<br><span class="sku">${esc(d.timeframe)}</span>` : ''}
          ${d.requires_address ? '<br>דורש כתובת' : '<br>לא דורש כתובת'}
          ${d.limit_per_shipment > 0 ? `<br>מגבלה למשלוח: ${d.limit_per_shipment}` : ''}
        </td></tr>`).join('')}</tbody></table>`
    : `<p class="warn">אין לפריט הזה אף אופציית משלוח — הוא מופיע בקטלוג אבל <b>אי אפשר להזמין אותו</b>.</p>`;

  const hero = (it.images?.desktop || [])[0];

  $('#itemBody').innerHTML = `
    <div class="detail-head">
      ${hero ? `<img src="${esc(hero)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
      <div class="detail-meta">
        <h2>${esc(it.product_name)}</h2>
        <span class="cat">${esc(it.category_name || '')}</span>
        <div class="card-foot"><span class="price">${money(it.sale_price)}</span></div>
      </div>
    </div>

    ${gallery('תמונות דסקטופ', it.images?.desktop)}
    ${gallery('תמונות מובייל', it.images?.mobile)}

    <table class="kv"><tbody>${rows}</tbody></table>

    <h3>אופציות משלוח</h3>
    ${delivery}

    ${it.description_html ? `<h3>תיאור</h3><div class="panel">${it.description_html}</div>` : ''}

    <h3>ה-JSON של השורה הזאת</h3>
    <pre class="code code-sm">${esc(pretty(it))}</pre>`;

  $('#itemDlg').showModal();
}

/* ───────────────────────── order ───────────────────────── */

function fillItemPickers() {
  const opts = state.items.map((it, i) =>
    `<option value="${i}">${esc(it.item_id)} · ${esc(it.product_name).slice(0, 44)}${
      (it.attributes || []).length ? ` · ${esc(it.attributes.map((a) => a.value).join('/'))}` : ''
    }${it.available ? '' : ' (לא זמין)'}</option>`).join('');

  $('#orderItem').innerHTML = opts;
  $('#hookItem').innerHTML = opts;

  if (!$('#orderExt').value) {
    $('#orderExt').value = `DEMO-${Date.now()}`;
  }
  syncOrder();
}

function currentOrderItem() {
  return state.items[Number($('#orderItem').value)] || null;
}

function syncOrder() {
  const it = currentOrderItem();
  if (!it) return;

  const opts = it.delivery_options || [];
  $('#orderDelivery').innerHTML = opts.length
    ? opts.map((d) => `<option value="${esc(d.code)}">${esc(d.code)} · ${esc(d.description)} · ${money(d.cost)}</option>`).join('')
    : '<option value="">— אין אופציית משלוח —</option>';

  const warn = [];
  if (!it.available) warn.push('הפריט מסומן לא זמין — ההזמנה תיענה ב-409.');
  if (!opts.length) warn.push('אין אופציית משלוח — ההזמנה תיענה ב-400.');
  $('#orderWarn').textContent = warn.join(' ');

  $('#orderBody').textContent = pretty(orderBody());
  renderMath();
}

function orderBody() {
  const it = currentOrderItem();
  if (!it) return {};
  return {
    external_order_id: $('#orderExt').value,
    item_id: it.item_id,
    quantity: Number($('#orderQty').value || 1),
    delivery_code: $('#orderDelivery').value,
    customer_full_name: $('#orderName').value,
    customer_phone: $('#orderPhone').value,
    customer_email: $('#orderEmail').value,
    delivery_street: $('#orderStreet').value,
    delivery_house_num: $('#orderHouse').value,
    delivery_city: $('#orderCity').value,
  };
}

function renderMath() {
  const it = currentOrderItem();
  if (!it) return;

  const qty = Number($('#orderQty').value || 1);
  const opt = (it.delivery_options || []).find((d) => d.code === $('#orderDelivery').value);
  const ship = opt ? (opt.is_individual ? opt.cost * qty : opt.cost) : 0;
  const due = it.sale_price * qty + ship;

  $('#orderMath').innerHTML = `
    ${money(it.sale_price)} × ${qty}
    ${opt ? ` + משלוח ${money(opt.cost)}${opt.is_individual ? ` × ${qty}` : ''}` : ''}
    = <b>${money(due)}</b>
    <br><span class="sku">זה הסכום שהשותף חייב ל-BoomBuy על ההזמנה הזאת (amount_due).</span>`;
}

async function sendOrder() {
  const out = $('#orderResp');

  if (state.source !== 'live') {
    // Nothing is posted in sample mode — a demo must never place a real order
    // that reaches a real supplier by accident.
    out.textContent = pretty({
      _note: 'מצב דוגמה — לא נשלחה בקשה אמיתית. זו התשובה שהיתה חוזרת.',
      boombuy_order_id: 123456,
      external_order_id: $('#orderExt').value,
      sale_price: currentOrderItem()?.sale_price,
      quantity: Number($('#orderQty').value || 1),
      shipping_cost: (currentOrderItem()?.delivery_options || [])
        .find((d) => d.code === $('#orderDelivery').value)?.cost ?? 0,
      amount_due: '…',
      delivery_timeframe: (currentOrderItem()?.delivery_options || [])
        .find((d) => d.code === $('#orderDelivery').value)?.timeframe ?? null,
    });
    return;
  }

  if (!confirm('מצב API חי — זו הזמנה אמיתית שתגיע לספק. להמשיך?')) return;

  out.textContent = '…שולח…';
  try {
    const res = await fetch(`${state.base.replace(/\/+$/, '')}/api/v1/partner/orders`, {
      method: 'POST',
      headers: { 'X-API-Key': state.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody()),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    out.textContent = `HTTP ${res.status}\n\n${typeof body === 'string' ? body : pretty(body)}`;
  } catch (err) {
    out.textContent = `שגיאת רשת: ${err.message}`;
  }
}

/* ───────────────────────── webhook ───────────────────────── */

function renderWebhook() {
  const it = state.items[Number($('#hookItem').value)] || state.items[0];
  if (!it) return;

  const ts = Math.floor(Date.now() / 1000);

  $('#hookHeaders').textContent =
    `Content-Type: application/json
X-BoomBuy-Event: product.unavailable
X-BoomBuy-Event-Id: ${crypto.randomUUID()}
X-BoomBuy-Timestamp: ${ts}
X-BoomBuy-Signature: sha256=<hmac של "${ts}." + גוף ההודעה, עם מפתח ה-API>`;

  $('#hookBody').textContent = pretty({
    event_id: crypto.randomUUID(),
    event: 'product.unavailable',
    occurred_at: new Date().toISOString(),
    data: {
      item_id: it.item_id,
      product_id: it.product_id,
      product_sku: it.product_sku,
      variation_id: it.variation_id,
      variation_sku: it.variation_sku,
      sku: it.sku,
      available: false,
    },
  });
}

/* ───────────────────────── field dictionary ───────────────────────── */

const FIELDS = [
  ['item_id', 'המזהה שהשותף מחזיר בהזמנה. למוצר עם וריאציות: "מוצר:וריאציה".'],
  ['product_id', 'מזהה המוצר האב. זהה לכל הוריאציות שלו, ומשמש לקיבוץ.'],
  ['product_name', 'שם המוצר. מגיע גם בשורת וריאציה.'],
  ['product_sku', 'מק״ט המוצר האב.'],
  ['variation_id', 'מזהה הוריאציה, או null במוצר פשוט.'],
  ['variation_name', 'שם הוריאציה. ריק ברוב הקטלוג — אל תסתמך עליו.'],
  ['variation_sku', 'מק״ט הוריאציה. גם הוא ריק ברוב הקטלוג.'],
  ['sku', 'מק״ט הוריאציה אם יש, אחרת של המוצר.'],
  ['attributes', 'מה שמבדיל בין הוריאציות: [{name:"מידה", value:"L"}]. ריק במוצר פשוט.'],
  ['category_id', 'מזהה קטגוריה. יציב — קבץ לפיו ולא לפי השם.'],
  ['category_name', 'שם הקטגוריה לתצוגה. ניתן לעריכה ואינו ייחודי.'],
  ['description', 'תיאור קצר, טקסט רגיל. ריק ברוב המוצרים.'],
  ['description_html', 'התיאור השיווקי, HTML.'],
  ['supplier_name', 'מי מספק בפועל.'],
  ['images', 'אובייקט: {desktop: [...], mobile: [...]}. mobile ריק ברוב המוצרים — יש ליפול חזרה לדסקטופ.'],
  ['sale_price', 'המחיר הסופי לפריט, כולל תוספת וריאציה ובונוס תמחור. זה מה שהשותף חייב.'],
  ['available', 'האם מותר למכור. בוליאני בלבד — כמויות מלאי לא נחשפות לעולם.'],
  ['modified_date', 'מתי המוצר עודכן אצלנו לאחרונה. זה לא תאריך תפוגה.'],
  ['delivery_options', 'אופציות המשלוח. פריט בלי אף אופציה לא ניתן להזמנה.'],
];

/* ───────────────────────── wiring ───────────────────────── */

function switchView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
}

function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#search').addEventListener('input', renderGrid);
  $('#onlyAvailable').addEventListener('change', renderGrid);
  $('#mobileView').addEventListener('change', renderGrid);

  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) showItem(Number(card.dataset.idx));
  });
  $('#itemClose').addEventListener('click', () => $('#itemDlg').close());

  ['#orderItem', '#orderQty', '#orderDelivery', '#orderExt', '#orderName',
   '#orderPhone', '#orderEmail', '#orderStreet', '#orderHouse', '#orderCity']
    .forEach((sel) => $(sel).addEventListener('input', syncOrder));
  $('#orderItem').addEventListener('change', syncOrder);
  $('#btnSendOrder').addEventListener('click', sendOrder);

  $('#hookItem').addEventListener('change', renderWebhook);

  $('#copyRaw').addEventListener('click', async () => {
    await navigator.clipboard.writeText(pretty(state.raw));
    $('#copyRaw').textContent = 'הועתק ✓';
    setTimeout(() => ($('#copyRaw').textContent = 'העתק הכל'), 1500);
  });

  $('#fieldsBody').innerHTML = FIELDS
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');

  const dlg = $('#liveDlg');
  $('#btnLive').addEventListener('click', () => {
    $('#liveBase').value = state.base || 'https://boomclub.org.il';
    $('#liveKey').value = state.key || '';
    dlg.showModal();
  });

  dlg.addEventListener('close', async () => {
    if (dlg.returnValue === 'sample') {
      localStorage.removeItem(LS_KEY);
      state.base = state.key = '';
      adopt(await loadSample(), 'sample');
      return;
    }
    if (dlg.returnValue !== 'connect') return;

    const base = $('#liveBase').value.trim();
    const key = $('#liveKey').value.trim();
    if (!base || !key) return;

    try {
      const payload = await loadLive(base, key);
      state.base = base;
      state.key = key;
      localStorage.setItem(LS_KEY, JSON.stringify({ base, key }));
      adopt(payload, 'live');
    } catch (err) {
      alert(`החיבור נכשל.\n\n${err.message}`);
    }
  });
}

async function boot() {
  wire();

  // A key saved earlier is reused, but a failure falls back to the sample
  // rather than leaving the page blank.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }

  if (saved?.base && saved?.key) {
    try {
      const payload = await loadLive(saved.base, saved.key);
      state.base = saved.base;
      state.key = saved.key;
      adopt(payload, 'live');
      return;
    } catch { /* fall through to the sample */ }
  }

  try {
    adopt(await loadSample(), 'sample');
  } catch (err) {
    $('#grid').innerHTML = `<p class="empty">טעינת נתוני הדוגמה נכשלה: ${esc(err.message)}</p>`;
  }
}

boot();
