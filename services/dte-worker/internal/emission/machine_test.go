package emission

import (
	"testing"
	"time"
)

// memStore: Store mínimo local al paquete de test (rompe el ciclo
// emission -> store -> emission que existiría importando el paquete store).
type memStore struct {
	byID  map[string]*Emission
	byKey map[string]string
	order []string
}

func newMemStore() *memStore {
	return &memStore{byID: map[string]*Emission{}, byKey: map[string]string{}}
}
func (s *memStore) GetByKey(tenantID, key string) (*Emission, bool) {
	id, ok := s.byKey[tenantID+"|"+key]
	if !ok {
		return nil, false
	}
	e := *s.byID[id]
	return &e, true
}
func (s *memStore) Get(id string) (*Emission, bool) {
	e, ok := s.byID[id]
	if !ok {
		return nil, false
	}
	c := *e
	return &c, true
}
func (s *memStore) Put(e *Emission) {
	if _, seen := s.byID[e.ID]; !seen {
		s.order = append(s.order, e.ID)
	}
	cp := *e
	s.byID[e.ID] = &cp
	s.byKey[e.TenantID+"|"+e.IdempotencyKey] = e.ID
}
func (s *memStore) All() []*Emission {
	out := make([]*Emission, 0, len(s.order))
	for _, id := range s.order {
		cp := *s.byID[id]
		out = append(out, &cp)
	}
	return out
}

func newTestMachine(opts ...Option) *Machine {
	return New(newMemStore(), append([]Option{WithBackoff(func(int) time.Duration { return 0 })}, opts...)...)
}

func TestEnqueueIsIdempotentPerTenantAndKey(t *testing.T) {
	m := newTestMachine()
	a, deduped, err := m.Enqueue(Request{TenantID: "t1", IdempotencyKey: "k1", DocumentType: "33"})
	if err != nil || deduped {
		t.Fatalf("first enqueue: em=%v deduped=%v err=%v", a, deduped, err)
	}
	b, deduped, err := m.Enqueue(Request{TenantID: "t1", IdempotencyKey: "k1", DocumentType: "33"})
	if err != nil || !deduped {
		t.Fatalf("stale retry must dedupe: deduped=%v err=%v", deduped, err)
	}
	if a.ID != b.ID {
		t.Fatalf("stale retry created a second emission: %s vs %s", a.ID, b.ID)
	}
	other, deduped, err := m.Enqueue(Request{TenantID: "t2", IdempotencyKey: "k1", DocumentType: "33"})
	if err != nil || deduped {
		t.Fatalf("tenant isolation: deduped=%v err=%v", deduped, err)
	}
	if other.ID == a.ID {
		t.Fatal("same key in another tenant must be a distinct emission")
	}
}

func TestEnqueueValidatesRequiredFields(t *testing.T) {
	m := newTestMachine()
	if _, _, err := m.Enqueue(Request{IdempotencyKey: "k", DocumentType: "33"}); err != ErrTenantMissing {
		t.Fatalf("tenant: %v", err)
	}
	if _, _, err := m.Enqueue(Request{TenantID: "t", DocumentType: "33"}); err != ErrKeyMissing {
		t.Fatalf("key: %v", err)
	}
	if _, _, err := m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k"}); err != ErrTypeMissing {
		t.Fatalf("type: %v", err)
	}
}

func TestClaimIsExclusiveAndCompletes(t *testing.T) {
	m := newTestMachine()
	em, _, _ := m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k", DocumentType: "33"})
	claimed := make(chan *Emission, 2)
	for i := 0; i < 2; i++ {
		go func(id string) { claimed <- m.ClaimNext(id) }("w")
	}
	first, second := <-claimed, <-claimed
	if first == nil {
		t.Fatal("one claim must succeed")
	}
	if second != nil {
		t.Fatal("two workers claimed the same emission")
	}
	if err := m.Complete(first.ID, "sii-fake-ref"); err != nil {
		t.Fatal(err)
	}
	got, ok := m.Get("t", em.ID)
	if !ok || got.State != StateEmitted || got.ResultRef != "sii-fake-ref" || got.ClaimedBy != "" {
		t.Fatalf("complete: %+v", got)
	}
}

func TestFailRetryThenDeadLetter(t *testing.T) {
	m := newTestMachine(WithMaxAttempts(2))
	em, _, _ := m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k", DocumentType: "33"})
	if c := m.ClaimNext("w"); c == nil {
		t.Fatal("claim 1")
	}
	if err := m.Fail(em.ID, "timeout", true); err != nil {
		t.Fatal(err)
	}
	got, _ := m.Get("t", em.ID)
	if got.State != StateFailed {
		t.Fatalf("retryable fail -> failed, got %s", got.State)
	}
	if c := m.ClaimNext("w"); c == nil {
		t.Fatal("claim 2 after retry")
	}
	if err := m.Fail(em.ID, "timeout", true); err != nil {
		t.Fatal(err)
	}
	got, _ = m.Get("t", em.ID)
	if got.State != StateDead {
		t.Fatalf("attempts exhausted -> dead, got %s", got.State)
	}
	if c := m.ClaimNext("w"); c != nil {
		t.Fatal("dead emissions must not be claimable")
	}
}

func TestNonRetryableFailGoesStraightToDead(t *testing.T) {
	m := newTestMachine()
	em, _, _ := m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k", DocumentType: "33"})
	m.ClaimNext("w")
	if err := m.Fail(em.ID, "invalid document", false); err != nil {
		t.Fatal(err)
	}
	got, _ := m.Get("t", em.ID)
	if got.State != StateDead {
		t.Fatalf("non-retryable -> dead, got %s", got.State)
	}
}

func TestGetIsTenantScoped(t *testing.T) {
	m := newTestMachine()
	em, _, _ := m.Enqueue(Request{TenantID: "t1", IdempotencyKey: "k", DocumentType: "33"})
	if _, ok := m.Get("t2", em.ID); ok {
		t.Fatal("cross-tenant read must not resolve")
	}
}

func TestBackoffSchedulesFutureRetry(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	m := newTestMachine(WithClock(func() time.Time { return now }), WithBackoff(func(a int) time.Duration { return time.Duration(a) * time.Minute }))
	em, _, _ := m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k", DocumentType: "33"})
	m.ClaimNext("w")
	if err := m.Fail(em.ID, "timeout", true); err != nil {
		t.Fatal(err)
	}
	if c := m.ClaimNext("w"); c != nil {
		t.Fatal("retry before backoff elapses must not claim")
	}
	now = now.Add(2 * time.Minute)
	if c := m.ClaimNext("w"); c == nil {
		t.Fatal("retry after backoff must claim")
	}
}
