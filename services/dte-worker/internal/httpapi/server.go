// Package httpapi exposes the versioned DTE emission worker contract.
//
// Deny-by-default: every /v1 route requires a valid bearer secret, an
// explicit tenant header and (for writes) an Idempotency-Key. The server
// refuses to start without a secret.
package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/emission"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/limits"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/metrics"
)

type Server struct {
	machine *emission.Machine
	secret  string
	limiter *limits.Limiter
	metrics *metrics.Registry
	log     *slog.Logger
}

func New(machine *emission.Machine, secret string, limiter *limits.Limiter, reg *metrics.Registry, log *slog.Logger) (*Server, error) {
	if secret == "" {
		return nil, errors.New("worker secret is required (deny-by-default)")
	}
	if log == nil {
		log = slog.Default()
	}
	if reg == nil {
		reg = metrics.New()
	}
	return &Server{machine: machine, secret: secret, limiter: limiter, metrics: reg, log: log}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/emissions", s.handleEnqueue)
	mux.HandleFunc("GET /v1/emissions/{id}", s.handleGet)
	mux.HandleFunc("GET /healthz", s.handleLiveness)
	mux.HandleFunc("GET /livez", s.handleLiveness)
	mux.HandleFunc("GET /readyz", s.handleReadiness)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	return mux
}

func (s *Server) authorized(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	got := []byte(strings.TrimPrefix(auth, prefix))
	want := []byte(s.secret)
	return len(got) == len(want) && subtle.ConstantTimeCompare(got, want) == 1
}

type enqueueBody struct {
	DocumentType string          `json:"document_type"`
	Payload      json.RawMessage `json:"payload"`
}

type emissionResponse struct {
	Emission         emission.Emission `json:"emission"`
	IdempotentReplay bool              `json:"idempotent_replay"`
}

func (s *Server) handleEnqueue(w http.ResponseWriter, r *http.Request) {
	s.metrics.Inc("dte_http_requests_total", 1)
	if !s.authorized(r) {
		s.metrics.Inc("dte_http_unauthorized_total", 1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tenant := r.Header.Get("X-Tenant-Id")
	if tenant == "" {
		http.Error(w, "X-Tenant-Id required", http.StatusBadRequest)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		http.Error(w, "Idempotency-Key required", http.StatusBadRequest)
		return
	}
	if s.limiter != nil && !s.limiter.Allow(tenant) {
		s.metrics.Inc("dte_http_rate_limited_total", 1)
		w.Header().Set("Retry-After", "1")
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	var body enqueueBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DocumentType == "" {
		http.Error(w, "document_type required", http.StatusBadRequest)
		return
	}
	em, deduped, err := s.machine.Enqueue(emission.Request{
		TenantID: tenant, IdempotencyKey: key, DocumentType: body.DocumentType,
	})
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if deduped {
		s.metrics.Inc("dte_emissions_deduped_total", 1)
	} else {
		s.metrics.Inc("dte_emissions_enqueued_total", 1)
	}
	s.log.Info("emission.enqueued", "id", em.ID, "tenant", tenant, "doc_type", body.DocumentType, "replay", deduped)
	status := http.StatusCreated
	if deduped {
		status = http.StatusOK
	}
	writeJSON(w, status, emissionResponse{Emission: *em, IdempotentReplay: deduped})
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	s.metrics.Inc("dte_http_requests_total", 1)
	if !s.authorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tenant := r.Header.Get("X-Tenant-Id")
	if tenant == "" {
		http.Error(w, "X-Tenant-Id required", http.StatusBadRequest)
		return
	}
	em, ok := s.machine.Get(tenant, r.PathValue("id"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, emissionResponse{Emission: *em})
}

func (s *Server) handleLiveness(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
}

func (s *Server) handleReadiness(w http.ResponseWriter, _ *http.Request) {
	// Memory store is always ready; the Firestore-backed Store will add a
	// real dependency probe here (fail-closed when unreachable).
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = w.Write([]byte(s.metrics.Text()))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
