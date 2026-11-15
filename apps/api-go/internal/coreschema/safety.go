package coreschema

// Whole is the Safety document with lists that are never null, so the JSON carries [] and not null.
func (s Safety) Whole() Safety {
	if s.Lines == nil {
		s.Lines = []string{}
	}
	if s.Veils == nil {
		s.Veils = []string{}
	}
	return s
}
