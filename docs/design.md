# デザインガイド（AIヘルパー わびすけ）

介護現場向けの業務アプリ。第一優先は**情報を素早く把握できること**。
コンセプトは「安心・落ち着き・やさしさ・医療らしい信頼感」。装飾性よりも可読性を重視する。

**画面を開いた瞬間に「今見るべき利用者」と「今日の状況」が3秒以内で把握できること**を最優先とする。
「病院システムのような堅苦しさ」ではなく「介護職員が毎日使いたくなる優しさ」を目指す。

参照モック: `docs/UI.png`

## 絶対ルール

1. **色は `src/index.css` の `@theme` セマンティックトークン経由でのみ参照する。**
   `slate-*` `green-*` `red-*` `amber-*` など Tailwind デフォルトパレットの直書きは禁止。
2. **アクセント色（ブランドグリーン `--color-accent`）は操作要素にのみ使う。**
   ボタン / アクティブなナビ / リンク / フォーカスリング。
   バッジ・ステータス表示には使わない（`danger` / `warn` / `success` を使う）。
3. **文字には `-ink` 系トークンを使う。**
   ブランド値（`accent` `danger` `warn` `success`）は彩度が高く明るいため、白や tint 背景の上で
   コントラスト比 4.5:1 に届かない。**面（塗り・ドット・ボーダー）にはブランド値、文字には `-ink`。**
   例: バッジのラベルは `text-warn-ink`、リンクは `text-accent-ink`。
4. **`focus:outline-none` の単独指定は禁止。** 必ず `focus-visible` リングを伴わせる。
5. **色だけに情報を担わせない。** 優先度バッジはドット + 文言でも判別できるようにする。
6. **アイコンだけで意味を持たせない。** 必ずテキストラベルを併記する。
   併記できない場所（折りたたみサイドバー・アイコンボタン）は `aria-label` と `sr-only` で補う。
7. **フラットデザイン。** グラデーション・内側ハイライト・質感表現は使わない。
   面の区別は「白背景 + 1px hairline + ごく弱い影」だけで行う。

## トークン

| 種別 | トークン |
|---|---|
| アクセント | `accent` `accent-hover` `accent-active` `accent-tint` `accent-wash` `accent-muted` `accent-ink` |
| 背景 | `canvas` #F8FAF9（ページ）/ `surface` #FFF（カード）/ `sunken`（補足ブロック） |
| テキスト | `label` #1F2937（主）/ `label-2` #6B7280（副）/ `label-3`（補助・日時） |
| 罫線 | `separator` #E5E7EB（サイドバー枠）/ `hairline` #ECECEC（カード枠・リスト行の区切り） |
| 塗り | `fill`（ghost hover）/ `fill-strong`（スケルトン） |
| 意味 | `danger` `warn` `success` `info`（各 `-tint` `-muted` `-ink` あり） |
| 角丸 | `rounded-control` 10px（入力欄・ボタン）/ `rounded-card` 16px / `rounded-sheet` 20px（モーダル）/ `rounded-full`（タグ） |
| 影 | `shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-card`（カード既定） |
| タイポ | `text-display` `text-title` `text-section` `text-metric` `text-body` `text-sub` `text-caption` |
| イージング | `ease-standard`（`cubic-bezier(0.4, 0, 0.2, 1)`） |
| ブレークポイント | `md` 768px / `wide` 1200px |

### ブランドカラー

Primary `#68B489` / Hover `#5AA37B` / Light `#EAF7EF` /
Success `#66C488` / Warning `#F5B247` / Danger `#E86A6A` / Info `#74A9F7`

### 塗りボタンは `-solid` を使う

白文字が乗る面は、ブランド値のままでは AA を満たさず、かつ**有効なボタンが「無効化されている」ように
見えてしまう**（実際に運用でその指摘が出た）。押せる状態がひと目で分かることを優先し、
白文字が乗る面だけ濃い `-solid` を使う。

| 用途 | トークン | 白文字とのコントラスト |
|---|---|---|
| プライマリボタン | `accent-solid` #3F7D58 | 4.90:1 ✅ |
| （旧・不採用） | `accent` #68B489 | 2.48:1 ❌ |
| 危険操作ボタン | `danger-solid` #C93A3A | 5.06:1 ✅ |
| （旧・不採用） | `danger` #E86A6A | 3.13:1 ❌ |

ブランド値（`accent` `danger`）は **文字が乗らない面**（tint 背景・ボーダー・ドット・ロゴ・
アクティブなナビの左ライン）に引き続き使い、全体の印象は保つ。

## ボタンの状態

**入力要件を満たすまでボタンは無効にし、満たした瞬間に濃くなる**ようにする。
「押せるのに何も起きない」「空のまま実行できてしまう」を防ぐ。

- 有効 = `-solid` の濃い塗り + 白文字 / 無効 = 同じ色の 30% + `cursor-not-allowed`
- hover は `enabled:hover:` を付ける（無効時に色が変わると押せると誤解させるため）
- `disabled:pointer-events-none` は使わない。カーソル形状で「押せない」ことを伝える
  （クリックは `disabled` 属性がネイティブに止める）
- **無効にしたら必ず理由を添える。** 例: 「承認済みの記録がまだありません」「氏名を入力してください」

## タイポグラフィ

Noto Sans JP（`index.html` で Google Fonts から 400/500/600/700 のみ読み込み）。行間は 1.5〜1.6 倍。

| 用途 | トークン | 値 |
|---|---|---|
| ページタイトル | `text-display` | 32px Bold |
| セクションタイトル・勤務情報 | `text-title` | 24px Semibold |
| カードタイトル | `text-section` | 20px Semibold |
| ダッシュボードの件数 | `text-metric` | 40px Bold |
| 本文 | `text-body` | 16px Regular |
| 補助テキスト | `text-sub` | 14px Regular |
| キャプション | `text-caption` | 12px Regular |

数字は Medium〜Bold。桁が動く数値には `.tabular` を付けて視線の揺れを抑える。

## レイアウト

左サイドバー + メインコンテンツの2カラム。**ページタイトルは共通ヘッダー（`Layout`）が
ルートから解決して出す。各ページは `h1` を持たない。**

| 箇所 | 値 |
|---|---|
| サイドバー幅 | 240px（`wide` 以上）/ 80px アイコンのみ（`md`〜`wide`） |
| メイン最大幅 | 1600px |
| メイン左右余白 | 48px（`wide`）/ 32px（`md`）/ 16px（モバイル） |
| ヘッダー高さ | 72px（`h-18`） |
| カード内 padding | 24px（`Card` の既定） |
| セクション間 | `space-y-8`（32px） |
| カード間 | `gap-6`（24px） |
| ボタン高さ | `md` 48px / `sm` 40px |
| 入力欄高さ | 48px（textarea は最低 160px） |

余白は 8px グリッド。**8 / 16 / 24 / 32 / 40 / 48 / 64 のみ**を使う。

### レスポンシブ

| 幅 | サイドバー | カード |
|---|---|---|
| `wide` 1200px 以上 | 固定・展開（ロゴ + ラベル） | 2〜3カラム |
| `md`〜`wide` | 折りたたみ・アイコンのみ | 2カラム |
| `md` 768px 未満 | 廃止 → `BottomNav`（下部ナビ） | 1カラム・アクションボタンは全幅 |

## モーション

- `duration-200 ease-standard` を基本にする
- ホバーは**色変更のみ**
- カードのホバーは `translateY(-2px)` まで。押下は `active:scale`
- モーダルは fade + scale（`dialog-in`）
- `prefers-reduced-motion: reduce` で全トランジションを無効化（`index.css` に実装済み）

## テーブルを使わない

一覧はすべてカードリストで表現する。スマートフォンでの閲覧しやすさを優先するため。
利用者行はクリック可能にし、ホバーで背景をわずかにグレーへ、`cursor: pointer`、押下で軽く沈める。

## プリミティブ

`src/components/ui.tsx` に集約（shadcn/ui は導入しない）:
`Button` `Card` `CardTitle` `Input` `Textarea` `Select` `Label` `ErrorText` `Spinner` `Skeleton` `SkeletonCard` `EmptyState`

個別ファイル:
`Sidebar.tsx`（左固定ナビ）/ `BottomNav.tsx`（モバイル下部ナビ）/ `nav.ts`（ナビ定義。両者が共有）/
`Segmented.tsx`（相互排他な切替）/ `ConfirmDialog.tsx`（破壊的操作の確認。`window.confirm` は使わない）/
`badges.tsx`（優先度・カテゴリ）/ `AppName.tsx`（アプリ名。ja のみルビ）/ `WabisukeMark.tsx`（ロゴマーク）

`Card` の色替えは `tone` prop（`default` / `warn` / `accent` / `sunken`）で行う。
`className` で背景色やボーダー色を上書きしない（tailwind-merge を入れていないため、
同じプロパティのクラスを重ねると CSS 順で勝敗が決まり壊れる）。

アイコンは **Lucide**（`lucide-react`）。線幅 2px、サイズ 20px（`size-5`）に統一する。

## ローディング・空状態

素の「読み込み中…」テキストは使わない。
一覧の読み込みは `SkeletonCard`、ボタン内は `Spinner`（色は親から継承）、空は `EmptyState`。

## 見た目の確認（バックエンド不要）

`preview.html` + `src/preview.tsx` は `fetch` をダミー応答に差し替えて `Layout` + `HomePage` を
そのまま描画する dev 専用エントリ。Cognito ログインもデプロイ済み API も不要。

```
npm run dev   # → http://localhost:5173/preview.html
```

本番ビルドの入口は `index.html` のみなので、このファイルは `dist/` には入らない。
