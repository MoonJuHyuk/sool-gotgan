// 라벨 사진 → Claude (이미지 인식 + 웹 검색) → 정해진 형식의 JSON
export const MODELS = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const SCHEMA_HINT = `{
  "kind": "wine" | "whisky",
  "name": "label name as printed, e.g. 'Château Talbot 2018' or 'Lagavulin 16'",
  "type": one of WINE_TYPES or WHISKY_TYPES,
  "vintage": number or null,         // wine only
  "age": number or null,             // whisky age statement in years
  "country": string, "region": string,
  "producer": string,                // winery / château, or distillery for whisky
  "grapes": string or null,          // wine: grape varieties, comma separated
  "cask": string or null,            // whisky: cask types
  "abv": number or null, "volume": number or null,   // ml
  "sweetness": 1-5, "acidity": 1-5 or null, "tannin": 1-5 or null, "body": 1-5, "finish": 1-5 or null,
  "smoky": 1-5 or null, "fruity": 1-5 or null, "spicy": 1-5 or null,
  "desc": "3-5 sentence introduction: producer, place, style, typical aromas and flavours, drinking window if wine",
  "pairing": "2-4 concrete dishes that suit it",
  "confidence": "high" | "medium" | "low",
  "sources": ["url", "..."]
}`;

function prompt(lang, types) {
  const L = lang === 'ko' ? 'Korean (한국어). Keep proper nouns (producer, region, grape) in their usual Korean spelling followed by the original in parentheses the first time, e.g. "생쥘리앙(Saint-Julien)".' : 'English.';
  return `You are a sommelier and whisky specialist cataloguing a private home cellar.
Look at the bottle/label photo. Identify the exact product (producer, cuvée/expression, vintage or age).
Then use web search to confirm the facts and gather the producer's or a reputable retailer's description and tasting notes.

Taste scales (1 = very light/low, 5 = very strong/high). For wine fill sweetness, acidity, tannin, body, finish; leave smoky/fruity/spicy null.
For whisky fill smoky, sweetness, fruity, spicy, body; leave acidity/tannin/finish null.
Use null for anything you cannot determine. Never invent a vintage or age that is not on the label.

Allowed "type" values — wine: ${JSON.stringify(types.wine)}; whisky: ${JSON.stringify(types.whisky)}.
Write "desc" and "pairing" (and "region"/"country" names) in ${L}

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
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
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
