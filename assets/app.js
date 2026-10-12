/*
 * The partner's side of the BoomBuy integration, rendered from LIVE API
 * responses. There is no bundled snapshot on purpose: the point of this page
 * is to exercise the real endpoint, and a frozen copy would quietly stop
 * telling the truth the first time the contract changed.
 *
 * Two things to know about calling the API from a browser:
 *   - The request leaves the VIEWER's machine, so the viewer's own IP is what
 *     the partner's allow-list is checked against. From anywhere else: 401.
 *   - The key in config.js is committed deliberately for this demo. See the
 *     note in that file before reusing the pattern anywhere real.
 */
'use strict';

const LS_KEY = 'boombuy.partner.demo';

const state = {
  items: [],      // raw feed rows
  products: [],   // rows grouped by product_id
  raw: null,
  base: '',
  key: '',
  page: 1,
  limit: 100,
  total: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) =>
  (typeof n === 'number' ? n : Number(n || 0)).toLocaleString('he-IL', {
    style: 'currency', currency: 'ILS', maximumFractionDigits: 2,
  });

const pretty = (o) => JSON.stringify(o, null, 2);

/* ───────────────────────── the API ───────────────────────── */

function creds() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
  const demo = window.BOOMBUY_DEMO || {};
  return { base: saved?.base || demo.base || '', key: saved?.key || demo.key || '' };
}

async function apiGet(path) {
  const url = `${state.base.replace(/\/+$/, '')}${path}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'X-API-Key': state.key } });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();

  if (!res.ok) {
    // 401 here is nearly always the IP allow-list rather than a bad key, and
    // saying so saves a long hunt in the wrong place.
    const hint = res.status === 401
      ? 'המפתח שגוי, או — הרבה יותר סביר — כתובת ה-IP שממנה אתה גולש לא נמצאת ברשימה המורשית של השותף. הקריאה יוצאת מהדפדפן שלך, לא משרת.'
      : '';
    const err = new Error(`HTTP ${res.status}`);
    err.detail = `${hint}\n\n${text.slice(0, 400)}`;
    err.status = res.status;
    throw err;
  }

  return { body: JSON.parse(text), ms, url };
}

async function loadFeed() {
  setStatus('…טוען מה-API…', 'busy');
  try {
    const { body, ms, url } = await apiGet(
      `/api/v1/partner/products?limit=${state.limit}&page=${state.page}`);

    state.raw = body;
    state.items = Array.isArray(body.items) ? body.items : [];
    state.total = body.total ?? null;
    state.products = groupByProduct(state.items);

    setStatus(`✅ ${state.items.length} שורות · ${ms} ms`, 'ok');
    $('#rawMeta').textContent =
      `${url}\n${state.items.length} שורות · total ${body.total ?? '—'} · page ${body.page ?? '—'} · ${ms} ms`;
    $('#rawJson').textContent = pretty(body);

    renderGrid();
    renderPager();
    fillPickers();
    renderWebhook();
  } catch (err) {
    setStatus(`⛔ ${err.message}`, 'bad');
    $('#grid').innerHTML = '';
    $('#emptyState').hidden = false;
    $('#emptyState').innerHTML =
      `<strong>${esc(err.message)}</strong><br><br>${esc(err.detail || '').replace(/\n/g, '<br>')}`;
    $('#rawJson').textContent = `${err.message}\n${err.detail || ''}`;
  }
}

function setStatus(text, kind) {
  const el = $('#status');
  el.textContent = text;
  el.className = `badge badge-${kind}`;
}

/* ───────────────────────── grouping ─────────────────────────
 * A partner's storefront shows ONE product with a size picker, not four
 * separate listings. The feed is per item, so the grouping happens here —
 * which is also the shape the API documents: every variation of a product
 * lands on the same page, so product_id is enough to collect them.
 */

function groupByProduct(items) {
  const map = new Map();

  for (const it of items) {
    if (!map.has(it.product_id)) {
      map.set(it.product_id, {
        product_id: it.product_id,
        product_name: it.product_name,
        product_sku: it.product_sku,
        category_id: it.category_id,
        category_name: it.category_name,
        supplier_name: it.supplier_name,
        description_html: it.description_html,
        rows: [],
      });
    }
    map.get(it.product_id).rows.push(it);
  }

  for (const p of map.values()) {
    // Attribute names in first-seen order, each with its distinct values —
    // that is exactly one <select> per attribute.
    const names = [];
    const values = new Map();
    for (const r of p.rows) {
      for (const a of r.attributes || []) {
        if (!values.has(a.name)) { names.push(a.name); values.set(a.name, []); }
        if (!values.get(a.name).includes(a.value)) values.get(a.name).push(a.value);
      }
    }
    p.attrNames = names;
    p.attrValues = values;
    p.hasVariations = p.rows.some((r) => r.variation_id !== null);
    // Open on something sellable when there is one, so the first thing a
    // visitor sees is not an out-of-stock size.
    p.selected = p.rows.find((r) => r.available) || p.rows[0];
  }

  return Array.from(map.values());
}

function rowFor(p, choice) {
  return p.rows.find((r) =>
    p.attrNames.every((n) =>
      (r.attributes || []).find((a) => a.name === n)?.value === choice[n])) || null;
}

/* ───────────────────────── catalogue ───────────────────────── */

function picsOf(row) {
  const mobile = $('#mobileView').checked;
  const imgs = row.images || {};
  // Deliberately NOT falling back: `mobile` is empty on most of the catalogue
  // and showing that honestly is the point of the toggle.
  return mobile ? (imgs.mobile || []) : (imgs.desktop || []);
}

function visibleProducts() {
  const q = $('#search').value.trim().toLowerCase();
  const onlyAvail = $('#onlyAvailable').checked;
  const onlyVars = $('#onlyVariations').checked;

  return state.products.filter((p) => {
    if (onlyAvail && !p.rows.some((r) => r.available)) return false;
    if (onlyVars && !p.hasVariations) return false;
    if (!q) return true;
    const hay = [
      p.product_name, p.product_sku, p.category_name, p.supplier_name,
      ...p.rows.map((r) => `${r.item_id} ${r.sku} ${(r.attributes || []).map((a) => a.value).join(' ')}`),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function cardHtml(p) {
  const row = p.selected;
  const pics = picsOf(row);

  const thumb = pics.length
    ? `<img src="${esc(pics[0])}" alt="" loading="lazy"
           onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'התמונה לא נטענה'}))">`
    : `<span class="noimg">אין תמונה${$('#mobileView').checked ? ' למובייל' : ''}</span>`;

  const selects = p.attrNames.map((name) => {
    const chosen = (row.attributes || []).find((a) => a.name === name)?.value;
    const opts = p.attrValues.get(name).map((v) => {
      // Mark values whose row is unsellable, so the picker tells the truth
      // before the customer clicks.
      const r = p.rows.find((x) => (x.attributes || []).some((a) => a.name === name && a.value === v));
      const out = r && !r.available ? ' (אזל)' : '';
      return `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}${out}</option>`;
    }).join('');
    return `<label class="pick"><span>${esc(name)}</span><select data-attr="${esc(name)}">${opts}</select></label>`;
  }).join('');

  return `
    <article class="card ${row.available ? '' : 'is-out'}" data-pid="${p.product_id}">
      <div class="thumb">
        ${thumb}
        <span class="pill ${row.available ? 'pill-ok' : 'pill-out'}">${row.available ? 'זמין' : 'לא זמין'}</span>
        ${p.hasVariations ? `<span class="pill pill-var">${p.rows.length} וריאציות</span>` : ''}
      </div>
      <div class="card-body">
        <span class="cat">${esc(p.category_name || '—')}</span>
        <h3 class="name">${esc(p.product_name)}</h3>
        ${selects ? `<div class="picks">${selects}</div>` : ''}
        <div class="card-foot">
          <span class="price">${money(row.sale_price)}</span>
          <span class="sku">${esc(row.item_id)}</span>
        </div>
        <button class="btn btn-sm details" data-pid="${p.product_id}">פרטים מלאים</button>
      </div>
    </article>`;
}

function renderGrid() {
  const list = visibleProducts();
  $('#count').textContent =
    `${list.length} מוצרים · ${state.items.length} שורות בפיד`;
  $('#emptyState').hidden = list.length > 0;
  if (list.length) $('#emptyState').innerHTML = 'לא נמצאו מוצרים.';
  $('#grid').innerHTML = list.map(cardHtml).join('');
}

function onPick(e) {
  const sel = e.target.closest('select[data-attr]');
  if (!sel) return;

  const card = sel.closest('.card');
  const p = state.products.find((x) => x.product_id === Number(card.dataset.pid));
  if (!p) return;

  const choice = {};
  card.querySelectorAll('select[data-attr]').forEach((s) => { choice[s.dataset.attr] = s.value; });

  const row = rowFor(p, choice);
  if (!row) {
    // Combinations that do not exist are normal with multiple attributes.
    card.querySelector('.price').textContent = '—';
    card.querySelector('.sku').textContent = 'אין וריאציה כזאת';
    return;
  }

  p.selected = row;
  card.outerHTML = cardHtml(p);
}

/* ───────────────────────── detail ───────────────────────── */

function gallery(label, urls) {
  if (!urls || !urls.length) return `<div class="gal"><span class="gal-label">${label}: ריק</span></div>`;
  return `<div class="gal"><span class="gal-label">${label} (${urls.length})</span>${
    urls.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')
  }</div>`;
}

function showProduct(pid) {
  const p = state.products.find((x) => x.product_id === pid);
  if (!p) return;
  const it = p.selected;

  const variantTable = p.hasVariations ? `
    <h3>כל הוריאציות של המוצר (${p.rows.length})</h3>
    <table class="kv variants"><thead><tr>
      <th>item_id</th>${p.attrNames.map((n) => `<th>${esc(n)}</th>`).join('')}<th>מחיר</th><th>זמין</th>
    </tr></thead><tbody>
      ${p.rows.map((r) => `<tr class="${r.item_id === it.item_id ? 'is-sel' : ''}">
        <td class="sku">${esc(r.item_id)}</td>
        ${p.attrNames.map((n) => `<td>${esc((r.attributes || []).find((a) => a.name === n)?.value ?? '—')}</td>`).join('')}
        <td>${money(r.sale_price)}</td>
        <td>${r.available ? '✅' : '⛔'}</td>
      </tr>`).join('')}
    </tbody></table>` : '';

  const rows = [
    ['item_id', `<span class="sku">${esc(it.item_id)}</span>`],
    ['מוצר', `${esc(p.product_name)} <span class="sku">(#${p.product_id})</span>`],
    ['מק״ט מוצר', p.product_sku || '—'],
    ['וריאציה', it.variation_id ? `#${it.variation_id} ${esc(it.variation_name || '(ללא שם)')}` : '— מוצר פשוט —'],
    ['מק״ט וריאציה', it.variation_sku || '—'],
    ['מק״ט בשימוש', it.sku || '—'],
    ['מאפיינים', (it.attributes || []).length
      ? it.attributes.map((a) => `<span class="attr">${esc(a.name)}: ${esc(a.value)}</span>`).join(' ') : '—'],
    ['קטגוריה', `${esc(p.category_name || '—')} <span class="sku">(#${p.category_id ?? '—'})</span>`],
    ['ספק', esc(p.supplier_name || '—')],
    ['מחיר', `<b>${money(it.sale_price)}</b>`],
    ['זמין למכירה', it.available ? '✅ כן' : '⛔ לא'],
    ['עודכן', it.modified_date || '—'],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  const delivery = (it.delivery_options || []).length
    ? `<table class="kv"><tbody>${it.delivery_options.map((d) => `
        <tr><th>${esc(d.code)}</th><td><b>${esc(d.description)}</b> · ${money(d.cost)}
          ${d.is_individual ? ' · <b>לכל יחידה</b>' : ''}
          ${d.timeframe ? `<br><span class="sku">${esc(d.timeframe)}</span>` : ''}
          <br>${d.requires_address ? 'דורש כתובת' : 'לא דורש כתובת'}
          ${d.limit_per_shipment > 0 ? `<br>מגבלה למשלוח: ${d.limit_per_shipment}` : ''}
        </td></tr>`).join('')}</tbody></table>`
    : `<p class="warn">אין לפריט אף אופציית משלוח — הוא בקטלוג אבל <b>אי אפשר להזמין אותו</b>.</p>`;

  const hero = (it.images?.desktop || [])[0];

  $('#itemBody').innerHTML = `
    <div class="detail-head">
      ${hero ? `<img src="${esc(hero)}" alt="" onerror="this.style.visibility='hidden'">` : ''}
      <div class="detail-meta">
        <h2>${esc(p.product_name)}</h2>
        <span class="cat">${esc(p.category_name || '')}</span>
        <div class="card-foot"><span class="price">${money(it.sale_price)}</span></div>
      </div>
    </div>
    ${variantTable}
    ${gallery('תמונות דסקטופ', it.images?.desktop)}
    ${gallery('תמונות מובייל', it.images?.mobile)}
    <h3>השדות של השורה הנבחרת</h3>
    <table class="kv"><tbody>${rows}</tbody></table>
    <h3>אופציות משלוח</h3>
    ${delivery}
    ${p.description_html ? `<h3>תיאור</h3><div class="panel">${p.description_html}</div>` : ''}
    <h3>ה-JSON של השורה הזאת</h3>
    <pre class="code code-sm">${esc(pretty(it))}</pre>`;

  $('#itemDlg').showModal();
}

/* ───────────────────────── paging ───────────────────────── */

function renderPager() {
  const more = state.items.length > 0;
  $('#pager').innerHTML = `
    <button class="btn btn-sm" id="prevPage" ${state.page <= 1 ? 'disabled' : ''}>הקודם</button>
    <span class="count">עמוד ${state.page}${state.total ? ` · ${state.total} מוצרים בקטלוג` : ''}</span>
    <button class="btn btn-sm" id="nextPage" ${more ? '' : 'disabled'}>הבא</button>`;
  $('#prevPage')?.addEventListener('click', () => { if (state.page > 1) { state.page--; loadFeed(); } });
  $('#nextPage')?.addEventListener('click', () => { state.page++; loadFeed(); });
}

/* ───────────────────────── order ───────────────────────── */

function fillPickers() {
  const opts = state.items.map((it, i) =>
    `<option value="${i}">${esc(it.item_id)} · ${esc(it.product_name).slice(0, 40)}${
      (it.attributes || []).length ? ` · ${esc(it.attributes.map((a) => a.value).join('/'))}` : ''
    }${it.available ? '' : ' (לא זמין)'}</option>`).join('');
  $('#orderItem').innerHTML = opts;
  $('#hookItem').innerHTML = opts;
  if (!$('#orderExt').value) $('#orderExt').value = `DEMO-${Date.now()}`;
  syncOrder();
}

const currentItem = () => state.items[Number($('#orderItem').value)] || null;

function syncOrder() {
  const it = currentItem();
  if (!it) return;

  const opts = it.delivery_options || [];
  $('#orderDelivery').innerHTML = opts.length
    ? opts.map((d) => `<option value="${esc(d.code)}">${esc(d.code)} · ${esc(d.description)} · ${money(d.cost)}</option>`).join('')
    : '<option value="">— אין אופציית משלוח —</option>';

  const w = [];
  if (!it.available) w.push('הפריט לא זמין — צפוי 409.');
  if (!opts.length) w.push('אין אופציית משלוח — צפוי 400.');
  $('#orderWarn').textContent = w.join(' ');

  $('#orderBody').textContent = pretty(orderBody());
  renderMath();
}

function orderBody() {
  const it = currentItem();
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
  const it = currentItem();
  if (!it) return;
  const qty = Number($('#orderQty').value || 1);
  const opt = (it.delivery_options || []).find((d) => d.code === $('#orderDelivery').value);
  const ship = opt ? (opt.is_individual ? opt.cost * qty : opt.cost) : 0;
  $('#orderMath').innerHTML = `
    ${money(it.sale_price)} × ${qty}${opt ? ` + משלוח ${money(opt.cost)}${opt.is_individual ? ` × ${qty}` : ''}` : ''}
    = <b>${money(it.sale_price * qty + ship)}</b>
    <br><span class="sku">זה ה-amount_due שהשותף חייב ל-BoomBuy.</span>`;
}

async function sendOrder() {
  const out = $('#orderResp');
  if (!confirm('זו הזמנה אמיתית מול ה-API. ההזמנה תיווצר ודיווח יישלח לספק. להמשיך?')) return;

  out.textContent = '…שולח…';
  try {
    const t0 = performance.now();
    const res = await fetch(`${state.base.replace(/\/+$/, '')}/api/v1/partner/orders`, {
      method: 'POST',
      headers: { 'X-API-Key': state.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody()),
    });
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    out.textContent = `HTTP ${res.status} · ${ms} ms\n\n${typeof body === 'string' ? body : pretty(body)}`;
    // A new reference, so the next send is not swallowed by idempotency.
    $('#orderExt').value = `DEMO-${Date.now()}`;
    syncOrder();
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
      item_id: it.item_id, product_id: it.product_id, product_sku: it.product_sku,
      variation_id: it.variation_id, variation_sku: it.variation_sku, sku: it.sku,
      available: false,
    },
  });
}

/* ───────────────────────── field dictionary ───────────────────────── */

const FIELDS = [
  ['item_id', 'המזהה שהשותף מחזיר בהזמנה. למוצר עם וריאציות: "מוצר:וריאציה".'],
  ['product_id', 'מזהה המוצר האב. זהה לכל הוריאציות — זה מה שמקבץ אותן לכרטיס אחד.'],
  ['product_name', 'שם המוצר. מגיע גם בשורת וריאציה.'],
  ['product_sku', 'מק״ט המוצר האב.'],
  ['variation_id', 'מזהה הוריאציה, או null במוצר פשוט.'],
  ['variation_name', 'שם הוריאציה. ריק ברוב הקטלוג — אל תסתמך עליו.'],
  ['variation_sku', 'מק״ט הוריאציה. גם הוא ריק ברוב הקטלוג.'],
  ['sku', 'מק״ט הוריאציה אם יש, אחרת של המוצר.'],
  ['attributes', 'מה שמבדיל בין הוריאציות: [{name:"מידה", value:"L"}]. זה מה שמייצר את ה-SELECT.'],
  ['category_id', 'מזהה קטגוריה. יציב — קבץ לפיו ולא לפי השם.'],
  ['category_name', 'שם הקטגוריה לתצוגה. ניתן לעריכה ואינו ייחודי.'],
  ['description', 'תיאור קצר, טקסט רגיל. ריק ברוב המוצרים.'],
  ['description_html', 'התיאור השיווקי, HTML.'],
  ['supplier_name', 'מי מספק בפועל.'],
  ['images', '{desktop: [...], mobile: [...]}. mobile ריק ברוב המוצרים — יש ליפול חזרה לדסקטופ.'],
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
  $('#onlyVariations').addEventListener('change', renderGrid);
  $('#reload').addEventListener('click', loadFeed);
  $('#limit').addEventListener('change', () => { state.limit = Number($('#limit').value); state.page = 1; loadFeed(); });

  $('#grid').addEventListener('change', onPick);
  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.details');
    if (btn) { showProduct(Number(btn.dataset.pid)); return; }
    if (e.target.closest('select')) return;   // picking a size is not "open"
    const card = e.target.closest('.card');
    if (card) showProduct(Number(card.dataset.pid));
  });
  $('#itemClose').addEventListener('click', () => $('#itemDlg').close());

  ['#orderItem', '#orderQty', '#orderDelivery', '#orderExt', '#orderName',
   '#orderPhone', '#orderEmail', '#orderStreet', '#orderHouse', '#orderCity']
    .forEach((s) => $(s).addEventListener('input', syncOrder));
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

  const dlg = $('#connDlg');
  $('#btnConn').addEventListener('click', () => {
    $('#connBase').value = state.base;
    $('#connKey').value = state.key;
    dlg.showModal();
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'reset') {
      localStorage.removeItem(LS_KEY);
      const c = creds(); state.base = c.base; state.key = c.key;
    } else if (dlg.returnValue === 'connect') {
      state.base = $('#connBase').value.trim();
      state.key = $('#connKey').value.trim();
      localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base, key: state.key }));
    } else {
      return;
    }
    $('#host').textContent = state.base;
    state.page = 1;
    loadFeed();
  });
}

function boot() {
  wire();
  const c = creds();
  state.base = c.base;
  state.key = c.key;
  $('#host').textContent = state.base || '— לא מוגדר —';

  if (!state.base || !state.key) {
    setStatus('⛔ אין הגדרות חיבור', 'bad');
    $('#emptyState').hidden = false;
    $('#emptyState').innerHTML = 'לחץ על <b>הגדרות חיבור</b> והזן כתובת בסיס ומפתח API.';
    return;
  }
  loadFeed();
}

boot();
