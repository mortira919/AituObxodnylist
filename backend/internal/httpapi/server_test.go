package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testHandler() http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(nil, Config{Logger: logger})
}

func TestWriteRequestsRequireCSRFHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/auth/logout", strings.NewReader("{}"))
	res := httptest.NewRecorder()
	testHandler().ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", res.Code, http.StatusForbidden, res.Body.String())
	}
	var body apiErrorBody
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "forbidden" {
		t.Fatalf("error code = %q, want forbidden", body.Error.Code)
	}
	if got := res.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

func TestWriteRequestsRejectForeignOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/auth/logout", nil)
	req.Header.Set("X-Requested-With", "fetch")
	req.Header.Set("Origin", "https://attacker.example")
	res := httptest.NewRecorder()
	testHandler().ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
}

func TestLogoutWithoutCookieIsIdempotent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/auth/logout", nil)
	req.Header.Set("X-Requested-With", "fetch")
	res := httptest.NewRecorder()
	testHandler().ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", res.Code, http.StatusNoContent, res.Body.String())
	}
	if res.Body.Len() != 0 {
		t.Fatalf("204 response must not contain a body: %q", res.Body.String())
	}
}

func TestPublicVerifyInvalidNumberIsPrivateAndDoesNotNeedDatabase(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, apiPrefix+"/public/verify/not-a-number", nil)
	res := httptest.NewRecorder()
	testHandler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 || body["found"] != false || body["closed"] != false {
		t.Fatalf("invalid verification response exposed unexpected data: %#v", body)
	}
}

func TestUnknownAPIEndpointUsesStandardErrorEnvelope(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, apiPrefix+"/missing", nil)
	res := httptest.NewRecorder()
	testHandler().ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusNotFound)
	}
	var body apiErrorBody
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "not_found" || body.Error.Message == "" {
		t.Fatalf("unexpected error response: %#v", body.Error)
	}
}

func TestPublicVerifyRateLimit(t *testing.T) {
	handler := testHandler()
	for i := 0; i < 31; i++ {
		req := httptest.NewRequest(http.MethodGet, apiPrefix+"/public/verify/invalid", nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if i < 30 && res.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200", i+1, res.Code)
		}
		if i == 30 {
			if res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "" {
				t.Fatalf("limited request status/header = %d/%q", res.Code, res.Header().Get("Retry-After"))
			}
		}
	}
}

func TestNormalizeMarkInput(t *testing.T) {
	tests := []struct {
		name      string
		input     markInput
		today     string
		wantNote  string
		wantDue   string
		wantError string
	}{
		{name: "clear removes debt fields", input: markInput{State: "clear", Note: stringPtr("ignored"), Due: stringPtr("2020-01-01")}, today: "2026-11-03"},
		{name: "trim debt note", input: markInput{State: "debt", Note: stringPtr("  Вернуть книгу  "), Due: stringPtr("2026-11-03")}, today: "2026-11-03", wantNote: "Вернуть книгу", wantDue: "2026-11-03"},
		{name: "debt requires note", input: markInput{State: "debt"}, today: "2026-11-03", wantError: "note_required"},
		{name: "due cannot be past", input: markInput{State: "debt", Note: stringPtr("Долг"), Due: stringPtr("2026-11-02")}, today: "2026-11-03", wantError: "due_past"},
		{name: "date format validated", input: markInput{State: "debt", Note: stringPtr("Долг"), Due: stringPtr("03.11.2026")}, today: "2026-11-03", wantError: "validation"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			note, due, apiErr := normalizeMarkInput(tt.input, tt.today)
			if tt.wantError != "" {
				if apiErr == nil || apiErr.Code != tt.wantError {
					t.Fatalf("error = %#v, want code %q", apiErr, tt.wantError)
				}
				return
			}
			if apiErr != nil {
				t.Fatalf("unexpected error: %v", apiErr)
			}
			if note != tt.wantNote || due != tt.wantDue {
				t.Fatalf("got note/due %q/%q, want %q/%q", note, due, tt.wantNote, tt.wantDue)
			}
		})
	}
}

func TestSheetStatusAndShortName(t *testing.T) {
	opened := Sheet{Marks: []Mark{{State: "pending"}, {State: "clear"}}}
	if got := sheetStatus(opened); got != "progress" {
		t.Fatalf("status = %q, want progress", got)
	}
	opened.Marks = append(opened.Marks, Mark{State: "debt"})
	if got := sheetStatus(opened); got != "debt" {
		t.Fatalf("status = %q, want debt", got)
	}
	opened.ClosedAt = stringPtr("2026-11-03T10:00:00+05:00")
	if got := sheetStatus(opened); got != "closed" {
		t.Fatalf("status = %q, want closed", got)
	}
	if got := makeShortName("Айгерим Сапарова"); got != "Айгерим С." {
		t.Fatalf("short name = %q", got)
	}
	if got := makeShortName("Жанар"); got != "Жанар" {
		t.Fatalf("single name = %q", got)
	}
}

func TestCSVParsingAndFormulaGuard(t *testing.T) {
	if got := detectCSVSeparator([]byte("name;group;login\n")); got != ';' {
		t.Fatalf("separator = %q, want semicolon", got)
	}
	if got := detectCSVSeparator([]byte("name,group,login\n")); got != ',' {
		t.Fatalf("separator = %q, want comma", got)
	}
	for _, value := range []string{"=1+1", " +SUM(A1:A2)", "-cmd", "@value"} {
		if !formulaCell(value) {
			t.Errorf("formulaCell(%q) = false", value)
		}
	}
	for _, value := range []string{"Aliya", "PO-2201", "a.user"} {
		if formulaCell(value) {
			t.Errorf("formulaCell(%q) = true", value)
		}
	}
}

func TestCSVStrayQuotesDoNotRejectWholeFile(t *testing.T) {
	data := []byte("name;group;login\nЕрлан \"Ер\" Нуров;PO-2201;e.nurov\n=HYPERLINK(\"x\");PO-2201;evil\nAliya Ken;PO-2301;a.ken\n")
	records, err := newImportReader(data, ';').ReadAll()
	if err != nil {
		t.Fatalf("stray quotes rejected the file: %v", err)
	}
	if len(records) != 4 {
		t.Fatalf("rows = %d, want 4", len(records))
	}
	if records[1][0] != `Ерлан "Ер" Нуров` {
		t.Errorf("name with quotes = %q", records[1][0])
	}
	if !formulaCell(records[2][0]) {
		t.Errorf("formula row was not detected: %q", records[2][0])
	}
}

func TestRateLimiterExpiresAndResets(t *testing.T) {
	limiter := newRateLimiter()
	if allowed, _ := limiter.allow("test", 1, time.Millisecond); !allowed {
		t.Fatal("first request should be allowed")
	}
	if allowed, retry := limiter.allow("test", 1, time.Millisecond); allowed || retry < 1 {
		t.Fatalf("second request = %v, retry=%d; want rate limited", allowed, retry)
	}
	time.Sleep(2 * time.Millisecond)
	if allowed, _ := limiter.allow("test", 1, time.Millisecond); !allowed {
		t.Fatal("request should be allowed after the old window expires")
	}
	limiter.reset("test")
	if allowed, _ := limiter.allow("test", 1, time.Second); !allowed {
		t.Fatal("request should be allowed after a reset")
	}
}
