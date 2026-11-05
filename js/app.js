import { t, getLang, setLang, STR } from './i18n.js';
import { LS, LocalStore, makeSheetStore, photoUrl, photoFallback, parseConnect, connectLinkFor } from './store.js';
import { readLabel, MODELS } from './ai.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = v => v !== undefined && v !== null && v !== '';
const money = n => has(n) ? Number(n).toLocaleString(getLang() === 'ko' ? 'ko-KR' : 'en-US') + (getLang() === 'ko' ? '원' : '') : '';

const WINE_TASTE = ['sweetness', 'acidity', 'tannin', 'body', 'finish'];
const WHISKY_TASTE = ['smoky', 'sweetness', 'fruity', 'spicy', 'body'];
const tasteLabel = (kind, k) => t(kind === 'whisky' && k === 'sweetness' ? 't_sweet' : 't_' + k);
const NUM = ['vintage', 'age', 'abv', 'volume', 'price', 'qty', 'remaining'];

const S = { items: [], filter: 'all', q: '', sort: LS.get('cellar.sort', 'recent'), store: null, conn: null, cfg: {}, loaded: false, offline: false };

/* ---------------- boot ---------------- */
function readConnFromHash() {
  if (!location.hash.includes('connect=')) return;
  const c = parseConnect(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (c) { LS.set('cellar.conn', c); toast(t('connectOk')); }
  else toast(t('connectBad'));
}
function pickStore() {
  S.conn = LS.get('cellar.conn', null);
  S.store = S.conn ? makeSheetStore(S.conn) : LocalStore;
}
async function load() {
  S.offline = false;
  if (S.store.kind === 'sheet') {
    const c = S.store.cached();
    if (c) { S.items = c; S.loaded = true; render(); }
    S.cfg = S.store.cachedConfig() || {};
    try { S.items = await S.store.list(); S.loaded = true; }
    catch (e) { S.offline = true; S.loaded = true; }
    S.store.getConfig().then(c => { S.cfg = c; }).catch(() => {});
  } else {
    S.items = await LocalStore.list();
    S.cfg = await LocalStore.getConfig();
    S.loaded = true;
  }
  render();
}

/* ---------------- static chrome ---------------- */
function chrome() {
  document.title = t('appName');
  $('#title').textContent = t('appName');
  $('#q').placeholder = t('search');
  document.querySelectorAll('[data-f]').forEach(b => b.textContent = t(b.dataset.f));
  const sort = $('#sort');
  sort.innerHTML = [['recent', 'sortRecent'], ['name', 'sortName'], ['price', 'sortPrice'], ['vintage', 'sortVintage']]
    .map(([v, k]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${t(k)}</option>`).join('');
  $('#fab').setAttribute('aria-label', t('add'));
  $('#setBtn').setAttribute('aria-label', t('settings'));
}

/* ---------------- list ---------------- */
function bottleSVG(kind) {
  return kind === 'whisky'
    ? `<svg viewBox="0 0 60 120" aria-hidden="true"><path d="M24 4h12v18l8 10v80a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V32l8-10z" fill="var(--kc)" opacity=".85"/><rect x="20" y="58" width="20" height="26" rx="2" fill="var(--surface)" opacity=".85"/></svg>`
    : `<svg viewBox="0 0 60 120" aria-hidden="true"><path d="M26 4h8v30c0 6 12 12 12 26v52a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V60c0-14 12-20 12-26z" fill="var(--kc)" opacity=".85"/><rect x="18" y="70" width="24" height="22" rx="2" fill="var(--surface)" opacity=".85"/></svg>`;
}
const subline = it => it.kind === 'whisky'
  ? [it.producer, has(it.age) ? it.age + (getLang() === 'ko' ? '년' : ' yr') : '', it.region || it.country].filter(has).join(' · ')
  : [it.vintage, it.producer, it.region || it.country].filter(has).join(' · ');

function visible() {
  const q = S.q.trim().toLowerCase();
  let list = S.items.filter(it => S.filter === 'all' || it.kind === S.filter);
  if (q) list = list.filter(it => [it.name, it.producer, it.grapes, it.region, it.country, it.type, it.note, it.cask, it.location].join(' ').toLowerCase().includes(q));
  const by = {
    recent: (a, b) => String(b.created || '').localeCompare(String(a.created || '')),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), getLang()),
    price: (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0),
    vintage: (a, b) => (Number(a.vintage) || 9999) - (Number(b.vintage) || 9999),
  };
  return list.sort(by[S.sort] || by.recent);
}

function render() {
  const sum = k => S.items.filter(i => i.kind === k).reduce((n, i) => n + (Number(i.qty) || 0), 0);
  const value = S.items.reduce((n, i) => n + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  $('#ledger').innerHTML = S.loaded
    ? `<span>${t('wine')} <b>${sum('wine')}</b>${t('bottles')}</span><span>${t('whisky')} <b>${sum('whisky')}</b>${t('bottles')}</span><span>${t('totalValue')} <b>${money(value) || 0}</b></span>`
    : '&nbsp;';
  const ban = $('#banner');
  if (S.offline) { ban.hidden = false; ban.innerHTML = `<span>${t('offline')}</span>`; }
  else if (S.store.kind === 'local' && !LS.get('cellar.hideLocalBanner', false)) {
    ban.hidden = false;
    ban.innerHTML = `<span>${t('localMode')}</span><button class="btn" id="banSet">${t('settings')}</button>`;
    $('#banSet').onclick = openSettings;
  } else ban.hidden = true;

  const list = visible(), grid = $('#grid'), st = $('#status');
  grid.innerHTML = list.map(it => `<button class="card ${it.kind === 'whisky' ? 'whisky' : 'wine'}" data-id="${esc(it.id)}">
      <div class="thumb" data-photo="${esc(it.photo || '')}"><div class="ph">${bottleSVG(it.kind)}</div>
        ${(Number(it.qty) || 0) > 1 ? `<span class="qty">${Number(it.qty)}${t('bottles')}</span>` : ''}
        ${(Number(it.qty) || 0) === 0 ? `<span class="zero">0${t('bottles')}</span>` : ''}</div>
      <div class="tag"><span class="k">${esc(it.type || t(it.kind === 'whisky' ? 'whisky' : 'wine'))}</span>
        <span class="n">${esc(it.name)}</span><span class="s">${esc(subline(it)) || '&nbsp;'}</span></div></button>`).join('');
  grid.querySelectorAll('.thumb[data-photo]').forEach(async el => {
    const p = el.dataset.photo; if (!p) return;
    const u = await photoUrl(p, 500); if (!u) return;
    const img = new Image(); img.alt = ''; img.decoding = 'async';
    img.onload = () => { const ph = el.querySelector('.ph'); if (ph) ph.replaceWith(img); };
    img.onerror = () => { const f = photoFallback(p); if (f && img.src !== f) img.src = f; };
    img.src = u;
  });
  if (!S.loaded) { st.hidden = false; st.innerHTML = `<strong>${t('loading')}</strong>`; return; }
  if (!S.items.length) { st.hidden = false; st.innerHTML = `<strong>${t('emptyTitle')}</strong><span>${t('emptyBody')}</span>`; }
  else if (!list.length) { st.hidden = false; st.innerHTML = `<strong>${t('noMatch')}</strong>`; }
  else st.hidden = true;
}

/* ---------------- sheets (modal) ---------------- */
let lastFocus = null, onClose = null;
function openSheet(html, cls = '') {
  if (onClose) { const f = onClose; onClose = null; f(); }
  lastFocus = document.activeElement;
  const sh = $('#sheet');
  sh.className = 'sheet ' + cls;
  sh.innerHTML = html;
  $('#overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  sh.scrollTop = 0;
  sh.querySelector('.x')?.focus();
  sh.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
}
function closeSheet() {
  if (onClose) { const f = onClose; onClose = null; f(); }
  $('#overlay').hidden = true; document.body.style.overflow = '';
  lastFocus?.focus?.();
}
$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });
const head = title => `<div class="sheet-head"><strong>${esc(title)}</strong><button class="x" data-close aria-label="${t('close')}">×</button></div>`;

function toast(msg, ms = 3200) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => el.hidden = true, ms);
}

/* ---------------- detail ---------------- */
const pips = v => `<div class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= (Number(v) || 0) ? 'on' : ''}"></i>`).join('')}</div>`;
async function openDetail(id) {
  const it = S.items.find(x => x.id === id); if (!it) return;
  const w = it.kind !== 'whisky';
  const rows = [
    [t('f_country'), it.country], [t('f_region'), it.region], [t(w ? 'f_producer_wine' : 'f_producer_whisky'), it.producer],
    ...(w ? [[t('f_grapes'), it.grapes], [t('f_vintage'), it.vintage]] : [[t('f_age'), has(it.age) ? it.age + (getLang() === 'ko' ? '년' : ' yr') : ''], [t('f_cask'), it.cask]]),
    [t('f_abv'), has(it.abv) ? it.abv + '%' : ''], [t('f_volume'), has(it.volume) ? it.volume + 'ml' : ''],
    ...(w ? [] : [[t('f_opened'), it.opened ? t('opened') + (has(it.remaining) ? ` · ${it.remaining}% ${t('left')}` : '') : t('unopened')]]),
  ];
  const buy = [[t('f_price'), money(it.price)], [t('f_purchased'), it.purchased], [t('f_shop'), it.shop], [t('f_location'), it.location]];
  const dl = r => r.filter(([, v]) => has(v)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const T = (w ? WINE_TASTE : WHISKY_TASTE).filter(k => has(it[k]) && Number(it[k]) > 0);
  const srcs = String(it.sources || '').split(/\s+/).filter(s => /^https?:\/\//.test(s));
  openSheet(`<div class="${w ? 'wine' : 'whisky'}">
    ${head('')}
    <div class="detail">
      <div class="photo" id="dPhoto"><div class="ph">${bottleSVG(it.kind)}</div></div>
      <div class="info">
        <div class="chips"><span class="chip">${esc(it.type || t(w ? 'wine' : 'whisky'))}</span></div>
        <h2>${esc(it.name)}</h2>
        ${dl(rows) ? `<dl>${dl(rows)}</dl>` : ''}
        ${T.length ? `<div><p class="h3">${t('taste')}</p><div class="taste">${T.map(k => `<span>${tasteLabel(it.kind, k)}</span>${pips(it[k])}<span class="v">${it[k]}/5</span>`).join('')}</div></div>` : ''}
        ${has(it.desc) ? `<div><p class="h3">${t('about')}</p><p class="prose">${esc(it.desc)}</p></div>` : ''}
        ${has(it.pairing) ? `<div><p class="h3">${t('pairing')}</p><p class="prose">${esc(it.pairing)}</p></div>` : ''}
        ${has(it.note) ? `<div><p class="h3">${t('tastingNote')}</p><p class="prose mynote">${esc(it.note)}</p></div>` : ''}
        ${dl(buy) ? `<div><p class="h3">${t('purchase')}</p><dl>${dl(buy)}</dl></div>` : ''}
        <div class="actions">
          <span class="stepper"><button id="qMinus" aria-label="-1">−</button><span id="qtyv">${Number(it.qty) || 0}${t('bottles')}</span><button id="qPlus" aria-label="+1">＋</button></span>
          <button class="btn" id="dEdit">${t('edit')}</button><button class="btn danger" id="dDel">${t('del')}</button>
        </div>
        <div id="confirmBox"></div>
        ${srcs.length ? `<div><p class="h3">${t('sources')}</p><div class="srcs">${srcs.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('')}</div></div>` : ''}
      </div>
    </div></div>`);
  $('#qMinus').onclick = () => bump(it.id, -1);
  $('#qPlus').onclick = () => bump(it.id, 1);
  $('#dEdit').onclick = () => openForm(it.id);
  $('#dDel').onclick = () => {
    $('#confirmBox').innerHTML = `<div class="confirm"><span>${t('confirmDel')}</span><button class="btn danger" id="cYes">${t('del')}</button><button class="btn" id="cNo">${t('cancel')}</button></div>`;
    $('#cNo').onclick = () => $('#confirmBox').innerHTML = '';
    $('#cYes').onclick = async () => {
      $('#cYes').disabled = true;
      try { await S.store.remove(it.id); S.items = S.items.filter(x => x.id !== it.id); cacheItems(); closeSheet(); render(); }
      catch (e) { $('#confirmBox').innerHTML = `<p class="err">${t('saveFail')}</p>`; }
    };
  };
  const u = await photoUrl(it.photo, 1400);
  if (u) { const img = new Image(); img.alt = it.name || ''; img.onload = () => { const p = $('#dPhoto'); if (p) { p.innerHTML = ''; p.appendChild(img); } }; img.onerror = () => { const f = photoFallback(it.photo); if (f && img.src !== f) img.src = f; }; img.src = u; }
}
function cacheItems() { if (S.store.kind === 'sheet') LS.set('cellar.cache', S.items); }
let bumpBusy = false;
async function bump(id, d) {
  if (bumpBusy) return;
  const it = S.items.find(x => x.id === id); if (!it) return;
  const q = Math.max(0, (Number(it.qty) || 0) + d);
  bumpBusy = true; $('#qtyv').textContent = q + t('bottles');
  try { const saved = await S.store.save({ ...it, qty: q }); Object.assign(it, saved); cacheItems(); render(); }
  catch (e) { $('#qtyv').textContent = (Number(it.qty) || 0) + t('bottles'); toast(t('saveFail')); }
  bumpBusy = false;
}

/* ---------------- add: pick photo ---------------- */
function openAdd() {
  openSheet(`${head(t('addTitle'))}
    <div class="pickers">
      <label class="btn primary wide" for="camIn">${camIcon()} ${t('takePhoto')}</label>
      <input id="camIn" type="file" accept="image/*" capture="environment" hidden>
      <label class="btn wide" for="libIn">${t('pickPhoto')}</label>
      <input id="libIn" type="file" accept="image/*" hidden>
      <button class="btn wide" id="manual">${t('noPhoto')}</button>
    </div>`);
  const go = e => { const f = e.target.files[0]; if (f) openForm(null, f); };
  $('#camIn').onchange = go; $('#libIn').onchange = go;
  $('#manual').onclick = () => openForm(null);
}

/* image → resized JPEG (≤1568px long edge, Claude's recommended size) */
async function prepImage(file, max = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    return { blob, b64 };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------- form ---------------- */
let F = null; // current form state
function field(name, label, val, o = {}) {
  const type = o.type || 'text';
  return `<div class="f${o.full ? ' full' : ''}" ${o.only ? `data-only="${o.only}"` : ''}><label for="f_${name}">${esc(label)}</label>
    <input id="f_${name}" name="${name}" type="${type}" ${o.step ? `step="${o.step}"` : ''} ${type === 'number' ? 'inputmode="decimal"' : ''} placeholder="${esc(o.ph || '')}" value="${esc(val ?? '')}" autocomplete="off"></div>`;
}
function area(name, label, val, o = {}) {
  return `<div class="f full" ${o.only ? `data-only="${o.only}"` : ''}><label for="f_${name}">${esc(label)}</label><textarea id="f_${name}" name="${name}">${esc(val ?? '')}</textarea></div>`;
}
function typeSel(kind, val) {
  const opts = STR[getLang()][kind === 'whisky' ? 'whiskyTypes' : 'wineTypes'];
  const all = has(val) && !opts.includes(val) ? [val, ...opts] : opts;
  return `<div class="f" data-only="${kind}"><label for="f_type_${kind}">${t(kind === 'whisky' ? 'f_type_whisky' : 'f_type_wine')}</label>
    <select id="f_type_${kind}" name="type_${kind}"><option value=""></option>${all.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
}
function rateRow(kind, key, val) {
  const v = Number(val) || 0, n = kind + '_' + key;
  return `<div class="rate" data-only="${kind}"><span>${tasteLabel(kind, key)}</span><div class="opts">${[0, 1, 2, 3, 4, 5].map(i =>
    `<input type="radio" id="r_${n}_${i}" name="t_${n}" value="${i}" ${i === v ? 'checked' : ''}><label for="r_${n}_${i}">${i || '–'}</label>`).join('')}</div></div>`;
}

function openForm(id, file) {
  const it = id ? S.items.find(x => x.id === id) : null;
  const kind = it ? it.kind : (S.filter === 'whisky' ? 'whisky' : 'wine');
  F = { it, kind, image: null, aiCtl: null, touched: new Set() };
  const v = k => it ? it[k] : '';
  openSheet(`<div class="${kind}" id="formRoot">
    ${head(t(it ? 'editTitle' : 'addTitle'))}
    <form id="bf" novalidate>
      <div class="seg" role="group" style="align-self:flex-start"><button type="button" data-k="wine">${t('wine')}</button><button type="button" data-k="whisky">${t('whisky')}</button></div>
      <div class="photo-row"><div class="pv" id="pv"><div class="ph">${bottleSVG(kind)}</div></div>
        <div class="side"><label class="btn" for="f_photo">${camIcon()} ${t(it?.photo ? 'takePhoto' : 'pickPhoto')}</label><input id="f_photo" type="file" accept="image/*" hidden><span id="aiHint" class="hint"></span></div></div>
      <div id="aiBox"></div>
      <fieldset><legend>${t('sBasic')}</legend>
        ${field('name', t('f_name') + ' *', v('name'), { full: true })}
        ${typeSel('wine', kind === 'wine' ? v('type') : '')}${typeSel('whisky', kind === 'whisky' ? v('type') : '')}
        ${field('vintage', t('f_vintage'), v('vintage'), { type: 'number', ph: '2018', only: 'wine' })}
        ${field('age', t('f_age'), v('age'), { type: 'number', ph: '12', only: 'whisky' })}
        ${field('country', t('f_country'), v('country'))}
        ${field('region', t('f_region'), v('region'))}
        ${field('producer', t('f_producer_wine'), v('producer'))}
        ${field('grapes', t('f_grapes'), v('grapes'), { only: 'wine' })}
        ${field('cask', t('f_cask'), v('cask'), { only: 'whisky' })}
        ${field('abv', t('f_abv'), v('abv'), { type: 'number', step: '0.1' })}
        ${field('volume', t('f_volume'), v('volume'), { type: 'number', ph: '750' })}
      </fieldset>
      <fieldset><legend>${t('sTaste')}</legend>
        ${WINE_TASTE.map(k => rateRow('wine', k, kind === 'wine' ? v(k) : '')).join('')}
        ${WHISKY_TASTE.map(k => rateRow('whisky', k, kind === 'whisky' ? v(k) : '')).join('')}
      </fieldset>
      <fieldset><legend>${t('sAbout')}</legend>
        ${area('desc', t('f_desc'), v('desc'))}
        ${area('pairing', t('f_pairing'), v('pairing'))}
      </fieldset>
      <fieldset><legend>${t('sBuy')}</legend>
        ${field('price', t('f_price'), v('price'), { type: 'number' })}
        ${field('qty', t('f_qty'), it ? v('qty') : 1, { type: 'number' })}
        ${field('purchased', t('f_purchased'), v('purchased'), { type: 'date' })}
        ${field('shop', t('f_shop'), v('shop'))}
        ${field('location', t('f_location'), v('location'), { full: true })}
        <div class="f" data-only="whisky"><label for="f_opened">${t('f_opened')}</label><select id="f_opened" name="opened"><option value="0">${t('unopened')}</option><option value="1" ${v('opened') ? 'selected' : ''}>${t('opened')}</option></select></div>
        ${field('remaining', t('f_remaining'), v('remaining'), { type: 'number', only: 'whisky' })}
      </fieldset>
      <fieldset><legend>${t('sNote')}</legend>${area('note', t('f_note'), v('note'))}</fieldset>
      <input type="hidden" name="sources" value="${esc(v('sources') || '')}">
      <p class="err" id="ferr" hidden></p>
      <div class="form-foot"><button type="button" class="btn" id="fCancel">${t('cancel')}</button><button type="submit" class="btn primary" id="saveBtn">${t(it ? 'saveEdit' : 'save')}</button></div>
    </form></div>`);
  F.producerLabel = document.querySelector('label[for="f_producer"]');
  applyKind();
  document.querySelectorAll('#bf [data-k]').forEach(b => b.onclick = () => { F.kind = b.dataset.k; applyKind(); });
  $('#bf').addEventListener('input', e => { if (e.target.name) { F.touched.add(e.target.name); e.target.classList.remove('ai'); } });
  $('#f_photo').onchange = e => { const f = e.target.files[0]; if (f) setImage(f); };
  $('#fCancel').onclick = () => it ? openDetail(it.id) : closeSheet();
  $('#bf').onsubmit = e => { e.preventDefault(); save(); };
  onClose = () => { F?.aiCtl?.abort(); };
  if (it?.photo) photoUrl(it.photo, 400).then(u => { if (u && $('#pv')) $('#pv').innerHTML = `<img src="${u}" alt="">`; });
  if (file) setImage(file);
  else aiHint();
}
function applyKind() {
  const root = $('#formRoot'); root.className = F.kind;
  document.querySelectorAll('#bf [data-k]').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === F.kind));
  document.querySelectorAll('#bf [data-only]').forEach(el => el.hidden = el.dataset.only !== F.kind);
  F.producerLabel.textContent = t(F.kind === 'whisky' ? 'f_producer_whisky' : 'f_producer_wine');
  const vol = $('#f_volume'); if (vol) vol.placeholder = F.kind === 'whisky' ? '700' : '750';
}
function aiHint() {
  const h = $('#aiHint'); if (!h) return;
  h.textContent = S.cfg.claudeKey ? '' : t('aiNoKey');
}
async function setImage(file) {
  try { F.image = await prepImage(file); }
  catch (e) { toast(t('aiFail')); return; }
  $('#pv').innerHTML = `<img src="${URL.createObjectURL(F.image.blob)}" alt="">`;
  if (S.cfg.claudeKey) runAI(); else aiHint();
}
async function runAI() {
  if (!F?.image) return;
  F.aiCtl?.abort();
  const ctl = F.aiCtl = new AbortController();
  const box = $('#aiBox');
  box.innerHTML = `<div class="aistate"><span class="spin"></span><div><strong>${t('aiReading')}</strong><br><span class="hint">${t('aiReadingSub')}</span></div></div>`;
  try {
    const r = await readLabel({
      key: S.cfg.claudeKey, model: S.cfg.model === 'haiku' ? MODELS.haiku : MODELS.sonnet,
      imageBase64: F.image.b64, lang: getLang(), signal: ctl.signal,
      types: { wine: STR[getLang()].wineTypes, whisky: STR[getLang()].whiskyTypes },
    });
    if (ctl.signal.aborted || !$('#bf')) return;
    fillFromAI(r);
    box.innerHTML = `<div class="aistate ok"><div>${t('aiDone')}${r.confidence === 'low' ? ' ⚠︎' : ''}</div></div>`;
  } catch (e) {
    if (ctl.signal.aborted || e.name === 'AbortError') return;
    box.innerHTML = `<div class="aistate err"><div><strong>${t('aiFail')}</strong><br><span class="hint">${esc(e.message || '')}</span><br><button type="button" class="btn" id="aiAgain" style="margin-top:8px">${t('aiRetry')}</button></div></div>`;
    $('#aiAgain').onclick = runAI;
  }
}
function fillFromAI(r) {
  const fm = $('#bf');
  if (r.kind === 'wine' || r.kind === 'whisky') { if (!F.it && !F.touched.size) { F.kind = r.kind; applyKind(); } }
  const k = F.kind;
  const set = (name, val) => {
    if (!has(val) || F.touched.has(name)) return;
    const el = fm.elements[name];
    if (!el || (has(el.value) && !el.classList.contains('ai'))) return; // never overwrite what the user typed
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(val))) el.add(new Option(val, val), 1);
    el.value = val; el.classList.add('ai');
  };
  ['name', 'country', 'region', 'producer', 'grapes', 'cask', 'abv', 'volume', 'vintage', 'age', 'desc', 'pairing'].forEach(n => set(n, r[n]));
  set('type_' + k, r.type);
  (k === 'wine' ? WINE_TASTE : WHISKY_TASTE).forEach(key => {
    const v = Math.round(Number(r[key])); if (!(v >= 1 && v <= 5)) return;
    const name = `t_${k}_${key}`; if (F.touched.has(name)) return;
    const cur = fm.querySelector(`input[name="${name}"]:checked`); if (cur && cur.value !== '0' && !cur.dataset.ai) return;
    const el = document.getElementById(`r_${k}_${key}_${v}`); if (el) { el.checked = true; el.dataset.ai = '1'; }
  });
  if (Array.isArray(r.sources) && r.sources.length) fm.elements.sources.value = r.sources.join(' ');
}

async function save() {
  const fm = $('#bf'), err = $('#ferr'), btn = $('#saveBtn');
  const fd = new FormData(fm);
  const name = String(fd.get('name') || '').trim();
  if (!name) { err.hidden = false; err.textContent = t('needName'); $('#f_name').focus(); return; }
  const k = F.kind;
  const o = { ...(F.it || {}), kind: k };
  ['name', 'country', 'region', 'producer', 'abv', 'volume', 'price', 'qty', 'purchased', 'shop', 'location', 'desc', 'pairing', 'note', 'sources'].forEach(n => {
    let x = String(fd.get(n) ?? '').trim();
    o[n] = x === '' ? null : NUM.includes(n) ? Number(x) : x;
  });
  o.type = String(fd.get('type_' + k) || '') || null;
  if (k === 'wine') {
    o.vintage = has(fd.get('vintage')) ? Number(fd.get('vintage')) : null;
    o.grapes = String(fd.get('grapes') || '').trim() || null;
    o.age = o.cask = o.remaining = null; o.opened = false;
  } else {
    o.age = has(fd.get('age')) ? Number(fd.get('age')) : null;
    o.cask = String(fd.get('cask') || '').trim() || null;
    o.opened = fd.get('opened') === '1';
    o.remaining = has(fd.get('remaining')) ? Number(fd.get('remaining')) : null;
    o.vintage = o.grapes = null;
  }
  ['sweetness', 'acidity', 'tannin', 'body', 'finish', 'smoky', 'fruity', 'spicy'].forEach(key => o[key] = null);
  (k === 'wine' ? WINE_TASTE : WHISKY_TASTE).forEach(key => { const r = Number(fd.get(`t_${k}_${key}`) || 0); o[key] = r || null; });
  if (o.qty == null) o.qty = 0;
  btn.disabled = true; btn.textContent = t('saving'); err.hidden = true;
  try {
    const saved = await S.store.save(o, F.image?.blob || null);
    const i = S.items.findIndex(x => x.id === saved.id);
    if (i >= 0) S.items[i] = saved; else S.items.unshift(saved);
    cacheItems(); render();
    onClose = null; F = null;
    openDetail(saved.id);
  } catch (e) {
    err.hidden = false; err.textContent = t('saveFail');
    btn.disabled = false; btn.textContent = t(F.it ? 'saveEdit' : 'save');
  }
}

/* ---------------- settings ---------------- */
function openSettings() {
  const sheet = S.store.kind === 'sheet';
  openSheet(`${head(t('settings'))}
  <div class="set">
    <section><p class="h3">${t('language')}</p>
      <div class="seg" style="align-self:flex-start"><button data-l="ko" aria-pressed="${getLang() === 'ko'}">한국어</button><button data-l="en" aria-pressed="${getLang() === 'en'}">English</button></div></section>
    <section><p class="h3">${t('storage')}</p>
      <span class="status ${sheet ? 'on' : ''}"><i></i>${t(sheet ? 'stSheet' : 'stLocal')}</span>
      ${sheet ? `<div class="row">${S.cfg.sheetUrl ? `<a class="btn" href="${esc(S.cfg.sheetUrl)}" target="_blank" rel="noopener">${t('openSheet')}</a>` : ''}<button class="btn" id="shareBtn">${t('shareLink')}</button><button class="btn danger" id="discBtn">${t('disconnect')}</button></div><div id="shareOut"></div>`
      : `<p class="hint">${t('connectHelp')}</p><div class="f"><label for="connIn">${t('connectPaste')}</label><input id="connIn" type="url" placeholder="https://…#connect=…"></div><div class="row"><button class="btn primary" id="connBtn">${t('connect')}</button></div><p class="err" id="connErr" hidden></p>`}
    </section>
    <section><p class="h3">${t('ai')}</p>
      <div class="f"><label for="keyIn">${t('apiKey')}</label><input id="keyIn" type="password" autocomplete="off" placeholder="${t('apiKeyPh')}" value="${esc(S.cfg.claudeKey || '')}"></div>
      <div class="f"><label for="modelIn">${t('model')}</label><select id="modelIn"><option value="sonnet">${t('modelSonnet')}</option><option value="haiku" ${S.cfg.model === 'haiku' ? 'selected' : ''}>${t('modelHaiku')}</option></select></div>
      <p class="hint">${t(sheet ? 'keySavedSheet' : 'keySavedLocal')}</p>
      <div class="row"><button class="btn primary" id="keySave">${t('saveSettings')}</button></div></section>
    <section><p class="h3">${t('backup')}</p>
      <div class="row"><button class="btn" id="csvBtn">${t('exportCsv')}</button><button class="btn" id="jsonBtn">${t('exportJson')}</button>
      <label class="btn" for="impIn">${t('importJson')}</label><input id="impIn" type="file" accept="application/json,.json" hidden></div></section>
    <p class="hint">술곳간 · Sool Gotgan · v${VERSION}</p>
  </div>`);
  document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { setLang(b.dataset.l); chrome(); render(); openSettings(); });
  if (sheet) {
    $('#shareBtn').onclick = async () => {
      const link = connectLinkFor(S.conn);
      try { await navigator.clipboard.writeText(link); toast(t('copied')); }
      catch (e) { $('#shareOut').innerHTML = `<p class="hint">${t('copyFail')}</p><div class="linkbox">${esc(link)}</div>`; }
    };
    $('#discBtn').onclick = () => { LS.del('cellar.conn'); LS.del('cellar.cache'); LS.del('cellar.sheetcfg'); pickStore(); closeSheet(); load(); };
  } else {
    $('#connBtn').onclick = async () => {
      const c = parseConnect($('#connIn').value);
      const e = $('#connErr');
      if (!c) { e.hidden = false; e.textContent = t('connectBad'); return; }
      $('#connBtn').disabled = true;
      try { await makeSheetStore(c).ping(); LS.set('cellar.conn', c); pickStore(); closeSheet(); toast(t('connectOk')); load(); }
      catch (x) { e.hidden = false; e.textContent = t('connectBad'); $('#connBtn').disabled = false; }
    };
  }
  $('#keySave').onclick = async () => {
    const c = { claudeKey: $('#keyIn').value.trim(), model: $('#modelIn').value === 'haiku' ? 'haiku' : '' };
    $('#keySave').disabled = true;
    try { S.cfg = { ...S.cfg, ...(await S.store.setConfig(c)) }; toast(t('saved')); }
    catch (e) { toast(t('saveFail')); }
    $('#keySave').disabled = false;
  };
  $('#csvBtn').onclick = exportCsv;
  $('#jsonBtn').onclick = () => download(`sool-gotgan-backup-${today()}.json`, JSON.stringify({ app: 'cellar', version: 1, exported: new Date().toISOString(), items: S.items }, null, 2), 'application/json');
  $('#impIn').onchange = importJson;
}
const today = () => new Date().toISOString().slice(0, 10);
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportCsv() {
  const cols = ['kind', 'name', 'type', 'vintage', 'age', 'country', 'region', 'producer', 'grapes', 'cask', 'abv', 'volume', 'sweetness', 'acidity', 'tannin', 'body', 'finish', 'smoky', 'fruity', 'spicy', 'opened', 'remaining', 'price', 'qty', 'purchased', 'shop', 'location', 'desc', 'pairing', 'note', 'created'];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '﻿' + [cols.join(','), ...S.items.map(it => cols.map(c => q(it[c])).join(','))].join('\n');
  download(`sool-gotgan-${today()}.csv`, csv, 'text/csv');
}
async function importJson(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw 0;
    let n = 0;
    for (const raw of items) {
      if (!raw || !raw.name) continue;
      const it = { ...raw };
      if (S.items.some(x => x.id === it.id)) delete it.id;
      if (it.photo?.startsWith('local:') && S.store.kind === 'sheet') it.photo = null;
      const saved = await S.store.save(it, null);
      S.items.unshift(saved); n++;
    }
    cacheItems(); render(); toast(t('importDone', n));
  } catch (x) { toast(t('importFail')); }
}

/* ---------------- icons ---------------- */
function camIcon() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`; }

/* ---------------- events & start ---------------- */
const VERSION = '0.1.0';
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
  S.filter = b.dataset.f; document.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); render();
});
$('#q').oninput = e => { S.q = e.target.value; render(); };
$('#sort').onchange = e => { S.sort = e.target.value; LS.set('cellar.sort', S.sort); render(); };
$('#grid').onclick = e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); };
$('#fab').onclick = openAdd;
$('#setBtn').onclick = openSettings;
window.addEventListener('hashchange', () => { if (location.hash.includes('connect=')) { readConnFromHash(); pickStore(); load(); } });
window.addEventListener('online', () => { if (S.offline) load(); });

readConnFromHash();
pickStore();
chrome();
render();
load();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
