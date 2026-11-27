package engine

import "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"

// Words in more than one language (issue #159): the twin of packages/rules-engine/src/words.ts. A ruleset's labels and
// terms, and a World's terms, are the words themselves or a map from language to words. The vectors hold the lists equal.

var (
	// Languages is LANGUAGES: the languages a document may give its words in, in fallback order.
	Languages = []string{"en", "vi"}
	// TermIDs is TERM_IDS: the app's words a World or a ruleset may replace.
	TermIDs = []string{
		"party", "foe", "gm", "player", "session", "fight", "round", "turn", "character", "creature", "mob", "scene",
		"mission", "handout", "codex", "tableScreen",
		"markerRed", "markerAmber", "markerGreen", "markerBlue", "markerPurple", "markerWhite",
	}
)

// MaxTerm is MAX_TERM: the longest word or plural a term holds.
const MaxTerm = 60

// termSchema is Term: the word, or the word and its plural as ICU names them.
var termSchema = schema.AnyOf(label(MaxTerm), schema.Object(schema.Req("one", label(MaxTerm)), schema.Req("other", label(MaxTerm))))

// termWords is TermWords: a term for every language, or one per language, which the web's lookup reads per language.
var termWords = schema.ByLanguage(termSchema, Languages...)

// text is Text: a label a ruleset may give per language.
func text(n int) schema.Schema { return schema.Words(label(n), Languages...) }
