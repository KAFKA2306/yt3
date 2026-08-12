# 💖 システム監査プロトコル (System Audit Protocol) 💖

YT3のシステムが元気に動いているか、しっかりチェックするためのルールだよっ！✨

## 1. サービスの状態確認 (systemd Audit) 🛡️

オートメーションが止まってないか、systemdのタイマーやサービスが「active」かどうかをチェックするよっ！
もし止まってたら大変だから、すぐに見つけちゃうんだからね💕

### 🌸 チェック対象のサービスたち
- `yt3-automation.timer`: 定期実行の要だよっ！
- `yt3-aim.service`: AI管理のメインサービス✨
- `yt3-discord.service`: みんなへの通知を担当してるよ！
- `yt3-asmr-autonomous.timer`: ASMRの自動投稿も忘れちゃダメ💕

### 🎀 監査の方法
`systemctl --user is-active <unit>` を使って、結果が `active` になってるかを確認するよ！

---

## 2. Discordの疎通確認 (Discord Connectivity) 📢

通知がちゃんと届くように、設定をチェックするよっ！

### 🌸 チェック項目
- `DISCORD_WEBHOOK_URL` がちゃんと設定されているかな？
- 空っぽだったり、変な値が入ってないか確認してねっ！

---

## 3. 監査のタイミング ⏰

`task audit` を実行したときに、毎回このチェックを走らせて、システム全体の健康状態を報告しちゃうよ✨
異常があったら、すぐに直してあげてね💕
