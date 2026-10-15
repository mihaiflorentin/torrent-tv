package application

import (
	"strings"
	"testing"
)

// In SRT and WebVTT, {braces} and backslash sequences are dialogue.
func TestToWebVTTKeepsLiteralBracesAndBackslashesInSRTAndVTT(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\nHe typed {admin} then C:\\new\n\n" +
		"2\n00:00:03,000 --> 00:00:04,000\n{music}\n\n" +
		"3\n00:00:05,000 --> 00:00:06,000\n{\\an8}Top {\\i1}it{\\i0}\n"
	want := []string{"He typed {admin} then C:\\new", "{music}", "Top <i>it</i>"}
	for _, format := range []string{".srt", ".vtt"} {
		input := srt
		if format == ".vtt" {
			input = "WEBVTT\n\n" + strings.ReplaceAll(srt, ",000", ".000")
		}
		got, err := toWebVTT([]byte(input), format)
		if err != nil {
			t.Fatal(err)
		}
		payloads := cuePayloads(t, got)
		if len(payloads) != len(want) {
			t.Fatalf("%s cues = %q", format, payloads)
		}
		for i := range want {
			if strings.TrimSpace(payloads[i]) != want[i] {
				t.Errorf("%s cue %d = %q, want %q", format, i+1, payloads[i], want[i])
			}
		}
	}
}

func TestToWebVTTAssBreaksAndOverrides(t *testing.T) {
	ass := "[Script Info]\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}A\\nB\\NC {\\pos(1,2)}D\n"
	got, err := toWebVTT([]byte(ass), ".ass")
	if err != nil {
		t.Fatal(err)
	}
	payloads := cuePayloads(t, got)
	if len(payloads) != 1 || strings.TrimSpace(payloads[0]) != "A\nB\nC D" {
		t.Fatalf("ass cue = %q", payloads)
	}
}

func TestToSAMIKeepsLiteralBracesInSRT(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\nHe typed {admin} then C:\\new\n"
	got, err := toSAMI([]byte(srt), ".srt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "He typed {admin} then C:\\new") {
		t.Fatalf("sami = %s", got)
	}
}
