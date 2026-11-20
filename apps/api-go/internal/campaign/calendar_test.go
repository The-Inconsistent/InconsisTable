package campaign

import (
	"strings"
	"testing"
	"time"
)

func TestToIcs(t *testing.T) {
	start := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	got := toIcs(icsEvent{uid: "room-1@x", start: start, summary: "Room, one; two · Session 3", location: "Ana's\nflat",
		stamp: start.Add(-time.Hour)})
	for _, want := range []string{
		"DTSTART:20261120T120000Z\r\n",
		"DTEND:20261120T150000Z\r\n",
		"DTSTAMP:20261120T110000Z\r\n",
		`SUMMARY:Room\, one\; two · Session 3` + "\r\n",
		`LOCATION:Ana's\nflat` + "\r\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in\n%s", want, got)
		}
	}
	if !strings.HasSuffix(got, "END:VCALENDAR\r\n") {
		t.Errorf("no CRLF end: %q", got)
	}
	if strings.Contains(toIcs(icsEvent{start: start, stamp: start}), "LOCATION") {
		t.Error("no place, no LOCATION")
	}
	long := fold("SUMMARY:" + strings.Repeat("é", 60))
	for i, line := range strings.Split(long, "\r\n") {
		if len(line) > 75 || (i > 0 && !strings.HasPrefix(line, " ")) {
			t.Errorf("line %d folds badly: %q", i, line)
		}
	}
}
