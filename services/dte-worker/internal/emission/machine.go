// Package emission implements the idempotent DTE emission state machine.
//
// It owns the exactly-once guard for document emission requests: a stale
// retry carrying an already-seen (tenant, idempotency_key) pair can never
// create a second emission — the historical double-emission risk under
// stale-retry (Notion Hy3-architect-oleada-2) is closed by construction.
//
// The machine is storage-agnostic (store.Store) and emits no network calls:
// real SII interaction belongs to an emitter adapter behind an explicit
// interface; the sandbox adapter shipped with this service never talks to SII.
package emission

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

type State string

const (
	StateQueued   State = "queued"
	StateEmitting State = "emitting"
	StateEmitted  State = "emitted"
	StateFailed   State = "failed"
	StateDead     State = "dead"
)

var (
	ErrNotFound      = errors.New("emission not found")
	ErrNotClaimable  = errors.New("emission not claimable")
	ErrTenantMissing = errors.New("tenant id required")
	ErrKeyMissing    = errors.New("idempotency key required")
	ErrTypeMissing   = errors.New("document type required")
)

// Emission is one document emission request and its lifecycle state.
type Emission struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenant_id"`
	IdempotencyKey string    `json:"idempotency_key"`
	DocumentType   string    `json:"document_type"`
	State          State     `json:"state"`
	Attempts       int       `json:"attempts"`
	MaxAttempts    int       `json:"max_attempts"`
	LastError      string    `json:"last_error,omitempty"`
	ClaimedBy      string    `json:"claimed_by,omitempty"`
	ResultRef      string    `json:"result_ref,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	NextAttemptAt  time.Time `json:"next_attempt_at"`
}

// Request is the enqueue input. Payload stays opaque to the queue.
type Request struct {
	TenantID       string `json:"tenant_id"`
	IdempotencyKey string `json:"idempotency_key"`
	DocumentType   string `json:"document_type"`
}

// Store is the persistence boundary (memory impl here; Firestore later).
type Store interface {
	GetByKey(tenantID, key string) (*Emission, bool)
	Get(id string) (*Emission, bool)
	Put(e *Emission)
	All() []*Emission
}

// Machine runs the state machine. Safe for concurrent use.
type Machine struct {
	mu          sync.Mutex
	store       Store
	maxAttempts int
	now         func() time.Time
	backoff     func(attempt int) time.Duration
}

type Option func(*Machine)

func WithMaxAttempts(n int) Option          { return func(m *Machine) { m.maxAttempts = n } }
func WithClock(now func() time.Time) Option { return func(m *Machine) { m.now = now } }
func WithBackoff(b func(attempt int) time.Duration) Option {
	return func(m *Machine) { m.backoff = b }
}

func New(store Store, opts ...Option) *Machine {
	m := &Machine{store: store, maxAttempts: 5, now: time.Now, backoff: func(int) time.Duration { return 0 }}
	for _, o := range opts {
		o(m)
	}
	return m
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Enqueue registers a request once per (tenant, idempotency_key). A repeat
// returns the original emission with deduped=true: the exactly-once guard.
func (m *Machine) Enqueue(req Request) (em *Emission, deduped bool, err error) {
	if req.TenantID == "" {
		return nil, false, ErrTenantMissing
	}
	if req.IdempotencyKey == "" {
		return nil, false, ErrKeyMissing
	}
	if req.DocumentType == "" {
		return nil, false, ErrTypeMissing
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.store.GetByKey(req.TenantID, req.IdempotencyKey); ok {
		return existing, true, nil
	}
	t := m.now()
	em = &Emission{
		ID: newID(), TenantID: req.TenantID, IdempotencyKey: req.IdempotencyKey,
		DocumentType: req.DocumentType, State: StateQueued,
		MaxAttempts: m.maxAttempts, CreatedAt: t, UpdatedAt: t, NextAttemptAt: t,
	}
	m.store.Put(em)
	return em, false, nil
}

// ClaimNext claims one due emission for a worker (queued, or failed and due
// for retry). Returns nil when nothing is claimable.
func (m *Machine) ClaimNext(workerID string) *Emission {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for _, e := range m.store.All() {
		claimable := e.State == StateQueued ||
			(e.State == StateFailed && e.Attempts < e.MaxAttempts && !e.NextAttemptAt.After(now))
		if !claimable {
			continue
		}
		e.State = StateEmitting
		e.ClaimedBy = workerID
		e.Attempts++
		e.UpdatedAt = now
		m.store.Put(e)
		return e
	}
	return nil
}

// Complete marks an emission as emitted with an opaque result reference.
func (m *Machine) Complete(id, resultRef string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.store.Get(id)
	if !ok {
		return ErrNotFound
	}
	if e.State != StateEmitting {
		return ErrNotClaimable
	}
	e.State = StateEmitted
	e.ResultRef = resultRef
	e.ClaimedBy = ""
	e.LastError = ""
	e.UpdatedAt = m.now()
	m.store.Put(e)
	return nil
}

// Fail records a failure. Retryable failures below MaxAttempts return to the
// queue with backoff; anything else goes to the dead-letter state.
func (m *Machine) Fail(id, reason string, retryable bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.store.Get(id)
	if !ok {
		return ErrNotFound
	}
	if e.State != StateEmitting {
		return ErrNotClaimable
	}
	now := m.now()
	e.LastError = reason
	e.ClaimedBy = ""
	e.UpdatedAt = now
	if retryable && e.Attempts < e.MaxAttempts {
		e.State = StateFailed
		e.NextAttemptAt = now.Add(m.backoff(e.Attempts))
	} else {
		e.State = StateDead
	}
	m.store.Put(e)
	return nil
}

// Get returns one emission scoped by tenant.
func (m *Machine) Get(tenantID, id string) (*Emission, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.store.Get(id)
	if !ok || e.TenantID != tenantID {
		return nil, false
	}
	return e, true
}
