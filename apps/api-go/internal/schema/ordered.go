package schema

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"slices"
	"strconv"
)

// Obj is a JSON object that keeps its keys in JavaScript's order: the array indexes first, ascending, then every other
// key where it was first set. Input whose key order the TypeScript reads (Object.entries, JSON.stringify) is decoded
// into it with DecodeJSON, and every object schema that reads an Obj answers with one: z.object in its fields' order,
// z.record and z.partialRecord in the input's.
type Obj struct {
	keys []string
	vals map[string]any
}

// NewObj is an empty object.
func NewObj() *Obj { return &Obj{vals: map[string]any{}} }

// Get is the value of key, and whether the object has it.
func (o *Obj) Get(key string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.vals[key]
	return v, ok
}

// Has is JavaScript's `key in o`.
func (o *Obj) Has(key string) bool {
	_, ok := o.Get(key)
	return ok
}

// Keys are the keys in order. The slice is the object's own: don't change it.
func (o *Obj) Keys() []string {
	if o == nil {
		return nil
	}
	return o.keys
}

// Len is the number of keys.
func (o *Obj) Len() int { return len(o.Keys()) }

// Set is JavaScript's assignment: a new key takes its place in the order, an existing one keeps its place.
func (o *Obj) Set(key string, v any) *Obj {
	if _, ok := o.vals[key]; !ok {
		at := len(o.keys)
		if n, isIndex := arrayIndex(key); isIndex {
			at = 0
			for at < len(o.keys) {
				m, earlier := arrayIndex(o.keys[at])
				if !earlier || m > n {
					break
				}
				at++
			}
		}
		o.keys = slices.Insert(o.keys, at, key)
	}
	o.vals[key] = v
	return o
}

// Map is a shallow copy as a Go map, for code that reads keys and not their order.
func (o *Obj) Map() map[string]any {
	out := make(map[string]any, o.Len())
	for _, k := range o.Keys() {
		out[k] = o.vals[k]
	}
	return out
}

// An array index is a canonical decimal below 2^32 - 1; JavaScript lists those keys first, in numeric order.
func arrayIndex(key string) (uint64, bool) {
	if key == "" || len(key) > 10 || (key[0] == '0' && len(key) > 1) {
		return 0, false
	}
	n, err := strconv.ParseUint(key, 10, 64)
	return n, err == nil && n < math.MaxUint32
}

// MarshalJSON writes the keys in order. A number that isn't finite is null, as JSON.stringify writes it.
func (o *Obj) MarshalJSON() ([]byte, error) { return AppendJSON(nil, o) }

// UnmarshalJSON decodes in order, so an Obj field of a struct keeps it.
func (o *Obj) UnmarshalJSON(data []byte) error {
	v, err := DecodeJSON(data)
	if err != nil {
		return err
	}
	in, ok := v.(*Obj)
	if !ok {
		return errors.New("schema: not a JSON object")
	}
	*o = *in
	return nil
}

// AppendJSON appends v as JSON: an Obj in its order, a Go map with sorted keys, a number that isn't finite as null.
func AppendJSON(buf []byte, v any) ([]byte, error) {
	switch x := v.(type) {
	case *Obj:
		if x == nil {
			return append(buf, "null"...), nil
		}
		buf = append(buf, '{')
		for i, k := range x.keys {
			if i > 0 {
				buf = append(buf, ',')
			}
			key, _ := json.Marshal(k)
			buf = append(buf, key...)
			buf = append(buf, ':')
			var err error
			if buf, err = AppendJSON(buf, x.vals[k]); err != nil {
				return nil, err
			}
		}
		return append(buf, '}'), nil
	case []any:
		buf = append(buf, '[')
		for i, item := range x {
			if i > 0 {
				buf = append(buf, ',')
			}
			var err error
			if buf, err = AppendJSON(buf, item); err != nil {
				return nil, err
			}
		}
		return append(buf, ']'), nil
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return append(buf, "null"...), nil
		}
	}
	out, err := json.Marshal(v)
	return append(buf, out...), err
}

// DecodeJSON is JSON.parse: objects as Obj in JavaScript's key order (a repeated key keeps its first place and its last
// value), numbers as float64 (one too large to hold is an infinity, as in JavaScript), and nothing after the value.
func DecodeJSON(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := decodeValue(dec)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("schema: data after the JSON value")
	}
	return v, nil
}

func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			list := []any{}
			for dec.More() {
				item, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				list = append(list, item)
			}
			_, err := dec.Token()
			return list, err
		}
		o := NewObj()
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return nil, err
			}
			v, err := decodeValue(dec)
			if err != nil {
				return nil, err
			}
			k, _ := key.(string)
			o.Set(k, v)
		}
		_, err := dec.Token()
		return o, err
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, err
		}
		return f, nil
	}
	return tok, nil
}
