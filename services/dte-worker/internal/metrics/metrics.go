// Package metrics is a minimal dependency-free counter registry with text
// exposition (Prometheus-compatible counter lines).
package metrics

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

type Registry struct {
	mu       sync.Mutex
	counters map[string]int64
}

func New() *Registry { return &Registry{counters: map[string]int64{}} }

func (r *Registry) Inc(name string, delta int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters[name] += delta
}

func (r *Registry) Get(name string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.counters[name]
}

func (r *Registry) Text() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	names := make([]string, 0, len(r.counters))
	for n := range r.counters {
		names = append(names, n)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, n := range names {
		fmt.Fprintf(&b, "# TYPE %s counter\n%s %d\n", n, n, r.counters[n])
	}
	return b.String()
}
