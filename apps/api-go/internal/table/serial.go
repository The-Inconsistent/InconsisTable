// Package table is the table socket: the gateway (per-campaign queue, per-seat views, book relay, kicks), the action
// dispatch and the snapshot loaders. It is the Go twin of apps/api/src/table.
package table

import (
	"log"
	"runtime/debug"
	"sync"
)

// Serial runs work for one key after every earlier call for that key has settled.
//
// ponytail: in-process per-campaign queue, assumes one api instance; pg_advisory_xact_lock per campaign when we scale
// out (docs/design.md §5.6).
type Serial struct {
	mu    sync.Mutex
	tails map[string]chan struct{}
}

// NewSerial makes an empty queue.
func NewSerial() *Serial { return &Serial{tails: map[string]chan struct{}{}} }

// Go queues fn behind the key's earlier calls and returns at once; the returned channel closes when fn has run. Taking
// the place in line happens before Go returns, so two calls made in order run in order. A panic in fn is logged and
// does not break the chain, and an idle key leaves no entry behind.
func (q *Serial) Go(key string, fn func()) <-chan struct{} {
	done := make(chan struct{})
	q.mu.Lock()
	prev := q.tails[key]
	q.tails[key] = done
	q.mu.Unlock()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("table: panic in queued work for %s: %v\n%s", key, r, debug.Stack())
			}
			close(done)
			q.mu.Lock()
			if q.tails[key] == done {
				delete(q.tails, key)
			}
			q.mu.Unlock()
		}()
		if prev != nil {
			<-prev
		}
		fn()
	}()
	return done
}

// Do runs fn in the key's line and waits for it.
func (q *Serial) Do(key string, fn func()) { <-q.Go(key, fn) }

// pending is how many keys hold a queue entry, for tests.
func (q *Serial) pending() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.tails)
}
