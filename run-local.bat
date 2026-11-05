@echo off
REM PC에서 앱을 미리 보기: 이 파일을 더블클릭한 뒤 브라우저에서 http://localhost:8000 을 엽니다.
cd /d "%~dp0"
start "" http://localhost:8000
python -m http.server 8000
