package coreschema

// The two snapshots every seat receives (packages/core-schema/src/state.ts, encounter.ts, test-call.ts): `state`, the
// live table, and `codex`, the world. The api builds them whole; the Seat view (internal/view) cuts each seat's copy.
// Field names are the web's, so the JSON is what use-table.ts parses.

import "encoding/json"

type (
	// CampaignInfo is the room as every seat sees it.
	CampaignInfo struct {
		ID               string  `json:"id"`
		Name             string  `json:"name"`
		OwnerUserID      *string `json:"ownerUserId"`
		Archived         bool    `json:"archived"`
		NextSessionAt    *string `json:"nextSessionAt"`
		NextSessionPlace string  `json:"nextSessionPlace"`
		TableMode        string  `json:"tableMode"`
		Safety           Safety  `json:"safety"`
		// Fields is each campaign field of the pinned ruleset at its value in play; {} without a ruleset or fields.
		Fields map[string]any `json:"fields"`
		// WorldVersionID is the pinned World version (house decision #65), or nil; the World is served by the rules read.
		WorldVersionID *string `json:"worldVersionId"`
	}
	// Safety is the table's Session Zero: what stays out (lines), what stays off the page (veils), the X-Card's switch.
	Safety struct {
		Lines []string `json:"lines"`
		Veils []string `json:"veils"`
		XCard bool     `json:"xCard"`
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
		// Ledger is the saved ledger build and sheet, and the unfinished draft (house decision #63); nil when the actor
		// has none or the seat may not read it.
		Ledger *ActorLedger `json:"ledger"`
	}
	// ActorLedger is a saved ledger build and the sheet it resolved to, and a draft not yet resolved, as stored: JSON
	// text sent on as it is, so its keys keep the order the builder wrote them in. A part not stored is nil (null).
	// XPSpent, XPAtAscension and PackageWaived are its play (house decision #64); a row may hold only these.
	ActorLedger struct {
		Build         json.RawMessage `json:"build"`
		Sheet         json.RawMessage `json:"sheet"`
		Draft         json.RawMessage `json:"draft"`
		XPSpent       int             `json:"xpSpent"`
		XPAtAscension int             `json:"xpAtAscension"`
		PackageWaived bool            `json:"packageWaived"`
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
	// Clock is a progress clock: filled of segments.
	Clock struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		Segments   int     `json:"segments"`
		Filled     int     `json:"filled"`
		Visibility string  `json:"visibility"`
		EntryID    *string `json:"entryId"`
		Position   int     `json:"position"`
	}
	// SpendRequest is a pending ask to spend from a resource (house decision #43). Note is "" when none.
	SpendRequest struct {
		ID         string  `json:"id"`
		UserID     string  `json:"userId"`
		ActorID    *string `json:"actorId"`
		ResourceID string  `json:"resourceId"`
		Amount     int     `json:"amount"`
		Note       string  `json:"note"`
		CreatedAt  string  `json:"createdAt"`
	}
	// RollRow is one roll on a random table (house decision #49): what came up, as the seat that may see it reads it.
	// Visibility is the table's, so the Seat view can cut it; Label is the entry's own short name.
	RollRow struct {
		ID         string `json:"id"`
		TableID    string `json:"tableId"`
		EntryID    string `json:"entryId"`
		Label      string `json:"label"`
		Value      int    `json:"value"`
		Visibility string `json:"visibility"`
		At         string `json:"at"`
	}
	// DealtRow is a card dealt to a character from a random table and not yet returned.
	DealtRow struct {
		TableID    string `json:"tableId"`
		ActorID    string `json:"actorId"`
		EntryID    string `json:"entryId"`
		Label      string `json:"label"`
		Visibility string `json:"visibility"`
	}
	// RequestAnswer is the GM's answer to a request, sent to the player who asked.
	RequestAnswer struct {
		ID         string  `json:"id"`
		UserID     string  `json:"userId"`
		ActorID    *string `json:"actorId"`
		ResourceID string  `json:"resourceId"`
		Amount     int     `json:"amount"`
		Status     string  `json:"status"`
		Reason     string  `json:"reason"`
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
		MyDraft any        `json:"myDraft"`
		Tests   []TestCall `json:"tests"`
		// Clocks are the room's progress clocks by position.
		Clocks []Clock `json:"clocks"`
		// Requests are the pending spend requests, oldest first; RequestAnswers the asker's recent answers.
		Requests       []SpendRequest  `json:"requests"`
		RequestAnswers []RequestAnswer `json:"requestAnswers"`
		// Rolls are the last 10 rolls on random tables, newest first; Dealt the cards dealt and not yet returned (house
		// decision #49). Each seat gets the ones its sight reads.
		Rolls     []RollRow  `json:"rolls"`
		Dealt     []DealtRow `json:"dealt"`
		TestDefs  []TestDef  `json:"testDefs"`
		Encounter *Encounter `json:"encounter"`
		Games     []Game     `json:"games"`
		Access    Access     `json:"access"`
		// Pools are the shared pools in manifest order, each seat the ones it may see (house decision #59).
		Pools []PoolState `json:"pools"`
	}
	// PoolState is a shared pool as a seat sees it. Max is nil when the pool has none; Capped says whether the value
	// stops there.
	PoolState struct {
		ID         string   `json:"id"`
		Label      string   `json:"label"`
		Scope      string   `json:"scope"`
		Value      float64  `json:"value"`
		Min        float64  `json:"min"`
		Max        *float64 `json:"max"`
		Capped     bool     `json:"capped"`
		Visibility string   `json:"visibility"`
		EditableBy string   `json:"editableBy"`
	}

	// CombatantCondition is a condition on a combatant, sent where the seat sees it on the actor (house decision #67).
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
		ID         string   `json:"id"`
		ActorID    string   `json:"actorId"`
		Name       string   `json:"name"`
		Side       string   `json:"side"`
		Ord        int      `json:"ord"`
		Initiative *int     `json:"initiative"`
		Visibility string   `json:"visibility"`
		Keep       bool     `json:"keep"`
		HP         *HP      `json:"hp"`
		Bar        *float64 `json:"bar"`
		// States are the ruleset's health states that hold for the actor, in manifest order (house decision #66).
		States []CombatantState `json:"states"`
		// Members is a mob's members standing; nil for anyone else.
		Members    *HP                  `json:"members"`
		Conditions []CombatantCondition `json:"conditions"`
		*CombatantSides
	}
	// CombatantState is one health state that holds for a combatant.
	CombatantState struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	// CombatantSides is a combatant's part of a sides order (house decision #60); nil for any other order, so the keys
	// are absent. It is embedded, which encoding/json flattens and leaves out while nil.
	CombatantSides struct {
		Held   bool `json:"held"`
		Barred bool `json:"barred"`
		Unable bool `json:"unable"`
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
		// Unseen says the acting combatant is one this seat is not sent (house decision #68); never set for the combat side.
		Unseen bool `json:"unseen,omitempty"`
		*EncounterSides
	}
	// EncounterSides is the encounter's part of a sides order (house decision #60); nil for any other order.
	EncounterSides struct {
		Begun         bool    `json:"begun"`
		LastSide      *string `json:"lastSide"`
		OutOfTurnSide *string `json:"outOfTurnSide"`
		SideUp        *string `json:"sideUp"`
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
		ID        string        `json:"id"`
		Dice      string        `json:"dice"`
		Advantage bool          `json:"advantage"`
		Pool      *PoolSpec     `json:"pool"`
		Outcomes  []OutcomeSpec `json:"outcomes"`
		// Entities is the actor entity types that take the Test; omitted when every type does.
		Entities []string       `json:"entities,omitempty"`
		Inputs   []TestDefInput `json:"inputs"`
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
		// Status is open, done or failed on a quest and null on every other kind.
		Status *string `json:"status"`
		// ParentID is the entry it sits under (its own kind; a scene's adventure); Position orders siblings.
		ParentID *string `json:"parentId"`
		Position int     `json:"position"`
		// Links are the entries a scene points at.
		Links []string `json:"links"`
		// PlannedTests are the ruleset Test ids a scene plans; the GM side only.
		PlannedTests []string `json:"plannedTests"`
		// ImageID is the entry's picture; ImageRevealed says the table sees it (house decision #70).
		ImageID       *string `json:"imageId"`
		ImageRevealed bool    `json:"imageRevealed"`
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
