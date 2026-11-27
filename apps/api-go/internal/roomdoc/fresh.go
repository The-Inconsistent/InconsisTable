package roomdoc

// fresh is a document as a new group would start it (house decision #103), the mapping of the source app's freshStart
// (wrath_glory packages/shared/src/export.ts:114) onto the document: no sessions; every entry sealed again, its picture
// hidden, its readers and reveal time gone; every scene planned and every pick's switch off; every actor's resources
// back to their start (harm healed, pools spent or filled in play back to where a new character starts), its
// conditions and their stacks gone, and every character active again (the source clears `annihilated`); the shared
// pools back to their start; the next session and the safety lines cleared, and the sessions' dates and awards with the
// sessions. What a character is stays: its build and where its next advance counts from, its fields (earned XP among
// them), the records it holds and its items, as the source keeps sheets, builds, XP and given gear. It changes d in place: d is the parsed copy read made.
func fresh(d doc) doc {
	delete(d, "sessions")
	delete(d, "pools")
	if room, ok := d["room"].(map[string]any); ok {
		for _, key := range []string{"nextSessionAt", "nextSessionPlace", "safety"} {
			delete(room, key)
		}
	}
	for _, a := range d.list("actors") {
		delete(a, "resources")
		delete(a, "conditions")
		delete(a, "status")
	}
	for _, e := range d.list("codex") {
		for _, key := range []string{"visibility", "audienceMode", "audience", "imageRevealed", "revealedAt"} {
			delete(e, key)
		}
		if e["kind"] == "scene" {
			delete(e, "status")
		}
		prep, _ := e["prep"].(map[string]any)
		for _, pick := range doc(prep).list("picks") {
			for _, row := range doc(pick).list("rows") {
				delete(row, "on")
			}
		}
	}
	return d
}
