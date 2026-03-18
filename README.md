# 🎬 きらきら動画メーカー yt3 ✨

<div align="center">

**AIさんたちが がんばって おかねの動画を つくってくれるよ！💰✨**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Workflow-00a67e?style=flat-square)](https://langchain-ai.github.io/langgraphjs/)
[![Gemini](https://img.shields.io/badge/Gemini-LLM-4285f4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)

</div>

---

## ⚡ はじめかた (｡•̀ᴗ-)✧

これだけで、きれいな動画が できちゃうよ！

```bash
task bootstrap            # おともだち（依存関係）を よんでくるよ！
task run -- "FOMC 金利"   # すきなテーマで 動画をつくろう！🚀
```

## 🛠️ まほうのコマンド ✨

```
task run      │ ワークフローを しゅっぱつ！
task lint     │ おかしなところが ないかチェック！
task test     │ ちゃんと動くか テストするよ！
task up       │ みんなを 起こしてあげるよ！ (Voicevoxとか)
task down     │ おやすみなさいの じかん！
task status   │ みんな 元気かな？
```

## 🧪 テストとルール (๑•̀ㅂ•́)و✧

**「ぜったいあんぜん」せんりゃく！**:
へんな お金が かかったりしないように、しっかり がーど してるよ！
- **LLMは おやすみ**: `SKIP_LLM=true` で、むかしのデータを つかって テストするよ！
- **かってに投稿しない**: `DRY_RUN=true` だから、YouTubeとかには 内緒だよ！🤫

### ローカルでの つかいかた
```bash
task test    # はやく、あんぜんに テスト！✨
```

### なにを テストしてるの？
1.  **だいじなところ** (`src/core.ts`):
    *   せっていが ちゃんと よみこめるかな？
    *   AIの おへんじが きれいかな？
    *   ファイルが ちゃんと よめるかな？
2.  **エージェントさん** (`src/agents/research.ts`):
    *   **リサーチ**: ほんものの データがなくても、ちゃんと 動くか かくにんするよ！

## 📁 おへやの 紹介 🏠

```
src/
├── agents/    → はたらきものの エージェントさんたち！
├── graph.ts   → どういう順番で すすむかな？
├── state.ts   → みんなの 今の状態だよ！
└── index.ts   → ぜんぶの はじまり！✨

scripts/       → じどうくんたち！
config/        → だいじな 設定ファイル！
prompts/       → AIさんへの おねがいごと！
runs/          → できたもの！🎁
```

## 📐 なかの しくみ ⚙️

もっと くわしく しりたいときは、ここを みてね！

---

---

<div align="center">
<sub>LangGraph.js • Gemini • Voicevox • FFmpeg で つくったよ！🎀</sub>
</div>
