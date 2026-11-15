package view

import "regexp"

// An @mention of a codex entry, as stored in a body: `@[Title](entry-id)`. A seat that cannot see the entry receives
// `@[…](hidden)`, so neither the title nor the id of a hidden entry leaves the server. TS twin: packages/core-schema
// src/mention.ts.
var mentionRE = regexp.MustCompile(`@\[([^\]\n]*)\]\(([^)\s]+)\)`)

const hiddenMention = "@[…](hidden)"

func hideMentions(body string, canSee func(id string) bool) string {
	return mentionRE.ReplaceAllStringFunc(body, func(m string) string {
		if canSee(mentionRE.FindStringSubmatch(m)[2]) {
			return m
		}
		return hiddenMention
	})
}
