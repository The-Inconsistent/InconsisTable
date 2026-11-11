package table

import (
	"slices"
	"sync"
	"testing"
	"time"
)

func TestSerialRunsOneKeyInOrderAndKeysApart(t *testing.T) {
	q := NewSerial()
	var mu sync.Mutex
	var order []int
	var dones []<-chan struct{}
	for i := range 20 {
		dones = append(dones, q.Go("a", func() {
			time.Sleep(time.Millisecond)
			mu.Lock()
			order = append(order, i)
			mu.Unlock()
		}))
	}
	// Another key does not wait behind "a".
	blocked := make(chan struct{})
	q.Go("a", func() { <-blocked })
	select {
	case <-q.Go("b", func() {}):
	case <-time.After(time.Second):
		t.Fatal("key b waited behind key a")
	}
	close(blocked)
	for _, d := range dones {
		<-d
	}
	if !slices.IsSorted(order) || len(order) != 20 {
		t.Fatalf("ran out of order: %v", order)
	}
}

func TestSerialAFailureDoesNotBreakTheChainAndIdleKeysLeaveNothing(t *testing.T) {
	q := NewSerial()
	q.Go("a", func() { panic("boom") })
	ran := false
	q.Do("a", func() { ran = true })
	if !ran {
		t.Fatal("the call after a panic did not run")
	}
	deadline := time.Now().Add(time.Second)
	for q.pending() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if n := q.pending(); n != 0 {
		t.Fatalf("an idle queue holds %d entries", n)
	}
}
