# 夜話アーカイブ ASMR ワークフロー（標準）

## 概要
本文書は、夜話アーカイブ ASMR の標準工程を定義する。
作るのは「ASMR作品」ではなく、「録音されてしまった深夜」を記録するログである。

## 17 工程
1. **Idea**: 生活の断面だけを決める。ASMR行為ではなく状況を先に決める。
2. **Research**: DLsite、YouTube、Reddit、コメント欄を観測し、強いタグとAI臭を拾う。
3. **Scenario**: なぜ録音されたかを決める。時間、温度、距離、光、外音、関係を固定する。
4. **Script**: `script_master.md` を書く。短文、言い淀み、沈黙、呼吸、ノイズを優先する。
5. **VoiceDesign**: Irodori-TTS 用の caption を作る。状況、喉、距離、息、疲労、温度で詰める。
6. **TTS**: `uv run python infer.py` で生成する。`seed` は固定し、`num-steps` は 8-12 を基準にする。
7. **ASR QA**: `faster-whisper` と VAD で逆文字起こしし、意味反転や collapse を点検する。
8. **Sound Design**: 雨、布、椅子、生活音、空調、遠い道路を足し、「録れてしまった感」を出す。
9. **Thumbnail**: 不完全な構図、生活感、非対称、自然な実在感を優先する。
10. **Metadata**: title / description / tags を作る。タイトルは状況と音を短く結ぶ。
11. **Render**: `ffmpeg` で `final_video.mp4` を組む。
12. **Upload (private)**: `ENV_FILE=config/.env.yawa` を使い、非公開で上げる。
13. **Audit**: `videos.list` で duration、title、thumbnail、status を実測確認する。
14. **Metadata Fix**: 実測時間に合わせて title / description / tags を修正する。
15. **Dedup**: 同一タイトル、同一尺、同一サムネ、同一説明の重複は private に戻す。
16. **Publish (public)**: QA 通過、metadata 正常、duplicate なしのときだけ公開する。
17. **Archive**: run logs、prompt、caption、seed、ASR report、metadata を保存する。

## 固定ルール
- `ENV_FILE=config/.env.yawa` を使う。
- `privacyStatus` は初期 `private`。
- `videos.delete` は使わない。不要動画は private に戻す。
- `voice caption` は章ごとに変えない。
- `seed` は固定する。
- 実測していない再生時間を書かない。
- テンプレート感、lore 先行、AI っぽい綺麗さは避ける。
