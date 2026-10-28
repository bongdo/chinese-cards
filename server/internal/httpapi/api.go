package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bongdo/chinese-cards/server/internal/deckfmt"
	"github.com/bongdo/chinese-cards/server/internal/scheduler"
	"github.com/bongdo/chinese-cards/server/internal/store"
)

type Options struct {
	Token    string
	Webhook  string
	APKDir   string
	SyncFunc func(context.Context) ([]store.ImportResult, error)
	Logger   *log.Logger
}

type Server struct {
	store *store.Store
	opts  Options
	http  *http.Client
}

func New(st *store.Store, opts Options) *Server {
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	return &Server{store: st, opts: opts, http: &http.Client{Timeout: 5 * time.Second}}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /favicon.ico", s.noContent)
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/decks", s.decks)
	mux.HandleFunc("POST /api/import", s.importDeck)
	mux.HandleFunc("POST /api/sync", s.sync)
	mux.HandleFunc("GET /api/study", s.study)
	mux.HandleFunc("POST /api/review", s.review)
	mux.HandleFunc("GET /api/stats", s.stats)
	mux.HandleFunc("GET /api/changes", s.changes)
	mux.HandleFunc("PATCH /api/cards/{id}", s.updateCard)
	mux.HandleFunc("DELETE /api/cards/{id}", s.deleteCard)
	mux.HandleFunc("GET /api/digest", s.digest)
	mux.HandleFunc("GET /apk/", s.apkIndex)
	mux.HandleFunc("GET /apk/{name}", s.apkFile)
	return s.withLogging(s.withCORS(s.withAuth(mux)))
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.opts.Logger.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.opts.Token == "" || r.URL.Path == "/" || r.URL.Path == "/favicon.ico" ||
			r.URL.Path == "/api/health" || strings.HasPrefix(r.URL.Path, "/apk/") {
			next.ServeHTTP(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got == "" {
			got = r.Header.Get("X-Token")
		}
		if got != s.opts.Token {
			s.opts.Logger.Printf("auth failed: %s %s token_len=%d ua=%q",
				r.Method, r.URL.Path, len(got), r.UserAgent())
			writeErr(w, http.StatusUnauthorized, "bad token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) home(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>Chinese cards</title>` +
		`<h1>Chinese cards API</h1><p><a href="/apk/">APK</a> · <a href="/api/health">health</a></p>`))
}

func (s *Server) noContent(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
}

func (s *Server) decks(w http.ResponseWriter, r *http.Request) {
	decks, err := s.store.Decks(time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"decks": decks})
}

type importRequest struct {
	Text string `json:"text"`
}

func (s *Server) importDeck(w http.ResponseWriter, r *http.Request) {
	var req importRequest
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	deck, err := deckfmt.Parse(strings.NewReader(req.Text))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := s.store.Import(deck, time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) sync(w http.ResponseWriter, r *http.Request) {
	if s.opts.SyncFunc == nil {
		writeErr(w, http.StatusNotImplemented, "no deck directory configured")
		return
	}
	results, err := s.opts.SyncFunc(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) study(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	cards, err := s.store.Due(r.URL.Query().Get("deck"), limit, time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cards": cards, "count": len(cards)})
}

type reviewRequest struct {
	CardID    string `json:"card_id"`
	Known     bool   `json:"known"`
	ElapsedMS int    `json:"elapsed_ms"`
	EventID   string `json:"event_id"`
	Box       *int   `json:"box"`
	DueAt     *int64 `json:"due_at"`
	Lapses    *int   `json:"lapses"`
	Reps      *int   `json:"reps"`
}

func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	var req reviewRequest
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.CardID == "" {
		writeErr(w, http.StatusBadRequest, "card_id is required")
		return
	}
	card, err := s.store.Review(req.CardID, req.Known,
		time.Duration(req.ElapsedMS)*time.Millisecond, time.Now(), scheduleFrom(req), req.EventID)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"card":     card,
		"interval": card.DueAt.Sub(time.Now()).Round(time.Minute).String(),
		"due_at":   card.DueAt,
	})
	go s.notify(map[string]any{
		"event":  "review",
		"card":   card,
		"known":  req.Known,
		"source": "app",
	})
}

func scheduleFrom(req reviewRequest) *scheduler.State {
	if req.Box == nil || req.DueAt == nil || req.Lapses == nil || req.Reps == nil || *req.DueAt <= 0 {
		return nil
	}
	box := max(0, min(*req.Box, scheduler.MaxBox))
	return &scheduler.State{
		Box:    box,
		DueAt:  time.UnixMilli(*req.DueAt),
		Lapses: max(0, *req.Lapses),
		Reps:   max(0, *req.Reps),
	}
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	days := 7
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}
	st, err := s.store.BuildStats(days, time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) digest(w http.ResponseWriter, _ *http.Request) {
	text, err := s.store.Digest(time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(text))
}

func (s *Server) apkIndex(w http.ResponseWriter, _ *http.Request) {
	if s.opts.APKDir == "" {
		writeErr(w, http.StatusNotFound, "apk dir is not configured")
		return
	}
	entries, err := os.ReadDir(s.opts.APKDir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type item struct {
		name string
		size int64
		mod  time.Time
	}
	items := []item{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".apk") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, item{entry.Name(), info.Size(), info.ModTime()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.After(items[j].mod) })

	var b strings.Builder
	b.WriteString("<!doctype html><meta charset=utf-8><title>APK</title>")
	b.WriteString("<h1>Сборки приложения</h1><ul>")
	for _, it := range items {
		b.WriteString(`<li><a href="/apk/` + html.EscapeString(it.name) + `">` +
			html.EscapeString(it.name) + "</a> — " +
			strconv.FormatInt(it.size/1024, 10) + " KiB, " +
			it.mod.Format("2006-01-02 15:04") + "</li>")
	}
	b.WriteString("</ul>")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(b.String()))
}

func (s *Server) apkFile(w http.ResponseWriter, r *http.Request) {
	if s.opts.APKDir == "" {
		writeErr(w, http.StatusNotFound, "apk dir is not configured")
		return
	}
	name := filepath.Base(r.PathValue("name"))
	if !strings.HasSuffix(name, ".apk") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	path := filepath.Join(s.opts.APKDir, name)
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	http.ServeFile(w, r, path)
}

func (s *Server) notify(payload map[string]any) {
	if s.opts.Webhook == "" {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, s.opts.Webhook, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		s.opts.Logger.Printf("webhook: %v", err)
		return
	}
	resp.Body.Close()
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) changes(w http.ResponseWriter, r *http.Request) {
	var since int64
	if v := r.URL.Query().Get("since"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "since must be milliseconds")
			return
		}
		since = parsed
	}
	out, err := s.store.Changes(since, time.Now())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type cardPatch struct {
	Front  string `json:"front"`
	Back   string `json:"back"`
	Pinyin string `json:"pinyin"`
	Note   string `json:"note"`
}

func (s *Server) updateCard(w http.ResponseWriter, r *http.Request) {
	var req cardPatch
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	front, back := strings.TrimSpace(req.Front), strings.TrimSpace(req.Back)
	if front == "" || back == "" {
		writeErr(w, http.StatusBadRequest, "front and back are required")
		return
	}
	card, err := s.store.UpdateCard(r.PathValue("id"), front, back,
		strings.TrimSpace(req.Pinyin), strings.TrimSpace(req.Note), time.Now())
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, card)
}

func (s *Server) deleteCard(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCard(r.PathValue("id"), time.Now()); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
