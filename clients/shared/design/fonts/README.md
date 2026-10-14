# Bundled font

Bricolage Grotesque, one variable family (weight axis 200-800), bundled so the
offline Tizen WGT, webOS IPK, Android TV asset bundle and the browser app all
render the same face without a network font.

| File | Subset | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `bricolage-grotesque-latin-wght.woff2` | Latin (U+0000-00FF and punctuation) | 41344 | `a97804dc9fbe5fc972a08018c5eda4dab7ef2346f64c57e61419d05e6de4ea1c` |
| `bricolage-grotesque-latin-ext-wght.woff2` | Latin Extended (ă ș ț and similar) | 18668 | `e808f16b56f84dc7933e498cc8a41d4a5cd853adc6eef154584baa5de1008b15` |

- Source: npm package `@fontsource-variable/bricolage-grotesque` 5.3.0
  (`files/*-latin-wght-normal.woff2` and `files/*-latin-ext-wght-normal.woff2`),
  which are the upstream release subset by Unicode range with the optical-size
  and width axes pinned. The files are unmodified.
- License: SIL Open Font License 1.1 (`OFL.txt`), copyright 2022 The Bricolage
  Grotesque Project Authors. The OFL permits bundling and redistribution with
  software. The file carries no Reserved Font Name. Keep `OFL.txt` beside the
  files.
- The default instance of the weight axis is 800 (ExtraBold). Engines without
  variable-font support (webOS 4 Chromium 53) would render every weight at 800,
  so `../fonts.css` declares the face only inside
  `@supports (font-variation-settings: normal)` and those engines keep their
  platform sans.
- To update: download the two files for the new package version, replace the
  rows above and run `npm test -w @torrent-tv/shared`.
