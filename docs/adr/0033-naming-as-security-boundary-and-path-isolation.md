# ADR 0033: Naming as Security Boundary & Deterministic Path Isolation

## 📝 プロベナンス表示 (Claim Provenance)
- **VERIFIED**: Humanity Observatory の制作過程で、`default.yaml` や `latest` フォルダへの依存が原因でドメイン汚染（秒算マネーの設定漏洩）が発生した事実を特定。
- **OBSERVED**: ユーザーメモリにて「名前による誤認」を強く嫌う傾向、およびトップレベルからの物理的隔離を好む指向を確認。
- **INFERRED**: ドメイン境界を人間が「意識」するのではなく、パスや名前そのものに「機械的に誤認不可能な属性」を持たせることで、ゼロトラストな実行環境を構築できる。

## 状態
決定済み（Accepted）

## 文脈
「命名は装飾ではなく、境界である。」
現状のパス構成や設定管理は、暗黙的な継承（Implicit Inheritance）や曖昧な命名（`shared`, `latest`, `output`）を許容しており、これがドメイン間の設定漏洩の根本原因となっている。本 ADR は、名前からドメインを特定できない状態を「汚染」と定義し、機械的に監査可能な境界ルールを確立する。

## 決定事項

### 1. 命名境界の鉄則 (The Supreme Rule)
**「パス単体からドメインIDを特定できない場合、そのシステムは既に汚染されている。」**
これを監査項目 `14. Naming Boundary Audit` および `15. Path Isolation Audit` として実装する。

### 2. 禁止語彙と隔離構造
ドメイン境界を曖昧にする以下の用語を、ディレクトリ名、ID、ファイル名から完全に排除する。
- **禁止表現**: `shared`, `common`, `misc`, `tmp`, `default`, `latest`, `test`, `final`, `new`, `output`, `run`, `build`
- **推奨構造**: 常に `top-level/domain_id/identifier` 形式を強制する。
  - ✅ `runs/humanity_observatory/2026-05-17-predictive-coding`
  - ❌ `runs/2026-05-17-final`
  - ❌ `runs/latest`

### 3. 監査ルール (Naming Audit Rules)
| ID | ルール内容 |
| :--- | :--- |
| **NAME-001** | パス単体で `domain_id` を特定可能であること |
| **NAME-002** | ファイル名単体で `artifact_type` を特定可能であること |
| **NAME-003** | `run_id` に必ず `domain_id` プレフィックスを含むこと |
| **NAME-004** | 監査レポート名に `domain_id` を含むこと |
| **NAME-005** | コンフィグファイル名がドメインごとに一意であること |
| **NAME-CROSS-001** | ファイルパスの `domain_id` と、内部メタデータの `domain_id` が完全一致すること |
| **NAME-CROSS-004** | サムネイルファイル名と、埋め込まれたメタデータが一致すること |

### 4. 暗黙継承の禁止 (No Implicit Inheritance)
- `default.yaml` による「勝手なマージ」を廃止する。
- 実行時は必ず「明示的な domain_id」「明示的な config path」の指定を必須とする。
- 一致しない場合は `DomainIdentityMismatchError` を投げ、プロセスを即座に爆発（Crash-Driven）させる。

## 帰結
- **利点**:
  - 設定の混入が物理的に不可能になる。
  - 監査エージェントが、メタデータを見ずともパスの文字列だけで「正しさ」を 100% 検証可能になる。
- **代償**:
  - `latest` などの便利なエイリアスが使えなくなり、常にフルパスまたは正確な ID 指定が求められる。
  - 既存の「共通設定」をドメイン別ファイルへ物理的に分割するコストが発生する。
