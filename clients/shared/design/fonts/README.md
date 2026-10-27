# Bundled font

Inter, one variable family (weight axis 400-800), bundled so the offline Tizen
WGT, webOS IPK, Android TV asset bundle and the browser app all render the same
face without a network font. The TV build inlines both files into its CSS; the
browser build emits them as hashed woff2 files.

| File | Subset | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `inter-latin-wght.woff2` | Latin (U+0000-00FF and punctuation) | 32752 | `880c772d2f47cc9bac738922c1d3657c62d72e07873e82354007eb7289bd8728` |
| `inter-latin-ext-wght.woff2` | Latin Extended (ă ș ț and similar) | 56108 | `0b31d050b620e5b9a4f31a49173b5a9ac6f94fdbcfbb47d133683a3c337e09bf` |

- Source: the official Inter 4.1 release, `Inter-4.1.zip` from
  github.com/rsms/inter (SHA-256
  `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`), file
  `InterVariable.ttf`.
- Built with `python3 tools/subset_inter.py InterVariable.ttf <out-dir>`
  (fontTools 4.67): the weight axis is limited to 400-800, optical size is
  pinned to 14 (Inter's text design, which reads best at 3 m), and the font is
  split by the two unicode-range lists in `../fonts.css`. Kept layout features:
  kerning, ligatures, contextual alternates, marks, case forms and tabular
  figures (`tnum`, used through `--tt-figures`).
- License: SIL Open Font License 1.1 (`OFL.txt`, copied from the release),
  copyright 2016 The Inter Project Authors. The OFL permits bundling,
  subsetting and redistribution with software. The font carries no Reserved
  Font Name. Keep `OFL.txt` beside the files.
- The default instance of the weight axis is 400 (Regular). Engines without
  variable-font support (webOS 4 Chromium 53) would render every weight at
  400, so `../fonts.css` declares the face only inside
  `@supports (font-variation-settings: normal)` and those engines keep their
  platform sans.
- To update: download the new release, rerun the script, replace the rows above
  and run `npm test -w @torrent-tv/shared`.
