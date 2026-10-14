from __future__ import annotations
import sys
from pathlib import Path
import re
import struct
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tizen_wgt


VALID_CONFIG = b'''<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="0.1.2">
  <tizen:application id="FListTV001.FileListTV" package="FListTV001" required_version="5.0"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <tizen:profile name="tv-samsung"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/download"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <access origin="*" subdomains="true"/>
</widget>'''

NEWER_CONFIG = VALID_CONFIG.replace(b'required_version="5.0"', b'required_version="7.0"')

VALID_HTML = b'''<link rel="stylesheet" href="app.css">
<script type="text/javascript" src="$WEBAPIS/webapis/webapis.js"></script>
<script type="text/javascript" src="startup.js"></script>
<script type="text/javascript" src="app.js"></script>'''


def png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    rows = b"".join(b"\0" + b"\0\0\0\xff" * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


class WGTTests(unittest.TestCase):
    def test_pack_and_validate_unsigned_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "dist"
            (source / "assets").mkdir(parents=True)
            (source / "index.html").write_bytes(VALID_HTML)
            (source / "app.js").write_bytes(self.valid_app())
            (source / "app.css").write_text("body{}")
            (source / "startup.js").write_text("window.FileListBoot={};")
            (source / "signature1.xml").write_text("stale")
            (root / "config.xml").write_bytes(VALID_CONFIG)
            (root / "icon.png").write_bytes(png(117, 117))
            output = root / "torrent-tv-0.1.2.wgt"

            entries = tizen_wgt.collect_entries(source, root / "config.xml", root / "icon.png")
            self.assertNotIn("signature1.xml", entries)
            tizen_wgt.write_archive(output, entries)
            report = tizen_wgt.validate_archive(output, "7.0")
            self.assertIn("unsigned; Apps2Samsung will sign it", report)
            digest = tizen_wgt.write_checksum(output)
            self.assertEqual(64, len(digest))
            self.assertTrue(Path(str(output) + ".sha256").is_file())

    def test_rejects_newer_tizen_requirement(self):
        output = self.make_archive(NEWER_CONFIG, VALID_HTML)
        with self.assertRaisesRegex(tizen_wgt.WGTError, "requires Tizen 7.0"):
            tizen_wgt.validate_archive(output, "5.0")

    def test_five_floor_package_validates_against_floor_and_ceiling(self):
        output = self.make_archive(VALID_CONFIG, VALID_HTML)
        for target in ("5.0", "7.0"):
            with self.subTest(target=target):
                report = tizen_wgt.validate_archive(output, target)
                self.assertIn(f"requires Tizen 5.0, target=Tizen {target}", report)

    def test_rejects_missing_html_asset(self):
        output = self.make_archive(VALID_CONFIG, VALID_HTML + b'<script src="missing.js"></script>')
        with self.assertRaisesRegex(tizen_wgt.WGTError, "missing bundled asset"):
            tizen_wgt.validate_archive(output, "7.0")

    def test_rejects_partner_privilege(self):
        config = VALID_CONFIG.replace(
            b'<access origin="*"',
            b'<tizen:privilege name="http://tizen.org/privilege/vpnservice"/><access origin="*"',
        )
        output = self.make_archive(config, VALID_HTML)
        with self.assertRaisesRegex(tizen_wgt.WGTError, "partner-only"):
            tizen_wgt.validate_archive(output, "7.0")

    def test_rejects_module_entry_point(self):
        html = VALID_HTML + b'<script type="module" src="module.js"></script>'
        output = self.make_archive(VALID_CONFIG, html, {"module.js": b"export {}"})
        with self.assertRaisesRegex(tizen_wgt.WGTError, "classic scripts"):
            tizen_wgt.validate_archive(output, "7.0")

    def test_rejects_static_avplay_surface(self):
        html = VALID_HTML + b'<object type="application/avplayer"></object>'
        output = self.make_archive(VALID_CONFIG, html)
        with self.assertRaisesRegex(tizen_wgt.WGTError, "must not exist in startup HTML"):
            tizen_wgt.validate_archive(output, "7.0")

    def test_rejects_css_gap_properties(self):
        for prop in ("gap", "row-gap", "column-gap", "grid-gap"):
            css = f".row{{display:flex;{prop}:8px}}".encode()
            output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.css": css})
            for target in ("5.0", "7.0"):
                with self.subTest(property=prop, target=target):
                    with self.assertRaisesRegex(
                        tizen_wgt.WGTError,
                        rf"'app\.css' uses flex/grid gap property '{prop}'",
                    ):
                        tizen_wgt.validate_archive(output, target)

    def test_allows_gap_substrings_and_inset_values(self):
        css = (
            b".gapless{display:flex;box-shadow:inset 0 0 0 1px #000}"
            b".gap:hover{color:red}"
            b".hero{background:url(img/gap-row.png)}"
            b"@media (min-width:100px){.list{color:#fff}}"
        )
        extra = {"app.css": css, "bundle.js": b"(function(){var gap=8;}());"}
        output = self.make_archive(VALID_CONFIG, VALID_HTML, extra)
        for target in ("5.0", "7.0"):
            with self.subTest(target=target):
                report = tizen_wgt.validate_archive(output, target)
                self.assertIn(f"requires Tizen 5.0, target=Tizen {target}", report)

    def test_rejects_gap_properties_in_inline_style_blocks(self):
        html = VALID_HTML + b'<style>.row{display:flex;gap:8px}</style>'
        output = self.make_archive(VALID_CONFIG, html)
        for target in ("5.0", "7.0"):
            with self.subTest(target=target):
                with self.assertRaisesRegex(
                    tizen_wgt.WGTError,
                    r"'index\.html' uses flex/grid gap property 'gap'",
                ):
                    tizen_wgt.validate_archive(output, target)

    def test_allows_gap_free_inline_style_blocks(self):
        html = VALID_HTML + b'<style>#startup{box-shadow:inset 0 0 0 1px #000}.gapless{color:red}</style>'
        output = self.make_archive(VALID_CONFIG, html)
        report = tizen_wgt.validate_archive(output, "5.0")
        self.assertIn("requires Tizen 5.0, target=Tizen 5.0", report)

    FLOOR_API_SNIPPETS = (
        ("flatMap", b"var rows=list.flatMap(function(row){return [row];});"),
        ("flat", b"var one=list.flat(1);"),
        ("Object.fromEntries", b"var map=Object.fromEntries(pairs);"),
        ("globalThis", b"globalThis.FileListBoot=globalThis.FileListBoot||{};"),
        ("String.replaceAll", b"var slug=name.replaceAll(' ','-');"),
        ("matchAll", b"var all=[...text.matchAll(re)];"),
        ("structuredClone", b"var copy=structuredClone(state);"),
        ("Promise.allSettled", b"Promise.allSettled(jobs).then(function(){});"),
        ("Promise.any", b"Promise.any(jobs).catch(function(){});"),
        (".at", b"var first=row.at(0);"),
        ("ResizeObserver", b"var ro=new ResizeObserver(function(){});"),
        ("trimStart", b"var s=text.trimStart();"),
        ("trimEnd", b"var s=text.trimEnd();"),
        ("replaceChildren", b"node.replaceChildren(a,b);"),
        ("Object.hasOwn", b"var own=Object.hasOwn(map,key);"),
        ("findLast", b"var last=list.findLast(function(x){return x;});"),
        ("findLast", b"var last=list.findLastIndex(function(x){return x;});"),
        ("toSorted", b"var sorted=list.toSorted();"),
        ("toReversed", b"var rev=list.toReversed();"),
        ("Promise.withResolvers", b"var d=Promise.withResolvers();"),
        ("regex named groups", b"var m=/(?<year>\\d{4})/.exec(text);"),
        ("Unicode property escapes", b"var letters=/\\p{L}+/u.test(text);"),
        ("new AbortController", b"var controller=new AbortController();"),
        ("new AbortController", b"var controller=new AbortController;"),
    )

    def test_rejects_floor_missing_apis(self):
        for api, snippet in self.FLOOR_API_SNIPPETS:
            app = self.valid_app() + snippet
            output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.js": app})
            for target in ("5.0", "7.0"):
                with self.subTest(api=api, target=target):
                    with self.assertRaisesRegex(
                        tizen_wgt.WGTError,
                        rf"floor-missing API\(s\): {re.escape(api)};",
                    ):
                        tizen_wgt.validate_archive(output, target)

    def test_rejects_floor_missing_apis_in_verbatim_scripts(self):
        startup = b"var targets=hosts.flatMap(function(host){return host;});"
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"startup.js": startup})
        with self.assertRaisesRegex(
            tizen_wgt.WGTError,
            r"'startup\.js' uses 1 floor-missing API\(s\): flatMap;",
        ):
            tizen_wgt.validate_archive(output, "5.0")

    def test_allows_floor_safe_near_misses(self):
        app = self.valid_app() + (
            b"var head=tag.charAt(0);var parts=name.split('-');"
            b"var flatMapless=function(row){return row;};"
            b"/* globalThis does not exist on this engine; startup feature-detects instead */"
            b"/* structuredClone and ResizeObserver are unavailable on old engines; feature-detect instead */"
        )
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.js": app})
        for target in ("5.0", "7.0"):
            with self.subTest(target=target):
                report = tizen_wgt.validate_archive(output, target)
                self.assertIn(f"requires Tizen 5.0, target=Tizen {target}", report)

    def test_allows_guarded_abort_controller(self):
        guarded = (
            b"function a(){if(typeof AbortController!=='function')return null;return new AbortController();}",
            b"function b(c){var x=c.supportsAbortController?new AbortController:null;return x;}",
            b"function c(e){if(!e.supportsAbortController)return probe();var r=new AbortController();return r;}",
        )
        for index, snippet in enumerate(guarded):
            output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.js": self.valid_app() + snippet})
            with self.subTest(case=index):
                report = tizen_wgt.validate_archive(output, "5.0")
                self.assertIn("requires Tizen 5.0, target=Tizen 5.0", report)

    def test_rejects_abort_controller_with_only_a_distant_guard(self):
        snippet = b"function a(){return typeof AbortController;}" + b" " * 600 + b"function b(){return new AbortController();}"
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.js": self.valid_app() + snippet})
        with self.assertRaisesRegex(tizen_wgt.WGTError, r"floor-missing API\(s\): new AbortController;"):
            tizen_wgt.validate_archive(output, "5.0")

    def test_allows_new_api_near_misses(self):
        app = self.valid_app() + (
            b"var a=text.trimLeft();var b=text.trimRight();var c=list.findIndex(f);"
            b"var d=list.sort();var e=list.reverse();var f=/(?<=a)b(?<!c)/.test(t);"
            b"var g=Object.hasOwnProperty.call(o,k);var h=/\\d+/u.test(t);"
            b"var i=typeof AbortController;"
        )
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.js": app})
        report = tizen_wgt.validate_archive(output, "5.0")
        self.assertIn("requires Tizen 5.0, target=Tizen 5.0", report)

    CSS_RULE_SNIPPETS = (
        ("inset", b".a{position:absolute;inset:0}"),
        ("aspect-ratio", b".a{aspect-ratio:16/9}"),
        (":is()", b".a:is(.b,.c){color:red}"),
        (":where()", b":where(.a,.b){color:red}"),
        (":focus-visible", b".a:focus-visible{outline:0}"),
        ("min()", b".a{width:min(100%,40rem)}"),
        ("max()", b".a{width:calc(10px + max(1px,2vw))}"),
        ("clamp()", b".a{font-size:clamp(1rem,2vw,3rem)}"),
    )

    def test_rejects_unsupported_css_features(self):
        for name, css in self.CSS_RULE_SNIPPETS:
            output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.css": css})
            inline = self.make_archive(VALID_CONFIG, VALID_HTML + b"<style>" + css + b"</style>")
            for target in ("5.0", "7.0"):
                with self.subTest(feature=name, target=target):
                    with self.assertRaisesRegex(
                        tizen_wgt.WGTError,
                        rf"'app\.css' uses unsupported CSS {re.escape(name)};",
                    ):
                        tizen_wgt.validate_archive(output, target)
                    with self.assertRaisesRegex(
                        tizen_wgt.WGTError,
                        rf"'index\.html' uses unsupported CSS {re.escape(name)};",
                    ):
                        tizen_wgt.validate_archive(inline, target)

    def test_allows_the_shared_design_tokens_and_font_sheets(self):
        design = Path(__file__).resolve().parents[2] / "clients/shared/design"
        css = (design / "tokens.css").read_bytes() + (design / "fonts.css").read_bytes()
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.css": css})
        for target in ("5.0", "7.0"):
            with self.subTest(target=target):
                self.assertIn(f"target=Tizen {target}", tizen_wgt.validate_archive(output, target))

    def test_allows_css_near_misses(self):
        css = (
            b".a{box-shadow:inset 0 0 0 1px #000;top:0;right:0;bottom:0;left:0;accent-color:red}"
            b".b:focus{outline:0}.c:not(.d){color:red}.e:hover{color:red}"
            b"@media (min-width:100px) and (max-width:900px){.f{color:#fff}}"
            b".g{background:url(img/min-max.png);margin:calc(1px + 2px);padding:0 0 0 0}"
            b".is-open{color:red}.where{color:red}.inset-box{color:red}"
        )
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"app.css": css})
        report = tizen_wgt.validate_archive(output, "5.0")
        self.assertIn("requires Tizen 5.0, target=Tizen 5.0", report)

    def test_rejects_generic_tv_profile(self):
        config = VALID_CONFIG.replace(b'name="tv-samsung"', b'name="tv"')
        output = self.make_archive(config, VALID_HTML)
        with self.assertRaisesRegex(tizen_wgt.WGTError, "tv-samsung profile"):
            tizen_wgt.validate_archive(output, "7.0")

    def test_rejects_wrong_icon_dimensions(self):
        output = self.make_archive(VALID_CONFIG, VALID_HTML, {"icon.png": png(512, 512)})
        with self.assertRaisesRegex(tizen_wgt.WGTError, "117x117"):
            tizen_wgt.validate_archive(output, "7.0")

    def make_archive(self, config: bytes, html: bytes, extra: dict[str, bytes] | None = None) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / "app.wgt"
        entries = {
            "app.css": b"body{}",
            "app.js": self.valid_app(),
            "config.xml": config,
            "icon.png": png(117, 117),
            "index.html": html,
            "startup.js": b"window.FileListBoot={};",
        }
        entries.update(extra or {})
        tizen_wgt.write_archive(output, entries)
        return output

    @staticmethod
    def valid_app() -> bytes:
        return (
            b"(function(){var surface='application/avplayer',av=window.webapis.avplay;"
            b"av.open('url');av.setDisplayRect(0,0,1920,1080);av.prepareAsync(function(){});"
            b"av.stop();av.close();}());"
        )


if __name__ == "__main__":
    unittest.main()
