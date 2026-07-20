# デザインガイド（AIヘルパー わびすけ）

Apple Human Interface Guidelines の3原則に沿う。
**Clarity**（明瞭）/ **Deference**（UIはコンテンツに譲る）/ **Depth**（階層は深度で示す）

参照: <https://developer.apple.com/jp/design/human-interface-guidelines/>

## 絶対ルール

1. **色は `src/index.css` の `@theme` セマンティックトークン経由でのみ参照する。**
   `slate-*` `sky-*` `red-*` `amber-*` など Tailwind デフォルトパレットの直書きは禁止。
2. **アクセント色（侘助紅 `--color-accent`）は操作要素にのみ使う。**
   ボタン / アクティブなナビ / リンク / フォーカスリング。
   バッジ・ステータス表示には使わない（`danger` / `warn` / グレーを使う）。
   アクセントと danger は色相が近いため、この分離を崩すと意味が読めなくなる。
3. **`focus:outline-none` の単独指定は禁止。** 必ず `focus-visible` リングを伴わせる。
4. **色だけに情報を担わせない。** 要注意バッジのドットのように、形・文言でも判別できるようにする。
5. **影は「実際に浮くもの」にだけ使う。** ダイアログ / ドロップダウン / sticky ヘッダー / セグメンテッドコントロールのつまみ。
   カード・リストは 1px の hairline（`border-separator`）のみで面を区切る。

## トークン

| 種別 | トークン |
|---|---|
| アクセント | `accent` `accent-hover` `accent-active` `accent-tint` `accent-muted` |
| 背景 | `canvas`（ページ）/ `surface`（カード面）/ `sunken`（補足ブロック） |
| テキスト | `label`（主）/ `label-2`（副）/ `label-3`（補助・日時） |
| 罫線・塗り | `separator` / `fill`（ghost hover）/ `fill-strong`（secondary hover） |
| 意味 | `danger` `warn` `success`（各 `-tint` `-muted` あり） |
| 角丸 | `rounded-control` 8px / `rounded-card` 12px / `rounded-sheet` 16px |
| タイポ | `text-display` `text-title` `text-section` `text-body` `text-sub` `text-caption` |
| イージング | `ease-spring`（`cubic-bezier(0.32, 0.72, 0, 1)`） |

## マテリアル（面の質感）

単色ベタ塗りは安く見える。macOS / iOS の「上品さ」は次の4つの重ね合わせで出来ている:

1. **ごく浅い縦グラデーション** — 上が明るい＝上から光が当たっている
2. **上辺の内側ハイライト** `inset 0 1px 0 rgb(255 255 255 / .26)` — 面のエッジの反射
3. **色を持った落ち影** — 黒ではなく、その面の色を暗くした影を使う
4. **hairline のリング** `inset 0 0 0 .5px` — 輪郭の締まり

複数プロパティの協調が必要なため、ユーティリティではなく `index.css` の `@layer components` に
`mat-*` クラスとして持たせている。

| クラス | 用途 |
|---|---|
| `mat-primary` / `mat-danger` | 塗りボタン |
| `mat-secondary` | 白いガラス板のボタン |
| `mat-surface` | 通常のカード面 |
| `mat-raised` | 浮くカード（ログイン等）。落ち影を大きく柔らかく |
| `mat-field` | 入力欄。押せる面ではなく受ける面なのでわずかに凹ませる |
| `mat-thumb` | Segmented のつまみ |
| `mat-ambient` | 周辺光のある背景。アクセント色をごく薄く回り込ませる |

**hover は `filter: brightness()` で行い、`background-image` を差し替えない。**
グラデーションはCSSで補間できないため、差し替えると影のトランジションと動きがズレる。

## タイポグラフィ

**階層はサイズではなくウェイトと色で作る。** セクション見出し（`text-section`）は本文と同じ 15px で、
weight 600 と `label` 色によって立たせる。サイズを大きくして段差をつけるのは `text-title` 以上だけ。

日本語主体のため本文の行間は 1.75 と広め、見出しは `letter-spacing` を詰める。
`font-feature-settings: 'palt'` で約物を詰める。Webフォントは読み込まない（システムフォントの方が
ネイティブに馴染み、CloudFront の転送量も増やさない）。

## モーション

- `duration-150 ease-spring` を基本にする
- ホバーは**塗りの微変化のみ**。`transform` や影の増加を hover で使わない（安っぽさの原因）
- `transform` は `:active` の `scale(0.98)` にのみ許す
- `prefers-reduced-motion: reduce` で全トランジションを無効化（`index.css` に実装済み）

## 密度

余白は「多すぎない」ことを重視する。iOS の設定アプリ相当の、密度は高いが息継ぎのあるレイアウト。
8pt グリッド（4pt 細分）。

| 箇所 | 値 |
|---|---|
| コンテナ | `mx-auto max-w-5xl px-5 py-6` |
| ページ内セクション間 | `space-y-5`（20px） |
| カード内 padding | 16px（`Card` の既定） |
| カード内の要素間 | `gap-2` / `gap-3` |
| フォーム項目間 | `gap-4` |
| ボタン高さ | `md` 40px / `sm` 32px（タップターゲットの確保） |

## 材質

半透明 + ブラー（Liquid Glass の穏当な Web 翻訳）は**共通ヘッダーにだけ**使う。
スクロール時にコンテンツが透けることで「下に続きがある」ことを示す機能的な意味を持たせる。
カード・リストなどコンテンツ層には適用しない（iOS 26 でも Liquid Glass はコンテンツ層には当てていない）。

## プリミティブ

`src/components/ui.tsx` に集約（shadcn/ui は導入しない）:
`Button` `Card` `Input` `Textarea` `Select` `Label` `ErrorText` `Spinner` `Skeleton` `SkeletonCard` `EmptyState`

個別ファイル: `Segmented.tsx`（相互排他な切替）/ `ConfirmDialog.tsx`（破壊的操作の確認。`window.confirm` は使わない）/
`badges.tsx`（優先度・カテゴリ）/ `AppName.tsx`（アプリ名。ja のみルビ）

`Card` の色替えは `tone` prop（`default` / `warn` / `accent` / `sunken`）で行う。
`className` で背景色やボーダー色を上書きしない（tailwind-merge を入れていないため、
同じプロパティのクラスを重ねると CSS 順で勝敗が決まり壊れる）。

## ローディング・空状態

素の「読み込み中…」テキストは使わない。
一覧の読み込みは `SkeletonCard`、ボタン内は `Spinner`（色は親から継承）、空は `EmptyState`。
