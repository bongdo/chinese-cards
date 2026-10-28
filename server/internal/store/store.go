package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/bongdo/chinese-cards/server/internal/deckfmt"
	"github.com/bongdo/chinese-cards/server/internal/scheduler"
)

type Store struct {
	db *sql.DB
}

type Card struct {
	ID        string    `json:"id"`
	Deck      string    `json:"deck"`
	Front     string    `json:"front"`
	Back      string    `json:"back"`
	Pinyin    string    `json:"pinyin,omitempty"`
	Note      string    `json:"note,omitempty"`
	Box       int       `json:"box"`
	DueAt     time.Time `json:"due_at"`
	Lapses    int       `json:"lapses"`
	Reps      int       `json:"reps"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DeckInfo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Cards int    `json:"cards"`
	Due   int    `json:"due"`
}

type ImportResult struct {
	Deck     string   `json:"deck"`
	Added    int      `json:"added"`
	Updated  int      `json:"updated"`
	Removed  int      `json:"removed"`
	Total    int      `json:"total"`
	Warnings []string `json:"warnings,omitempty"`
}

const schema = `
CREATE TABLE IF NOT EXISTS decks (
	id         TEXT PRIMARY KEY,
	title      TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
	id      TEXT PRIMARY KEY,
	deck    TEXT NOT NULL,
	front   TEXT NOT NULL,
	back    TEXT NOT NULL,
	pinyin  TEXT NOT NULL DEFAULT '',
	note    TEXT NOT NULL DEFAULT '',
	box     INTEGER NOT NULL DEFAULT 0,
	due_at  INTEGER NOT NULL,
	lapses     INTEGER NOT NULL DEFAULT 0,
	reps       INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cards_deck_due ON cards(deck, due_at);
CREATE TABLE IF NOT EXISTS tombstones (
	id         TEXT PRIMARY KEY,
	deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tombstones_deleted ON tombstones(deleted_at);
CREATE TABLE IF NOT EXISTS reviews (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	card_id    TEXT NOT NULL,
	ts         INTEGER NOT NULL,
	known      INTEGER NOT NULL,
	elapsed_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reviews_ts ON reviews(ts);
CREATE TABLE IF NOT EXISTS review_events (
	event_id TEXT PRIMARY KEY,
	card_id  TEXT NOT NULL,
	ts       INTEGER NOT NULL
);
`

func Open(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := ensureColumn(db, "cards", "updated_at", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Import(d *deckfmt.Deck, now time.Time) (ImportResult, error) {
	res := ImportResult{Deck: d.ID, Warnings: d.Warnings}
	tx, err := s.db.Begin()
	if err != nil {
		return res, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO decks(id, title, updated_at) VALUES(?,?,?)
		 ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`,
		d.ID, d.Title, now.UnixMilli()); err != nil {
		return res, err
	}

	keep := make([]string, 0, len(d.Cards))
	for _, c := range d.Cards {
		id := c.ID(d.ID)
		keep = append(keep, id)
		var existed bool
		if err := tx.QueryRow(`SELECT 1 FROM cards WHERE id=?`, id).Scan(new(int)); err == nil {
			existed = true
		} else if err != sql.ErrNoRows {
			return res, err
		}
		if _, err := tx.Exec(
			`INSERT INTO cards(id, deck, front, back, pinyin, note, box, due_at, updated_at)
			 VALUES(?,?,?,?,?,?,0,?,?)
			 ON CONFLICT(id) DO UPDATE SET
			   deck=excluded.deck, front=excluded.front, back=excluded.back,
			   pinyin=excluded.pinyin, note=excluded.note, updated_at=excluded.updated_at`,
			id, d.ID, c.Front, c.Back, c.Pinyin, c.Note, now.UnixMilli(), now.UnixMilli()); err != nil {
			return res, err
		}
		if existed {
			res.Updated++
		} else {
			res.Added++
		}
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keep)), ",")
	args := make([]any, 0, len(keep)+1)
	args = append(args, d.ID)
	for _, id := range keep {
		args = append(args, id)
	}
	if _, err := tx.Exec(
		`DELETE FROM tombstones WHERE id IN (`+placeholders+`)`, args[1:]...); err != nil {
		return res, err
	}
	tombArgs := make([]any, 0, len(args)+1)
	tombArgs = append(tombArgs, now.UnixMilli())
	tombArgs = append(tombArgs, args...)
	if _, err := tx.Exec(
		`INSERT INTO tombstones(id, deleted_at)
		 SELECT id, ? FROM cards WHERE deck=? AND id NOT IN (`+placeholders+`)
		 ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at`, tombArgs...); err != nil {
		return res, err
	}
	out, err := tx.Exec(`DELETE FROM cards WHERE deck=? AND id NOT IN (`+placeholders+`)`, args...)
	if err != nil {
		return res, err
	}
	if n, _ := out.RowsAffected(); n > 0 {
		res.Removed = int(n)
	}

	if err := tx.QueryRow(`SELECT COUNT(*) FROM cards WHERE deck=?`, d.ID).Scan(&res.Total); err != nil {
		return res, err
	}
	return res, tx.Commit()
}

func (s *Store) Decks(now time.Time) ([]DeckInfo, error) {
	rows, err := s.db.Query(
		`SELECT d.id, d.title,
		        COUNT(c.id),
		        COALESCE(SUM(CASE WHEN c.due_at <= ? THEN 1 ELSE 0 END), 0)
		 FROM decks d LEFT JOIN cards c ON c.deck = d.id
		 GROUP BY d.id, d.title ORDER BY d.id`, now.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DeckInfo{}
	for rows.Next() {
		var d DeckInfo
		if err := rows.Scan(&d.ID, &d.Title, &d.Cards, &d.Due); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) Due(deck string, limit int, now time.Time) ([]Card, error) {
	if limit <= 0 {
		limit = 20
	}
	q := `SELECT id, deck, front, back, pinyin, note, box, due_at, lapses, reps, updated_at
	      FROM cards WHERE due_at <= ?`
	args := []any{now.UnixMilli()}
	if deck != "" {
		q += ` AND deck = ?`
		args = append(args, deck)
	}
	q += ` ORDER BY lapses DESC, due_at ASC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCards(rows)
}

func (s *Store) Review(cardID string, known bool, elapsed time.Duration, now time.Time, next *scheduler.State, eventID string) (Card, error) {
	c, err := s.Card(cardID)
	if err != nil {
		return Card{}, err
	}
	if next == nil {
		computed := scheduler.Next(scheduler.State{
			Box: c.Box, DueAt: c.DueAt, Lapses: c.Lapses, Reps: c.Reps,
		}, known, now)
		next = &computed
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Card{}, err
	}
	defer tx.Rollback()

	if eventID != "" {
		res, err := tx.Exec(
			`INSERT INTO review_events(event_id, card_id, ts) VALUES(?,?,?)
			 ON CONFLICT(event_id) DO NOTHING`,
			eventID, cardID, now.UnixMilli())
		if err != nil {
			return Card{}, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return c, tx.Commit()
		}
	}

	if _, err := tx.Exec(
		`UPDATE cards SET box=?, due_at=?, lapses=?, reps=? WHERE id=?`,
		next.Box, next.DueAt.UnixMilli(), next.Lapses, next.Reps, cardID); err != nil {
		return Card{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO reviews(card_id, ts, known, elapsed_ms) VALUES(?,?,?,?)`,
		cardID, now.UnixMilli(), boolInt(known), elapsed.Milliseconds()); err != nil {
		return Card{}, err
	}
	if err := tx.Commit(); err != nil {
		return Card{}, err
	}

	c.Box, c.DueAt, c.Lapses, c.Reps = next.Box, next.DueAt, next.Lapses, next.Reps
	return c, nil
}

func (s *Store) Card(id string) (Card, error) {
	rows, err := s.db.Query(
		`SELECT id, deck, front, back, pinyin, note, box, due_at, lapses, reps, updated_at
		 FROM cards WHERE id=?`, id)
	if err != nil {
		return Card{}, err
	}
	defer rows.Close()
	cards, err := scanCards(rows)
	if err != nil {
		return Card{}, err
	}
	if len(cards) == 0 {
		return Card{}, fmt.Errorf("card %q not found", id)
	}
	return cards[0], nil
}

func scanCards(rows *sql.Rows) ([]Card, error) {
	out := []Card{}
	for rows.Next() {
		var c Card
		var due, lapses, reps, updated int64
		if err := rows.Scan(&c.ID, &c.Deck, &c.Front, &c.Back, &c.Pinyin, &c.Note,
			&c.Box, &due, &lapses, &reps, &updated); err != nil {
			return nil, err
		}
		c.DueAt = time.UnixMilli(due)
		c.Lapses, c.Reps = int(lapses), int(reps)
		c.UpdatedAt = time.UnixMilli(updated)
		out = append(out, c)
	}
	return out, rows.Err()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

type Stats struct {
	Total     int        `json:"total"`
	DueNow    int        `json:"due_now"`
	New       int        `json:"new"`
	Answers   int        `json:"answers"`
	KnownRate float64    `json:"known_rate"`
	Streak    int        `json:"streak"`
	Days      []DayStat  `json:"days"`
	Hardest   []HardCard `json:"hardest"`
}

type DayStat struct {
	Date    string `json:"date"`
	Known   int    `json:"known"`
	Unknown int    `json:"unknown"`
}

type HardCard struct {
	ID     string `json:"id"`
	Front  string `json:"front"`
	Back   string `json:"back"`
	Lapses int    `json:"lapses"`
}

func (s *Store) BuildStats(days int, now time.Time) (Stats, error) {
	if days <= 0 {
		days = 7
	}
	st := Stats{Days: []DayStat{}, Hardest: []HardCard{}}

	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cards`).Scan(&st.Total); err != nil {
		return st, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cards WHERE due_at <= ?`, now.UnixMilli()).Scan(&st.DueNow); err != nil {
		return st, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cards WHERE reps = 0 AND lapses = 0`).Scan(&st.New); err != nil {
		return st, err
	}

	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).
		AddDate(0, 0, -(days - 1))
	rows, err := s.db.Query(`SELECT ts, known FROM reviews WHERE ts >= ?`, start.UnixMilli())
	if err != nil {
		return st, err
	}
	defer rows.Close()

	byDay := map[string]*DayStat{}
	for i := 0; i < days; i++ {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		byDay[d] = &DayStat{Date: d}
	}
	for rows.Next() {
		var ts int64
		var known int
		if err := rows.Scan(&ts, &known); err != nil {
			return st, err
		}
		if known == 1 {
			if d, ok := byDay[time.UnixMilli(ts).Format("2006-01-02")]; ok {
				d.Known++
			}
		} else {
			if d, ok := byDay[time.UnixMilli(ts).Format("2006-01-02")]; ok {
				d.Unknown++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return st, err
	}

	known, total := 0, 0
	for _, d := range byDay {
		known += d.Known
		total += d.Known + d.Unknown
	}
	st.Answers = total
	if total > 0 {
		st.KnownRate = float64(known) / float64(total)
	}
	for i := 0; i < days; i++ {
		st.Days = append(st.Days, *byDay[start.AddDate(0, 0, i).Format("2006-01-02")])
	}
	st.Streak = s.streak(now)

	hardRows, err := s.db.Query(
		`SELECT id, front, back, lapses FROM cards WHERE lapses > 0
		 ORDER BY lapses DESC, front LIMIT 5`)
	if err != nil {
		return st, err
	}
	defer hardRows.Close()
	for hardRows.Next() {
		var h HardCard
		if err := hardRows.Scan(&h.ID, &h.Front, &h.Back, &h.Lapses); err != nil {
			return st, err
		}
		st.Hardest = append(st.Hardest, h)
	}
	return st, hardRows.Err()
}

func (s *Store) streak(now time.Time) int {
	rows, err := s.db.Query(`SELECT DISTINCT ts FROM reviews`)
	if err != nil {
		return 0
	}
	defer rows.Close()

	active := map[string]bool{}
	for rows.Next() {
		var ts int64
		if rows.Scan(&ts) != nil {
			return 0
		}
		active[time.UnixMilli(ts).Format("2006-01-02")] = true
	}

	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !active[day.Format("2006-01-02")] {
		day = day.AddDate(0, 0, -1)
	}
	n := 0
	for active[day.Format("2006-01-02")] {
		n++
		day = day.AddDate(0, 0, -1)
	}
	return n
}

func (s *Store) Digest(now time.Time) (string, error) {
	st, err := s.BuildStats(7, now)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "## Китайский — прогресс (%s)\n\n", now.Format("2006-01-02"))
	fmt.Fprintf(&b, "- карточек всего: %d, к повторению сейчас: %d, ещё не видел: %d\n", st.Total, st.DueNow, st.New)
	fmt.Fprintf(&b, "- за 7 дней: %d ответов, «знаю» %.0f%%\n", st.Answers, st.KnownRate*100)
	fmt.Fprintf(&b, "- серия: %d дн.\n", st.Streak)
	if len(st.Hardest) > 0 {
		b.WriteString("- проваливается чаще всего: ")
		parts := make([]string, 0, len(st.Hardest))
		for _, h := range st.Hardest {
			parts = append(parts, fmt.Sprintf("%s (%d)", h.Front, h.Lapses))
		}
		b.WriteString(strings.Join(parts, ", "))
		b.WriteString("\n")
	}
	return b.String(), nil
}

type Changes struct {
	Cards   []Card   `json:"cards"`
	Deleted []string `json:"deleted"`
	Now     int64    `json:"now"`
}

func (s *Store) Changes(since int64, now time.Time) (Changes, error) {
	out := Changes{Cards: []Card{}, Deleted: []string{}, Now: now.UnixMilli()}

	rows, err := s.db.Query(
		`SELECT id, deck, front, back, pinyin, note, box, due_at, lapses, reps, updated_at
		 FROM cards WHERE updated_at > ? ORDER BY updated_at`, since)
	if err != nil {
		return out, err
	}
	out.Cards, err = scanCards(rows)
	rows.Close()
	if err != nil {
		return out, err
	}

	deleted, err := s.db.Query(`SELECT id FROM tombstones WHERE deleted_at > ?`, since)
	if err != nil {
		return out, err
	}
	defer deleted.Close()
	for deleted.Next() {
		var id string
		if err := deleted.Scan(&id); err != nil {
			return out, err
		}
		out.Deleted = append(out.Deleted, id)
	}
	return out, deleted.Err()
}

func (s *Store) UpdateCard(id, front, back, pinyin, note string, now time.Time) (Card, error) {
	res, err := s.db.Exec(
		`UPDATE cards SET front=?, back=?, pinyin=?, note=?, updated_at=? WHERE id=?`,
		front, back, pinyin, note, now.UnixMilli(), id)
	if err != nil {
		return Card{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Card{}, fmt.Errorf("card %q not found", id)
	}
	return s.Card(id)
}

func (s *Store) DeleteCard(id string, now time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`DELETE FROM cards WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("card %q not found", id)
	}
	if _, err := tx.Exec(
		`INSERT INTO tombstones(id, deleted_at) VALUES(?,?)
		 ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at`,
		id, now.UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func ensureColumn(db *sql.DB, table, column, decl string) error {
	var n int
	q := fmt.Sprintf(`SELECT COUNT(*) FROM pragma_table_info('%s') WHERE name = '%s'`, table, column)
	if err := db.QueryRow(q).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, decl))
	return err
}
