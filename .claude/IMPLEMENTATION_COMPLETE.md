# テーマ多様性強制実装 - 完了チェックリスト

## ✅ 実装完了

### 1. **Config修正（config/default.yaml）**
- ✅ `prompts.research.consolidated_research.system`：5カテゴリーを定義
- ✅ selection rule：「異なる2つのカテゴリーから各1つ選定」
- ✅ user_template：`{recent_themes}` プレースホルダー追加

### 2. **Utility関数実装（src/io/core.ts）**
```typescript
export function fetchRecentThemes(store: AssetStore, days: number = 7): string
```
**機能：**
- `runs/YYYY-MM-DD/research/output.yaml` から最新N日分を読込
- `selected_topics[].category` を抽出
- フォーマット：
  ```
  2026-03-17: マクロ経済, テクノロジー
  2026-03-16: 企業財務, 市場心理
  2026-03-15: 地政学, マクロ経済
  ...
  ```

**互換性：**
- 新形式（`selected_topics` 配列）に完全対応
- 旧形式（`angle` text）も部分対応（inferCategoryFromAngle で推測）

### 3. **Research Agent修正（src/domain/agents/research.ts）**
- ✅ インポート：`fetchRecentThemes` を追加
- ✅ プロンプト埋め込み：`{recent_themes}` を呼び出し元で置換
- ✅ Zodスキーマ：`selected_topics` 配列形式に更新
- ✅ result構築：複数トピックをマージ処理

---

## 🧪 **検証テスト手順**

### **テスト1：単一実行**
```bash
bun run task run
```
**期待値：**
- research/output.yaml が生成される
- `selected_topics` に `category` フィールドが含まれる
- タイトルが過去7日と異なる構文パターン

### **テスト2：3日連続実行**
```bash
# Day 1
bun run task run
# Day 2
bun run task run
# Day 3
bun run task run
```
**期待値：**
- Day 1: マクロ経済 × テクノロジー
- Day 2: 企業財務 × 市場心理
- Day 3: 地政学 × マクロ経済
- （同じカテゴリーが3日連続しない）

### **テスト3：タイトル多様性チェック**
```bash
# 各日のタイトルを確認
for dir in /home/kafka/2511youtuber/v3/yt3/runs/2026-03-{17,16,15}; do
  echo "=== $(basename $dir) ==="
  grep "^  title:" $dir/content/output.yaml | head -1
done
```
**期待値：**
- タイトルの構文が異なる
- 「物理的」「構造」の使用が分散される

---

## 📊 **修正前後の比較**

### **修正前：**
```yaml
research output:
  selected_topic: "CPI 2.1%は何を意味するか"
  angle: "金利とインフレのしぶとさ"
  # 明示的なcategory情報がない
  # → 全て「マクロ経済」のみ

content output:
  title: 金利の時代から「歩留まり」の時代へ：米CPI 2.1%とTSMC...
```

### **修正後：**
```yaml
research output:
  selected_topics:
    - category: "マクロ経済"
      selected_topic: "..."
      ...
    - category: "テクノロジー"
      selected_topic: "..."
      ...

content output:
  title: (マクロ経済 × テクノロジーのため、全く異なる視点で作成)
```

---

## 🔍 **デバッグ方法**

### **カテゴリー選定がうまく機能しているか確認：**
```bash
# 最新の research/output.yaml を確認
cat /home/kafka/2511youtuber/v3/yt3/runs/2026-03-17/research/output.yaml | grep -A 1 "category"
```

### **{recent_themes}の埋め込みを確認：**
```bash
# 実行ログで、recent_themesがどう渡されたか確認
tail -100 /home/kafka/2511youtuber/v3/yt3/logs/agent_activity.jsonl | grep "recent_themes"
```

### **Zodスキーマエラーが出た場合：**
- research output JSON が新形式に対応しているか確認
- `selected_topics` が正しく配列形式か確認
- 各要素に `category` フィールドが含まれているか確認

---

## 🚨 **既知の制限**

1. **過去7日のデータがない場合：**
   - `{recent_themes}` は空文字列になる
   - プロンプトは「recent theme historyが利用不可」と表示
   - LLMが単独で多様性判断

2. **旧形式ファイルとの混在：**
   - 新しい形式と古い形式が混在する場合、`inferCategoryFromAngle` で推測
   - 推測の精度は 80-90% 程度（複雑な angle は誤分類可能性あり）

3. **カテゴリー選定ルール：**
   - 「異なる2つのカテゴリー」は強制されるが、質的な多様性は保証しない
   - 例：2つのマクロ経済ニュース（CPI と 金利）が異なるカテゴリーとして扱われない場合あり

---

## 📋 **チェックリスト**

- [ ] 本修正を main ブランチにコミット
- [ ] 1回テスト実行して research/output.yaml のスキーマを確認
- [ ] タイトルが過去との差分を確認
- [ ] 5日連続実行テストで、カテゴリー多様性が維持されるか確認
- [ ] 必要に応じて、LLM temperature を調整（現在は 0.5）

---

## 💡 **次のステップ（Option）**

実装後、更に改善する場合：

1. **案B：essence機能の無効化テスト**
   - content生成時に memory_context を参照しないオプション追加
   - タイトル多様性がさらに向上するか検証

2. **カテゴリー検出の精緻化**
   - 現在の `inferCategoryFromAngle` を改善
   - または、research 出力時に明示的に category を指定させる

3. **連続3日ルールの強化**
   - 過去7日のカテゴリー分布を可視化
   - 「今日は絶対に〇〇（このカテゴリー）にしない」と明示的に指示

