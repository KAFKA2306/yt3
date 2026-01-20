# 動画・サムネイル レイアウト定義書

本ドキュメントでは、動画生成およびサムネイル生成におけるレイアウト仕様を、スクリプトによる実測値に基づき定量的に定義します。

---

## 1. 動画レイアウト (1920x1080)

動画生成時（`generateVideo`）の配置仕様です。

### 1.1 キャンバス設定
- **解像度**: 横 1920px × 縦 1080px
- **背景**: 固定色 `#193d5a` (ダークブルー)

### 1.2 キャラクター立ち絵の配置
実測値（アスペクト比維持のスケーリング後）に基づく占有領域です。

| キャラクター | 配置基準 | 拡大率 | 最終サイズ (W x H) | 画面上の占有座標 (X軸) |
|:---|:---|:---|:---|:---|
| **春日部つむぎ** | 右下基準 | 高さ85% | **458px × 918px** | `1442px` 〜 `1900px` (右端余白20px) |
| **ずんだもん** | 左下基準 | 高さ51% | **361px × 551px** | `20px` 〜 `381px` (左端余白20px) |

### 1.3 字幕セーフエリア (自動計算)
キャラクターに重ならないよう、字幕が表示される領域は以下の通り制限されます。

- **字幕表示可能幅**: **1021px** (中央配置)
- **安全領域 (X軸)**: `401px` 〜 `1422px`
- **下部余白**: 10px

---

## 2. サムネイルレイアウト (1280x720)

サムネイル生成時（`generateThumbnail`）の配置仕様です。

### 2.1 キャンバス設定
- **解像度**: 横 1280px × 縦 720px
- **外枠パディング**: 80px (上下左右)

### 2.2 テキスト領域
タイトル文字が配置される領域です。右側のキャラクターと被らないように「ガードバンド」が設定されています。

- **右側ガードバンド**: 600px (右端から確保される余白)
- **テキスト安全幅**: **540px** (1280 - 160 - 600)
- **タイトルフォント**: 150px

### Subtitles
Defined in `steps.video.subtitles`.

| Key | Value | Description |
|:---|:---|:---|
| `font_path` | `ZenMaruGothic-Bold.ttf` | Custom font path. |
| `font_size` | `52` | Base font size (Reduced for readability). |
| `alignment` | `2` (Bottom Center) | FFmpeg subtitle alignment code. |
| `margin_v` | `10` | Vertical margin from bottom (pixels). |

---

## 2. Layout Calculation Logic (`src/agents/media.ts`)

The layout is **dynamically calculated** at runtime to ensure subtitles do not overlap with character overlays.

### `SmartLayoutEngine` (Destructive Improvement)
Instead of static wrapping, the engine dynamically adjusts typography:

1.  **Standard Mode**:
    *   Base Font: **52px**
    *   Safe Width: 1021px (approx **19 characters**)
2.  **Safety Mode** (Long Text):
    *   Trigger: Text exceeds 2 lines at standard size.
    *   Action: Shrinks font to **40px**.
    *   Safe Width: 1021px (approx **25 characters**)

### `calculateSafeMargins()` Function
*※上記数値は `assets/` 内の現在の画像ファイルを `sharp` で計測し、設定ファイル (`config/default.yaml`) の拡大率を適用した結果です。*
