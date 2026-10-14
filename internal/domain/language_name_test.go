package domain

import "testing"

func TestLanguageFromNameResolvesNamesCodesAndLegacyTags(t *testing.T) {
	tests := map[string]string{
		"Romanian": "ro", "Română": "ro", "romana": "ro", "ROMÂNĂ": "ro", "ro": "ro", "ron": "ro", "rum": "ro", "mol": "ro",
		"English": "en", "engleza": "en", "eng": "en", "Français": "fr", "francais": "fr", "Español": "es", "Deutsch": "de",
		"Magyar": "hu", "cmn": "zh", "yue": "zh", "fil": "tl",
		"und": "", "": "", "forced": "", "1080p": "", "subs": "",
	}
	for input, want := range tests {
		if got := LanguageFromName(input); got != want {
			t.Errorf("LanguageFromName(%q) = %q, want %q", input, got, want)
		}
	}
}
