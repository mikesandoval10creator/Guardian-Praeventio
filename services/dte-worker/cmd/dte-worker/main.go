// Command dte-worker runs the DTE emission queue worker.
//
// The service is opt-in infrastructure behind a feature flag: the existing
// Node emission path stays authoritative until this worker passes its Go
// gate (docs/production/RUST-GO-FEASIBILITY-GATE.md) and is promoted in
// staging with a tested rollback.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/emission"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/httpapi"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/limits"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/metrics"
	"github.com/mikesandoval10creator/Guardian-Praeventio/services/dte-worker/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	addr := os.Getenv("DTE_WORKER_ADDR")
	if addr == "" {
		addr = ":8787"
	}
	secret := os.Getenv("DTE_WORKER_SECRET")
	if secret == "" {
		log.Error("startup.refused", "reason", "DTE_WORKER_SECRET is required (deny-by-default)")
		os.Exit(2)
	}
	reg := metrics.New()
	machine := emission.New(store.NewMemory(), emission.WithMaxAttempts(5))
	srv, err := httpapi.New(machine, secret, limits.New(10, 20, nil), reg, log)
	if err != nil {
		log.Error("startup.refused", "reason", err.Error())
		os.Exit(2)
	}
	httpSrv := &http.Server{Addr: addr, Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Info("worker.listening", "addr", addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("worker.failed", "reason", err.Error())
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("worker.shutdown_error", "reason", err.Error())
	}
	log.Info("worker.stopped")
}
