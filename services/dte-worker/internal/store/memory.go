// Package store defines the persistence boundary of the emission machine.
package store

import (
	"sync"

	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/emission"
)

// Memory is an in-memory Store. The Firestore-backed Store is a later,
// separately-reviewed slice; this implementation is the tested reference.
type Memory struct {
	mu    sync.RWMutex
	byID  map[string]*emission.Emission
	byKey map[string]string // tenant|key -> id
	order []string
}

func NewMemory() *Memory {
	return &Memory{byID: map[string]*emission.Emission{}, byKey: map[string]string{}}
}

func composite(tenantID, key string) string { return tenantID + "|" + key }

func (s *Memory) GetByKey(tenantID, key string) (*emission.Emission, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.byKey[composite(tenantID, key)]
	if !ok {
		return nil, false
	}
	e := *s.byID[id]
	return &e, true
}

func (s *Memory) Get(id string) (*emission.Emission, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.byID[id]
	if !ok {
		return nil, false
	}
	c := *e
	return &c, true
}

func (s *Memory) Put(e *emission.Emission) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, seen := s.byID[e.ID]; !seen {
		s.order = append(s.order, e.ID)
	}
	cp := *e
	s.byID[e.ID] = &cp
	s.byKey[composite(e.TenantID, e.IdempotencyKey)] = e.ID
}

func (s *Memory) All() []*emission.Emission {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*emission.Emission, 0, len(s.order))
	for _, id := range s.order {
		cp := *s.byID[id]
		out = append(out, &cp)
	}
	return out
}
