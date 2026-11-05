/**
 * 술곳간 · Sool Gotgan — Google Sheets backend (Apps Script)
 *
 * 이 스크립트는 구글시트에 붙어서(확장 프로그램 > Apps Script) 앱의 저장소 역할을 합니다.
 * This script lives inside your Google Sheet and stores the app's data there.
 *
 * 설치 / Setup: see SETUP.md (한국어) in the repository.
 *   1) 이 파일 내용을 Apps Script 편집기에 붙여넣고 저장
 *   2) 함수 목록에서 setup 실행 → 권한 허용
 *   3) 배포 > 새 배포 > 웹 앱 (실행: 나, 액세스: 모든 사용자)
 *   4) 함수 목록에서 connectLink 실행 → 실행 로그의 링크를 폰에서 열기
 */

const APP_URL = 'https://moonjuhyuk.github.io/sool-gotgan/'; // GitHub Pages 주소 (바뀌면 수정)
// 배포 후 [배포 > 배포 관리]의 웹 앱 URL(…/exec)을 여기에 붙여넣으세요. (편집기에서 실행하면 테스트용 /dev 주소가 나오기 때문)
const WEB_APP_URL = '';
const SHEET_NAME = 'Bottles';
const SUMMARY_NAME = '요약';
const PHOTO_FOLDER = '술곳간 사진';

// 열 순서 = 앱이 읽고 쓰는 순서. 바꾸지 마세요. (Column order the app relies on.)
const FIELDS = [
  ['id', 'ID'],
  ['kind', '종류 Kind'],
  ['pron', '읽는 법 Pronunciation'],
  ['name', '이름 Name'],
  ['type', '세부종류 Type'],
  ['vintage', '빈티지 Vintage'],
  ['age', '숙성(년) Age'],
  ['country', '국가 Country'],
  ['region', '지역 Region'],
  ['producer', '생산자·증류소 Producer'],
  ['grapes', '품종 Grapes'],
  ['cask', '캐스크 Cask'],
  ['abv', '알코올% ABV'],
  ['volume', '용량ml Volume'],
  ['sweetness', '당도 Sweetness'],
  ['acidity', '산미 Acidity'],
  ['tannin', '탄닌 Tannin'],
  ['body', '바디 Body'],
  ['finish', '여운 Finish'],
  ['smoky', '스모키 Smoky'],
  ['fruity', '과일향 Fruity'],
  ['spicy', '스파이시 Spicy'],
  ['aroma', '향 Aroma'],
  ['opened', '개봉 Opened'],
  ['remaining', '남은양% Left'],
  ['price', '구매가 Price'],
  ['qty', '수량 Qty'],
  ['purchased', '구매일 Purchased'],
  ['shop', '구매처 Shop'],
  ['location', '보관위치 Location'],
  ['desc', '설명 Description'],
  ['story', '양조장·가문 이야기 House story'],
  ['pairing', '페어링 Pairing'],
  ['note', '나의 메모 My note'],
  ['photo', '사진 Photo'],
  ['sources', '출처 Sources'],
  ['created', '등록일 Created'],
  ['updated', '수정일 Updated'],
];
const KEYS = FIELDS.map(f => f[0]);
const NUMERIC = ['vintage','age','abv','volume','sweetness','acidity','tannin','body','finish','smoky','fruity','spicy','aroma','remaining','price','qty'];

/* ---------------- one-time setup ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME, 0);
  sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS.map(f => f[1])])
    .setFontWeight('bold').setBackground('#5E1A2C').setFontColor('#FFFFFF').setWrap(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  sh.hideColumns(1); // id
  sh.setColumnWidth(3, 220);
  // 날짜·ID는 글자로 보관 (Sheets가 멋대로 날짜로 바꾸지 않게)
  ['id', 'purchased', 'created', 'updated'].forEach(k => {
    const c = columnLetter_(KEYS.indexOf(k) + 1);
    sh.getRange(c + ':' + c).setNumberFormat('@');
  });
  sh.getRange(2, KEYS.indexOf('price') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0');

  let sm = ss.getSheetByName(SUMMARY_NAME);
  if (!sm) sm = ss.insertSheet(SUMMARY_NAME, 1);
  const col = k => columnLetter_(KEYS.indexOf(k) + 1);
  const K = col('kind'), Q = col('qty'), P = col('price');
  const kinds = [['wine', '와인 wine'], ['whisky', '위스키 whisky'], ['other', '기타 other']];
  const R = (k, f) => f.replace(/KIND/g, k);
  sm.getRange(1, 1, 4, 4).setValues([
    ['항목'].concat(kinds.map(k => k[1])),
    ['보유 병 수'].concat(kinds.map(k => R(k[0], `=SUMIF(${SHEET_NAME}!${K}2:${K},"KIND",${SHEET_NAME}!${Q}2:${Q})`))),
    ['종류 수'].concat(kinds.map(k => R(k[0], `=COUNTIF(${SHEET_NAME}!${K}2:${K},"KIND")`))),
    ['총 구매가(원)'].concat(kinds.map(k => R(k[0], `=SUMPRODUCT((${SHEET_NAME}!${K}2:${K}="KIND")*N(+${SHEET_NAME}!${P}2:${P})*N(+${SHEET_NAME}!${Q}2:${Q}))`))),
  ]);
  sm.getRange('A1:D1').setFontWeight('bold').setBackground('#2E3531').setFontColor('#FFFFFF');
  sm.getRange('B2:D4').setNumberFormat('#,##0');
  sm.setColumnWidth(1, 140);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  photoFolder_();
  Logger.log('✅ setup 완료. 이제 [배포 > 새 배포 > 웹 앱]을 하고 connectLink를 실행하세요.');
}

/** 배포 후 실행: 폰·PC에서 열 연결 링크를 로그에 출력합니다. */
function connectLink() {
  const url = WEB_APP_URL || ScriptApp.getService().getUrl();
  if (!url) { Logger.log('❌ 아직 웹 앱으로 배포되지 않았습니다. [배포 > 새 배포]를 먼저 하세요.'); return; }
  if (!/\/exec$/.test(url)) { Logger.log('❌ [배포 > 배포 관리]에서 웹 앱 URL(…/exec)을 복사해 맨 위 WEB_APP_URL에 붙여넣고 저장한 뒤 다시 실행하세요.'); return; }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const token = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, s: secret }));
  Logger.log('📱 이 링크를 폰·PC에서 한 번 열면 연결됩니다 (남에게 공유하지 마세요):\n' + APP_URL + '#connect=' + token);
}

/** 연결 링크가 유출됐을 때 실행: 비밀키를 바꿔 기존 기기 연결을 모두 끊습니다. */
function resetSecret() {
  PropertiesService.getScriptProperties().setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('🔑 비밀키를 바꿨습니다. connectLink를 다시 실행해 새 링크로 연결하세요.');
}

/* ---------------- web app ---------------- */

function doGet() {
  return ContentService.createTextOutput('술곳간 backend is running. 앱에서 연결해 주세요.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const props = PropertiesService.getScriptProperties();
    if (!req.secret || req.secret !== props.getProperty('SECRET')) throw new Error('unauthorized');
    switch (req.action) {
      case 'list':   out = { ok: true, items: listItems_() }; break;
      case 'save':   out = { ok: true, item: saveItem_(req.item || {}, req.photo) }; break;
      case 'delete': out = { ok: true, deleted: deleteItem_(String(req.id || '')) }; break;
      case 'config': out = { ok: true, config: getConfig_() }; break;
      case 'setConfig': setConfig_(req.config || {}); out = { ok: true, config: getConfig_() }; break;
      default: throw new Error('unknown action');
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- data ---------------- */

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('setup 함수를 먼저 실행하세요 (run setup first)');
  return sh;
}

function listItems_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, KEYS.length).getValues();
  return rows.filter(r => r[0]).map(rowToItem_);
}

function rowToItem_(r) {
  const o = {};
  KEYS.forEach((k, i) => {
    let v = r[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (v === '') v = null;
    if (k === 'opened') v = v === true || v === 'TRUE' || v === 'true' || v === 1;
    o[k] = v;
  });
  o.id = String(o.id);
  return o;
}

function itemToRow_(o) {
  return KEYS.map(k => {
    let v = o[k];
    if (v === undefined || v === null) return '';
    if (k === 'opened') return v ? true : false;
    if (NUMERIC.indexOf(k) >= 0) { const n = Number(v); return isNaN(n) ? '' : n; }
    if (k === 'id' || k === 'purchased') return String(v);
    return String(v).slice(0, 49000);
  });
}

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function saveItem_(item, photo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const now = new Date().toISOString();
    const id = item.id ? String(item.id) : Utilities.getUuid();
    const row = findRow_(sh, id);
    const prev = row > 0 ? rowToItem_(sh.getRange(row, 1, 1, KEYS.length).getValues()[0]) : null;
    const o = Object.assign({}, item, { id: id, created: prev ? prev.created : now, updated: now });
    if (prev && !('photo' in item)) o.photo = prev.photo;

    if (photo && photo.data) {
      const blob = Utilities.newBlob(Utilities.base64Decode(photo.data), photo.type || 'image/jpeg', (o.name || 'bottle') + '.jpg');
      const file = photoFolder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      if (prev && prev.photo) trashFile_(prev.photo);
      o.photo = file.getId();
    } else if (prev && prev.photo && !o.photo) {
      trashFile_(prev.photo);
    }

    const values = [itemToRow_(o)];
    if (row > 0) sh.getRange(row, 1, 1, KEYS.length).setValues(values);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, KEYS.length).setValues(values);
    return rowToItem_(values[0]);
  } finally {
    lock.releaseLock();
  }
}

function deleteItem_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const row = findRow_(sh, id);
    if (row < 0) return false;
    const it = rowToItem_(sh.getRange(row, 1, 1, KEYS.length).getValues()[0]);
    if (it.photo) trashFile_(it.photo);
    sh.deleteRow(row);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function trashFile_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const fid = props.getProperty('PHOTO_FOLDER_ID');
  if (fid) { try { return DriveApp.getFolderById(fid); } catch (e) {} }
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const parents = ssFile.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/* ---------------- shared settings (Claude key, model) ---------------- */

function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  return {
    claudeKey: p.getProperty('CLAUDE_KEY') || '',
    model: p.getProperty('CLAUDE_MODEL') || '',
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function setConfig_(c) {
  const p = PropertiesService.getScriptProperties();
  if ('claudeKey' in c) { if (c.claudeKey) p.setProperty('CLAUDE_KEY', String(c.claudeKey).trim()); else p.deleteProperty('CLAUDE_KEY'); }
  if ('model' in c) { if (c.model) p.setProperty('CLAUDE_MODEL', String(c.model)); else p.deleteProperty('CLAUDE_MODEL'); }
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
