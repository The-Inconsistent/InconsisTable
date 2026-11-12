package coreschema

// The two snapshots every seat receives (packages/core-schema/src/state.ts, encounter.ts, test-call.ts): `state`, the
// live table, and `codex`, the world. The api builds them whole; the Seat view (internal/view) cuts each seat's copy.
// Field names are the web's, so the JSON is what use-table.ts parses.

type (
	// CampaignInfo is the room as every seat sees it.
	CampaignInfo struct {
		ID               string  `json:"id"`
		Name             string  `json:"name"`
		OwnerUserID      *string `json:"ownerUserId"`
		Archived         bool    `json:"archived"`
		NextSessionAt    *string `json:"nextSessionAt"`
		NextSessionPlace string  `json:"nextSessionPlace"`
	}
	// Session is the running session.
	Session struct {
		ID        string  `json:"id"`
		Number    int     `json:"number"`
		Title     string  `json:"title"`
		StartedAt string  `json:"startedAt"`
		EndedAt   *string `json:"endedAt"`
		Recap     string  `json:"recap"`
		Notes     string  `json:"notes"`
	}
	// ConditionTimer is what is left of an active condition's count.
	ConditionTimer struct {
		ID           string `json:"id"`
		ExpiresOn    string `json:"expiresOn"`
		ExpiresAfter *int   `json:"expiresAfter"`
	}
	// Actor is one actor with its ruleset values.
	Actor struct {
		ID              string             `json:"id"`
		Kind            string             `json:"kind"`
		Name            string             `json:"name"`
		Status          string             `json:"status"`
		OwnerUserID     *string            `json:"ownerUserId"`
		Entity          string             `json:"entity"`
		Fields          map[string]any     `json:"fields"`
		Resources       map[string]float64 `json:"resources"`
		Derived         map[string]float64 `json:"derived"`
		Conditions      []string           `json:"conditions"`
		ConditionTimers []ConditionTimer   `json:"conditionTimers"`
	}
	// Member is a seated member.
	Member struct {
		UserID       string   `json:"userId"`
		Name         string   `json:"name"`
		Role         string   `json:"role"`
		Scopes       []string `json:"scopes"`
		CharacterIDs []string `json:"characterIds"`
	}
	// Invite is a live invite, without its code.
	Invite struct {
		ID          string  `json:"id"`
		Mode        string  `json:"mode"`
		Role        string  `json:"role"`
		ActorID     *string `json:"actorId"`
		AllowGuests bool    `json:"allowGuests"`
		ExpiresAt   string  `json:"expiresAt"`
		Uses        int     `json:"uses"`
		MaxUses     *int    `json:"maxUses"`
	}
	// Guest is a character with a live guest token.
	Guest struct {
		ActorID string `json:"actorId"`
	}
	// Transfer is a transfer waiting for its recipient.
	Transfer struct {
		ToUserID  string `json:"toUserId"`
		ExpiresAt string `json:"expiresAt"`
	}
	// Access is who sits at the table.
	Access struct {
		Members  []Member  `json:"members"`
		Invites  []Invite  `json:"invites"`
		Guests   []Guest   `json:"guests"`
		Screens  int       `json:"screens"`
		Transfer *Transfer `json:"transfer"`
	}
	// LiveState is the `state` event.
	LiveState struct {
		Campaign     CampaignInfo `json:"campaign"`
		StateVersion int64        `json:"stateVersion"`
		Session      *Session     `json:"session"`
		Actors       []Actor      `json:"actors"`
		// MyDraft is the receiving user's builder draft, decoded JSON; nil for every other seat.
		MyDraft   any        `json:"myDraft"`
		Tests     []TestCall `json:"tests"`
		TestDefs  []TestDef  `json:"testDefs"`
		Encounter *Encounter `json:"encounter"`
		Games     []Game     `json:"games"`
		Access    Access     `json:"access"`
	}

	// CombatantCondition is a condition on a combatant, GM side only.
	CombatantCondition struct {
		ID        string `json:"id"`
		Left      *int   `json:"left"`
		ExpiresOn string `json:"expiresOn"`
	}
	// HP is a combatant's health numbers.
	HP struct {
		Value float64  `json:"value"`
		Max   *float64 `json:"max"`
	}
	// Combatant is one place in the order.
	Combatant struct {
		ID         string               `json:"id"`
		ActorID    string               `json:"actorId"`
		Name       string               `json:"name"`
		Side       string               `json:"side"`
		Ord        int                  `json:"ord"`
		Initiative *int                 `json:"initiative"`
		Visibility string               `json:"visibility"`
		Keep       bool                 `json:"keep"`
		HP         *HP                  `json:"hp"`
		Bar        *float64             `json:"bar"`
		Conditions []CombatantCondition `json:"conditions"`
	}
	// EncounterPhase is one phase of the round, for the banner.
	EncounterPhase struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Mode  string `json:"mode"`
	}
	// EncounterHealth is the ruleset's first health track.
	EncounterHealth struct {
		Resource   string  `json:"resource"`
		Temp       *string `json:"temp"`
		DeathSaves bool    `json:"deathSaves"`
	}
	// ConditionDef is a ruleset condition, for the GM's picker.
	ConditionDef struct {
		ID       string `json:"id"`
		Label    string `json:"label"`
		Duration string `json:"duration"`
	}
	// ScoringMode is how the ruleset scores a game.
	ScoringMode struct {
		Mode string `json:"mode"`
	}
	// Encounter is the running encounter.
	Encounter struct {
		ID            string           `json:"id"`
		Round         int              `json:"round"`
		CurrentID     *string          `json:"currentId"`
		FirstID       *string          `json:"firstId"`
		PhaseID       *string          `json:"phaseId"`
		Phases        []EncounterPhase `json:"phases"`
		Done          []string         `json:"done"`
		FirstPlayer   *string          `json:"firstPlayer"`
		Paused        bool             `json:"paused"`
		Health        *EncounterHealth `json:"health"`
		ConditionDefs []ConditionDef   `json:"conditionDefs"`
		EndMet        []int            `json:"endMet"`
		Scoring       *ScoringMode     `json:"scoring"`
		Combatants    []Combatant      `json:"combatants"`
	}
	// GameResult is one line of an ended game.
	GameResult struct {
		ResultID  string  `json:"resultId"`
		ActorID   *string `json:"actorId"`
		Name      string  `json:"name"`
		Score     int     `json:"score"`
		Tiebreaks []int   `json:"tiebreaks"`
		Place     *int    `json:"place"`
		Outcome   *string `json:"outcome"`
	}
	// Game is an ended game.
	Game struct {
		EncounterID string       `json:"encounterId"`
		EndedAt     string       `json:"endedAt"`
		EndedEarly  bool         `json:"endedEarly"`
		Mode        string       `json:"mode"`
		Rows        []GameResult `json:"rows"`
	}

	// PoolBand is one band a Dice pool counts dice in.
	PoolBand struct {
		ID    string `json:"id"`
		From  int    `json:"from"`
		To    int    `json:"to"`
		Worth int    `json:"worth"`
	}
	// PoolSpecial is how many special dice are read face by face.
	PoolSpecial struct {
		Label string `json:"label"`
		Count int    `json:"count"`
	}
	// PoolSpec is the phone's part of a Dice pool Test.
	PoolSpec struct {
		Die     int          `json:"die"`
		Bands   []PoolBand   `json:"bands"`
		Special *PoolSpecial `json:"special"`
		Shift   *string      `json:"shift"`
	}
	// OutcomeSpec is a result a reported Test lists.
	OutcomeSpec struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	// TestDefInput is one input the call form asks for.
	TestDefInput struct {
		ID      string   `json:"id"`
		Type    string   `json:"type"`
		Options []string `json:"options,omitempty"`
	}
	// TestDef is a Test the GM can call.
	TestDef struct {
		ID        string         `json:"id"`
		Dice      string         `json:"dice"`
		Advantage bool           `json:"advantage"`
		Pool      *PoolSpec      `json:"pool"`
		Outcomes  []OutcomeSpec  `json:"outcomes"`
		Inputs    []TestDefInput `json:"inputs"`
	}
	// TestResult is a reported roll; a field the seat may not see is nil.
	TestResult struct {
		Natural *int     `json:"natural"`
		Total   *int     `json:"total"`
		Outcome *string  `json:"outcome"`
		Margin  *int     `json:"margin"`
		Shifts  *int     `json:"shifts"`
		Flags   []string `json:"flags"`
	}
	// TestTargetState is one called character.
	TestTargetState struct {
		ActorID  string      `json:"actorId"`
		Modifier *int        `json:"modifier"`
		Target   *int        `json:"target"`
		Pool     *int        `json:"pool"`
		Report   *TestResult `json:"report"`
	}
	// TestCall is a Test the GM called.
	TestCall struct {
		ID           string            `json:"id"`
		TestID       string            `json:"testId"`
		Dice         string            `json:"dice"`
		Advantage    bool              `json:"advantage"`
		Pool         *PoolSpec         `json:"pool"`
		Outcomes     []OutcomeSpec     `json:"outcomes"`
		Status       string            `json:"status"`
		CreatedAt    string            `json:"createdAt"`
		Inputs       map[string]any    `json:"inputs"`
		SecretInputs []string          `json:"secretInputs"`
		ShowTarget   bool              `json:"showTarget"`
		ShowModifier bool              `json:"showModifier"`
		ShowOutcome  bool              `json:"showOutcome"`
		Revealed     bool              `json:"revealed"`
		Called       int               `json:"called"`
		Reported     int               `json:"reported"`
		Targets      []TestTargetState `json:"targets"`
	}

	// CodexEntry is one codex entry.
	CodexEntry struct {
		ID           string   `json:"id"`
		Kind         string   `json:"kind"`
		Title        string   `json:"title"`
		Body         string   `json:"body"`
		GMNotes      string   `json:"gmNotes"`
		Visibility   string   `json:"visibility"`
		AudienceMode string   `json:"audienceMode"`
		Audience     []string `json:"audience"`
	}
	// Codex is the `codex` event.
	Codex struct {
		Entries []CodexEntry   `json:"entries"`
		Recaps  []SessionRecap `json:"recaps"`
	}
	// SessionRecap is an ended session's recap, newest first, at most 50, never empty. Never the session's notes.
	SessionRecap struct {
		SessionID string `json:"sessionId"`
		Number    int    `json:"number"`
		Title     string `json:"title"`
		EndedAt   string `json:"endedAt"`
		Recap     string `json:"recap"`
	}
)
