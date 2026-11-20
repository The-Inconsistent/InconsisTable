package pack

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// LoneSurrogate finds a \uD800-\uDFFF escape in raw JSON that does not form a valid pair, and returns its offset. Go's
// encoding/json replaces such an escape with U+FFFD, so a content hash computed after decoding would differ from the
// one TypeScript computes (docs/adr/0008-go-api.md): the importer refuses the document instead of storing altered text.
func LoneSurrogate(raw []byte) (int, bool) {
	hex4 := func(at int) (rune, bool) {
		if at+4 > len(raw) {
			return 0, false
		}
		n, err := strconv.ParseUint(string(raw[at:at+4]), 16, 16)
		return rune(n), err == nil
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		if i+1 >= len(raw) {
			break
		}
		if raw[i+1] != 'u' {
			i++ // an escaped character, including a backslash: \\u0000 is not a \u escape
			continue
		}
		unit, ok := hex4(i + 2)
		if !ok {
			continue // not valid JSON; the decoder refuses it
		}
		switch {
		case unit >= 0xDC00 && unit <= 0xDFFF:
			return i, true // a low surrogate with no high one before it (a pair is consumed below)
		case unit >= 0xD800 && unit <= 0xDBFF:
			if i+11 < len(raw) && raw[i+6] == '\\' && raw[i+7] == 'u' {
				if low, ok := hex4(i + 8); ok && low >= 0xDC00 && low <= 0xDFFF {
					i += 11
					continue
				}
			}
			return i, true
		}
		i += 5
	}
	return 0, false
}

// readBody reads an importer's JSON body, up to engine.MaxPackBytes, as express's json({limit}) did for the importer
// routes: a request that is not JSON has an empty object as its body, so the importer is what refuses it. A lone
// surrogate is refused here, before the decoder can replace it. ordered decodes objects with schema.DecodeJSON, in
// their order, for a pack whose records the ledger builder reads in order (house decision #62).
func readBody(w http.ResponseWriter, r *http.Request, ordered bool) (any, error) {
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		return map[string]any{}, nil
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, engine.MaxPackBytes))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return nil, &core.HTTPError{Status: http.StatusRequestEntityTooLarge, Body: map[string]any{"statusCode": 413, "message": "request entity too large"}}
	}
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	if _, found := LoneSurrogate(raw); found {
		return nil, &ruleset.Refused{Problems: []engine.Problem{{Path: "(root)", Message: "a string holds an unpaired UTF-16 surrogate escape (\\uD800 to \\uDFFF); write the character itself"}}}
	}
	var body any
	if ordered {
		body, err = schema.DecodeJSON(raw)
	} else {
		err = json.Unmarshal(raw, &body)
	}
	if err != nil {
		return nil, malformed()
	}
	switch body.(type) {
	case map[string]any, *schema.Obj, []any:
		return body, nil
	}
	return nil, malformed()
}

func malformed() *core.HTTPError {
	return &core.HTTPError{Status: http.StatusBadRequest, Body: map[string]any{"statusCode": 400, "error": "Bad Request", "message": "Malformed JSON"}}
}
