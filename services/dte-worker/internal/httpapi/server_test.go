package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/emission"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/limits"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/metrics"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/store"
)

const testSecret = "test-secret-do-not-use-in-prod"

func newTestServer(t *testing.T, rate, burst float64) (*Server, *metrics.Registry) {
	t.Helper()
	reg := metrics.New()
	machine := emission.New(store.NewMemory())
	limiter := limits.New(rate, burst, nil)
	srv, err := New(machine, testSecret, limiter, reg, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return srv, reg
}

func doEnqueue(t *testing.T, h http.Handler, tenant, key, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/emissions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testSecret)
	req.Header.Set("X-Tenant-Id", tenant)
	req.Header.Set("Idempotency-Key", key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestNewRefusesEmptySecret(t *testing.T) {
	if _, err := New(emission.New(store.NewMemory()), "", nil, nil, nil); err == nil {
		t.Fatal("deny-by-default: empty secret must refuse to build the server")
	}
}

func TestEnqueueRequiresAuthorizationTenantAndKey(t *testing.T) {
	srv, _ := newTestServer(t, 100, 100)
	h := srv.Handler()
	body := `{"document_type":"33","payload":{}}`

	req := httptest.NewRequest(http.MethodPost, "/v1/emissions", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/emissions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer wrong")
	req.Header.Set("X-Tenant-Id", "t")
	req.Header.Set("Idempotency-Key", "k")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong secret: %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/emissions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testSecret)
	req.Header.Set("Idempotency-Key", "k")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing tenant: %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/emissions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testSecret)
	req.Header.Set("X-Tenant-Id", "t")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key: %d", rec.Code)
	}
}

func TestEnqueueIsExactlyOnceThroughTheAPI(t *testing.T) {
	srv, reg := newTestServer(t, 100, 100)
	h := srv.Handler()
	body := `{"document_type":"33","payload":{}}`

	first := doEnqueue(t, h, "t1", "k1", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("first: %d %s", first.Code, rec(first))
	}
	var a emissionResponse
	_ = json.Unmarshal(first.Body.Bytes(), &a)
	if a.IdempotentReplay || a.Emission.ID == "" {
		t.Fatalf("first response: %+v", a)
	}

	retry := doEnqueue(t, h, "t1", "k1", body)
	if retry.Code != http.StatusOK {
		t.Fatalf("stale retry: %d %s", retry.Code, rec(retry))
	}
	var b emissionResponse
	_ = json.Unmarshal(retry.Body.Bytes(), &b)
	if !b.IdempotentReplay || b.Emission.ID != a.Emission.ID {
		t.Fatalf("stale retry must replay the original: %+v vs %+v", a, b)
	}
	if reg.Get("dte_emissions_deduped_total") != 1 {
		t.Fatalf("dedupe counter: %d", reg.Get("dte_emissions_deduped_total"))
	}
}

func rec(r *httptest.ResponseRecorder) string { return r.Body.String() }

func TestGetIsTenantScoped(t *testing.T) {
	srv, _ := newTestServer(t, 100, 100)
	h := srv.Handler()
	first := doEnqueue(t, h, "t1", "k1", `{"document_type":"33","payload":{}}`)
	var a emissionResponse
	_ = json.Unmarshal(first.Body.Bytes(), &a)

	get := func(tenant string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/v1/emissions/"+a.Emission.ID, nil)
		req.Header.Set("Authorization", "Bearer "+testSecret)
		req.Header.Set("X-Tenant-Id", tenant)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if got := get("t1"); got.Code != http.StatusOK {
		t.Fatalf("owner read: %d", got.Code)
	}
	if got := get("t2"); got.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant read must 404, got %d", got.Code)
	}
}

func TestRateLimitPerTenant(t *testing.T) {
	srv, _ := newTestServer(t, 1, 2)
	h := srv.Handler()
	body := `{"document_type":"33","payload":{}}`
	var codes []int
	for i := 0; i < 3; i++ {
		codes = append(codes, doEnqueue(t, h, "t1", "k"+string(rune('a'+i)), body).Code)
	}
	if codes[0] != http.StatusCreated || codes[1] != http.StatusCreated || codes[2] != http.StatusTooManyRequests {
		t.Fatalf("burst 2 then 429, got %v", codes)
	}
	other := doEnqueue(t, h, "t2", "kz", body)
	if other.Code != http.StatusCreated {
		t.Fatalf("limiter must be per-tenant, got %d", other.Code)
	}
}

func TestHealthReadinessLiveness(t *testing.T) {
	srv, _ := newTestServer(t, 100, 100)
	h := srv.Handler()
	for _, path := range []string{"/healthz", "/readyz", "/livez"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, rec.Code)
		}
	}
	// One real authorized request so the HTTP counter exists in the output.
	doEnqueue(t, h, "t1", "k1", `{"document_type":"33","payload":{}}`)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "dte_http_requests_total") {
		t.Fatalf("metrics output: %s", rec.Body.String())
	}
}

func TestLimiterRefillsOverTime(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	lim := limits.New(1, 1, func() time.Time { return now })
	if !lim.Allow("t") || lim.Allow("t") {
		t.Fatal("burst 1: first ok, second blocked")
	}
	now = now.Add(2 * time.Second)
	if !lim.Allow("t") {
		t.Fatal("token must refill over time")
	}
}
