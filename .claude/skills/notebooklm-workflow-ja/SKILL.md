---
name: notebooklm-workflow-ja
description: NotebookLM ワークフロー統合パターン - ノートブック管理、動画生成、YouTube 投稿自動化
version: 1.0.0
source: local-git-analysis
analyzed_commits: 50
tags:
  - notebooklm
  - video-generation
  - workflow-automation
  - youtube-publishing
---

# NotebookLM ワークフロー統合ガイド

## 概要

YT3 システムで NotebookLM を統合して、自動的にビデオを生成し YouTube に投稿するワークフロー。

## ディレクトリ構造

```
runs-nlm/
├── {notebook_title}/
│   └── videos/
│       ├── {video_title_1}.mp4
│       └── {video_title_2}.mp4
```

**重要:** 各ノートブックが独立した `runs-nlm/{notebook_title}/` ディレクトリを持つ。

## NotebookLMAgent パターン

### 1. ノートブック情報の取得

```typescript
// notebooklm list --json でキャッシュ化
private notebookCache: Array<{ id: string; title?: string }> | null = null;

private getNotebookInfo(notebookId: string) {
  if (!this.notebookCache) {
    const output = execSync("notebooklm list --json", { encoding: "utf-8" });
    this.notebookCache = JSON.parse(output);
  }
  return this.notebookCache.find(nb => nb.id === notebookId);
}
```

### 2. 動画生成フロー

```typescript
// Step 1: ノートブック選択
this.executeNotebooklmCommand(`use ${notebookId}`);

// Step 2: 動画生成（--wait で完了を待つ）
this.executeNotebooklmCommand(
  `generate video --wait --style whiteboard`
);

// Step 3: 出力ディレクトリ準備
const dirName = this.sanitizeFileName(notebookInfo.title);
const outputDir = path.join(this.store.runDir, "runs-nlm", dirName, "videos");
await fs.ensureDir(outputDir);

// Step 4: 動画ダウンロード
const videoPath = path.join(outputDir, `${videoTitle}.mp4`);
this.executeNotebooklmCommand(`download video "${videoPath}" --latest --force`);
```

### 3. ファイル名のサニタイズ

```typescript
private sanitizeFileName(title: string): string {
  return title
    .replace(/[\\/\:*?"<>|]/g, "_")  // 特殊文字を削除
    .replace(/\s+/g, "_")             // スペースを置換
    .replace(/_+/g, "_")              // 連続アンダースコアを統一
    .replace(/_+$/, "")               // 末尾のアンダースコア削除
    .toLowerCase()
    .slice(0, 200);                   // 長さ制限
}
```

## config/default.yaml 設定

```yaml
agents:
  notebooklm:
    enabled: true
    video_style: "whiteboard"
    output_dir: "runs-nlm"  # Single Source of Truth
    temperature: 0.1
    notebook_ids: []
```

## テストパターン

### NotebookLMAgent テスト

```typescript
describe("NotebookLMAgent", () => {
  // テスト: 単一ノートブック処理
  test("should execute commands in correct sequence", async () => {
    const result = await agent.run(["abc123"]);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].video_path).toMatch(/runs-nlm\/.*\/videos\/.*\.mp4/);
  });

  // テスト: ファイル名サニタイズ
  test("should sanitize notebook titles with special characters", () => {
    const sanitized = agent["sanitizeFileName"]("My Report (2026)");
    expect(sanitized).toBe("my_report_2026");
  });

  // テスト: ノートブック未発見
  test("should throw error when notebook not found", async () => {
    await expect(agent.run(["nonexistent"])).rejects.toThrow();
  });
});
```

## コミットパターン

### タイプ別コミットメッセージ

| タイプ | 説明 | 例 |
|--------|------|-----|
| `feat:` | 新機能追加 | `feat: add batch publishing script for NotebookLM videos` |
| `refactor:` | ディレクトリ構造変更 | `refactor: NotebookLMAgent to use runs-nlm/ structure` |
| `fix:` | バグ修正 | `fix: resolve type errors in NotebookLMAgent` |

## NotebookLMAgent 実装チェックリスト

- [ ] `notebooklm list --json` でノートブック一覧をキャッシュ
- [ ] `notebookInfo.title` からディレクトリ名を生成
- [ ] `sanitizeFileName()` で特殊文字を削除
- [ ] 出力パスを `runs-nlm/{dirName}/videos/` に設定
- [ ] `--wait` オプションで動画生成完了を待つ
- [ ] エラーハンドリング: ノートブック未発見時に即座に throw
- [ ] TypeScript strict モード: `any` 型禁止
- [ ] テスト: ディレクトリ構造検証を含む

## YouTube 投稿への次のステップ

```typescript
// 生成されたビデオをメタデータと共に保持
interface NotebookVideo {
  notebook_id: string;
  notebook_title: string;
  video_path: string;      // runs-nlm/{title}/videos/{name}.mp4
  generated_at: string;
}

// 後続: YouTubePublisherAgent で処理
const videos = await notebooklmAgent.run(notebook_ids);
await youtubeAgent.publish(videos);  // 実装予定
```

## 単一の真実源 (Single Source of Truth)

- **設定:** `config/default.yaml` の `agents.notebooklm.*`
- **出力ディレクトリ:** `runs-nlm/` (ハードコード禁止)
- **ノートブックメタデータ:** NotebookLM の `list --json` から取得

設定を変更すれば、全体の動作が自動的に変わる設計。

## トラブルシューティング

### ノートブックが見つからない

```bash
notebooklm list --json | jq '.[] | .id, .title'
```

### 動画ダウンロード失敗

```bash
notebooklm use <notebook_id>
notebooklm generate video --wait --style whiteboard
notebooklm download video ./test.mp4 --latest --force
```

### パス構造の確認

```bash
find runs-nlm -type f -name "*.mp4" | head -10
```
