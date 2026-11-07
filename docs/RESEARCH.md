# 사전 조사 (2026-11-07)

별 수와 활동은 GitHub API 기준이다. **[미확인]** 은 2차 자료뿐이거나 직접 확인하지 못한 내용이다. 토큰 수치와 비교 글의 다수는 블로그·벤더 자료다.

## 직접 시험한 것

GitHub Free 개인 계정의 시험 저장소에서 2026-11-07 에 확인했다.

| 시험 | 결과 |
|---|---|
| 같은 이름 브랜치를 `POST git/refs` 로 20개 동시 생성 | 201 하나, 422 열아홉 |
| `createLinkedBranch` 같은 이름으로 10개 동시 호출 | 성공 하나, 이슈의 `linkedBranches` 에 잡힘 |
| Issue dependencies, sub-issues | 생성·조회 됨, 이슈 응답에 `issue_dependencies_summary` 포함 |
| 사용자 정의 ref `refs/gam/status` | 생성 됨, 브랜치 목록에 안 나옴, `contents?ref=` 로 읽힘 |
| `raw.githubusercontent.com/<repo>/refs/gam/status/status.svg` | 200, `image/svg+xml`, `max-age=300` |
| 익명 REST 호출 | `access-control-allow-origin: *`, ETag 있음 |
| Free 비공개 저장소의 브랜치 보호·룰셋 API | "Upgrade to GitHub Pro or make this repository public" 로 거절 |
| npm 이름 | `git-agent-manager` 비어 있음, `gam`·`git-agent` 는 사용 중 |

아직 안 해 본 것: README 안에서 camo 를 거친 뒤의 갱신 시간, 비공개 저장소에서 로그인한 사람에게 이미지가 보이는지.

## 선행 도구

| 도구 (별) | 계획 저장 | 연결 | 준수 장치 | 대시보드 | 알려진 문제 |
|---|---|---|---|---|---|
| [Taskmaster](https://github.com/eyaltoledano/claude-task-master) (28.3k, 4월 이후 커밋 없음) | `tasks.json` | MCP, CLI | 없음 | CLI | 기본 36도구 약 21k 토큰, Commons Clause, 동시 쓰기 데이터 유실 수정 이력 |
| [CCPM](https://github.com/automazeio/ccpm) (8.4k) | `.claude/` + Issues | Skill | 절차뿐 | 터미널 | 어느 쪽이 원본인지 불분명 |
| [Spec Kit](https://github.com/github/spec-kit) (148k) | `.specify/` | 슬래시 스킬 | 프롬프트, 선택 훅 | 없음 | [마일스톤 추적은 요청 단계](https://github.com/github/spec-kit/issues/5284), [마크다운이 무겁다](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) |
| [Backlog.md](https://github.com/MrLesk/Backlog.md) (7.3k) | 작업당 md | CLI, MCP | 없음 | TUI, 로컬 웹 | [클론 간 ID 중복](https://github.com/MrLesk/Backlog.md/issues/711) |
| [Kiro](https://kiro.dev/docs/specs/) (4.5k) | `.kiro/specs/` | Kiro 전용 | 단계 검토, 훅 | 작업 상태 | 작은 버그에 완료 조건 16개 (Fowler) |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) (74.2k) | `openspec/changes/` | 슬래시 | 사람 검토 | 불명확 | [변경 간 겹침이 보관 때까지 안 보임](https://github.com/Fission-AI/OpenSpec/issues/1669) |
| [Beads](https://github.com/gastownhall/beads) (28.6k) | Dolt, `refs/dolt/data` | CLI, MCP | 일부 훅 | 커뮤니티 | [스키마 이전 시 병합 불가](https://github.com/gastownhall/beads/issues/6727) |
| [Linear MCP](https://linear.app/docs/mcp) | SaaS | 원격 MCP | 없음 | Linear | 코드 저장소 밖 |
| [GitHub MCP](https://github.com/github/github-mcp-server) (34.3k) | Issues, Projects | 원격 MCP | 권한 | GitHub | 18k 토큰 안팎 [미확인] |
| [gh-aw](https://github.com/github/gh-aw) (5.6k) | md → lock.yml | Actions | [읽기 전용 기본, 샌드박스](https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/) | Actions | 실행당 비용, GitHub 전용 |
| [AGENTS.md](https://agents.md/) | 관례 파일 | 20개 이상 에이전트 | 없음 | 없음 | [ETH 연구](https://arxiv.org/abs/2602.11988): 성공률 이득 없음, 비용 20% 이상 증가 |
| [git-bug](https://github.com/git-bug/git-bug) (10.8k) | git 객체 | CLI | 없음 | TUI, 로컬 웹 | 마일스톤 없음 |
| [Vibe Kanban](https://vibekanban.com/shutdown) (28.6k) | 로컬 DB | 에이전트 실행 | 사람 검토 | 칸반 | 2026-04 회사 종료 |

이 밖에 Plane, BMAD, GSD(`open-gsd/gsd-core` 로 이전), OpenAI Symphony(Linear 를 제어판으로), Google Conductor, Melty Conductor, ACP 를 살펴봤다.

**되는 패턴:** 저장소 안의 평문 파일과 작은 CLI, 도구를 가리키는 짧은 포인터, 작업당 worktree·PR, 플랫폼 수준의 제한, 적은 도구 수.

**안 되는 패턴:** 훅의 실패 시 통과, MCP 도구 과다, 낡는 스펙, 절차 과다, 병렬 충돌, 저장소 두 개를 원본으로 두기, 호스팅과 사업 의존.

**지시문 준수 증거는 엇갈린다.** Fowler 의 글은 무시 사례를 보고했다. [48회 시험](https://github.com/yurukusa/cc-safe-setup/discussions/1091)은 짧은 금지 규칙이 잘 지켜졌다고 하지만, 짧은 세션이고 저자가 관련 책을 판다. 긴 작업에서의 준수를 잰 자료는 찾지 못했다.

## GitHub 동작 방식

- **차단:** [룰셋의 필수 검사는 App 을 고정할 수 있다](https://docs.github.com/en/rest/repos/rules). [Free 비공개는 보호 브랜치와 코드 오너가 없다](https://docs.github.com/en/get-started/learning-about-github/githubs-plans). 조직 룰셋의 필수 워크플로는 Team 에서 되는지 문서가 엇갈린다 [미확인].
- **App 과 Action:** [Checks 쓰기는 App 만 가능](https://docs.github.com/en/rest/checks/runs). [`GITHUB_TOKEN` 이벤트는 워크플로를 띄우지 않는다](https://docs.github.com/en/actions/concepts/security/github_token). 봇이 연 PR 은 필수 검사에서 멈출 수 있다.
- **워크플로 파일 쓰기:** [App 은 Workflows 쓰기 권한](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps), [토큰은 `workflow` 범위](https://docs.github.com/en/rest/repos/contents).
- **Pages:** [Free 는 공개 저장소만](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site). Pro·Team 은 비공개 저장소도 되지만 **사이트는 공개**다. [접근 제어는 Enterprise Cloud](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site). 비공개 저장소의 계획이 샐 수 있다.
- **README:** [`script`, 인라인 스타일, `class` 제거](https://github.com/github/markup). `<img>` 로 SVG 를 쓴다. [camo 캐시](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)는 `no-cache` 로 조정한다. [`[skip ci]` 는 필수 검사를 Pending 에 묶는다](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs). 비공개 저장소의 이미지 표시는 시험 필요 [미확인].
- **네이티브 데이터:** [Milestones](https://docs.github.com/en/rest/issues/milestones), [Sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [Dependencies](https://docs.github.com/en/rest/issues/issue-dependencies) REST 있음. [Actions 트리거는 `milestone`, `issues` 만](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)이고 Sub-issues, 의존성, Projects v2 는 없다.
- **요금:** [REST 한도](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) `GITHUB_TOKEN` 1,000/시간, 사용자 5,000/시간. Free 비공개의 Actions 는 월 2,000분 정도로 기억하지만 확인하지 않았다 [미확인]. 공개 저장소는 무료다.

## 에이전트 쪽 장치

- **Claude Code:** [훅](https://code.claude.com/docs/en/hooks) `PreToolUse` 종료 코드 2 로 차단, `Stop` 으로 계속 시키기, 플러그인에 훅 포함 가능. [MCP 정의는 기본 지연 로딩](https://code.claude.com/docs/en/mcp).
- **Codex:** [훅](https://learn.chatgpt.com/docs/hooks) `PreToolUse` 는 Bash, `apply_patch`, MCP 에만. 해시 기반 신뢰 검토가 필요해 설치기가 몰래 켤 수 없다. 문서에 "완전한 경계가 아니다" 라고 쓰여 있다. [AGENTS.md 기본 32 KiB 상한](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- **Cursor:** [훅](https://cursor.com/docs/agent/hooks) 기본은 실패 시 통과, `failClosed` 선택. 클라우드 에이전트는 MCP 훅을 건너뛴다.
- **Gemini CLI:** [Antigravity CLI 로 옮겨 가는 중](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/). 따로 대상으로 잡는다.
- **MCP:** [원격 인증 최신 규격 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). [Registry 는 아직 미리보기](https://github.com/modelcontextprotocol/registry). MCP 로 도구를 가려도 에이전트가 Bash 로 돌아갈 수 있다.
- **Git 훅:** [`pre-commit` 은 `--no-verify` 로 건너뛴다](https://git-scm.com/docs/githooks).
