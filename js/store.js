// 저장소: 구글시트(Apps Script) 또는 이 기기(IndexedDB)
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
export { LS };

/* ---------- tiny IndexedDB helper ---------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((ok, no) => {
    const r = indexedDB.open('cellar', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('items'); r.result.createObjectStore('photos'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((ok, no) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store)); // an IDBRequest for reads, undefined for writes
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => no(t.error);
  });
}
const idbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
const idbAll = st => tx(st, 'readonly', s => s.getAll());
const idbPut = (st, k, v) => tx(st, 'readwrite', s => { s.put(v, k); });
const idbDel = (st, k) => tx(st, 'readwrite', s => { s.delete(k); });

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- local store (this device only) ---------- */
export const LocalStore = {
  kind: 'local',
  async list() { return (await idbAll('items')) || []; },
  async save(item, photoBlob) {
    const now = new Date().toISOString();
    const prev = item.id ? await idbGet('items', item.id) : null;
    const o = { ...item, id: item.id || uid(), created: prev?.created || now, updated: now };
    if (photoBlob) {
      if (prev?.photo?.startsWith('local:')) await idbDel('photos', prev.photo);
      o.photo = 'local:' + uid();
      // Blob 대신 ArrayBuffer로 저장: 아이폰 Safari는 IndexedDB에 Blob 저장이 실패하는 경우가 있음
      await idbPut('photos', o.photo, { buf: await photoBlob.arrayBuffer(), type: photoBlob.type || 'image/jpeg' });
    }
    await idbPut('items', o.id, o);
    return o;
  },
  async remove(id) {
    const prev = await idbGet('items', id);
    if (prev?.photo?.startsWith('local:')) await idbDel('photos', prev.photo);
    await idbDel('items', id);
    return true;
  },
  async getConfig() { return { claudeKey: LS.get('cellar.key', ''), model: LS.get('cellar.model', '') }; },
  async setConfig(c) {
    if ('claudeKey' in c) LS.set('cellar.key', c.claudeKey || '');
    if ('model' in c) LS.set('cellar.model', c.model || '');
    return this.getConfig();
  },
};

/* ---------- Google Sheet store (Apps Script web app) ---------- */
function blobToBase64(blob) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
}

export function makeSheetStore(conn) {
  async function call(action, payload = {}, timeoutMs = 45000) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      // text/plain: CORS "simple request" (Apps Script cannot answer a preflight)
      const res = await fetch(conn.u, {
        method: 'POST', redirect: 'follow', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: conn.s, action, ...payload }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'server error');
      return j;
    } finally { clearTimeout(tm); }
  }
  return {
    kind: 'sheet',
    async list() { const j = await call('list'); LS.set('cellar.cache', j.items); return j.items; },
    cached() { return LS.get('cellar.cache', null); },
    async save(item, photoBlob) {
      const payload = { item };
      if (photoBlob) payload.photo = { data: await blobToBase64(photoBlob), type: photoBlob.type || 'image/jpeg' };
      return (await call('save', payload, 90000)).item;
    },
    async remove(id) { return (await call('delete', { id })).deleted; },
    async getConfig() { const c = (await call('config')).config; LS.set('cellar.sheetcfg', c); return c; },
    cachedConfig() { return LS.get('cellar.sheetcfg', null); },
    async setConfig(c) { const r = (await call('setConfig', { config: c })).config; LS.set('cellar.sheetcfg', r); return r; },
    ping: () => call('config', {}, 20000),
  };
}

/* ---------- photo URLs ---------- */
const blobUrls = new Map();
export async function photoUrl(photo, size = 1200) {
  if (!photo) return null;
  if (photo.startsWith('local:')) {
    if (blobUrls.has(photo)) return blobUrls.get(photo);
    let b = await idbGet('photos', photo).catch(() => null);
    if (!b) return null;
    if (b.buf) b = new Blob([b.buf], { type: b.type || 'image/jpeg' });
    const u = URL.createObjectURL(b);
    blobUrls.set(photo, u);
    return u;
  }
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo)}&sz=w${size}`;
}
export const photoFallback = photo => photo && !photo.startsWith('local:') ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(photo)}` : null;

/* ---------- connection token from link ---------- */
export function parseConnect(str) {
  try {
    const m = String(str).match(/connect=([A-Za-z0-9_\-=]+)/);
    const tok = m ? m[1] : String(str).trim();
    const json = atob(tok.replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(decodeURIComponent(escape(json)));
    if (!c.u || !c.s || !/^https:\/\/script\.google(usercontent)?\.com\//.test(c.u)) return null;
    return c;
  } catch (e) { return null; }
}
export function connectLinkFor(conn) {
  const tok = btoa(unescape(encodeURIComponent(JSON.stringify({ u: conn.u, s: conn.s })))).replace(/\+/g, '-').replace(/\//g, '_');
  return location.origin + location.pathname + '#connect=' + tok;
}
