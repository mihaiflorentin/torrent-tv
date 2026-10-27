"""Build the bundled Inter files in clients/shared/design/fonts from the official release.

usage: python3 tools/subset_inter.py <InterVariable.ttf> <out-dir>

InterVariable.ttf comes from the official release zip (github.com/rsms/inter,
SIL OFL 1.1). Needs fontTools and brotli (pip install --user fonttools brotli).

The weight axis is limited to 400-800 (the weights DESIGN.md uses) and optical
size is pinned to 14, Inter's text design, which reads best at 3 m. Two woff2
files are written, split by the same unicode-range lists as fonts.css: Latin and
Latin Extended (Romanian ă ș ț live in the second). Layout features kept:
kerning, ligatures, contextual alternates, marks, case forms and tabular figures.
"""
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
FEATURES = ["ccmp", "locl", "mark", "mkmk", "kern", "liga", "calt", "tnum", "case"]


def codepoints(ranges):
    result = []
    for part in ranges.split(","):
        low, _, high = part.strip()[2:].partition("-")
        result.extend(range(int(low, 16), int(high or low, 16) + 1))
    return result


def main(source, out):
    limited = instancer.instantiateVariableFont(TTFont(source), {"wght": (400, 800), "opsz": 14})
    staging = f"{out}/inter-limited.ttf"
    limited.save(staging)
    for name, ranges in (("latin", LATIN), ("latin-ext", LATIN_EXT)):
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = FEATURES
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        options.hinting = False
        font = TTFont(staging)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=codepoints(ranges))
        subsetter.subset(font)
        font.flavor = "woff2"
        font.save(f"{out}/inter-{name}-wght.woff2")
        print(f"{out}/inter-{name}-wght.woff2")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
