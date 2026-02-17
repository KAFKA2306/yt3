---
description: Git操作（ステータス確認、追加、コミット、プッシュ）
---
# /git — Git操作

変更をリポジトリへ一括反映する儀式。

## 手順

// turbo-all

1. `git status` で変更を確認。
2. `git add -A` で全変更をステージング。
3. `git commit -m "feat: [概要]"` でコミット。
4. `git push` を実行。
5. `gh run list` でCIの状態を確認。