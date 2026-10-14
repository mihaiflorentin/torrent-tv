package application

import "testing"

// Server.Shutdown waits for in-flight handlers, and an SSE handler only ends
// when its stream closes: closing the streams is what lets shutdown drain.
func TestCloseEventStreamsEndsSubscribers(t *testing.T) {
	service, _ := refreshHarness(t)
	stream, cancel := service.SubscribeEvents()
	defer cancel()
	service.CloseEventStreams()
	if _, open := <-stream; open {
		t.Fatal("subscriber stream must be closed")
	}
	late, lateCancel := service.SubscribeEvents()
	defer lateCancel()
	if _, open := <-late; open {
		t.Fatal("subscribing after the streams closed must yield a closed stream")
	}
	cancel() // double cancel after close must not panic
}
