# plateau-ui

**PLATEAU を、あなたのページに。アイデアの土台に。**

日本の 3D 建物マップを、手軽に描けるライブラリ。three.js でできることは、この上でもそのままできます。国のオープンデータだけで動きます。

サイト（サンプルとドキュメント）: https://gtjeon.github.io/plateau-ui/

> **アルファ版です。** リリースの間で API が変わることがあります。

> plateau-ui は国土交通省・PLATEAU の公式なものではありません。

## 使い方

```sh
pnpm add @plateau-ui/core three
```

最初の地図の表示から先は [`packages/core`](packages/core/README.md) にあります。

## 構成

| フォルダ        | 内容                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core` | ライブラリ本体（`@plateau-ui/core`）                                                                |
| `site`          | ホーム、サンプル、ドキュメント。サンプルはそれぞれ独立したページで、`site/src/examples/` にあります |

## 開発

Node 24 と pnpm を使います。

```sh
pnpm install
pnpm dev:site     # サイト
pnpm typecheck
pnpm build        # ライブラリ
```

Issue は歓迎します。プルリクエストは受け付けていません（[CONTRIBUTING.md](CONTRIBUTING.md)）。セキュリティの問題は
[SECURITY.md](SECURITY.md) をご覧ください。

## ライセンス

MIT（[LICENSE](LICENSE)）。サンプルの次の二つは、それぞれのライセンスに従います。

- `site/src/examples/riverside-cafes/photos/` の写真: Unsplash License（同じフォルダの README）
- `site/src/examples/zilla/models/` の恐竜: CC0（`Trex-LICENSE.txt`）

地図のデータはリポジトリに含まれていません。地図を描くときに PLATEAU と国土地理院から読み込み、それぞれの利用条件に従います。
出典はビューアーが地図の下に表示します。
