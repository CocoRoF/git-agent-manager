# git-agent-manager

<!-- gam:start -->
[![계획 진행도](https://raw.githubusercontent.com/CocoRoF/git-agent-manager/refs/gam/status/status.svg)](https://cocorof.github.io/git-agent-manager/#/CocoRoF/git-agent-manager)
<!-- gam:end -->

한 번 연결하면, 저장소에서 일하는 코딩 에이전트가 마일스톤 계획을 따르고 진행 상황이 대시보드에 저절로 나타납니다.

[English](README.md)

새로 배울 것도, 저장소에 늘어나는 것도 없습니다.

- **마일스톤은 GitHub Milestone 이고 작업은 GitHub Issue 입니다.** 새 브랜치, 파일 형식, DB, 계정이 없습니다. 이미 마일스톤을 쓰는 저장소는 바로 동작합니다.
- **상태는 저장하지 않고 계산합니다.** 브랜치가 있으면 진행 중, 열린 PR 이 있으면 리뷰 중, 병합된 PR 로 닫혔으면 완료입니다. 어긋날 일이 없습니다.
- **늘 쓰던 화면에서 끼어듭니다.** 휴대폰으로 이슈 순서를 바꾸거나 댓글을 달면 에이전트가 다음 호출에서 봅니다.
- **지워도 평범한 이슈와 마일스톤만 남습니다.**

## 시작하기

GitHub 저장소 폴더에서 (Node 20 이상):

```bash
npx github:CocoRoF/git-agent-manager
```

이것으로 끝입니다. 이 명령은

1. Claude Code, Codex, Cursor, Gemini 가 있으면 연결합니다. 기계 단위라서 이후 모든 저장소에서 동작합니다.
2. 이미 있는 GitHub 로그인을 씁니다 (`GITHUB_TOKEN`, `gh`, git 자격 증명).
3. Codex 와 Gemini 의 전역 안내 파일에 짧은 블록을, Claude Code 에 작은 훅 둘을 추가합니다. 저장소는 건드리지 않고, 그 파일에 쓰신 내용도 그대로 둡니다.
4. README 진행도 카드와 카드를 최신으로 유지하는 작은 워크플로를 PR 로 제안합니다. 거절해도 됩니다.

그다음에는 에이전트에게 원하는 것을 말하면 됩니다.

> 이 저장소에 결제 시스템을 넣는 계획을 세우고 시작해 줘.

## 안건

한 문장으로 목표를 던집니다.

```bash
gam agenda "경쟁사 3곳을 분석해서 다음 분기 가격 전략을 제안해 줘"
```

다음에 현황을 확인하는 에이전트가 이것을 마일스톤과 작업으로 나눕니다. 역할(`role:*` 라벨과 `GAM_ROLE` 변수)을 쓰면 여러 에이전트가 각자 맡을 일을 가져가고, 같은 파일을 건드리면 경고를 받습니다. 마일스톤이 모두 닫히면 안건도 저절로 닫힙니다.

## 설정

전부 선택 사항이고 `.github/gam.yml` 에 씁니다.

```yaml
approval: required  # 에이전트가 만든 작업은 사람이 "proposed" 라벨을 뗄 때까지 대기
merge: agent        # 검사를 통과하면 gam_finish 가 PR 을 병합할 수 있음
```

자세한 내용은 [영문 README](README.md) 를 보세요. 설계는 [docs/PLAN.md](docs/PLAN.md) 에 있습니다.

## 라이선스

[Apache 2.0](LICENSE)
