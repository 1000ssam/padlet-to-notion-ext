# TODO — 사용자가 직접 해야 하는 작업

## 현재 상태

자는 동안 처리된 것:
- [x] 루프 버그 수정: `isSaving` 가드 + 포스트 5개씩 병렬 upsert + 아카이브 병렬 PATCH
- [x] Notion OAuth 플로우 코드 작성 (`popup.js`: `startOAuthFlow`, `exchangeCodeForToken`)
- [x] 온보딩 UI 정비: OAuth 버튼 + 에러 표시 + "수동 설정" 링크
- [x] 설정 화면 정비: 인증 방식 라디오(OAuth/토큰) + DB 모드 라디오 상호작용
- [x] OAuth 토큰 교환 백엔드 작성 (`oauth-backend/api/oauth-token.js`, Vercel 배포용)
- [x] `manifest.json`에 `identity` 권한 추가

아직 남은 것 → **아래 단계를 순서대로 수행하세요.**

---

## STEP 1: Notion OAuth 앱 등록

1. https://www.notion.so/my-integrations 접속
2. **"+ 새 통합 앱"** 클릭
3. 아래 항목 입력:
   - **이름**: `Padlet to Notion` (원하는 이름)
   - **유형**: "공개 통합" 선택 ← 반드시 공개여야 OAuth 가능
   - **회사/개인 웹사이트**: 아무 URL이나 (예: `https://example.com`)
4. 생성 후 **OAuth 설정** 탭으로 이동:
   - **OAuth 리디렉션 URI** 필드에 아래 값 추가:
     ```
     https://<확장앱ID>.chromiumapp.org/notion
     ```
     `<확장앱ID>`는 크롬 `chrome://extensions` → 개발자 모드 → 확장 ID 확인
5. **Client ID** 와 **Client Secret** 복사 (다음 단계에서 사용)

> 내부 통합 토큰(`ntn_...`)으로는 새 DB 자동 생성이 안 됩니다.
> 기존 DB 연결(`기존 DB 연결` 탭)은 내부 토큰으로도 가능합니다.

---

## STEP 2: popup.js 상단 값 교체

`C:\dev\padlet-to-notion-ext\popup\popup.js` 파일 상단:

```js
// 현재 (플레이스홀더)
const OAUTH_CLIENT_ID     = 'YOUR_NOTION_CLIENT_ID';
const OAUTH_CLIENT_SECRET = 'YOUR_NOTION_CLIENT_SECRET';
const OAUTH_TOKEN_ENDPOINT = 'https://api.notion.com/v1/oauth/token';
```

**STEP 3(Vercel 배포) 완료 전까지 개발용 임시 설정:**
```js
const OAUTH_CLIENT_ID     = 'STEP1에서_복사한_client_id';
const OAUTH_CLIENT_SECRET = 'STEP1에서_복사한_client_secret';  // 개발 중 임시
const OAUTH_TOKEN_ENDPOINT = 'https://api.notion.com/v1/oauth/token';
```

**STEP 3 완료 후 최종 설정 (client_secret 제거):**
```js
const OAUTH_CLIENT_ID     = 'STEP1에서_복사한_client_id';
const OAUTH_CLIENT_SECRET = '';  // 백엔드에서 관리하므로 비워도 됨
const OAUTH_TOKEN_ENDPOINT = 'https://your-backend.vercel.app/api/oauth-token';
```

---

## STEP 3: OAuth 백엔드 Vercel 배포 (선택, 보안 강화용)

> client_secret을 확장앱 코드에 포함하면 누구나 추출 가능합니다.
> Vercel 백엔드를 통해 서버에서 교환하면 secret이 노출되지 않습니다.

1. [Vercel 계정](https://vercel.com) 없으면 GitHub로 가입
2. `oauth-backend` 폴더를 별도 Git 저장소로 만들거나, Vercel CLI 사용:
   ```bash
   cd C:\dev\padlet-to-notion-ext\oauth-backend
   npm i -g vercel
   vercel
   ```
3. 배포 후 Vercel 프로젝트 **Settings > Environment Variables**에 추가:
   - `NOTION_CLIENT_ID` = STEP 1에서 복사한 Client ID
   - `NOTION_CLIENT_SECRET` = STEP 1에서 복사한 Client Secret
4. 배포된 URL 확인 (예: `https://padlet-notion-oauth.vercel.app`)
5. `popup.js` 업데이트:
   ```js
   const OAUTH_TOKEN_ENDPOINT = 'https://padlet-notion-oauth.vercel.app/api/oauth-token';
   ```

---

## STEP 4: 확장 앱 리로드 및 테스트

1. `chrome://extensions` → 개발자 모드 ON
2. **"압축 해제된 확장 프로그램 로드"** → `C:\dev\padlet-to-notion-ext` 선택
   (이미 로드된 경우 새로고침 버튼 클릭)
3. Padlet 페이지 열기 → 확장 아이콘 클릭
4. 온보딩: **"Notion 계정 연결"** 버튼 클릭 → OAuth 팝업 → 워크스페이스 선택 → 승인
5. 자동으로 DB 생성되면 메인 화면으로 이동
6. **"저장"** 버튼으로 동기화 테스트

---

## 참고: 기존 내부 토큰 사용자

OAuth 없이 기존 `ntn_...` 토큰으로도 사용 가능합니다:
1. 확장 아이콘 → 설정(⚙️)
2. **인증 방식**: "통합 토큰 직접 입력" 선택
3. **DB 설정**: "기존 DB 연결" 선택 (이 앱으로 만든 DB여야 함)
4. 패들렛 DB ID, 포스트 DB ID 입력 → 연결하기

기존 DB:
- 패들렛 DB: `314dd1dcd64480aabe7ed71348c22428`
- 포스트 DB: `45224ebcb3ec43689559cfa6ffad4121`
