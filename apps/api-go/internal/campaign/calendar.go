package campaign

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The next session as a calendar file (house decision #85; Auspex packages/shared/src/calendar.ts): one event written
// by hand (RFC 5545). The room keeps no session length, so the event is a fixed 3 hours.
const nextSessionHours = 3

// NextIcs is GET /api/campaigns/{id}/next.ics: for any seat of the room, 404 until a next-session date is set.
func (s *Service) NextIcs(w http.ResponseWriter, r *http.Request) (any, error) {
	id, err := core.Parse(coreschema.CampaignID, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), id.(string), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	ics, err := nextSessionIcs(r.Context(), s.DB, id.(string), time.Now())
	if err != nil {
		return nil, err
	}
	if ics == "" {
		return nil, core.Refuse(http.StatusNotFound, "noNextSession")
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="next-session.ics"`)
	w.Header().Set("Cache-Control", "private, no-cache") // the GM may move it
	if _, err := w.Write([]byte(ics)); err != nil {
		return nil, err
	}
	return core.Written{}, nil
}

// nextSessionIcs is the room's next session as a file, or "" when none is set. The summary names the room and the
// session's number to come.
func nextSessionIcs(ctx context.Context, conn core.Conn, campaignID string, now time.Time) (string, error) {
	var name, place string
	var at *time.Time
	var next int
	err := conn.QueryRow(ctx, `SELECT name, next_session_at, next_session_place,
		coalesce((SELECT max(number) FROM session WHERE campaign_id = c.id), 0) + 1 FROM campaign c WHERE id = $1`,
		campaignID).Scan(&name, &at, &place, &next)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && at == nil) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return toIcs(icsEvent{
		uid:      campaignID + "-" + strconv.FormatInt(at.Unix(), 10) + "@inconsistable",
		start:    *at,
		summary:  name + " · Session " + strconv.Itoa(next),
		location: place,
		stamp:    now,
	}), nil
}

type icsEvent struct {
	uid, summary, location string
	start, stamp           time.Time
}

// icsDate is a UTC date-time, YYYYMMDDTHHMMSSZ (RFC 5545 §3.3.5).
func icsDate(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// icsText escapes backslash, comma and semicolon, and writes a line break as \n (RFC 5545 §3.3.11).
var icsText = strings.NewReplacer(`\`, `\\`, ",", `\,`, ";", `\;`, "\r\n", `\n`, "\r", `\n`, "\n", `\n`).Replace

// fold splits a content line longer than 75 octets onto lines that start with a space (RFC 5545 §3.1), on whole
// characters.
func fold(line string) string {
	var out []string
	cur := ""
	for _, ch := range line {
		limit := 75
		if len(out) > 0 {
			limit = 74
		}
		if len(cur)+utf8.RuneLen(ch) > limit {
			out = append(out, cur)
			cur = ""
		}
		cur += string(ch)
	}
	return strings.Join(append(out, cur), "\r\n ")
}

// toIcs is the whole file, CRLF line ends throughout.
func toIcs(e icsEvent) string {
	lines := []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//InconsisTable//table companion//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		"UID:" + icsText(e.uid),
		"DTSTAMP:" + icsDate(e.stamp),
		"DTSTART:" + icsDate(e.start),
		"DTEND:" + icsDate(e.start.Add(nextSessionHours*time.Hour)),
		"SUMMARY:" + icsText(e.summary),
	}
	if e.location != "" {
		lines = append(lines, "LOCATION:"+icsText(e.location))
	}
	lines = append(lines, "END:VEVENT", "END:VCALENDAR")
	for i, l := range lines {
		lines[i] = fold(l)
	}
	return strings.Join(lines, "\r\n") + "\r\n"
}
