package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/aitu/clearance/backend/internal/httpapi"
	"github.com/aitu/clearance/backend/internal/store"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		logger.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		logger.Error("connect to database", "error", err)
		os.Exit(1)
	}
	if err := store.Migrate(ctx, db); err != nil {
		logger.Error("apply database migrations", "error", err)
		os.Exit(1)
	}
	if err := store.Seed(ctx, db, os.Getenv("ADMIN_LOGIN"), os.Getenv("ADMIN_PASSWORD")); err != nil {
		logger.Error("seed initial data", "error", err)
		os.Exit(1)
	}

	config := httpapi.Config{
		CookieSecure:        envBool("COOKIE_SECURE", true),
		AppOrigin:           strings.TrimRight(os.Getenv("APP_ORIGIN"), "/"),
		AppURL:              strings.TrimRight(os.Getenv("APP_URL"), "/"),
		TelegramBotUsername: strings.TrimPrefix(os.Getenv("TELEGRAM_BOT_USERNAME"), "@"),
		TelegramBotToken:    os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramSecret:      os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
		TrustedProxies:      commaSeparated(os.Getenv("TRUSTED_PROXIES")),
		Logger:              logger,
	}
	if config.TelegramBotUsername == "" {
		config.TelegramBotUsername = "aitu_clearance_bot"
	}
	if config.AppURL == "" {
		config.AppURL = config.AppOrigin
	}
	if config.AppURL == "" {
		config.AppURL = "http://localhost:5173"
	}

	server := &http.Server{
		Addr:              envString("HTTP_ADDR", ":8000"),
		Handler:           httpapi.New(db, config),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("shutdown HTTP server", "error", err)
		}
	}()

	logger.Info("backend listening", "address", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("HTTP server failed", "error", err)
		os.Exit(1)
	}
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	value, ok := os.LookupEnv(name)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.EqualFold(value, "true") || value == "1" || strings.EqualFold(value, "yes")
}

func commaSeparated(value string) []string {
	items := strings.Split(value, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}
