package store

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bongdo/chinese-cards/server/internal/deckfmt"
	"github.com/bongdo/chinese-cards/server/internal/scheduler"
)

const deckA = `!deck test/a
!title A
я = 我 [wǒ]
ты = 你 [nǐ]
`

const deckAv2 = `!deck test/a
!title A
я = 我 [wǒ]
ты = 你 [nǐ]
он = 他 [tā]
`

var now = time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC)

func newStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func mustImport(t *testing.T, st *Store, text string, at time.Time) ImportResult {
	t.Helper()
	d, err := deckfmt.Parse(strings.NewReader(text))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	res, err := st.Import(d, at)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	return res
}

func TestImportIsIdempotent(t *testing.T) {
	st := newStore(t)

	first := mustImport(t, st, deckA, now)
	if first.Added != 2 || first.Updated != 0 || first.Total != 2 {
		t.Fatalf("first import: %+v", first)
	}
	second := mustImport(t, st, deckA, now)
	if second.Added != 0 || second.Updated != 2 || second.Removed != 0 || second.Total != 2 {
		t.Fatalf("second import: %+v", second)
	}
}

func TestReimportKeepsProgress(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)

	cards, err := st.Due("test/a", 10, now)
	if err != nil {
		t.Fatalf("due: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("due: %d", len(cards))
	}
	reviewed, err := st.Review(cards[0].ID, true, 2*time.Second, now, nil, "")
	if err != nil {
		t.Fatalf("review: %v", err)
	}
	if reviewed.Box != 1 {
		t.Fatalf("box after known: %d", reviewed.Box)
	}

	mustImport(t, st, deckAv2, now)
	again, err := st.Card(cards[0].ID)
	if err != nil {
		t.Fatalf("card: %v", err)
	}
	if again.Box != 1 || !again.DueAt.Equal(reviewed.DueAt) {
		t.Fatalf("progress lost: %+v", again)
	}
}

func TestRemovedCardIsDeleted(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckAv2, now)
	res := mustImport(t, st, deckA, now)
	if res.Removed != 1 || res.Total != 2 {
		t.Fatalf("removal: %+v", res)
	}
}

func TestDueOnlyReturnsReadyCards(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)

	cards, _ := st.Due("", 10, now)
	if len(cards) != 2 {
		t.Fatalf("due now: %d", len(cards))
	}
	if _, err := st.Review(cards[0].ID, true, 0, now, nil, ""); err != nil {
		t.Fatalf("review: %v", err)
	}
	ready, _ := st.Due("", 10, now)
	if len(ready) != 1 {
		t.Fatalf("after known review: %d due, want 1", len(ready))
	}
	later, _ := st.Due("", 10, now.Add(25*time.Hour))
	if len(later) != 2 {
		t.Fatalf("next day: %d due, want 2", len(later))
	}
}

func TestReviewAcceptsClientSchedule(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)
	cards, _ := st.Due("", 10, now)

	want := scheduler.State{
		Box:    4,
		DueAt:  time.UnixMilli(now.UnixMilli() + 7*24*60*60*1000),
		Lapses: 2,
		Reps:   11,
	}
	got, err := st.Review(cards[0].ID, true, time.Second, now, &want, "e1")
	if err != nil {
		t.Fatalf("review: %v", err)
	}
	if got.Box != want.Box || !got.DueAt.Equal(want.DueAt) ||
		got.Lapses != want.Lapses || got.Reps != want.Reps {
		t.Fatalf("client schedule lost: %+v", got)
	}
}

func TestReviewEventIsIdempotent(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)
	cards, _ := st.Due("", 10, now)

	first, err := st.Review(cards[0].ID, true, time.Second, now, nil, "event-1")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := st.Review(cards[0].ID, true, time.Second, now, nil, "event-1")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.Box != first.Box || !second.DueAt.Equal(first.DueAt) || second.Reps != first.Reps {
		t.Fatalf("duplicate applied: first=%+v second=%+v", first, second)
	}
	st2, err := st.BuildStats(7, now)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if st2.Answers != 1 {
		t.Fatalf("answers: %d", st2.Answers)
	}
}

func TestStatsAndStreak(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)
	cards, _ := st.Due("", 10, now)

	if _, err := st.Review(cards[0].ID, true, time.Second, now, nil, ""); err != nil {
		t.Fatalf("review: %v", err)
	}
	if _, err := st.Review(cards[1].ID, false, time.Second, now, nil, ""); err != nil {
		t.Fatalf("review: %v", err)
	}

	day2 := now.Add(24 * time.Hour)
	if _, err := st.Review(cards[1].ID, true, time.Second, day2, nil, ""); err != nil {
		t.Fatalf("review: %v", err)
	}

	st2, err := st.BuildStats(7, day2)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if st2.Total != 2 || st2.New != 0 {
		t.Fatalf("totals: %+v", st2)
	}
	if st2.Answers != 3 {
		t.Fatalf("answers: %d", st2.Answers)
	}
	if st2.KnownRate < 0.65 || st2.KnownRate > 0.7 {
		t.Fatalf("known rate: %.2f", st2.KnownRate)
	}
	if st2.Streak != 2 {
		t.Fatalf("streak: %d", st2.Streak)
	}
	if len(st2.Hardest) != 1 || st2.Hardest[0].Front != "ты" {
		t.Fatalf("hardest: %+v", st2.Hardest)
	}
	if len(st2.Days) != 7 {
		t.Fatalf("days: %d", len(st2.Days))
	}

	digest, err := st.Digest(day2)
	if err != nil {
		t.Fatalf("digest: %v", err)
	}
	if !strings.Contains(digest, "ты") || !strings.Contains(digest, "2026-10-23") {
		t.Fatalf("digest:\n%s", digest)
	}
}

func TestDecksReportDue(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckA, now)
	decks, err := st.Decks(now)
	if err != nil {
		t.Fatalf("decks: %v", err)
	}
	if len(decks) != 1 || decks[0].ID != "test/a" || decks[0].Cards != 2 || decks[0].Due != 2 {
		t.Fatalf("decks: %+v", decks)
	}
}

func TestRemovedCardLeavesTombstone(t *testing.T) {
	st := newStore(t)
	mustImport(t, st, deckAv2, now)

	cards, _ := st.Due("test/a", 10, now)
	var removed string
	for _, c := range cards {
		if c.Front == "он" {
			removed = c.ID
		}
	}
	if removed == "" {
		t.Fatal("card not imported")
	}

	mustImport(t, st, deckA, now.Add(time.Second))
	changes, err := st.Changes(0, now.Add(2*time.Second))
	if err != nil {
		t.Fatalf("changes: %v", err)
	}
	found := false
	for _, id := range changes.Deleted {
		if id == removed {
			found = true
		}
	}
	if !found {
		t.Fatalf("no tombstone for removed card: %+v", changes.Deleted)
	}

	mustImport(t, st, deckAv2, now.Add(3*time.Second))
	changes, err = st.Changes(0, now.Add(4*time.Second))
	if err != nil {
		t.Fatalf("changes: %v", err)
	}
	if len(changes.Deleted) != 0 {
		t.Fatalf("tombstone must be cleared when the card returns: %+v", changes.Deleted)
	}
}
