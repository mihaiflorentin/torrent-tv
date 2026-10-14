package application

import (
	"bytes"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

// legacyCharmaps picks the single-byte code page that subtitle files of a
// language were most often saved in before UTF-8 became common.
var legacyCharmaps = map[string]*charmap.Charmap{
	"ro": charmap.Windows1250, "pl": charmap.Windows1250, "cs": charmap.Windows1250, "sk": charmap.Windows1250,
	"hu": charmap.Windows1250, "hr": charmap.Windows1250, "sl": charmap.Windows1250, "bs": charmap.Windows1250,
	"ru": charmap.Windows1251, "bg": charmap.Windows1251, "uk": charmap.Windows1251, "sr": charmap.Windows1251,
	"mk": charmap.Windows1251, "be": charmap.Windows1251,
	"el": charmap.Windows1253, "tr": charmap.Windows1254, "he": charmap.Windows1255, "ar": charmap.Windows1256,
	"lt": charmap.Windows1257, "lv": charmap.Windows1257, "et": charmap.Windows1257,
}

var romanianCedillas = strings.NewReplacer("ş", "ș", "ţ", "ț", "Ş", "Ș", "Ţ", "Ț")

// decodeSubtitleText turns raw subtitle bytes into UTF-8 text. It understands
// UTF-8 (with or without BOM), UTF-16 LE/BE (BOM or NUL-pattern detected) and,
// for anything else, picks a legacy code page from the language hint:
// Windows-1250 for Romanian and its neighbours, 1251 for Cyrillic, and so on.
// With no hint, the Romanian cedilla bytes (ş ţ in cp1250/ISO-8859-2) select
// Windows-1250, otherwise Windows-1252. Romanian cedilla letters are
// normalised to the comma-below forms (ș ț).
func decodeSubtitleText(data []byte, lang string) string {
	switch {
	case bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}):
		data = data[3:]
	case bytes.HasPrefix(data, []byte{0xFF, 0xFE}):
		return normalizeRomanian(decodeUTF16(data[2:], false), lang)
	case bytes.HasPrefix(data, []byte{0xFE, 0xFF}):
		return normalizeRomanian(decodeUTF16(data[2:], true), lang)
	}
	if bigEndian, ok := sniffUTF16(data); ok {
		return normalizeRomanian(decodeUTF16(data, bigEndian), lang)
	}
	if utf8.Valid(data) {
		return normalizeRomanian(string(data), lang)
	}
	table, ok := legacyCharmaps[lang]
	romanian := lang == "ro"
	if !ok {
		table = charmap.Windows1252
		if lang == "" && hasRomanianCedillaByte(data) {
			table, romanian = charmap.Windows1250, true
		}
	}
	text, err := table.NewDecoder().String(string(data))
	if err != nil {
		return strings.ToValidUTF8(string(data), "�")
	}
	if romanian {
		text = romanianCedillas.Replace(text)
	}
	return text
}

// hasRomanianCedillaByte reports the ş/ţ/Ş/Ţ bytes shared by Windows-1250 and
// ISO-8859-2, which Windows-1252 text almost never contains.
func hasRomanianCedillaByte(data []byte) bool {
	for _, b := range data {
		if b == 0xBA || b == 0xFE || b == 0xAA || b == 0xDE {
			return true
		}
	}
	return false
}

func normalizeRomanian(text, lang string) string {
	if lang == "ro" {
		return romanianCedillas.Replace(text)
	}
	return text
}

func decodeUTF16(data []byte, bigEndian bool) string {
	units := make([]uint16, 0, len(data)/2)
	for i := 0; i+1 < len(data); i += 2 {
		if bigEndian {
			units = append(units, uint16(data[i])<<8|uint16(data[i+1]))
		} else {
			units = append(units, uint16(data[i+1])<<8|uint16(data[i]))
		}
	}
	return string(utf16.Decode(units))
}

// sniffUTF16 recognises BOM-less UTF-16 text: mostly-ASCII subtitles put a NUL
// in every other byte.
func sniffUTF16(data []byte) (bigEndian, ok bool) {
	n := len(data)
	if n > 4096 {
		n = 4096
	}
	n -= n % 2
	if n < 4 {
		return false, false
	}
	even, odd := 0, 0
	for i := 0; i < n; i += 2 {
		if data[i] == 0 {
			even++
		}
		if data[i+1] == 0 {
			odd++
		}
	}
	pairs := n / 2
	switch {
	case odd*10 >= pairs*3 && even == 0:
		return false, true
	case even*10 >= pairs*3 && odd == 0:
		return true, true
	}
	return false, false
}
