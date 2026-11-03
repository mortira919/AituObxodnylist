package security

import "testing"

func TestPasswordHashAndVerification(t *testing.T) {
	password := "Қауіпсіз-құпия-сөз-ұзындығы-более-72-байт"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if hash == password || len(hash) == 0 {
		t.Fatal("password hash is not encoded")
	}
	if !VerifyPassword(hash, password) {
		t.Fatal("the generated password hash did not verify")
	}
	if VerifyPassword(hash, "incorrect password") {
		t.Fatal("an incorrect password verified")
	}
}
