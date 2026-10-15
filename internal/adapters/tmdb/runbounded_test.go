package tmdb

import (
	"context"
	"errors"
	"testing"
)

// A cancelled parent context must surface as an error: workers skip their
// items, so returning nil would leave zero-value results to be cached.
func TestRunBoundedReportsParentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ran := 0
	err := runBounded(ctx, 5, func(int) error { ran++; return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled (ran %d)", err, ran)
	}
}

func TestRunBoundedReportsCancellationDuringRun(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := runBounded(ctx, 8, func(i int) error {
		if i == 0 {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
