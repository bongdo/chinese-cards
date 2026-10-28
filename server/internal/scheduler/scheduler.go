package scheduler

import "time"

var ladder = []time.Duration{
	0,
	24 * time.Hour,
	3 * 24 * time.Hour,
	7 * 24 * time.Hour,
	16 * 24 * time.Hour,
	40 * 24 * time.Hour,
	90 * 24 * time.Hour,
	200 * 24 * time.Hour,
	400 * 24 * time.Hour,
}

const Relearn = 10 * time.Minute

var MaxBox = len(ladder) - 1

type State struct {
	Box    int
	DueAt  time.Time
	Lapses int
	Reps   int
}

func Next(s State, known bool, now time.Time) State {
	if !known {
		s.Box = 0
		s.Lapses++
		s.DueAt = now.Add(Relearn)
		return s
	}
	if s.Box < 0 {
		s.Box = 0
	}
	s.Box++
	if s.Box > MaxBox {
		s.Box = MaxBox
	}
	s.Reps++
	s.DueAt = now.Add(ladder[s.Box])
	return s
}

func Interval(box int) time.Duration {
	if box < 0 || box > MaxBox {
		return 0
	}
	return ladder[box]
}
