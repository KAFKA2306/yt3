# Gemini活用 (鉄の掟)

**目的**: `gemini-3.0-flash-preview` を最大限に活用し、コンテキストとコストを最適化する。

## 鉄の掟 (Rules)

1.  **暗黙的キャッシュの活用 (Implicit Caching)**:
    -   静的コンテンツ（システムプロンプト、知識ベース）は必ず**先頭**に配置せよ。
    -   `prompts/*.yaml` で共通の `systemInstruction` 構造を維持し、キャッシュヒット率を高めよ。

2.  **シングルトン利用 (Singleton)**:
    -   `GoogleGenerativeAI` クラスを直接インスタンス化するな。
    -   必ず `src/core.ts` の `createLlm()` を使用せよ (`config` と `API_KEY` 管理のため)。

3.  **JSONモード (Structured Output)**:
    -   構造化データが必要な場合は、必ず `generationConfig: { responseMimeType: "application/json" }` を指定せよ。
    -   レスポンスのパースには `src/core.ts` の `parseLlmJson` を使用せよ。

4.  **Fail Fast**:
    -   安全フィルター等で拒否された場合、リトライ地獄に陥るな。ログを出力して即座にスキップせよ。
