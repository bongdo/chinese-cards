package scheduler

import (
	"testing"
	"time"
)

var now = time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)

func TestKnownClimbsOneBox(t *testing.T) {
	s := Next(State{}, true, now)
	if s.Box != 1 || s.Reps != 1 || s.Lapses != 0 {
		t.Fatalf("state: %+v", s)
	}
	if want := now.Add(24 * time.Hour); !s.DueAt.Equal(want) {
		t.Fatalf("due: want %v, got %v", want, s.DueAt)
	}
}

func TestKnownClimbsLadder(t *testing.T) {
	s := State{}
	for i := 1; i <= MaxBox; i++ {
		s = Next(s, true, now)
		if s.Box != i {
			t.Fatalf("step %d: box %d", i, s.Box)
		}
		if want := now.Add(Interval(i)); !s.DueAt.Equal(want) {
			t.Fatalf("step %d: due %v, want %v", i, s.DueAt, want)
		}
	}
	s = Next(s, true, now)
	if s.Box != MaxBox {
		t.Fatalf("box must stay capped, got %d", s.Box)
	}
}

func TestUnknownResets(t *testing.T) {
	s := Next(State{Box: 5, Reps: 9, Lapses: 2}, false, now)
	if s.Box != 0 || s.Lapses != 3 || s.Reps != 9 {
		t.Fatalf("state: %+v", s)
	}
	if want := now.Add(Relearn); !s.DueAt.Equal(want) {
		t.Fatalf("due: got %v, want %v", s.DueAt, want)
	}
}

func TestNegativeBoxIsSanitised(t *testing.T) {
	s := Next(State{Box: -3}, true, now)
	if s.Box != 1 {
		t.Fatalf("box: %d", s.Box)
	}
}
