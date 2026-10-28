package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"syscall"
	"time"

	"github.com/bongdo/chinese-cards/server/internal/deckfmt"
	"github.com/bongdo/chinese-cards/server/internal/httpapi"
	"github.com/bongdo/chinese-cards/server/internal/store"
)

func main() {
	addr := env("ADDR", ":8787")
	dbPath := env("DB", "./data/cards.db")
	deckDir := env("DECK_DIR", "./decks")
	apkDir := env("APK_DIR", "./dist/apk")

	logger := log.New(os.Stdout, "", log.LstdFlags)
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		logger.Fatalf("data dir: %v", err)
	}

	st, err := store.Open(dbPath)
	if err != nil {
		logger.Fatalf("open db: %v", err)
	}
	defer st.Close()

	syncDecks := func(_ context.Context) ([]store.ImportResult, error) {
		return importDir(st, deckDir, logger)
	}
	if results, err := syncDecks(context.Background()); err != nil {
		logger.Printf("initial sync: %v", err)
	} else {
		for _, r := range results {
			logger.Printf("deck %s: +%d ~%d -%d = %d", r.Deck, r.Added, r.Updated, r.Removed, r.Total)
		}
	}

	srv := httpapi.New(st, httpapi.Options{
		Token:    os.Getenv("CARDS_TOKEN"),
		Webhook:  os.Getenv("AGENT_WEBHOOK"),
		APKDir:   apkDir,
		SyncFunc: syncDecks,
		Logger:   logger,
	})

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Printf("listening on %s (decks: %s)", addr, deckDir)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Printf("shutdown: %v", err)
	}
}

func importDir(st *store.Store, dir string, logger *log.Logger) ([]store.ImportResult, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.deck"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)

	results := make([]store.ImportResult, 0, len(files))
	for _, file := range files {
		f, err := os.Open(file)
		if err != nil {
			logger.Printf("%s: %v", file, err)
			continue
		}
		deck, err := deckfmt.Parse(f)
		f.Close()
		if err != nil {
			logger.Printf("%s: %v", file, err)
			continue
		}
		res, err := st.Import(deck, time.Now())
		if err != nil {
			logger.Printf("%s: %v", file, err)
			continue
		}
		results = append(results, res)
	}
	return results, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
