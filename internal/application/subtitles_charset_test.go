package application

import (
	"context"
	"os"
	"strings"
	"testing"
	"unicode/utf16"

	"golang.org/x/text/encoding/charmap"
)

func TestSubtitleLanguageReadsNamesFromSidecarFileNames(t *testing.T) {
	tests := map[string]string{
		"Subs/Romanian.srt":                    "ro",
		"Subs/2_Romanian.srt":                  "ro",
		"Movie.2023.Romana.srt":                "ro",
		"Movie.Română.srt":                     "ro",
		"Subs/English.SDH.srt":                 "en",
		"Subs/3_French.srt":                    "fr",
		"Movie.ro.srt":                         "ro",
		"Movie.ron.forced.srt":                 "ro",
		"Movie.rum.srt":                        "ro",
		"Movie.mol.srt":                        "ro",
		"Subs/Romanian/2_Track.srt":            "ro",
		"Subs/English/Movie.2023.srt":          "en",
		"Movie.2023.1080p.WEB-DL.srt":          "",
		"Subs/Movie.2023.1080p.srt":            "",
		"Movie.Romanian.Dubbed.1080p.x264.srt": "",
	}
	for name, want := range tests {
		if got := subtitleLanguage(name); got != want {
			t.Errorf("subtitleLanguage(%q) = %q, want %q", name, got, want)
		}
	}
}

func encode(t *testing.T, enc *charmap.Charmap, text string) []byte {
	t.Helper()
	out, err := enc.NewEncoder().String(text)
	if err != nil {
		t.Fatal(err)
	}
	return []byte(out)
}

func utf16Bytes(text string, bigEndian bool, bom bool) []byte {
	units := utf16.Encode([]rune(text))
	out := []byte{}
	if bom {
		if bigEndian {
			out = append(out, 0xFE, 0xFF)
		} else {
			out = append(out, 0xFF, 0xFE)
		}
	}
	for _, unit := range units {
		if bigEndian {
			out = append(out, byte(unit>>8), byte(unit))
		} else {
			out = append(out, byte(unit), byte(unit>>8))
		}
	}
	return out
}

func TestDecodeSubtitleTextDetectsEncodings(t *testing.T) {
	const ro = "Știu că înțeleg șțăâî ȘȚĂÂÎ"
	legacy := "Ştiu că înţeleg şţăâî ŞŢĂÂÎ" // cedilla forms as found in cp1250 files
	tests := []struct {
		name string
		data []byte
		lang string
		want string
	}{
		{"utf8", []byte(ro), "ro", ro},
		{"utf8 bom", append([]byte{0xEF, 0xBB, 0xBF}, ro...), "", ro},
		{"utf16le bom", utf16Bytes(ro, false, true), "", ro},
		{"utf16be bom", utf16Bytes(ro, true, true), "", ro},
		{"utf16le no bom", utf16Bytes(ro, false, false), "", ro},
		{"cp1250 with ro hint", encode(t, charmap.Windows1250, legacy), "ro", ro},
		{"cp1250 without hint", encode(t, charmap.Windows1250, legacy), "", ro},
		{"iso-8859-2 with ro hint", encode(t, charmap.ISO8859_2, legacy), "ro", ro},
		{"cp1252 fallback", encode(t, charmap.Windows1252, "Où êtes-vous ? Señor Müller"), "", "Où êtes-vous ? Señor Müller"},
		{"cp1251 with ru hint", encode(t, charmap.Windows1251, "Привет, мир"), "ru", "Привет, мир"},
		{"ascii", []byte("plain"), "", "plain"},
	}
	for _, test := range tests {
		if got := decodeSubtitleText(test.data, test.lang); got != test.want {
			t.Errorf("%s: got %q, want %q", test.name, got, test.want)
		}
	}
}

func TestPrepareSubtitleConvertsLegacyEncodedRomanianSRTToUTF8WebVTT(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\n" + "Ştiu că înţeleg</br>şţăâî\n"
	provider := &subtitleDownloadStub{download: SubtitleDownload{Data: encode(t, charmap.Windows1250, srt), Format: ".srt", Name: "Movie.ro.srt", Language: "ron"}}
	service := newSubtitleTestService(t, &subtitleEngineStub{}, &subtitleProbeStub{}, provider)
	asset, err := service.PrepareSubtitle(context.Background(), "source", "subdl", "p1", "vtt")
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(asset.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "Știu că înțeleg\nșțăâî") {
		t.Fatalf("body = %q", body)
	}
}

func TestPrepareSubtitleAcceptsUTF16SRT(t *testing.T) {
	srt := "1\r\n00:00:01,000 --> 00:00:02,000\r\nSalut ăâîșț\r\n"
	provider := &subtitleDownloadStub{download: SubtitleDownload{Data: utf16Bytes(srt, false, true), Format: ".srt", Name: "Movie.ro.srt", Language: "ron"}}
	service := newSubtitleTestService(t, &subtitleEngineStub{}, &subtitleProbeStub{}, provider)
	asset, err := service.PrepareSubtitle(context.Background(), "source", "subdl", "p1", "vtt")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(asset.Path)
	if !strings.Contains(string(body), "Salut ăâîșț") {
		t.Fatalf("body = %q", body)
	}
}
