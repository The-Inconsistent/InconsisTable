package roomdoc

import "fmt"

// itemLine is how the items check reads one document item back (house decision #95): its kind, its entry or name, its
// quantity, its host's entry, the title of the codex item a GIVE handed over, its source and note.
func itemLine(d doc, a, x map[string]any) string {
	name := doc(x).str("entry")
	if name == "" {
		name = doc(x).str("name")
	}
	quantity := "-"
	if q, has := x["quantity"].(float64); has {
		quantity = fmt.Sprint(q)
	}
	host := "-"
	for _, y := range doc(a).list("items") {
		if y["id"] == x["fittedTo"] {
			host = doc(y).str("entry")
		}
	}
	title := "-"
	for _, e := range d.list("codex") {
		if e["id"] == x["entryId"] {
			title = doc(e).str("title")
		}
	}
	source := doc(x).str("source")
	if source == "" {
		source = "hand"
	}
	return doc(x).str("kind") + " " + name + " x" + quantity + " on " + host + " from " + title + " " + source + " " + doc(x).str("note")
}
