package store

import (
	"strings"
	"testing"
)

func TestRandomPasswordUsesOnlyAllowedCharacters(t *testing.T) {
	password, err := RandomPassword(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(password) != 10 {
		t.Fatalf("password length = %d", len(password))
	}
	if strings.ContainsAny(password, "0O1lI") {
		t.Fatalf("password contains an ambiguous character: %q", password)
	}
}

func TestValidLogin(t *testing.T) {
	for _, login := range []string{"admin", "a.user-1", "test_account"} {
		if !validLogin(login) {
			t.Errorf("validLogin(%q) = false", login)
		}
	}
	for _, login := range []string{"UPPER", "ab", "no spaces", "user!"} {
		if validLogin(login) {
			t.Errorf("validLogin(%q) = true", login)
		}
	}
}
