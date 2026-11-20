package image

import (
	"errors"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

var (
	jpeg = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10}
	webp = append([]byte("RIFF\x10\x00\x00\x00WEBPVP8 "), 0, 0)
)

func refusal(err error) string {
	var e *cs.Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestCheckRefusesWhatIsNotAPictureOrDoesNotFit(t *testing.T) {
	full := make([]Info, MaxCount)
	heavy := []Info{{Size: MaxRoomBytes - len(jpeg) + 1}}
	exact := []Info{{Size: MaxRoomBytes - len(jpeg)}}
	big := append(append([]byte{}, jpeg...), make([]byte, MaxBytes)...)
	for _, c := range []struct {
		name, mime string
		data       []byte
		held       []Info
		want       string
	}{
		{"jpeg", "image/jpeg", jpeg, nil, ""},
		{"webp", "image/webp", webp, nil, ""},
		{"another format", "image/png", jpeg, nil, "pictureType"},
		{"bytes of the other format", "image/webp", jpeg, nil, "pictureNotPicture"},
		{"text called a picture", "image/jpeg", []byte("hello, world"), nil, "pictureNotPicture"},
		{"over a megabyte", "image/jpeg", big, nil, "pictureTooLarge"},
		{"the room's count", "image/jpeg", jpeg, full, "picturesFull"},
		{"one under the count", "image/jpeg", jpeg, full[1:], ""},
		{"the room's bytes", "image/jpeg", jpeg, heavy, "picturesTooHeavy"},
		{"exactly the room's bytes", "image/jpeg", jpeg, exact, ""},
	} {
		if got := refusal(Check(c.mime, c.data, c.held)); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
