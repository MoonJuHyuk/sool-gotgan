# 술곳간 (Sool Gotgan) — notes for Claude

Read `docs/작업안내서.md` first (architecture, file map, sheet column order, change procedures) and `docs/진행사항.md` (history, what's done).
The owner is a non-developer; reply in Korean, keep explanations plain, and do browser/PC setup work yourself where you can.

- Static PWA, no build step. Hosted on GitHub Pages from `main` (repo `MoonJuHyuk/sool-gotgan`). Working copy lives on the owner's NAS: `★문주혁\Python\sool-gotgan`.
- Data: Google Sheet "술곳간" via the Apps Script web app in `apps-script/Code.gs` (POST text/plain JSON with `secret`). Photos in Drive folder "술곳간 사진".
- AI: `js/ai.js` calls the Claude Messages API directly from the browser (`anthropic-dangerous-direct-browser-access`), image + `web_search` tool, JSON reply. Key is stored in the sheet's script properties. Rule: leave fields null unless the label or a found source states them.
- Themes per tab via `body[data-theme]`: all=E1 jumak, wine=W3 sunset, whisky=A cellar, other=E2 neon. Font: Galmuri (OFL) in `fonts/`.
- On every app change bump `VERSION` in both `js/app.js` and `sw.js`.
- Adding a sheet column: update `FIELDS` in Code.gs → save script (don't deploy) → insert the column in the sheet → immediately deploy a new version of the same deployment → then update the app. Nothing may be saved in between.
- Secrets (web app URL + secret, connect link) are in `docs/연결정보.local.md`, which is git-ignored. Never commit them.
