package application

import (
	"sync"
	"testing"
)

// Event ids are assigned by the journal; fan-out must deliver them in id
// order or a client reconnecting with Last-Event-ID permanently skips one.
func TestConcurrentPublishDeliversEventsInIDOrder(t *testing.T) {
	service, _ := refreshHarness(t)
	const publishers, each = 8, 25
	stream, cancel := service.SubscribeEvents()
	defer cancel()
	received := make(chan int64, publishers*each)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for event := range stream {
			if event.Kind == "order.test" {
				received <- event.ID
			}
			if len(received) == publishers*each {
				return
			}
		}
	}()
	var wg sync.WaitGroup
	for p := 0; p < publishers; p++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < each; i++ {
				service.PublishEvent("order.test", map[string]int{"i": i})
			}
		}()
	}
	wg.Wait()
	<-done
	close(received)
	var last int64
	for id := range received {
		if id <= last {
			t.Fatalf("event %d delivered after %d", id, last)
		}
		last = id
	}
}
