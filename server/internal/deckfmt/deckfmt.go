package deckfmt

import (
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
)

type Card struct {
	Front  string
	Back   string
	Pinyin string
	Note   string
}

type Deck struct {
	ID       string
	Title    string
	Src      string
	Cards    []Card
	Warnings []string
}

func (c Card) ID(deckID string) string {
	sum := sha1.Sum([]byte(deckID + "\x00" + c.Front))
	return hex.EncodeToString(sum[:8])
}

func Parse(r io.Reader) (*Deck, error) {
	d := &Deck{Src: "ru>zh"}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)

	for line := 1; sc.Scan(); line++ {
		raw := strings.TrimSpace(sc.Text())
		if raw == "" || strings.HasPrefix(raw, "#") {
			continue
		}

		if strings.HasPrefix(raw, "!") {
			key, val, ok := strings.Cut(strings.TrimPrefix(raw, "!"), " ")
			if !ok {
				d.Warnings = append(d.Warnings, fmt.Sprintf("line %d: meta line without value", line))
				continue
			}
			key, val = strings.TrimSpace(key), strings.TrimSpace(val)
			switch key {
			case "deck":
				d.ID = val
			case "title":
				d.Title = val
			case "src":
				d.Src = val
			default:
				d.Warnings = append(d.Warnings, fmt.Sprintf("line %d: unknown meta %q", line, key))
			}
			continue
		}

		front, back, ok := strings.Cut(raw, "=")
		front, back = strings.TrimSpace(front), strings.TrimSpace(back)
		if !ok || front == "" || back == "" {
			d.Warnings = append(d.Warnings, fmt.Sprintf("line %d: expected `front = back`", line))
			continue
		}

		card, note := Card{Front: front}, ""
		if i := strings.LastIndex(back, "//"); i >= 0 {
			card.Back, note = strings.TrimSpace(back[:i]), strings.TrimSpace(back[i+2:])
		} else {
			card.Back = back
		}
		if strings.HasSuffix(card.Back, "]") {
			if i := strings.LastIndex(card.Back, "["); i >= 0 {
				card.Pinyin = strings.TrimSpace(card.Back[i+1 : len(card.Back)-1])
				card.Back = strings.TrimSpace(card.Back[:i])
			}
		}
		card.Note = note
		if card.Back == "" {
			d.Warnings = append(d.Warnings, fmt.Sprintf("line %d: empty back side", line))
			continue
		}
		d.Cards = append(d.Cards, card)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}

	if d.ID == "" {
		return nil, fmt.Errorf("missing `!deck` line")
	}
	if len(d.Cards) == 0 {
		return nil, fmt.Errorf("deck %q has no cards", d.ID)
	}
	if d.Title == "" {
		d.Title = d.ID
	}
	return d, nil
}
