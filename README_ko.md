# git-agent-manager

<!-- gam:start -->
[![계획 진행도](https://raw.githubusercontent.com/CocoRoF/git-agent-manager/refs/gam/status/status.svg)](https://cocorof.github.io/git-agent-manager/)
<!-- gam:end -->

한 번 연결하면, 저장소에서 일하는 코딩 에이전트가 마일스톤 계획을 따르고 진행 상황이 대시보드에 저절로 나타납니다.

[English](README.md)

새로 배울 것도, 저장소에 늘어나는 것도 없습니다.

- **마일스톤은 GitHub Milestone 이고 작업은 GitHub Issue 입니다.** 새 브랜치, 파일 형식, DB, 계정이 없습니다. 이미 마일스톤을 쓰는 저장소는 바로 동작합니다.
- **상태는 저장하지 않고 계산합니다.** 브랜치가 있으면 진행 중, 열린 PR 이 있으면 리뷰 중, 병합된 PR 로 닫혔으면 완료입니다. 어긋날 일이 없습니다.
- **늘 쓰던 화면에서 끼어듭니다.** 휴대폰으로 이슈 순서를 바꾸거나 댓글을 달면 에이전트가 다음 호출에서 봅니다.
- **지워도 평범한 이슈와 마일스톤만 남습니다.**

## 시작하기

GitHub 저장소 폴더 안에서 (Node 20 이상):

```bash
npx git-agent-manager
```

한 번에 저장소 하나만 연결하고, 저장소 폴더가 아니면 실행되지 않습니다. 이 명령은

1. 이미 있는 GitHub 로그인을 쓰고 (`GITHUB_TOKEN`, `gh`, git 자격 증명), 저장소에 쓸 권한이 있는지 확인합니다.
2. 이 폴더의 Claude Code 를 바로 연결합니다.
3. 저장소에서 일하는 모든 에이전트를 연결하는 PR 을 하나 엽니다. Claude Code 용 `.mcp.json`, Codex 용 `.codex/config.toml`, Codex·Cursor 등이 읽는 `AGENTS.md` 안내, README 진행도 카드, 그리고 대시보드를 **그 저장소의 GitHub Pages** 에 올리는 워크플로입니다.

그다음에는 에이전트에게 원하는 것을 말하면 됩니다.

> 이 저장소에 결제 시스템을 넣는 계획을 세우고 시작해 줘.

## 대시보드

대시보드는 저장소마다 자기 것입니다. 그 저장소의 GitHub Pages (`https://<owner>.github.io/<repo>/`) 나, Pages 설정에 연결한 자기 도메인에서 열리고, 그 저장소만 보여 줍니다.

- 저장소가 이미 다른 용도로 Pages 를 쓰고 있으면 건드리지 않습니다. `gam site <폴더>` 로 만들어 원하는 곳에 올리고 `.github/gam.yml` 에 `dashboard: <주소>` 를 적으면 됩니다.
- `gam site <폴더> --repos 나/a,나/b` 로 여러 저장소를 한 페이지에 모아 자기 도메인에 올릴 수 있습니다.
- 비공개 저장소는 공개 대시보드를 만들지 않습니다. `gam dashboard` 로 로컬 HTML 파일을 만들거나, `gam site` 결과를 나만 볼 수 있는 곳에 올리세요.

## 안건

한 문장으로 목표를 던집니다.

```bash
gam agenda "경쟁사 3곳을 분석해서 다음 분기 가격 전략을 제안해 줘"
```

다음에 현황을 확인하는 에이전트가 이것을 마일스톤과 작업으로 나눕니다. 역할(`role:*` 라벨과 `GAM_ROLE` 변수)을 쓰면 여러 에이전트가 각자 맡을 일을 가져가고, 같은 파일을 건드리면 경고를 받습니다. 마일스톤이 모두 닫히면 안건도 저절로 닫힙니다.

## 설정

전부 선택 사항이고 `.github/gam.yml` 에 씁니다.

```yaml
approval: required                      # 에이전트가 만든 작업은 사람이 "proposed" 라벨을 뗄 때까지 대기
merge: agent                            # 검사를 통과하면 gam_finish 가 PR 을 병합할 수 있음
dashboard: https://plan.example.com/    # 대시보드 링크가 가리킬 주소
```

자세한 내용은 [영문 README](README.md) 를 보세요. 설계는 [docs/PLAN.md](docs/PLAN.md) 에 있습니다.

## 라이선스

[Apache 2.0](LICENSE)
