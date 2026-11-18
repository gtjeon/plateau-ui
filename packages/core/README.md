# @plateau-ui/core

**PLATEAU を、あなたのページに。アイデアの土台に。**

日本の 3D 建物マップを、手軽に描けるライブラリ。three.js でできることは、この上でもそのままできます。国のオープンデータだけで動きます。

three.js の WebGPU レンダラーで描画し、WebGPU がない環境では WebGL2 で動きます。

サイト（サンプルとドキュメント）: https://gtjeon.github.io/plateau-ui/

> **アルファ版です。** リリースの間で API が変わることがあります。

> plateau-ui は個人が開発しているオープンソースのライブラリで、国土交通省・PLATEAU の公式なものではありません。

## インストール

```sh
pnpm add @plateau-ui/core three
```

`three` はピア依存です。ページとライブラリが同じ `three` を使うので、ページが作ったメッシュやライト、マテリアル、後処理を地図と一緒に使えます。

## 最初の地図

```html
<div id="map" style="width: 100%; height: 100vh"></div>
```

```ts
import { Viewer } from '@plateau-ui/core'

const viewer = new Viewer({
  container: 'map',
  center: [139.7671, 35.6812], // [経度, 緯度]
  zoom: 17,
  pitch: 60,
  heading: 30,
  // 描くものと読み込むもの。ここでは画面に映る範囲すべて
  mask: { shapes: [{ shape: 'view' }] },
})
```

地面、建物、glTF モデルのレイヤーは、どのビューアーにも最初からあります（`viewer.ground`・`viewer.buildings`・`viewer.models`）。
マーカー、図形、GeoJSON、ベクトルタイルと画像タイル、立体、見える範囲、自分で作ったレイヤーは、`layers` か `viewer.add()` で加えます。

## データ

描くものはすべて、実行時に公開 CDN から読み込みます。パッケージには含まれていません。

| 配信元                        | 内容                             |
| ----------------------------- | -------------------------------- |
| api.plateauview.mlit.go.jp    | PLATEAU のカタログ               |
| assets.cms.plateau.reearth.io | PLATEAU の 3D Tiles              |
| cyberjapandata.gsi.go.jp      | 国土地理院のベクトルタイルと標高 |

都市ごとのタイルの場所は PLATEAU のカタログが示すので、タイルはカタログが挙げる別のホストから来ることもあります（現在は
assets.cms.plateau.reearth.io）。

地図の下の出典表示は、各配信元の利用条件に沿って、画面に映っているものに応じてビューアーが描きます。リクエストは
`transformRequest` で書き換えられます（プロキシ、ミラー、署名付き URL など）。渡される URL は本来のものなので、ヘッダーを足す
ページはホストを確かめてから足せます。

## デコーダー

PLATEAU のタイルは Draco で圧縮されていて、glTF モデルは KTX2 テクスチャを使うことがあります。二つのデコーダーはパッケージに
含まれていません。three のローダーが実行時に読み込み、ページのオリジンで `blob:` URL から起動したワーカーで動かします。既定の
場所は次のとおりです。

| デコーダー                    | 既定の場所                                                            |
| ----------------------------- | --------------------------------------------------------------------- |
| Draco 1.5.7                   | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/`             |
| Basis（KTX2、three 0.186 用） | `https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/libs/basis/` |

この読み込みは `transformRequest` を通りません。これらのホストのコードを動かしたくないページは、同じファイルを自分で配信して
場所を指定します。

```ts
new Viewer({
  // ...
  buildings: { dracoPath: '/decoders/draco/' },
  models: { dracoPath: '/decoders/draco/', ktx2Path: '/decoders/basis/' },
})
```

## Content-Security-Policy

ポリシーの下で試したものではなく、コードから読み取ったものです。CSP を使うページには、少なくとも次が必要です。

- デコーダーのワーカーに `worker-src blob:`、その WebAssembly に `script-src 'wasm-unsafe-eval'`
- `connect-src` に、上のデータのホスト（とページ自身のレイヤーが使うホスト）、ページのオリジンから配信しない場合はデコーダーの
  ホスト、そして `blob:` と `data:`
- `img-src blob: data:`

## 動作環境

- WebGPU、または代わりに WebGL2 が使えるブラウザ（どちらで動いているかは `viewer.backend` でわかります）
- `three` 0.186

## ライセンス

MIT。`dist` に同梱したコードのライセンス表記は `THIRD_PARTY_LICENSES.md` にあります。

ライブラリが描くデータはライブラリに含まれません。各配信元の利用条件に従い、その出典を地図の下に表示します。
