# QR Talk

PeerJS Cloudの無料PeerServerをシグナリングに使う、音声のみのWebRTCトークアプリです。

## 使い方

1. Bluetoothマイク・スピーカーを端末のOS側で接続します。
2. HTTPSまたはlocalhostで`index.html`を配信します。
3. 1台目で「トークを開始」を押します。
4. 2台目以降で「トークに参加」を押し、表示されたQRコードを読み取ります。

## ローカル起動

```sh
python3 -m http.server 5173
```

PCでは`http://localhost:5173/`でマイク・カメラを使えます。スマホ同士やPCとスマホで試す場合は、HTTPSで配信してください。

## GitHub Pages

`.github/workflows/pages.yml`でGitHub Pagesへデプロイできます。

1. GitHubのリポジトリ設定で`Settings` -> `Pages`を開きます。
2. `Build and deployment`の`Source`で`GitHub Actions`を選びます。
3. `main`ブランチへpushすると自動で公開されます。

`Get Pages site failed`または`Not Found`で失敗する場合は、Pagesがまだ有効化されていない可能性があります。上記の`Source: GitHub Actions`を保存してから、Actionsを再実行してください。

## 補足

- PeerJS Cloudはシグナリングだけに使い、音声はWebRTCのP2P接続で流れます。
- 画面上は開始側と参加側を区別しません。内部的にはQRコードの宛先になった端末が参加受付を担当します。
- 参加受付を担当している端末が抜けた場合、残った端末の中から自動で新しい参加受付を選び、参加用QRを更新します。
- 退出ボタンを押さずに閉じた端末は、生存確認が途切れてから参加者一覧から削除されます。
- 近くにいる参加者の遅延音声は、マイク入力との特徴比較で自動的に音量を下げます。VADで音声区間だけを判定対象にし、無音区間では相関計算と抑制レベル変更を行いません。0.5秒ごとに判定し、直近2秒分の音声判定結果を見て2秒ごとに段階的に抑制レベルを調整します。抑制中は参加者一覧に`近接抑制`と抑制率が表示されます。
- マイク取得時にブラウザへ`echoCancellation`、`noiseSuppression`、`autoGainControl`を要求します。実際の効き方は端末、OS、ブラウザ、接続中のイヤホンに依存します。
- ミュート中も近接判定用のマイク解析は継続し、WebRTCの送信だけ無音に差し替えます。
- 対応ブラウザではMedia Session API経由でイヤホン側のミュート、通話、受話、再生/停止系ボタンを検知し、アプリ内ミュートのON/OFFを切り替えます。Bluetooth/HFPの全イベントをWebページから直接取得できるわけではありません。
- PCブラウザでは対応していればアプリ内でスピーカーを選べます。
- AndroidとiOSではBluetoothの入出力は基本的にOS側の音声ルートに従います。
- 画面スリープ抑止はWake Lock API対応ブラウザで有効になります。iOSや一部ブラウザではOS制限により画面オフ中の接続維持を保証できません。
