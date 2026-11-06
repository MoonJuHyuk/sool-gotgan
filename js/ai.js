// 라벨 사진 → Claude (이미지 인식 + 웹 검색) → 정해진 형식의 JSON
export const MODELS = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const SCHEMA_HINT = `{
  "kind": "wine" | "whisky" | "other",   // other = sake, makgeolli, soju, brandy, gin, rum, liqueur, beer…
  "name": "label name as printed, in the original language, e.g. 'Château Talbot 2018' or 'Lagavulin 16'",
  "pron": "how to say the name — see PRONUNCIATION below",
  "type": one of the allowed types for that kind,
  "vintage": number or null,         // wine only
  "age": number or null,             // age statement in years (whisky, brandy…)
  "country": string, "region": string,
  "producer": string,                // winery / château / brewery / distillery
  "grapes": string or null,          // wine: grape varieties, comma separated
  "cask": string or null,            // whisky: cask types
  "abv": number or null, "volume": number or null,   // ml
  "sweetness": 1-5 or null, "acidity": 1-5 or null, "tannin": 1-5 or null, "body": 1-5 or null, "finish": 1-5 or null,
  "smoky": 1-5 or null, "fruity": 1-5 or null, "spicy": 1-5 or null, "aroma": 1-5 or null,
  "desc": "3-5 sentence introduction of THIS bottle: style, typical aromas and flavours, drinking window if wine",
  "story": "2-4 sentences on the producer / distillery / house: founding, history, the family behind it, what it is known for. null if you found nothing reliable",
  "pairing": "2-4 concrete dishes that suit it",
  "confidence": "high" | "medium" | "low",
  "sources": ["url", "..."]
}`;

function prompt(lang, types) {
  const PRON = lang === 'ko'
    ? 'Write the full "name" as a Korean speaker would say it aloud, in Hangul only, following the original-language pronunciation (French/Italian/Spanish/German as natives say it, the way Korean wine shops usually transliterate it). Keep vintage/age numbers as digits. e.g. "Château Talbot 2018" → "샤토 탈보 2018", "Albert Bichot Chablis Domaine Long-Depaquit 2022" → "알베르 비쇼 샤블리 도멘 롱 드파키 2022", "Lagavulin 16" → "라가불린 16".'
    : 'An easy English phonetic respelling of the name for someone who does not speak the label language, e.g. "Château Talbot" → "shah-TOH tal-BOH". Use null if the name is already plain English.';
  const L = lang === 'ko' ? 'Korean (한국어). Keep proper nouns (producer, region, grape) in their usual Korean spelling followed by the original in parentheses the first time, e.g. "생쥘리앙(Saint-Julien)".' : 'English.';
  return `You are a sommelier and whisky specialist cataloguing a private home cellar.
Look at the bottle/label photo. Identify the exact product (producer, cuvée/expression, vintage or age).
Then use web search to confirm the facts and gather the producer's or a reputable retailer's description and tasting notes.

Taste scales (1 = very light/low, 5 = very strong/high).
- wine: sweetness, acidity, tannin, body, finish (others null)
- whisky: smoky, sweetness, fruity, spicy, body (others null)
- other: sweetness, acidity, body, aroma (intensity of aroma), finish (others null)

ACCURACY RULE — the owner will fill gaps by hand, so a blank is better than a guess:
- Only fill a field when the label shows it or a source you found states it (or, for taste scales, when sources describe that trait).
- If web search does not give you a reliable answer for a field, set it to null. Do NOT estimate, infer from similar products, or use typical values.
- Never invent a vintage, age, ABV, region or grape that is not on the label or in a source.

PRONUNCIATION ("pron"): ${PRON}

Allowed "type" values — wine: ${JSON.stringify(types.wine)}; whisky: ${JSON.stringify(types.whisky)}; other: ${JSON.stringify(types.other || [])}.
Write "desc", "story" and "pairing" (and "region"/"country" names) in ${L}

Reply with ONLY one JSON object in a \`\`\`json code block, matching:
${SCHEMA_HINT}`;
}

function extractJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[1]);
}

export async function readLabel({ key, model, imageBase64, mediaType = 'image/jpeg', lang = 'ko', types, signal }) {
  if (!key) throw new Error('NO_KEY');
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: prompt(lang, types) },
    ],
  }];
  const body = {
    model: model || MODELS.sonnet,
    max_tokens: 2500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages,
  };
  let data;
  for (let turn = 0; turn < 3; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (data.stop_reason !== 'pause_turn') break;
    // 검색이 길어져 잠시 멈춘 경우: 받은 내용을 그대로 돌려보내 이어서 진행
    body.messages = [...messages, { role: 'assistant', content: data.content }];
  }
  const blocks = data.content || [];
  let lastResult = -1;
  blocks.forEach((b, i) => { if (b.type === 'web_search_tool_result') lastResult = i; });
  const text = blocks.slice(lastResult + 1).filter(b => b.type === 'text').map(b => b.text).join('\n')
    || blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const out = extractJson(text);
  // 검색 결과에서 출처 URL 보충
  const cited = new Set(Array.isArray(out.sources) ? out.sources : []);
  blocks.forEach(b => (b.citations || []).forEach(c => c.url && cited.add(c.url)));
  out.sources = [...cited].slice(0, 5);
  return out;
}

// Vivino 평점 찾기 — vivino.com 안에서만 검색하고, 검색 결과에 실제로 나온 Vivino 페이지가 아니면 버림
const VIVINO_DOMAINS = ['vivino.com'];
export const vivinoSearchUrl = q => 'https://www.vivino.com/search/wines?q=' + encodeURIComponent(q || '');
const isVivino = u => { try { return /(^|\.)vivino\.com$/.test(new URL(u).hostname); } catch (e) { return false; } };
const normUrl = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '').toLowerCase(); } catch (e) { return ''; } };

export async function findVivino({ key, name, producer, vintage, signal }) {
  if (!key) throw new Error('NO_KEY');
  if (!name) return null;
  const q = [producer && !String(name).toLowerCase().includes(String(producer).toLowerCase()) ? producer : '', name, vintage || ''].filter(Boolean).join(' ');
  const text = `Find this exact wine on Vivino and report its Vivino average rating.
Wine: ${q}

Search only vivino.com (try the producer + wine name; add the vintage if the first search misses).
STRICT RULES — a blank is better than a wrong number:
- Only report a rating you actually saw for THIS wine (same producer and same cuvée) in the search results.
- "url" must be the vivino.com page of that wine exactly as it appeared in the results.
- Prefer the rating for the same vintage; if only the wine's overall rating is shown, use it and set "sameVintage": false.
- If you did not find it, or are not sure it is the same wine, reply with all fields null. Never estimate.

Reply with ONLY one JSON object in a \`\`\`json code block:
{"rating": number 1.0-5.0 or null, "count": number of ratings or null, "url": "https://www.vivino.com/..." or null, "sameVintage": true | false | null}`;
  const messages = [{ role: 'user', content: text }];
  const body = {
    model: MODELS.haiku,
    max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, allowed_domains: VIVINO_DOMAINS }],
    messages,
  };
  let data;
  for (let turn = 0; turn < 3; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data?.error?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
    if (data.stop_reason !== 'pause_turn') break;
    body.messages = [...messages, { role: 'assistant', content: data.content }];
  }
  const blocks = data.content || [];
  // 검색 결과에 실제로 나온 Vivino 주소 목록
  const seen = new Set();
  blocks.forEach(b => {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => r.url && isVivino(r.url) && seen.add(normUrl(r.url)));
    (b.citations || []).forEach(c => c.url && isVivino(c.url) && seen.add(normUrl(c.url)));
  });
  let out;
  try { out = extractJson(blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')); } catch (e) { return null; }
  const rating = Math.round(Number(out.rating) * 10) / 10;
  if (!(rating >= 1 && rating <= 5) || !out.url || !isVivino(out.url) || !seen.has(normUrl(out.url))) return null;
  const count = Number(out.count);
  return { rating, count: count > 0 ? Math.round(count) : null, url: out.url, sameVintage: out.sameVintage !== false };
}
