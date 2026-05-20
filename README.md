# PDF Diff

請求書 PDF をページ単位・文字単位で比較し、差分をマーカー表示するオフラインデスクトップアプリです。

- **技術**: Tauri 2 + React + TypeScript + pdf.js
- **比較**: A のページ順を基準にペア（**表示も A p.1 → p.2 → … の順**）。宛先（御中・様の直前）は **両方ある場合に完全一致必須**、本文は **全文一致率≧閾値**。B にのみあるページは末尾。各ペア内は 1 文字単位で diff
- **表示**: PDF A = 赤（削除）、PDF B = 緑（追加）

## 必要環境

| ツール | 用途 |
|--------|------|
| [Node.js](https://nodejs.org/) 20+ | フロントエンド |
| [Rust](https://www.rust-lang.org/tools/install) | Tauri ビルド |
| macOS: Xcode CLT | `xcode-select --install` |
| Windows ビルド時 | Visual Studio Build Tools |

## セットアップ

```bash
cd pdf-invoice-diff
npm install
```

### ブラウザのみで試す（Tauri なし）

```bash
npm run dev
```

http://localhost:1420 を開き、PDF A / B を選択して「比較」。

### Tauri デスクトップで起動（Mac）

```bash
npm run tauri dev
```

初回は Rust のコンパイルに数分かかることがあります。

## Windows 用ビルド

Mac 上では Windows 向け exe の直接ビルドは難しいため、**GitHub Actions** または **Windows PC** でビルドするのが一般的です。

### ローカル（Windows）

```bash
npm install
npm run tauri build
```

成果物: `src-tauri/target/release/bundle/`

### GitHub Actions 例

`.github/workflows/build.yml` を追加し、`windows-latest` で `npm run tauri build` を実行。

## アイコン

`src-tauri/icons/` にアイコンが必要です。1024x1024 の PNG を用意して:

```bash
npm run tauri icon path/to/icon.png
```

## 使い方

1. **PDF A** … 比較元
2. **PDF B** … 比較先
3. **比較** … ページ一覧に差分文字数が表示されます
4. ページを選ぶと左右にプレビューとマーカーが表示されます

## 注意（請求書向け）

- テキストは pdf.js で抽出しています。読み取り順は **上→下、左→右** です。
- 表レイアウトが大きく変わると、見た目は同じでも差分が多く出ることがあります。
- 正規化は行っていません（1文字でも差分になります）。

## プロジェクト構成

```
src/
  lib/          # PDF 抽出・diff ロジック
  components/   # ページビューア
src-tauri/      # Tauri (Rust)
```
