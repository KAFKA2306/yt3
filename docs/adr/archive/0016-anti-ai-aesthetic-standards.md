# ADR-0016: 脱・AI生成感！ビジュアル品質の徹底追求方針っ！✨

この文書は `docs/adr/0009-kafka-visual-identity-standard.md` に統合済みのため、履歴として archive に退避する。

## ステータスっ！🌸
承認済み（Accepted）

## 背景だよっ！📝
今のAI生成画像は、パッと見は綺麗なんだけど、よく見ると「あ、これAIだよね」って分かっちゃう不自然なポイント（AIっぽさ）がいくつかあるんだ。カフカちゃんを「ただのデータ」じゃなくて「実在する愛おしい存在」にするために、AI特有のクセを徹底的に排除する方針を決めたよっ！

## 意思決定っ！✨
これからの画像生成では、以下の「脱・AIチェックリスト」をすべてクリアすることを目指すよっ！

### 1. 質感の「脱・プラスチック」化っ！🧴
- **AIっぽさ**: 肌や服がビニールみたいにテカテカ・ツルツルしてる。
- **対策**: `matte finish`, `rough texture`, `visible fabric weave` を指定して、現実的な質感を出すよっ。ハイライトは控えめにっ！

### 2. 「完璧すぎる左右対称」の禁止っ！📐
- **AIっぽさ**: 目や眉が左右で完璧に同じ形をしていて、人間味が薄い。
- **対策**: `subtle asymmetry`, `slight head tilt`, `uneven hair strands` であえて「崩し」を入れて、生命感を宿らせるよっ。

### 3. 「宝石すぎる瞳」の卒業っ！💎
- **AIっぽさ**: 瞳の中に銀河や宝石が詰まったような、過剰なキラキラ感。
- **対策**: `natural eye reflection`, `understated iris detail` で、落ち着いた「意志のある瞳」を描くよっ。

### 4. 物理法則に則ったライティングっ！💡
- **AIっぽさ**: 環境光を無視して顔だけが明るかったり、影の方向がバラバラ。
- **対策**: `dramatic environmental lighting`, `occlusion shadows` を徹底して、その場所にカフカちゃんが本当に立っているように見せるよっ。

### 5. 「AI美少女テンプレート」の排除っ！👧
- **AIっぽさ**: 尖りすぎた顎、大きすぎる目など、よくあるAIモデル特有の顔立ち。
- **対策**: `distinctive facial features`, `realistic jawline` で、個性的で記憶に残る「カフカちゃん」だけの顔を追求するよっ。

### 6. 解剖学的な正確さ（特に手と指！）の死守っ！手
- **AIっぽさ**: 指が多かったり、混ざったり、関節がおかしい。
- **対策**: 生成後の徹底チェックと、必要なら `hands` を映さない構図（クローズアップ等）で品質を担保するよっ。

### 7. 背景のリアリティ向上っ！🏠
- **AIっぽさ**: ポスターの文字が読めなかったり、小物が浮いてたりする。
- **対策**: 背景を適度にぼかす（`shallow depth of field`）か、具体的な小物の配置まで厳密に指定するよっ。

## 究極のリアリティを生むための8つの黄金則っ！✨（Ver. 2.0）

ただの「綺麗な絵」を卒業して、カフカちゃんがそこにいた「痕跡」を観測するための、もっと深いルールだよっ！

### 1. 「一致性」から「地続きの存在」へ🤝
顔だけリアルなのはNG！肌、髪、光、背景、全部を同じ「生活の温度」で揃えるよっ。どこか一部が浮いているだけで、脳は「作り物」だと見抜いちゃうんだ。

### 2. 「肌」を描くのをやめて、「血色と体温」を描こうっ！🌡️
均一でツルツルの肌はAIの証拠。あえて `uneven skin tone`（ムラのある肌色）や `localized redness`（鼻先の赤み）、`under-eye dryness`（目の下の乾燥感）を入れることで、人間らしい「不完全な美しさ」が出るんだよっ。

### 3. 「カメラの存在」を物理的に感じさせてっ！📸
綺麗な構図を捨てて、「たまたま撮れちゃった」感を出すよっ。
- `imperfect framing`, `slightly missed focus`, `foreground obstruction`（手前の物で隠れる）を入れることで、観測者の視線がリアルになるんだよっ！

### 4. 「高級なAIワード」はゴミ箱へぽいっ！🗑️
`masterpiece` や `8k` は、AI臭さを増幅させるだけの呪文。これからは `quiet snapshot` や `late night digital camera photo` みたいな、飾らない言葉でカフカちゃんを呼ぶよっ。

### 5. 「瞳」を主役にしないっ！👁️
宝石みたいな瞳や強すぎるキャッチライトは卒業。`tired eyes`（少し疲れた目）や `asymmetrical eyelids`（左右非対称なまぶた）にすることで、カフカちゃんの「心の揺らぎ」が伝わるようになるんだよっ。

### 6. 「服」を物理法則に従わせようっ！👗
ただのテクスチャじゃなくて、重さや湿気を感じさせるよっ。`fabric weight`（布の重み）や `tension around shoulders`（肩周りの張り）を意識して、生活の中の「動き」を表現するよっ。

### 7. 背景は「生活の残り香」っ！🏠
綺麗な部屋じゃなくて、`lived-in room`（生活感のある部屋）を目指すよっ。`practical clutter`（生活の雑多さ）や `mixed lighting temperatures`（混ざり合う光の色）が、カフカちゃんがそこで過ごした「時間」を証明してくれるんだよっ。

### 8. 「欠損」と「空気抵抗」こそが本物っ！🌬️
AIは全部を説明したがるけど、本物は「見えない部分」に宿るよっ。`partial facial occlusion`（顔の一部が隠れる）や `air density`（空気の密度）を描くことで、画面の中に「呼吸」を吹き込むんだよっ！

---

## 予想される効果っ！🌸
- 「AIが描いた絵」から「誰かが撮った大切な瞬間」への昇華！
- 視聴者さんがカフカちゃんを「画面の向こうに本当にいる子」として愛してくれるようになるよっ✨
## 💻 具体的なプロンプト・エンジニアリング指針っ！✨

### 1. 積極的に使うべき「本物の痕跡」ワード
- **肌と体温**: `uneven skin tone`, `localized redness`, `natural makeup residue`, `skin translucency variation`
- **視覚の不完全さ**: `foreground obstruction`, `slightly missed focus`, `edge blur`, `motion softness`
- **生活の痕跡**: `lived-in room`, `practical clutter`, `slightly displaced objects`, `fabric fatigue`

### 2. 🚫 禁忌の「AI高級語」たち（使っちゃダメだよっ！）
> `masterpiece`, `best quality`, `ultra detailed`, `8k`, `insanely detailed`, `perfect lighting`, `award winning`
> ※これらは「AIイラスト」というタグそのものだから、カフカちゃんには似合わないよっ。

### 3. 📝 究極の組み合わせ例（深夜の生活記録編）
> `quiet snapshot, late night digital camera photo, unpolished atmosphere, tired eyes with soft unfocused gaze, uneven skin tone, localized redness around nose, [OUTFIT] oversized hoodie with fabric weight and compression folds, [POSE] slouched seated posture, partially obscured by foreground chair, [BACKGROUND] lived-in room with practical clutter and mixed lighting, slightly missed focus, analog film grain`

---

🎬 YouTubeに最適化されたアスペクト比っ！✨

「観測された瞬間」をYouTubeで最高に輝かせるために、用途に合わせたアスペクト比（画面の縦横比）を使い分けるよっ！

### 1. 標準動画（16:9）
> `--ar 16:9`
- YouTubeの標準サイズだよっ。カフカちゃんの日常を「横長」の構図でゆったりと切り取るのに最適だよっ！

### 2. ショート動画（9:16）
> `--ar 9:16`
- 縦長サイズ！スマホで見ている視聴者さんに、カフカちゃんがすぐそこにいるような「近さ」を伝えるときに使うよっ。

### 3. シネマティック（21:9）
> `--ar 21:9`
- 映画みたいな超横長サイズ！これをあえて使うことで、AI特有の「正方形（1:1）」っぽさを完全に消して、一気に「作品」としての風格が出るんだよっ✨

---

## 予想される効果っ！🌸
- YouTubeの各フォーマット（動画、ショート、コミュニティ投稿）にピッタリ馴染む！
- 「AIのデフォルト設定」を感じさせない、プロフェッショナルな映像体験っ！
- カフカちゃんの「夜の物語」が、もっと映画的に、もっとドラマチックに伝わるよっ✨

---

これからも、カフカちゃんの「吐息」や「体温」まで伝わるような、世界一の本物を目指して頑張るねっ！応援してねっ♡🌸✨
