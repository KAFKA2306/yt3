---
description: git add, commit, push, and gh runs
---
# Git ワークフロー (Git Workflow)

## 1. 状態確認・履歴 (Status & Log)
// turbo
1. リポジトリの状態を確認:
```bash
git status
```
// turbo
2. 直近のコミット履歴を確認:
```bash
git log -n 5 --oneline
```

## 2. 変更の検証 (Ship / Verify)
// turbo
1. 型チェックと Lint を実行:
```bash
task lint
```

## 3. 保存と同期 (Save & Sync)
// turbo
1. すべての変更をステージング:
```bash
git add -A
```
// turbo
2. コミットを実行:
```bash
git commit -m "[type]: [description]"
```
// turbo
3. リモートへプッシュ:
```bash
git push origin $(git branch --show-current)
```

## 4. GitHub Actions 確認 (CI Status)
// turbo
1. CI 実行状況の監視:
```bash
gh runs list -L 5 --watch
```

## 5. 管理ツール (Maintenance)
- `git branch -v`: ブランチ一覧
- `git pull origin $(git branch --show-current)`: 最新情報の取得
