package application

import (
	"strings"
	"testing"
)

func cuePayloads(t *testing.T, vtt []byte) []string {
	t.Helper()
	out := []string{}
	for _, block := range strings.Split(strings.ReplaceAll(string(vtt), "\r\n", "\n"), "\n\n") {
		lines := strings.Split(block, "\n")
		for i, line := range lines {
			if strings.Contains(line, "-->") {
				out = append(out, strings.Join(lines[i+1:], "\n"))
				break
			}
		}
	}
	return out
}

func TestToWebVTTResolvesBreakTagsOverridesAndEntitiesInCueText(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\nLine1</br>Line2\n\n" +
		"2\n00:00:03,000 --> 00:00:04,000\nA<br/>B <BR />C\n\n" +
		"3\n00:00:05,000 --> 00:00:06,000\nD&lt;br&gt;E\n\n" +
		"4\n00:00:07,000 --> 00:00:08,000\n{\\an8}Top\\NBottom\n\n" +
		"5\n00:00:09,000 --> 00:00:10,000\n<font color=\"#ff0\">Yellow</font> <i>it</i>\n\n" +
		"6\n00:00:11,000 --> 00:00:12,000\nX</br>\n</br>Y\n"
	got, err := toWebVTT([]byte(srt), ".srt")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Line1\nLine2", "A\nB\nC", "D\nE", "Top\nBottom", "Yellow <i>it</i>", "X\nY"}
	payloads := cuePayloads(t, got)
	if len(payloads) != len(want) {
		t.Fatalf("cues = %q, want %d cues", payloads, len(want))
	}
	for i := range want {
		if strings.TrimSpace(payloads[i]) != want[i] {
			t.Errorf("cue %d = %q, want %q", i+1, payloads[i], want[i])
		}
	}
}

func TestToWebVTTAssDialogueUsesRealNewlinesAndFormattingTags(t *testing.T) {
	ass := "[Script Info]\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}Top\\NBottom {\\i1}slant{\\i0} a & b\n"
	got, err := toWebVTT([]byte(ass), ".ass")
	if err != nil {
		t.Fatal(err)
	}
	payloads := cuePayloads(t, got)
	if len(payloads) != 1 || strings.TrimSpace(payloads[0]) != "Top\nBottom <i>slant</i> a &amp; b" {
		t.Fatalf("ass cue = %q", payloads)
	}
}

func TestToWebVTTCleansEmbeddedVTTTracksToo(t *testing.T) {
	vtt := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne</br>Two\n"
	got, err := toWebVTT([]byte(vtt), ".vtt")
	if err != nil {
		t.Fatal(err)
	}
	if payloads := cuePayloads(t, got); len(payloads) != 1 || strings.TrimSpace(payloads[0]) != "One\nTwo" {
		t.Fatalf("vtt cue = %q", payloads)
	}
}

func TestToSAMIBreaksLinesForEveryBreakSpelling(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\nLine1</br>Line2<br/>L3 <font color=\"red\">x</font>\n"
	got, err := toSAMI([]byte(srt), ".srt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "<P Class=SUBTTL>Line1<br>Line2<br>L3 x</P>") {
		t.Fatalf("sami = %q", got)
	}
}
