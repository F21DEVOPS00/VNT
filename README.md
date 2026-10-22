# VNT — Voice Note Taker

아이폰 회의 녹음 → 받아쓰기 → 회의 요약·할 일 → 지정 이메일 발송.

## 현재 구현

- 큰 빨간 버튼을 한 번 누르면 녹음 시작, 다시 누르면 종료합니다.
- 녹음을 먼저 앱 문서 저장소에 보관합니다. 네트워크 오류가 녹음 파일을 지우지 않습니다.
- 한국어·영어 녹음의 받아쓰기, 한국어 회의 요약·결정·할 일 추출.
- 회의별 텍스트·메모 저장, 녹음 재생·공유·가져오기·삭제.
- 최대 10개 이메일 수신자, 자동 이메일 켜기/끄기, BCC 발송.
- AI 및 메일 서비스 설정 전에는 녹음·로컬 저장·샘플 회의록 확인만 사용할 수 있습니다.
- 녹음 종료 후 결과 화면에서 원본 녹음 재생·일시정지·이어 듣기·처음부터 다시 듣기를 사용할 수 있습니다. 파일을 미리 불러오고 로딩·오류·재생 시간을 표시합니다.
- 실제 분석이 없는 결과 화면에는 **테스트 예시** 요약·텍스트를 표시합니다. 이 예시는 실제 녹음의 받아쓰기/요약으로 저장되거나 이메일로 보내지지 않습니다. 예시 숨기기로 실제 분석 대기 상태를 확인할 수 있습니다.
- `내 메모`에서 직접 입력하고 `메모 저장`을 누릅니다. `녹음 목록` 또는 `새 녹음 하러 가기`로 돌아가면 기존 녹음을 다시 열거나 빨간 버튼으로 새 녹음을 시작할 수 있습니다.
- 이메일 전송 결과가 불확실하면 자동 재시도를 멈춥니다. 전송 시도 기록은 서버 재시작 후에도 유지합니다.

## Windows에서 시작

Node.js 22.17 이상, Git, 같은 Wi-Fi의 아이폰이 필요합니다.

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

아이폰 App Store에서 **Expo Go 57**로 업데이트하고 개발 서버의 QR 코드를 카메라로 스캔합니다. 이 프로젝트는 SDK 57을 사용합니다. SDK 58용 Expo Go는 아직 App Store에 배포되지 않았으므로 최신 SDK로 임의로 변경하지 마세요(2026-10-21 확인). 먼저 화면을 켠 채 짧은 녹음으로 시험하세요. Expo Go는 개발 미리보기이며 독립 앱이 아닙니다. 배경·잠금 화면 녹음은 EAS 독립 빌드에서 검증해야 합니다.

개인 테스트용 `.env`에서 `EXPO_PUBLIC_DEFAULT_RECIPIENTS`에 본인 수신 주소를 넣을 수 있습니다. 공개 빌드는 이 기본값을 비워야 합니다. `.env`는 Git과 EAS 업로드에서 제외됩니다.

## AI / 이메일 서버

```powershell
Copy-Item server/.env.example server/.env
npm run server
```

서버의 `.env`에 OpenAI API 키, SMTP 계정과 발신 주소를 설정합니다. 앱에는 API 키를 넣지 않습니다. 개인 LAN 테스트는 임의의 긴 `MEETING_ACCESS_TOKEN`을 서버와 앱 설정에 동일하게 입력합니다. 서버 주소는 `http://PC의로컬IP:8787`입니다. 방화벽 또는 네트워크 설정은 사용자가 직접 확인해야 합니다. LAN HTTP는 개발 전용입니다.

공개 서비스는 Supabase URL/anon key/service role key를 서버에 설정하고 이메일 확인을 켭니다. 앱의 회원가입·로그인으로 각자의 토큰을 받습니다. `NODE_ENV=production`에서는 개인 공유 암호 인증으로 시작하지 않습니다. 반드시 HTTPS와 지속 저장 볼륨을 사용하세요.

녹음은 24MB까지 업로드할 수 있습니다. 긴 회의는 나누어 녹음하세요. 현재 녹음 설정은 mono AAC 48kbps이며, 실제 길이 한도는 파일 크기로 판단합니다. 받아쓰기·요약은 외부 API 요금이 발생할 수 있습니다. 현재 공급자는 OpenAI이며 모델은 서버 환경 변수로 바꿀 수 있습니다. 자동 이메일은 SMTP 서비스가 연결되어야 실제 발송됩니다.

## 검사

```powershell
npm run typecheck
npm test
npm run build:web
```

서버 테스트는 인증 차단, 파일 크기 제한, 임시 파일 삭제, 구조화된 요약, 메일 중복 방지와 전송 불확실성을 검증합니다. 실제 AI나 이메일 서비스는 호출하지 않습니다. 웹은 UI 미리보기이며 실제 아이폰 녹음 테스트를 대체하지 않습니다.

## 소스 구조

- `App.tsx`: 한 버튼 녹음 화면, 회의 목록/상세, 수신자·계정 설정.
- `src/storage.ts`: 기기 저장소, 복구 메타데이터, 안전한 연결 토큰 저장.
- `src/api.ts`: AI 및 이메일 서버 호출.
- `server/app.mjs`: 인증, 업로드, 요약·메일 API와 사용량 제한.
- `server/services.mjs`: Supabase·SMTP·전송 시도 영속 저장.
- `server/index.mjs`: OpenAI 연결과 서버 시작.
- `docs/APP_STORE.md`: 공개 배포 준비와 실제 기기 검증 목록.
- `docs/PRIVACY_DRAFT.md`: 운영 정보 입력과 검토가 필요한 개인정보 안내 초안.

## GitHub

저장소: https://github.com/F21DEVOPS00/VNT

기본 브랜치 `main`. 소스만 보관하며 녹음·키·사용자 데이터는 올리지 않습니다. `AGENTS.md`가 이후 Codex 작업 규칙입니다.

## 아이폰 독립 앱 / App Store

Mac 없이 EAS 클라우드 빌드가 가능합니다. Expo 계정과 유효한 Apple Developer Program 멤버십이 필요합니다. 아직 앱이 App Store에 등록되거나 심사 제출된 상태는 아닙니다.

```powershell
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform ios --profile development
# 실제 기기 검증 후
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

`eas build:configure`와 앱 식별자/서명 연결은 본인 계정으로 진행합니다. 공개 빌드 전에 `EXPO_PUBLIC_API_URL`을 운영 HTTPS 주소로 설정하고 개인 수신자 환경 변수가 없는지 확인하세요.

## 현재 제한

- Windows에서 iOS 바이너리를 직접 빌드하거나 시뮬레이터로 검증하지 않았습니다.
- 실시간 자막·화자 구분·오프라인 AI는 포함하지 않습니다. 녹음 종료 후 처리합니다.
- 앱을 강제 종료하면 녹음·업로드가 중단될 수 있습니다. 재실행 시 남은 파일 복구를 시도하지만 복구를 보장하지 않습니다.
- AI/메일 요청 중 앱이 백그라운드로 가면 완료 표시를 받지 못할 수 있습니다. 공개 출시 전 영속 백그라운드 작업 큐와 완료 알림을 추가해야 합니다.
- 서버 전송 이력은 단일 인스턴스 파일 저장 방식입니다. 여러 서버 운영에는 데이터베이스와 분산 작업 큐로 교체해야 합니다.
- 공개 서비스의 결제/유료 사용량 정책, 비밀번호 재설정, 운영 모니터링은 아직 구성되지 않았습니다.

## 근거 문서

- Expo Audio: https://docs.expo.dev/versions/latest/sdk/audio/
- EAS iPhone builds: https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/
- OpenAI transcription: https://developers.openai.com/api/docs/guides/speech-to-text
