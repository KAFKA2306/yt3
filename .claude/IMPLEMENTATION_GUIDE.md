# タイトル類似性 - 実装ガイド

## ✅ 完了：config/default.yaml 修正

### 変更内容：
1. **`content.one_shot.system`** に「タイトル多様性の強制」ルールを追加
2. **`content.one_shot.user_template`** に `{recent_titles}` プレースホルダーを追加
3. **`outline.system`** に「タイトル生成の多様性」指示を強化
4. **`outline.user_template`** に `{recent_titles}` プレースホルダーを追加

## 🔧 次のステップ：コード側の実装

### **必要な処理：**

コンテンツ生成時に、過去7日のタイトル一覧を取得して、プロンプト内の `{recent_titles}` プレースホルダーに挿入する。

```typescript
// 擬似コード（実装パターン）
const recentTitles = await fetchRecentTitles(7); // 過去7日のタイトル
const formattedTitles = recentTitles
  .map((title, i) => `${i+1}. ${title}`)
  .join('\n');

const prompt = userTemplate.replace(
  '{recent_titles}',
  `【直近7日間のタイトル一覧（これらは避ける）】\n${formattedTitles}`
);
```

### **ファイルの探索：**

実装箇所は以下のいずれかにあるはず：
- `src/` ディレクトリ内で「user_template」や「strategy」を処理するファイル
- YouTubeコンテンツ生成パイプラインの「content」ステップ処理
- プロンプト埋め込みロジック

### **実装チェックリスト：**

- [ ] 1. **`fetchRecentTitles()` 関数を実装**
  - `runs/` ディレクトリから最新7日分の `content/output.yaml` を読み込む
  - 各ファイルから `script.title` を抽出
  - 日付が新しい順に返す

- [ ] 2. **プロンプト埋め込みロジックを追加**
  - content生成前に過去タイトルを取得
  - `{recent_titles}` プレースホルダーを置換
  - outline生成時にも同じ処理を追加

- [ ] 3. **テスト実行**
  - 実際に動画を1本生成して、タイトルが過去のものと異なるか確認
  - 3日連続で実行して、毎日異なるパターンか確認

---

## 💡 補足：短期的な回避策

もし上記の実装が難しい場合の一時的な対策：

```yaml
# config/default.yaml に直接過去タイトルを埋め込む
prompts:
  content:
    one_shot:
      system: |
        ...

        【直近7日間のタイトル（これらは避ける）】
        1. 金利の時代から「歩留まり」の時代へ：米CPI 2.1%とTSMC 2nm量産が告げる世界経済の構造転換
        2. 「金利の支配」が終わる日：NVIDIAが告げたAI新大陸の開拓と、物理的限界の衝突
        3. 「2nmの衝撃」と金利の停滞：AIバブルが物理的現実に衝突する2026年の転換点
        ...
```

毎日手動更新する必要がありますが、即座に効果が出ます。

---

## 📊 期待される効果

### **修正前（現在）：**
- 7日間で7個のタイトルすべてが「構文形式」と「語彙」で被っている
- ユーザーが「毎日同じテーマに見える」と感じる

### **修正後（期待値）：**
- 同じニューステーマでも「異なるアプローチ」でタイトル付与
- 例：
  - Day 1: 「A という現象が起きている事実」（疑問形）
  - Day 2: 「A と B の関係を再発見」（対比形）
  - Day 3: 「A から導かれる新しい投資機会」（予測形）

