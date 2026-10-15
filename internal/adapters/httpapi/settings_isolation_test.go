package httpapi

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

// A rejected PUT must leave the live settings untouched: decoding writes into
// the backing arrays of slices, which the store's copy still shares.
func TestFailedPutSettingsDoesNotMutateLiveSettings(t *testing.T) {
	handler := newStubHandler(t, nil)
	before := getSettingsBody(t, handler)
	keys := []string{"trustedCidrs", "evictionRules", "metadataProviders"}
	for _, key := range keys {
		if _, ok := before[key]; !ok {
			t.Fatalf("settings body lacks %s", key)
		}
	}

	rec := putSettingsBody(t, handler, map[string]any{
		"trustedCidrs":      []string{"10.9.9.0/24"},
		"evictionRules":     []string{"x"},
		"metadataProviders": []string{"zzz"},
		"maxConcurrentJobs": 9999, // fails validation
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body %s", rec.Code, rec.Body.String())
	}
	after := getSettingsBody(t, handler)
	for _, key := range keys {
		if !reflect.DeepEqual(after[key], before[key]) {
			t.Errorf("%s mutated by a rejected PUT: %v, want %v", key, after[key], before[key])
		}
	}
}

func TestSettingsCloneDoesNotAlias(t *testing.T) {
	a := config.Defaults()
	b := a.Clone()
	b.TrustedCIDRs[0] = "changed"
	b.EvictionRules[0] = "changed"
	b.MetadataProviders[0] = "changed"
	if a.TrustedCIDRs[0] == "changed" || a.EvictionRules[0] == "changed" || a.MetadataProviders[0] == "changed" {
		t.Fatal("Clone shares slice storage")
	}
}
