package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg, err := loadConfig(os.Args[1:])
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(2)
	}

	signalContext, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	ctx, cancel := context.WithTimeout(signalContext, 28*time.Minute)
	defer cancel()

	if err := newSyncService(cfg, logger).run(ctx); err != nil {
		logger.Error("sync failed", "error", err)
		os.Exit(1)
	}
	logger.Info("sync finished successfully", "mode", cfg.Mode, "dry_run", cfg.DryRun)
}
