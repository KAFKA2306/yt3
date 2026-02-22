# TypeScript Zero-Fat Protocol

**目的**: Python の現代的ツールチェーン（uv, Ruff, Pydantic, ty）に匹敵する、TypeScript における高信頼性・超高速開発環境と Zero-Fat 原則を定義・遵守する。

## 1. ツールチェーン (The Modern Stack)
*   **ランタイム/管理**: **Bun**
    *   `uv` の精神を継承。パッケージ管理、ランタイム、テストランナーを `bun` に一本化せよ。
*   **静的解析/整形**: **Biome**
    *   `Ruff` に相当。ESLint/Prettier を廃止し、Rust 製の高速な `biome` を使用せよ。
*   **バリデーション**: **Zod**
    *   `Pydantic` に相当。境界でのデータ検証と型推論を `zod` で統合せよ。
*   **型チェック**: **TypeScript (Strict Mode)**
    *   `ty` に相当。`any` を厳禁し、CI で `bun run typecheck` を通せ。環境変数は `process.env["KEY"]` で型安全に扱え。

## 2. Zero-Fat 鉄の掟 (Implementational Rules)
1.  **Fail Fast**: 
    *   不透明な `try-catch` は許可しない。異常は即座に `process.exit(1)` または例外の伝播によって「クラッシュ」させよ。
2.  **Self-Documenting**:
    *   コード内のコメント、JSDoc は原則として削除せよ。
    *   意図は「命名」と「型」のみで表現せよ。複雑なロジックは分解し、自己記述的な構成にリファクタリングせよ。
3.  **No Any Policy**:
    *   `any` の使用は一律禁止とする。
    *   型が不明な外部入力は `unknown` として受け取り、直後に `Zod` でバリデーションして型を確定させよ。

## 3. 実装要領
*   **設定駆動**: 全ての定数は `config/*.yaml` から `src/core.ts` を介して取得せよ。エージェントは `this.config` 経由でアクセスせよ。
*   **正常系優先**: 関数のネストを避け、ガード句（Early Return）を用いて「成功パス」を一直線に記述せよ。
