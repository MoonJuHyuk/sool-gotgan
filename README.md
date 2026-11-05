# 술곳간 · Sool Gotgan

곳간은 귀한 것을 쌓아 두는 창고입니다. 술곳간은 집에 모아 둔 와인과 위스키를 정리하는 개인 술 창고 앱입니다.

집 와인냉장고와 위스키장에 무엇이 있는지 한눈에 볼 수 있습니다.
라벨을 찍으면 Claude가 사진을 읽고 웹에서 정보를 찾아 정해진 칸에 채워 줍니다.

- **폰 앱처럼 설치:** 홈 화면 아이콘으로 열리고, 인터넷이 끊겨도 마지막 목록을 볼 수 있습니다 (설치형 웹앱, PWA).
- **사진으로 등록:** 카메라로 바로 찍거나 앨범에서 고릅니다.
- **AI 자동 입력:** 이름, 빈티지·숙성 연수, 국가, 지역, 생산자·증류소, 품종·캐스크, 도수, 맛(1~5), 소개, 어울리는 음식, 출처.
- **내 구글시트에 저장:** 데이터는 각자 구글드라이브의 시트에, 사진은 드라이브 폴더에 저장됩니다. 서버 비용이 없고 모든 기기에서 같은 창고가 보입니다.
- **나만의 기록:** 구매가, 구매일, 구매처, 보관 위치, 남은 양, 나의 메모.
- **와인·위스키·기타(사케·전통주·브랜디 등)** 탭마다 다른 레트로 도트 분위기. 한글 도트 글꼴은 [갈무리](https://github.com/quiple/galmuri)(SIL OFL 1.1).
- **한국어 / English**, CSV·백업 파일 내보내기.

## 쓰는 법

1. 앱 주소를 엽니다: https://moonjuhyuk.github.io/sool-gotgan/
2. 바로 쓰면 그 기기에만 저장됩니다. 여러 기기에서 같이 보려면 [SETUP.md](SETUP.md)대로 구글시트를 연결하세요.
3. 라벨 자동 인식을 쓰려면 설정에 본인의 Claude API 키를 넣습니다 (종량제, 1병 약 40~100원).

## 구조

```
index.html            앱 화면
css/app.css           디자인
js/app.js             화면 동작
js/store.js           저장소 (구글시트 연결 / 이 기기)
js/ai.js              라벨 인식 (Claude API + 웹 검색)
js/i18n.js            한국어·영어 문구
sw.js                 오프라인용 서비스 워커
apps-script/Code.gs   구글시트에 붙이는 저장 스크립트
```

빌드 과정이 없는 순수 HTML·JS입니다. PC에서 미리 보려면 `run-local.bat`(Windows)을 실행하거나 `python -m http.server 8000` 후 http://localhost:8000 을 엽니다.

## 개인정보

- 술 데이터와 사진은 사용자 본인의 구글드라이브에만 저장됩니다. 이 저장소나 개발자에게 전송되지 않습니다.
- Claude API 키는 본인 기기 또는 본인 시트의 스크립트 설정에만 저장되며, 라벨 사진은 인식할 때 Anthropic API로만 전송됩니다.

---

## English

*Gotgan* is the Korean word for a storehouse of precious things. Sool Gotgan is a personal cellar for your wine fridge and whisky shelf. Photograph a label and Claude reads it, looks the bottle up on the web, and fills in a structured record.

- Installable web app (PWA) with offline viewing
- Camera or photo library input; AI fills name, vintage/age, country, region, producer/distillery, grapes/cask, ABV, 1–5 taste scales, description, food pairing and sources
- Data lives in **your own Google Sheet** (via a small Apps Script you paste in), photos in your Google Drive; no server to run
- Korean and English UI, light and dark themes, CSV and JSON export

Open https://moonjuhyuk.github.io/sool-gotgan/ to try it (data stays on that device), then follow [SETUP.md](SETUP.md) to connect a sheet. AI label reading needs your own Claude API key (pay-as-you-go).

License: MIT
