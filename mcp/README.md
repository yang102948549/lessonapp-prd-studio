# lessonapp-prd-mcp

수업용 웹앱을 기획할 때 쓰는 MCP 서버입니다. [수업 웹앱 PRD 스튜디오](https://yang102948549.github.io/lessonapp-prd-studio/)의 기획 질문과 교육과정 성취기준 데이터를 AI 클라이언트(Claude, Cursor 등)에서 그대로 쓸 수 있게 합니다.

로컬에서 stdio로 실행하며 네트워크 접속, 서버, API 키가 필요 없습니다. Node 18 이상이 필요합니다.

## 설치

Claude Code:

```
claude mcp add lessonapp-prd -- npx -y lessonapp-prd-mcp
```

Claude Desktop 등 다른 클라이언트는 설정 파일에 다음을 추가합니다.

```json
{
  "mcpServers": {
    "lessonapp-prd": { "command": "npx", "args": ["-y", "lessonapp-prd-mcp"] }
  }
}
```

## 도구

| 도구 | 하는 일 |
|---|---|
| `browse_curriculum` | 학년군·교과·과목·단원(영역) 목차와 성취기준 개수 |
| `search_standards` | 성취기준 원문을 낱말·학교급·학년·교과로 검색 |
| `get_standard` | 성취기준 코드로 원문과 소속 조회 |
| `get_planning_questions` | 지금까지의 답에 맞는 다음 기획 질문과 선택지 |
| `build_prd` | 답과 성취기준 코드로 PRD 초안(마크다운) 생성. 빠진 핵심 항목과 충돌도 알려 줌 |

## 사용 예

> 초등학교 5학년 수학 수업에서 쓸 도구를 기획하고 싶어. 혼합 계산 성취기준을 찾아서 PRD 초안까지 만들어 줘.

AI가 `search_standards`로 `6수01-01`을 찾고, `get_planning_questions`로 교사에게 필요한 질문을 한두 개씩 하며, 마지막에 `build_prd`로 초안을 만듭니다.

## 데이터

- 2022 개정 교육과정 성취기준 4,451개(초1~고3, 제2외국어 포함). 교과서 단원이 아니라 교육과정의 영역 단위입니다.
- 출처와 이용 조건은 [NOTICE.md](NOTICE.md)를 보세요.
- 학년은 학년군 단위입니다. 초5를 고르면 초5~6 전체가 나옵니다.

## 개발

저장소의 `mcp/` 폴더입니다. 질문 정의(`planning.js`)와 교육과정 데이터(`curriculum-data.js`)는 사이트와 같은 파일을 쓰며, 저장소 루트에서 바꾼 뒤 `npm run sync`로 복사합니다(`npm pack`·`npm publish` 때 자동 실행).

```
npm install
npm test
```
