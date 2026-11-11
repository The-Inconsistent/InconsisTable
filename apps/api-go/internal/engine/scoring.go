package engine

import (
	"cmp"
	"errors"
	"slices"
)

// The end of a game (house decisions #38-#40): which endWhen triggers hold, each actor's final score and the ranking.
// Pure: the api reads the actors and writes the results.

// EndMet returns the indexes of the endWhen triggers that hold for any actor of the order. An actor with a nil scope,
// or whose values are missing, meets none.
func (c *CompiledRuleset) EndMet(actors map[string]*Record, order []string, round float64) []int {
	met := []int{}
	if c.Scoring == nil {
		return met
	}
	var scopes []*Record
	for _, id := range order {
		scope := actors[id]
		if scope == nil {
			continue
		}
		withRound := &Record{make(map[string]any, len(scope.Fields)+1)}
		for k, v := range scope.Fields {
			withRound.Fields[k] = v
		}
		withRound.Fields["round"] = round
		scopes = append(scopes, withRound)
	}
	for i, expr := range c.Scoring.EndWhen {
		for _, scope := range scopes {
			holds, err := evaluateBool(expr, scope)
			var exprErr ExprError
			if err != nil && !errors.As(err, &exprErr) {
				panic(err)
			}
			if holds {
				met = append(met, i)
				break
			}
		}
	}
	return met
}

// ScoreRow is one actor's score and tiebreak values.
type ScoreRow struct {
	ActorID   string    `json:"actorId"`
	Score     float64   `json:"score"`
	Tiebreaks []float64 `json:"tiebreaks"`
}

// ScoreRows returns each actor's score and tiebreak values, in the order given. An actor with a nil scope scores 0.
//
// ponytail: a value missing from a scope fails the whole game end, so a ruleset that scores a field must set it.
func (c *CompiledRuleset) ScoreRows(actors map[string]*Record, order []string) ([]ScoreRow, error) {
	rows := []ScoreRow{}
	if c.Scoring == nil {
		return rows, nil
	}
	for _, id := range order {
		row := ScoreRow{id, 0, make([]float64, len(c.Scoring.Tiebreaks))}
		if scope := actors[id]; scope != nil {
			var err error
			if row.Score, err = evaluateInt(c.Scoring.Score, scope); err != nil {
				return nil, err
			}
			for i, expr := range c.Scoring.Tiebreaks {
				if row.Tiebreaks[i], err = evaluateInt(expr, scope); err != nil {
					return nil, err
				}
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// RankedRow is a row with its result: a place when competing, an outcome when cooperating.
type RankedRow struct {
	ScoreRow
	Place   *int    `json:"place"`
	Outcome *string `json:"outcome"`
}

func signOf(order string) float64 {
	if order == "high" {
		return -1
	}
	return 1
}

// RankResults ranks by score, then each tiebreak in its own order. Rows still tied share the place and the next place
// is skipped (1, 1, 3). A cooperative game ranks nobody: every row gets the outcome of the first trigger in met, or
// lose when none is met (the table stopped early).
func RankResults(s *Scoring, rows []ScoreRow, met []int) []RankedRow {
	out := make([]RankedRow, 0, len(rows))
	if s.Mode == "coop" {
		outcome := "lose"
		if len(met) > 0 {
			if first := slices.Min(met); first >= 0 && first < len(s.EndWhen) && s.EndWhen[first].Outcome != nil {
				outcome = *s.EndWhen[first].Outcome
			}
		}
		for _, r := range rows {
			out = append(out, RankedRow{r, nil, &outcome})
		}
		return out
	}
	compare := func(a, b ScoreRow) int {
		if a.Score != b.Score {
			return cmp.Compare(signOf(s.Order)*a.Score, signOf(s.Order)*b.Score)
		}
		for i, t := range s.Tiebreaks {
			if a.Tiebreaks[i] != b.Tiebreaks[i] {
				return cmp.Compare(signOf(t.Order)*a.Tiebreaks[i], signOf(t.Order)*b.Tiebreaks[i])
			}
		}
		return 0
	}
	sorted := slices.Clone(rows)
	slices.SortStableFunc(sorted, compare)
	place := 0
	for i, r := range sorted {
		if i == 0 || compare(sorted[i-1], r) != 0 {
			place = i + 1
		}
		at := place
		out = append(out, RankedRow{r, &at, nil})
	}
	return out
}
