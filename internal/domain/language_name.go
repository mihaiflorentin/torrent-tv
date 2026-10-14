package domain

import "strings"

// languageNames maps lowercase, diacritic-free English and native language
// names, plus a few legacy or macro-language tags, to ISO 639-1 codes. It
// complements NormalizeLanguage for free-form sources: sidecar file names
// (Subs/Romanian.srt) and Matroska track titles.
var languageNames = map[string]string{
	"romanian": "ro", "romana": "ro", "roman": "ro", "romaneste": "ro", "moldovan": "ro", "moldavian": "ro", "mol": "ro",
	"english": "en", "engleza": "en", "ingles": "en", "englisch": "en", "anglais": "en",
	"french": "fr", "francais": "fr", "franceza": "fr", "frances": "fr", "franzosisch": "fr",
	"german": "de", "deutsch": "de", "germana": "de", "aleman": "de",
	"spanish": "es", "espanol": "es", "castellano": "es", "spaniola": "es",
	"italian": "it", "italiano": "it", "italiana": "it",
	"portuguese": "pt", "portugues": "pt", "portugheza": "pt",
	"dutch": "nl", "nederlands": "nl", "olandeza": "nl",
	"hungarian": "hu", "magyar": "hu", "maghiara": "hu",
	"polish": "pl", "polski": "pl", "poloneza": "pl",
	"czech": "cs", "cestina": "cs", "ceha": "cs",
	"slovak": "sk", "slovencina": "sk",
	"bulgarian": "bg", "balgarski": "bg", "bulgara": "bg",
	"serbian": "sr", "srpski": "sr", "sarba": "sr",
	"croatian": "hr", "hrvatski": "hr", "croata": "hr",
	"slovenian": "sl", "slovene": "sl", "slovenscina": "sl",
	"greek": "el", "ellinika": "el", "greaca": "el",
	"turkish": "tr", "turkce": "tr", "turca": "tr",
	"russian": "ru", "russkij": "ru", "rusa": "ru",
	"ukrainian": "uk", "ucraineana": "uk",
	"swedish": "sv", "svenska": "sv", "danish": "da", "dansk": "da", "norwegian": "no", "norsk": "no", "finnish": "fi", "suomi": "fi",
	"arabic": "ar", "araba": "ar", "hebrew": "he", "ivrit": "he", "persian": "fa", "farsi": "fa",
	"hindi": "hi", "japanese": "ja", "nihongo": "ja", "korean": "ko", "chinese": "zh", "mandarin": "zh", "cantonese": "zh",
	"thai": "th", "vietnamese": "vi", "indonesian": "id", "malay": "ms", "filipino": "tl", "tagalog": "tl",
	"cmn": "zh", "yue": "zh", "fil": "tl",
}

var languageFold = strings.NewReplacer(
	"ă", "a", "â", "a", "î", "i", "ș", "s", "ş", "s", "ț", "t", "ţ", "t",
	"á", "a", "à", "a", "ä", "a", "ã", "a", "å", "a", "é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ï", "i", "ó", "o", "ô", "o", "ö", "o", "õ", "o", "ú", "u", "ü", "u", "ç", "c", "ñ", "n",
	"č", "c", "ě", "e", "š", "s", "ž", "z", "ł", "l", "ő", "o", "ű", "u", "ı", "i",
)

// LanguageFromName resolves a free-form language word to its ISO 639-1 code:
// an ISO code (639-1, 639-2) or an English/native language name, ignoring
// case and diacritics. Unknown or undetermined input answers "".
func LanguageFromName(value string) string {
	word := languageFold.Replace(strings.ToLower(strings.TrimSpace(value)))
	if word == "" {
		return ""
	}
	if code := NormalizeLanguage(word); code != "" {
		return code
	}
	return languageNames[word]
}
