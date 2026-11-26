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
	// JournalSession is one session of the GM's journal (house decision #85); Abandoned when it ended without an award.
	// Award is the XP each character was given at its end (house decision #120), nil when none was stored.
	JournalSession struct {
		Session
		Abandoned bool `json:"abandoned"`
		Award     *int `json:"award"`
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
		// Held is the records the actor holds (house decision #88): for a seat that may not read a kind's names, each one
		// under the kind's unseen word with its effects and no key or cite.
		Held []HeldRecord `json:"held"`
		// Items is what it holds in play (house decision #95): whole for the seat holding it and the GM side, empty for
		// everyone else.
		Items []ActorItem `json:"items"`
		// Ledger is the saved ledger build and sheet, and the unfinished draft (house decision #63); nil when the actor
		// has none or the seat may not read it.
		Ledger *ActorLedger `json:"ledger"`
		// SpawnOptions are the spawn options it was spawned with (house decision #92): the GM side's; absent when none.
		SpawnOptions []string `json:"spawnOptions,omitempty"`
	}
	// HeldRecord is one record an actor holds: its kind, the entry's key, name and cite, and its effects. Key and Cite
	// are nil where the seat may not read them.
	HeldRecord struct {
		Kind    string       `json:"kind"`
		Key     *string      `json:"key"`
		Name    string       `json:"name"`
		Cite    *string      `json:"cite"`
		Effects []HeldEffect `json:"effects"`
	}
	// ActorItem is one item an actor holds (state.ts ActorItem): Entry is the pack entry's key (nil for a hand-written
	// one), Quantity a counted kind's, FittedTo the item it is fitted to, EntryID the codex item a GIVE handed over.
	ActorItem struct {
		ID       string  `json:"id"`
		Kind     string  `json:"kind"`
		Entry    *string `json:"entry"`
		Name     string  `json:"name"`
		Cite     *string `json:"cite"`
		Note     string  `json:"note"`
		Quantity *int    `json:"quantity"`
		FittedTo *string `json:"fittedTo"`
		// FittedLine is the line of the saved build it is fitted to (`<card>/<name>`, house decision #102); absent when none.
		FittedLine *string `json:"fittedLine,omitempty"`
		// Profile is the entry record's weapon or armour, the numbers its card draws (house decision #102).
		Profile json.RawMessage `json:"profile,omitempty"`
		Source  string          `json:"source"`
		EntryID *string         `json:"entryId"`
		Rev     int64           `json:"rev"`
		Tags    []string        `json:"tags"`
		Effects []HeldEffect    `json:"effects"`
	}
	// HeldEffect is one effect of a held record, as the sheet words it.
	HeldEffect struct {
		Path  string `json:"path"`
		Mode  string `json:"mode"`
		Value string `json:"value"`
		Phase string `json:"phase"`
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
		ID      string  `json:"id"`
		UserID  string  `json:"userId"`
		ActorID *string `json:"actorId"`
		// A resource and an amount, or a spend of the ruleset and its inputs (house decision #84).
		ResourceID *string            `json:"resourceId"`
		Amount     *int               `json:"amount"`
		SpendID    *string            `json:"spendId"`
		Inputs     map[string]float64 `json:"inputs"`
		Note       string             `json:"note"`
		CreatedAt  string             `json:"createdAt"`
		// Acquire is an acquisition asked for (house decision #102): the entry and the host it goes on.
		Acquire *RequestAcquire `json:"acquire,omitempty"`
	}
	// RequestAcquire is the pack entry an acquisition asks for, and the item (To) or build line (Line) it is fitted to.
	RequestAcquire struct {
		Type  string `json:"type"`
		Entry string `json:"entry"`
		// Name is the entry's name as the room is served it, its key when it is served none.
		Name string `json:"name"`
		To   string `json:"to,omitempty"`
		Line string `json:"line,omitempty"`
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
		ResourceID *string `json:"resourceId"`
		Amount     *int    `json:"amount"`
		SpendID    *string `json:"spendId"`
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
		// Journal is every session of the room, newest first, for the seats that run it (house decision #85).
		Journal []JournalSession `json:"journal"`
		Actors  []Actor          `json:"actors"`
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
		// Whispers are this session's, newest first (house decision #93); each seat the ones to a character it holds.
		Whispers []Whisper `json:"whispers"`
		// History is the running session's logged actions, newest first (house decision #133): the side that may undo
		// them, cut to the writes the seat sees; absent for everyone else and when there is none.
		History []HistoryLine `json:"history,omitempty"`
	}
	// Whisper is the GM's private line to chosen characters (house decision #93), with each reader's reply and read mark.
	Whisper struct {
		ID        string          `json:"id"`
		Text      string          `json:"text"`
		CreatedAt string          `json:"createdAt"`
		Readers   []WhisperReader `json:"readers"`
	}
	// WhisperReader is one addressed character: its one reply (the latest) and when it read the whisper.
	WhisperReader struct {
		ActorID   string  `json:"actorId"`
		Reply     *string `json:"reply"`
		RepliedAt *string `json:"repliedAt"`
		ReadAt    *string `json:"readAt"`
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
		// Stacks is how many it holds, when more than one (house decision #81).
		Stacks int `json:"stacks,omitempty"`
	}
	// EncounterReminder is one reminder line due now (house decision #81), the combat side's only.
	EncounterReminder struct {
		At       string   `json:"at"`
		Source   string   `json:"source"`
		ID       string   `json:"id"`
		Text     string   `json:"text"`
		Cite     *string  `json:"cite"`
		ActorIDs []string `json:"actorIds"`
	}
	// EncounterTurnBack is the fight's last turn step (house decision #82): which kind, whose turn (left out for a round),
	// in which round, and how many later actions go back with it. Kind "begin" is BEGIN ROUND 1 (house decision #130).
	EncounterTurnBack struct {
		Kind  string `json:"kind"`
		Name  string `json:"name,omitempty"`
		Round int    `json:"round"`
		Later int    `json:"later"`
	}
	// FightLogWrite is one logged write of an action, as the log holds it (eventlog.Written).
	FightLogWrite struct {
		Target map[string]string `json:"target"`
		Kind   string            `json:"kind"`
		Before any               `json:"before"`
		After  any               `json:"after"`
	}
	// FightLogStrike is the strike an action was (house decision #99), as strike.apply logged it.
	FightLogStrike struct {
		StrikeID   string  `json:"strikeId"`
		AttackerID string  `json:"attackerId"`
		TargetID   string  `json:"targetId"`
		Means      *string `json:"means"`
		Total      float64 `json:"total"`
		Outcome    string  `json:"outcome"`
		Wounds     float64 `json:"wounds"`
		Shock      float64 `json:"shock"`
	}
	// FightLogLine is one logged action of the running fight (house decision #100): the round and the actor acting it
	// left, whether Undo or TURN BACK took it back, the strike it was, and its writes.
	FightLogLine struct {
		ID      string          `json:"id"`
		Round   int             `json:"round"`
		ActorID *string         `json:"actorId"`
		Undone  bool            `json:"undone"`
		Strike  *FightLogStrike `json:"strike,omitempty"`
		Writes  []FightLogWrite `json:"writes"`
	}
	// HistoryLine is one logged action of the running session, for HISTORY (house decision #133): when it was taken,
	// whether it stands undone, the strike it was, and its writes as logged.
	HistoryLine struct {
		ID     string          `json:"id"`
		At     string          `json:"at"`
		Undone bool            `json:"undone"`
		Strike *FightLogStrike `json:"strike,omitempty"`
		Writes []FightLogWrite `json:"writes"`
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
		// Marker is its marker colour (house decision #92); absent when it has none.
		Marker string `json:"marker,omitempty"`
		// Used is the spends limited per round it used this round, once per use (house decision #91); absent when none.
		Used []string `json:"used,omitempty"`
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
		// Reminders are the lines due now (house decision #81); the combat side's only, absent for every other seat.
		Reminders []EncounterReminder `json:"reminders,omitempty"`
		// TurnBack is what TURN BACK would take back (house decision #82); the combat side's only, nil with nothing to take.
		TurnBack *EncounterTurnBack `json:"turnBack,omitempty"`
		// Log is the running fight's logged actions, newest first (house decision #100); the combat side's only.
		Log []FightLogLine `json:"log,omitempty"`
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
		// Label, InputLabels and InputOptionLabels are the ruleset's words for the Test, its inputs and an input's
		// options (house decision #77); each omitted when the ruleset gives none.
		Label             string                       `json:"label,omitempty"`
		InputLabels       map[string]string            `json:"inputLabels,omitempty"`
		InputOptionLabels map[string]map[string]string `json:"inputOptionLabels,omitempty"`
		// Marks are the yes-or-no the GM sets when calling (house decision #80); omitted when the Test has none.
		Marks []TestMarkDef `json:"marks,omitempty"`
	}
	// TestMarkDef is one mark of a Test, by id, with the ruleset's word for it.
	TestMarkDef struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	// TestOfferState is what a taker's result offers the GM (house decision #80): its changes with the amounts worked
	// out for that taker, and whether it was applied.
	TestOfferState struct {
		ID      string            `json:"id"`
		Label   string            `json:"label"`
		Changes []TestOfferChange `json:"changes"`
		Applied bool              `json:"applied"`
	}
	// TestOfferChange is one write of an offer: a pool or a resource, its label, and by how much.
	TestOfferChange struct {
		Pool     string `json:"pool,omitempty"`
		Resource string `json:"resource,omitempty"`
		Label    string `json:"label"`
		By       int    `json:"by"`
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
		// Offers is the GM side's only (house decision #80): omitted when there is none, and never sent to a seat below.
		Offers []TestOfferState `json:"offers,omitempty"`
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
		// Acquire is set on a call made for an acquisition (house decision #102); never on the table screen.
		Acquire *CallAcquire `json:"acquire,omitempty"`
	}
	// CallAcquire is what an acquisition call asks for: the entry's name, the kind, the Test's inputs as parts.
	CallAcquire struct {
		Name   string                       `json:"name"`
		Kind   string                       `json:"kind"`
		Inputs map[string]AcquireInputState `json:"inputs"`
	}
	// AcquireInputState is one of an acquisition's Test inputs: its total and its labelled parts.
	AcquireInputState struct {
		Total float64 `json:"total"`
		Parts []struct {
			Label string  `json:"label"`
			Value float64 `json:"value"`
		} `json:"parts"`
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
		// Status is open, done or failed on a quest, planned, active, done or skipped on a scene, and null otherwise.
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
		// RevealedAt is when the entry was last revealed to the party or a reader; nil while sealed (house decision #86).
		RevealedAt *string `json:"revealedAt"`
		// Fields are the ruleset's declared fields of the entry's kind (house decision #71): stored whole as loaded,
		// filtered to what is declared, valid and seen by the Seat view.
		Fields map[string]any `json:"fields"`
		// Layout and Header are a handout's (house decision #72): one of engine.HandoutLayouts and the line above its
		// body, "" for none. Both are null on every other kind. Seen by whoever sees the entry.
		Layout *string `json:"layout"`
		Header *string `json:"header"`
		// Prep is a scene's prepared lines as stored (ScenePrep), the codex and secrets sides only; nil when none.
		Prep any `json:"prep"`
		// Source is the pack entry it was made from ({entity, key, cite}), the codex and secrets sides only; nil when
		// none (house decision #97).
		Source any `json:"source"`
	}
	// Codex is the `codex` event.
	Codex struct {
		Entries []CodexEntry   `json:"entries"`
		Recaps  []SessionRecap `json:"recaps"`
		// LatestBegin is the room's latest scene begin while its scene is still active (what scene.undoBegin takes back),
		// else nil. The codex and secrets sides only (house decision #105).
		LatestBegin *LatestBegin `json:"latestBegin"`
	}
	// LatestBegin is a scene begin: its id, its scene and the entry ids it revealed.
	LatestBegin struct {
		ID       string   `json:"id"`
		SceneID  string   `json:"sceneId"`
		Revealed []string `json:"revealed"`
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
