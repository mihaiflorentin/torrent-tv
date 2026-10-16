package application

import (
	"context"
	"sync"
)

// flightGroup coalesces concurrent fetches of the same key into one call. The
// call runs detached from the first caller's context (bounded by
// titleInfoFetchTimeout), so closing a panel mid-fetch neither aborts it nor
// poisons a cache; each waiter still leaves as soon as its own context ends
// (ok=false). The zero value is ready to use; mu guards the group.
type flightGroup[T any] struct {
	calls map[string]*flightCall[T]
}

type flightCall[T any] struct {
	done   chan struct{}
	result T
}

func (g *flightGroup[T]) do(ctx context.Context, mu *sync.Mutex, key string, fetch func(context.Context) T) (T, bool) {
	mu.Lock()
	call, running := g.calls[key]
	if !running {
		if g.calls == nil {
			g.calls = map[string]*flightCall[T]{}
		}
		call = &flightCall[T]{done: make(chan struct{})}
		g.calls[key] = call
		go func() {
			fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), titleInfoFetchTimeout)
			defer cancel()
			call.result = fetch(fetchCtx)
			mu.Lock()
			delete(g.calls, key)
			mu.Unlock()
			close(call.done)
		}()
	}
	mu.Unlock()
	select {
	case <-call.done:
		return call.result, true
	case <-ctx.Done():
		var zero T
		return zero, false
	}
}
