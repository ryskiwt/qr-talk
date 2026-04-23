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
- PCブラウザでは対応していればアプリ内でスピーカーを選べます。
- AndroidとiOSではBluetoothの入出力は基本的にOS側の音声ルートに従います。
- 画面スリープ抑止はWake Lock API対応ブラウザで有効になります。iOSや一部ブラウザではOS制限により画面オフ中の接続維持を保証できません。
