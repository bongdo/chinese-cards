package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/bongdo/chinese-cards/server/internal/deckfmt"
	"github.com/bongdo/chinese-cards/server/internal/store"
)

const deck = `!deck test/a
!title Тест
я = 我 [wǒ]
ты = 你 [nǐ]
`

func newServer(t *testing.T, opts Options) (*store.Store, *httptest.Server) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if opts.SyncFunc == nil {
		opts.SyncFunc = func(context.Context) ([]store.ImportResult, error) {
			d, err := deckfmt.Parse(strings.NewReader(deck))
			if err != nil {
				t.Fatal(err)
			}
			res, err := st.Import(d, time.Now())
			return []store.ImportResult{res}, err
		}
	}
	srv := httptest.NewServer(New(st, opts).Handler())
	t.Cleanup(srv.Close)
	return st, srv
}

func post(t *testing.T, url string, body any) (*http.Response, []byte) {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

func get(t *testing.T, url string) (*http.Response, []byte) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

func TestStudyFlow(t *testing.T) {
	_, srv := newServer(t, Options{})

	resp, _ := get(t, srv.URL+"/api/health")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health: %d", resp.StatusCode)
	}

	resp, data := post(t, srv.URL+"/api/sync", map[string]string{})
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), `"added":2`) {
		t.Fatalf("sync: %d %s", resp.StatusCode, data)
	}

	resp, data = get(t, srv.URL+"/api/study?limit=10")
	var list struct {
		Cards []store.Card `json:"cards"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatalf("study json: %v (%s)", err, data)
	}
	if resp.StatusCode != http.StatusOK || len(list.Cards) != 2 {
		t.Fatalf("study: %d %s", resp.StatusCode, data)
	}

	resp, data = post(t, srv.URL+"/api/review", map[string]any{
		"card_id": list.Cards[0].ID, "known": true, "elapsed_ms": 1500,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("review: %d %s", resp.StatusCode, data)
	}

	_, data = get(t, srv.URL+"/api/study")
	list.Cards = nil
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatalf("study json: %v", err)
	}
	if len(list.Cards) != 1 {
		t.Fatalf("after review due: %d", len(list.Cards))
	}

	_, data = get(t, srv.URL+"/api/stats?days=7")
	if !strings.Contains(string(data), `"answers":1`) {
		t.Fatalf("stats: %s", data)
	}

	resp, data = get(t, srv.URL+"/api/digest")
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "Китайский — прогресс") {
		t.Fatalf("digest: %d %s", resp.StatusCode, data)
	}
}

func TestReviewAcceptsClientStateAndDedupes(t *testing.T) {
	_, srv := newServer(t, Options{})
	post(t, srv.URL+"/api/sync", map[string]string{})

	_, data := get(t, srv.URL+"/api/study")
	var list struct {
		Cards []store.Card `json:"cards"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatalf("study json: %v", err)
	}
	id := list.Cards[0].ID
	due := time.Now().Add(48 * time.Hour).UnixMilli()
	body := map[string]any{
		"event_id": "event-1", "card_id": id, "known": true,
		"box": 3, "due_at": due, "lapses": 1, "reps": 5,
	}
	for i := 0; i < 2; i++ {
		if resp, data := post(t, srv.URL+"/api/review", body); resp.StatusCode != http.StatusOK {
			t.Fatalf("review: %d %s", resp.StatusCode, data)
		}
	}

	var changes struct {
		Cards []store.Card `json:"cards"`
	}
	_, data = get(t, srv.URL+"/api/changes?since=0")
	if err := json.Unmarshal(data, &changes); err != nil {
		t.Fatalf("changes json: %v", err)
	}
	for _, card := range changes.Cards {
		if card.ID != id {
			continue
		}
		if card.Box != 3 || card.Lapses != 1 || card.Reps != 5 || card.DueAt.UnixMilli() != due {
			t.Fatalf("state not stored: %+v", card)
		}
		return
	}
	t.Fatalf("card %s missing from changes", id)
}

func TestImportValidatesDeck(t *testing.T) {
	_, srv := newServer(t, Options{})
	resp, data := post(t, srv.URL+"/api/import", map[string]string{"text": "мусор"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("import: %d %s", resp.StatusCode, data)
	}
	resp, data = post(t, srv.URL+"/api/import", map[string]string{"text": deck})
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), `"deck":"test/a"`) {
		t.Fatalf("import: %d %s", resp.StatusCode, data)
	}
}

func TestAuth(t *testing.T) {
	_, srv := newServer(t, Options{Token: "s3cret"})

	resp, _ := get(t, srv.URL+"/api/decks")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", resp.StatusCode)
	}
	resp, _ = get(t, srv.URL+"/")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("root must stay open, got %d", resp.StatusCode)
	}
	resp, _ = get(t, srv.URL+"/api/health")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health must stay open, got %d", resp.StatusCode)
	}
	resp, _ = get(t, srv.URL+"/apk/")
	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("apk downloads must not require a token")
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/decks", nil)
	req.Header.Set("Authorization", "Bearer s3cret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200 with token, got %d", resp.StatusCode)
	}
}

func TestWebhookFires(t *testing.T) {
	events := make(chan map[string]any, 1)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		events <- payload
	}))
	defer hook.Close()

	_, srv := newServer(t, Options{Webhook: hook.URL})
	post(t, srv.URL+"/api/sync", map[string]string{})
	_, data := get(t, srv.URL+"/api/study")
	var list struct {
		Cards []store.Card `json:"cards"`
	}
	_ = json.Unmarshal(data, &list)
	post(t, srv.URL+"/api/review", map[string]any{"card_id": list.Cards[0].ID, "known": false})

	select {
	case ev := <-events:
		if ev["event"] != "review" || ev["known"] != false {
			t.Fatalf("payload: %+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("webhook did not fire")
	}
}

func TestAPKIndexAndFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "chinese-1.apk"), []byte("APKDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, srv := newServer(t, Options{APKDir: dir})

	resp, data := get(t, srv.URL+"/apk/")
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "chinese-1.apk") {
		t.Fatalf("index: %d %s", resp.StatusCode, data)
	}

	resp, data = get(t, srv.URL+"/apk/chinese-1.apk")
	if resp.StatusCode != http.StatusOK || string(data) != "APKDATA" {
		t.Fatalf("file: %d %s", resp.StatusCode, data)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "android.package-archive") {
		t.Fatalf("content type: %s", ct)
	}

	resp, _ = get(t, srv.URL+"/apk/missing.apk")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing: %d", resp.StatusCode)
	}
}

func TestCardEditAndDelete(t *testing.T) {
	_, srv := newServer(t, Options{})
	post(t, srv.URL+"/api/sync", map[string]string{})

	_, data := get(t, srv.URL+"/api/study")
	var list struct {
		Cards []store.Card `json:"cards"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatalf("study json: %v", err)
	}
	id := list.Cards[0].ID

	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/api/cards/"+id,
		strings.NewReader(`{"front":"я","back":"俺","pinyin":"ǎn","note":"редко"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch status: %d", resp.StatusCode)
	}

	var changes struct {
		Cards   []store.Card `json:"cards"`
		Deleted []string     `json:"deleted"`
		Now     int64        `json:"now"`
	}
	_, data = get(t, srv.URL+"/api/changes?since=0")
	if err := json.Unmarshal(data, &changes); err != nil {
		t.Fatalf("changes json: %v", err)
	}
	if len(changes.Cards) != 2 {
		t.Fatalf("changes after patch: %+v", changes.Cards)
	}
	edited := false
	for _, card := range changes.Cards {
		if card.ID == id {
			edited = card.Back == "俺" && card.Pinyin == "ǎn"
		}
	}
	if !edited {
		t.Fatalf("edit not visible in changes: %+v", changes.Cards)
	}
	if changes.Now == 0 {
		t.Fatal("changes must return now")
	}

	req, _ = http.NewRequest(http.MethodDelete, srv.URL+"/api/cards/"+id, nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status: %d", resp.StatusCode)
	}

	_, data = get(t, srv.URL+"/api/changes?since=0")
	if err := json.Unmarshal(data, &changes); err != nil {
		t.Fatalf("changes json: %v", err)
	}
	if len(changes.Deleted) != 1 || changes.Deleted[0] != id {
		t.Fatalf("tombstones: %+v", changes.Deleted)
	}

	_, data = get(t, srv.URL+"/api/changes?since="+strconv.FormatInt(changes.Now, 10))
	if err := json.Unmarshal(data, &changes); err != nil {
		t.Fatalf("changes json: %v", err)
	}
	if len(changes.Cards) != 0 || len(changes.Deleted) != 0 {
		t.Fatalf("delta must be empty: %+v", changes)
	}

	req, _ = http.NewRequest(http.MethodPatch, srv.URL+"/api/cards/missing",
		strings.NewReader(`{"front":"a","back":"b"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing card status: %d", resp.StatusCode)
	}
}
