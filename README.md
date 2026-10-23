# Backseat (AI 소통기)

화면을 캡처하고 주석을 달아 AI에게 말로 전달하는 Electron 도구. point, talk, let the AI drive.

```sh
npm install
npm run build
npm start
```
캡처 단축키: Ctrl+Shift+A (트레이 아이콘 클릭도 가능)

흐름: 단축키 → 화면이 멈추고 어두워짐 → 드래그로 영역 선택 → 편집기에서 펜/텍스트/메모 → 저장(Ctrl+S, PNG + brief.md) 또는 복사(Ctrl+C, 이미지+메모를 클립보드) → 터미널이나 채팅창에 Ctrl+V.

검증: `npm run selftest` 가 캡처→크롭→선택창·편집기 렌더링→클립보드→brief 생성을 자동으로 확인한다.

주의: 프로젝트를 Claude 앱의 임시 폴더처럼 가상화된 AppData 아래에 두면 Electron 샌드박스와 Vite 빌드가 깨진다. D:\backseat 같은 일반 폴더에서 작업할 것.
