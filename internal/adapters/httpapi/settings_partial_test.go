package httpapi

import (
	"net/http"
	"testing"
)

// Omitted fields in a PUT keep their current value instead of silently
// becoming zero/false.
func TestPutSettingsKeepsOmittedFields(t *testing.T) {
	handler := newStubHandler(t, nil)
	before := getSettingsBody(t, handler)
	if before["protectLeased"] != true {
		t.Skipf("fixture default protectLeased = %v; the test needs it enabled", before["protectLeased"])
	}
	rec := putSettingsBody(t, handler, map[string]any{"instanceName": "Living room"})
	// instanceName alone must now be enough: everything else is inherited.
	if rec.Code != http.StatusOK {
		t.Fatalf("partial PUT status = %d, body = %s", rec.Code, rec.Body.String())
	}
	after := getSettingsBody(t, handler)
	if after["instanceName"] != "Living room" {
		t.Fatalf("sent field not applied: %v", after["instanceName"])
	}
	if after["protectLeased"] != true || after["maxConcurrentJobs"] != before["maxConcurrentJobs"] {
		t.Fatalf("omitted fields were reset: protectLeased=%v maxConcurrentJobs=%v", after["protectLeased"], after["maxConcurrentJobs"])
	}
}
