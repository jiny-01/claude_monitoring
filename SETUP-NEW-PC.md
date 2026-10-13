# 클로드 모니터링 — 새 PC 설치 지침서 (Claude 세션용)

이 문서는 **새 PC의 Claude Code 세션**에게 주는 작업 지침이에요.
목표: 이 PC에 "클로드 모니터링" 위젯을 설치하고, 상태줄 연동까지 끝내서 실제로 동작하는 것을 확인한다.

- 저장소: https://github.com/jiny-01/claude_monitoring.git
- 위젯은 로컬 파일만 읽는다(LLM·네트워크 호출 없음, 토큰 0). 이 성질을 깨는 수정은 하지 않는다.
- Windows 전용이다. Windows가 아니면 중단하고 사용자에게 알린다.

## 작업 규칙
- 모든 응답은 한국어로 한다.
- `settings.json`의 기존 설정은 보존한다. 특히 **기존 `statusLine`이 있으면 덮어쓰지 말고** 사용자에게 먼저 묻는다.
- 오류가 나면 무작위로 고치지 말고 원인을 분석한 뒤 단계별로 해결한다.
- 설치 위치는 사용자가 지정하지 않았다면 `C:\tools\claude-board`를 쓴다. (경로에 공백·한글이 없는 곳을 권장)

## 1단계. 사전 점검
아래를 확인하고, 없는 것만 사용자에게 알려 설치를 안내한다.

```powershell
node -v      # Node.js LTS (18 이상)
npm -v
git --version
```

- Claude Code가 이 PC에 설치되어 있어야 한다(`~/.claude` 폴더 존재).

## 2단계. 받기와 의존성 설치
```powershell
git clone https://github.com/jiny-01/claude_monitoring.git C:\tools\claude-board
cd C:\tools\claude-board
npm install
```

## 3단계. 상태줄(statusLine) 연동
상태줄 연동이 있어야 세션 실제 이름, 컨텍스트 %, 5시간·주간 사용량이 표시된다. 없어도 위젯은 동작하지만 세션 제목이 별칭(`폴더명-번호`)으로 보인다.

1. `C:\Users\<사용자>\.claude\settings.json`을 읽는다.
2. `statusLine` 키가 **없으면** 아래를 추가한다.
   ```json
   "statusLine": {
     "type": "command",
     "command": "node C:/tools/claude-board/statusline.js"
   }
   ```
3. `statusLine`이 **이미 있으면** 중단하고 사용자에게 선택지를 준다(덮어쓰기 / 기존 명령과 병행 / 연동 생략).
4. 주의사항
   - 경로는 반드시 **슬래시(`/`)** 로 쓴다. Windows에서 상태줄 명령은 Git Bash로 실행되어 역슬래시가 깨진다.
   - 설치 위치가 `C:\tools\claude-board`가 아니면 그 경로로 바꾼다.
   - 위젯 폴더를 나중에 옮기면 이 경로도 함께 바꿔야 한다.
   - `settings.json`은 JSON이므로 쉼표·따옴표를 깨뜨리지 않는다.

## 4단계. 실행
```powershell
cd C:\tools\claude-board
npm start
```

- 트레이(작업표시줄 우측)에 클로드 모양 아이콘이 생기고, 클릭하면 위젯이 열린다.
- 핀(우측 상단)을 누르면 화면에 고정된다.

## 5단계. 동작 확인
다음을 확인하고 결과를 사실대로 보고한다.

| 확인 항목 | 방법 | 기대 결과 |
|---|---|---|
| 위젯 표시 | 트레이 아이콘 클릭 | 세션 카드 목록이 보임 |
| 세션 인식 | 다른 터미널에서 Claude Code 세션 실행 | 목록에 카드가 추가됨 |
| 상태줄 수집 | `%LOCALAPPDATA%\claude-board\status\` 폴더 확인 | 세션 응답 후 `<세션ID>.json` 파일 생성 |
| 사용량 표시 | 세션이 한 번 응답한 뒤 위젯 하단 확인 | 5시간·주간 한도 표시(Pro/Max 구독만) |

- 상태 파일이 안 생기면: `settings.json`의 경로가 슬래시인지, `node`가 PATH에 있는지, 세션이 한 번 응답했는지 순서대로 점검한다.
- 위젯이 "불러오는 중…"에서 멈추면: 콘솔 오류를 확인하고 원인을 분석한다.

## 6단계. 선택 사항 (사용자가 원할 때만)
- **바로가기 만들기**: electron 실행 파일에 인자 `"C:\tools\claude-board"`, 아이콘 `icon.ico`로 `.lnk`를 만들고 작업표시줄에 고정한다. 바로가기는 저장소에 없으므로 직접 만든다.
- **설치 파일 빌드**: `npm run dist:simple` → `dist/`에 설치 파일과 포터블이 생성된다(각 약 81MB). 설치 후에도 3단계(상태줄 연동)는 따로 필요하며, 이 경우 `statusline.js`는 설치 폴더의 `resources`에 있다.
- **자동 시작**: 로그인 시 실행되도록 시작프로그램에 바로가기를 넣는다.

## 알아 둘 점
- 각 PC는 **자기 PC의 세션만** 보여준다. 여러 PC의 세션을 합쳐 보지는 못한다.
- 설정(고정 상태·위치·크기·별칭)은 PC별로 `%APPDATA%\claude-board\config.json`에 저장된다.
- 클라우드 세션, Remote Control 세션은 목록에 나타나지 않는다.
- 입력 대기 중이라 상태줄이 아직 한 번도 실행되지 않은 세션은 제목이 별칭으로 보이다가, 다음 응답 후 실제 이름으로 바뀐다.
- 세션 종료 버튼은 확인 없이 즉시 프로세스를 종료한다.

## 완료 보고 형식
작업이 끝나면 아래를 한국어 개조식으로 보고한다.
- 설치 경로와 실행 여부
- `settings.json` 변경 내용(추가한 키만)
- 5단계 확인 결과(확인한 것 / 확인하지 못한 것 구분)
- 사용자가 직접 해야 할 일(바로가기, 작업표시줄 고정 등)
