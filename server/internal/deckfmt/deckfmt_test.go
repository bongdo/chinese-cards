package deckfmt

import (
	"strings"
	"testing"
)

const sample = `!deck test/01
!title Тест
!src ru>zh

# комментарий
я = 我 [wǒ]
оно = 它 [tā] // неодушевлённые предметы
два = 二
кто = 谁 [shéi] // также shuí
`

func TestParse(t *testing.T) {
	d, err := Parse(strings.NewReader(sample))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if d.ID != "test/01" || d.Title != "Тест" || d.Src != "ru>zh" {
		t.Fatalf("meta: %+v", d)
	}
	if len(d.Cards) != 4 {
		t.Fatalf("want 4 cards, got %d: %+v", len(d.Cards), d.Cards)
	}
	if len(d.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", d.Warnings)
	}

	first := d.Cards[0]
	if first.Front != "я" || first.Back != "我" || first.Pinyin != "wǒ" || first.Note != "" {
		t.Fatalf("card 0: %+v", first)
	}
	second := d.Cards[1]
	if second.Front != "оно" || second.Back != "它" || second.Pinyin != "tā" ||
		second.Note != "неодушевлённые предметы" {
		t.Fatalf("card 1: %+v", second)
	}
	if d.Cards[2].Pinyin != "" {
		t.Fatalf("card without pinyin: %+v", d.Cards[2])
	}
}

func TestCardIDIsStable(t *testing.T) {
	a, _ := Parse(strings.NewReader(sample))
	b, _ := Parse(strings.NewReader(sample))
	if a.Cards[0].ID(a.ID) != b.Cards[0].ID(b.ID) {
		t.Fatal("card id changed between identical parses")
	}
	c, _ := Parse(strings.NewReader(strings.Replace(sample, "!title Тест", "!title Другое", 1)))
	if a.Cards[0].ID(a.ID) != c.Cards[0].ID(c.ID) {
		t.Fatal("card id must not depend on the title")
	}
	d, _ := Parse(strings.NewReader(strings.Replace(sample, "\nя = 我", "\nменя = 我", 1)))
	if a.Cards[0].ID(a.ID) == d.Cards[0].ID(d.ID) {
		t.Fatal("editing the front side must produce a new id")
	}
}

func TestParseErrors(t *testing.T) {
	if _, err := Parse(strings.NewReader("я = 我")); err == nil {
		t.Fatal("want error for missing !deck")
	}
	if _, err := Parse(strings.NewReader("!deck x\n# only comments\n")); err == nil {
		t.Fatal("want error for empty deck")
	}
	d, err := Parse(strings.NewReader("!deck x\n!bogus value\nплохая строка\nок = да\n"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(d.Cards) != 1 || len(d.Warnings) != 2 {
		t.Fatalf("warnings: %+v, cards: %+v", d.Warnings, d.Cards)
	}
}
