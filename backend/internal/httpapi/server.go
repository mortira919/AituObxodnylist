package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/aitu/clearance/backend/internal/security"
	"github.com/aitu/clearance/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	apiPrefix       = "/api/v1"
	sessionCookie   = "session"
	sessionIdle     = 12 * time.Hour
	sessionAbsolute = 7 * 24 * time.Hour
)

var (
	departments   = []string{"library", "accounting", "dorm", "military", "it", "academic"}
	sheetTypes    = []string{"graduation", "expulsion", "transfer", "leave", "dorm"}
	dummyHashOnce sync.Once
	dummyHash     string
)

type Config struct {
	CookieSecure        bool
	AppOrigin           string
	AppURL              string
	TelegramBotUsername string
	TelegramBotToken    string
	TelegramSecret      string
	TrustedProxies      []string
	Logger              *slog.Logger
}

type Server struct {
	db      *sql.DB
	config  Config
	logger  *slog.Logger
	limiter *rateLimiter
}

type principal struct {
	User
	tokenHash []byte
	createdAt time.Time
}

type User struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Login              string  `json:"login"`
	Role               string  `json:"role"`
	DepartmentID       *string `json:"departmentId,omitempty"`
	StudentID          *string `json:"studentId,omitempty"`
	Group              *string `json:"group,omitempty"`
	Active             bool    `json:"active"`
	TelegramLinked     bool    `json:"telegramLinked"`
	MustChangePassword bool    `json:"mustChangePassword"`
}

type Student struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	Name         string `json:"name"`
	Group        string `json:"group"`
	Login        string `json:"login"`
	ActiveSheets int    `json:"activeSheets"`
}

type apiError struct {
	Status  int
	Code    string
	Field   string
	Message string
}

func (e *apiError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

type apiErrorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Field   string `json:"field,omitempty"`
	} `json:"error"`
}

func New(db *sql.DB, config Config) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	s := &Server{db: db, config: config, logger: config.Logger, limiter: newRateLimiter()}
	r := gin.New()
	// Gin trusts every proxy by default, which lets any client spoof X-Forwarded-For and
	// dodge the per-IP rate limits. Trust only the configured proxies (none by default).
	trusted := config.TrustedProxies
	if len(trusted) == 0 {
		trusted = nil
	}
	if err := r.SetTrustedProxies(trusted); err != nil {
		s.logger.Error("invalid trusted proxy configuration")
		_ = r.SetTrustedProxies(nil)
	}
	r.Use(gin.CustomRecovery(func(c *gin.Context, _ any) {
		s.logger.Error("panic handling request", "path", c.Request.URL.Path)
		writeError(c, http.StatusInternalServerError, "server", "", "Internal server error")
	}), securityHeaders(), s.csrfMiddleware())
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, apiPrefix) {
			writeError(c, http.StatusNotFound, "not_found", "", "API endpoint not found")
			return
		}
		c.Status(http.StatusNotFound)
	})
	r.GET("/healthz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group(apiPrefix)
	api.POST("/auth/login", s.login)
	api.POST("/auth/logout", s.logout)
	api.GET("/public/verify/:number", s.publicRateLimit(), s.verify)
	api.POST("/telegram/webhook", s.telegramWebhook)

	private := api.Group("")
	private.Use(s.authMiddleware())
	private.GET("/auth/me", s.me)
	private.POST("/auth/password", s.changePassword)

	private.GET("/sheets", s.listSheets)
	private.POST("/sheets", s.createSheet)
	private.GET("/sheets/mine", s.mySheets)
	private.GET("/sheets/summary", s.sheetSummary)
	private.GET("/sheets/:number", s.sheetDetail)
	private.PUT("/sheets/:number/marks/:department", s.setMark)
	private.GET("/queue/counts", s.queueCounts)
	private.POST("/queue/clear", s.bulkClear)

	private.GET("/students", s.listStudents)
	private.POST("/students", s.createStudent)
	private.POST("/students/import", s.importStudents)
	private.PATCH("/students/:id", s.updateStudent)

	private.GET("/users", s.listUsers)
	private.POST("/users", s.createUser)
	private.PATCH("/users/:id", s.updateUser)
	private.POST("/users/:id/reset-password", s.resetPassword)

	private.GET("/templates", s.getTemplates)
	private.PUT("/templates/:type", s.updateTemplate)
	private.GET("/audit", s.listAudit)
	private.POST("/telegram/link", s.telegramLink)
	private.DELETE("/telegram/link", s.telegramUnlink)

	return r
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "same-origin")
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Next()
	}
}

func (s *Server) csrfMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		if method != http.MethodPost && method != http.MethodPut && method != http.MethodPatch && method != http.MethodDelete {
			c.Next()
			return
		}
		// Telegram calls this endpoint server-to-server and authenticates with its secret token.
		if c.FullPath() == apiPrefix+"/telegram/webhook" {
			c.Next()
			return
		}
		if c.GetHeader("X-Requested-With") != "fetch" {
			writeError(c, http.StatusForbidden, "forbidden", "", "Request origin check failed")
			return
		}
		if origin := c.GetHeader("Origin"); origin != "" && !s.validOrigin(origin, c.Request) {
			writeError(c, http.StatusForbidden, "forbidden", "", "Request origin check failed")
			return
		}
		c.Next()
	}
}

func (s *Server) validOrigin(origin string, r *http.Request) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if s.config.AppOrigin != "" {
		return strings.EqualFold(strings.TrimRight(origin, "/"), s.config.AppOrigin)
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	// Vite proxies the API from localhost:5173 to localhost:8000 in development.
	local := func(host string) bool {
		return strings.EqualFold(host, "localhost") || strings.EqualFold(host, "127.0.0.1") || strings.EqualFold(host, "[::1]")
	}
	return local(u.Hostname()) && local(hostname(r.Host))
}

func hostname(hostport string) string {
	if u, err := url.Parse("http://" + hostport); err == nil {
		return u.Hostname()
	}
	return hostport
}

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie(sessionCookie)
		if err != nil || cookie == "" {
			writeError(c, http.StatusUnauthorized, "unauthorized", "", "Authentication required")
			return
		}
		hash := tokenHash(cookie)
		var userID string
		var createdAt, expiresAt time.Time
		err = s.db.QueryRowContext(c.Request.Context(), `SELECT user_id::text, created_at, expires_at FROM sessions WHERE token_hash = $1`, hash).Scan(&userID, &createdAt, &expiresAt)
		if errors.Is(err, sql.ErrNoRows) || err == nil && (!expiresAt.After(time.Now()) || !createdAt.Add(sessionAbsolute).After(time.Now())) {
			_, _ = s.db.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE token_hash = $1`, hash)
			writeError(c, http.StatusUnauthorized, "unauthorized", "", "Session expired")
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		user, err := s.loadUser(c.Request.Context(), userID)
		if errors.Is(err, sql.ErrNoRows) || err == nil && !user.Active {
			_, _ = s.db.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE token_hash = $1`, hash)
			writeError(c, http.StatusUnauthorized, "unauthorized", "", "Authentication required")
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		now := time.Now()
		newExpiry := now.Add(sessionIdle)
		absoluteExpiry := createdAt.Add(sessionAbsolute)
		if newExpiry.After(absoluteExpiry) {
			newExpiry = absoluteExpiry
		}
		if _, err := s.db.ExecContext(c.Request.Context(), `UPDATE sessions SET expires_at = $2, last_seen_at = $3 WHERE token_hash = $1`, hash, newExpiry, now); err != nil {
			s.internalError(c, err)
			return
		}
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(sessionCookie, cookie, int(time.Until(newExpiry).Seconds()), "/", "", s.config.CookieSecure, true)
		c.Set("principal", &principal{User: user, tokenHash: hash, createdAt: createdAt})
		c.Next()
	}
}

func (s *Server) publicRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := "verify:" + c.ClientIP()
		allowed, retry := s.limiter.allow(key, 30, time.Minute)
		if !allowed {
			c.Header("Retry-After", strconv.Itoa(retry))
			writeError(c, http.StatusTooManyRequests, "rate_limited", "", "Too many requests")
			return
		}
		c.Next()
	}
}

func (s *Server) requireRole(c *gin.Context, roles ...string) (*principal, bool) {
	value, ok := c.Get("principal")
	if !ok {
		writeError(c, http.StatusUnauthorized, "unauthorized", "", "Authentication required")
		return nil, false
	}
	p := value.(*principal)
	for _, role := range roles {
		if p.Role == role {
			return p, true
		}
	}
	writeError(c, http.StatusForbidden, "forbidden", "", "Action is not allowed")
	return nil, false
}

func (s *Server) currentPrincipal(c *gin.Context) *principal {
	value, _ := c.Get("principal")
	return value.(*principal)
}

func (s *Server) loadUser(ctx context.Context, id string) (User, error) {
	var user User
	var department sql.NullString
	var telegram sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT id::text, name, login, role::text, department::text, active, must_change_password, telegram_chat_id FROM users WHERE id::text = $1`, id).
		Scan(&user.ID, &user.Name, &user.Login, &user.Role, &department, &user.Active, &user.MustChangePassword, &telegram)
	if err != nil {
		return User{}, err
	}
	if department.Valid {
		user.DepartmentID = stringPtr(department.String)
	}
	user.TelegramLinked = telegram.Valid
	if user.Role == "student" {
		var studentID, group string
		err := s.db.QueryRowContext(ctx, `SELECT id::text, "group" FROM students WHERE user_id::text = $1`, user.ID).Scan(&studentID, &group)
		if err != nil {
			return User{}, err
		}
		user.StudentID = stringPtr(studentID)
		user.Group = stringPtr(group)
	}
	return user, nil
}

func (s *Server) me(c *gin.Context) {
	c.JSON(http.StatusOK, s.currentPrincipal(c).User)
}

func (s *Server) login(c *gin.Context) {
	var input struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	input.Login = strings.ToLower(strings.TrimSpace(input.Login))
	if input.Login == "" || len(input.Login) > 64 || input.Password == "" || utf8.RuneCountInString(input.Password) > 128 {
		writeError(c, http.StatusBadRequest, "validation", "", "Invalid login request")
		return
	}
	key := "login:" + c.ClientIP() + ":" + input.Login
	if allowed, retry := s.limiter.allow(key, 5, 15*time.Minute); !allowed {
		c.Header("Retry-After", strconv.Itoa(retry))
		writeError(c, http.StatusTooManyRequests, "rate_limited", "", "Too many login attempts")
		return
	}
	var userID, passwordHash string
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT id::text, password_hash FROM users WHERE login = $1 AND active = true`, input.Login).Scan(&userID, &passwordHash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.limiter.reset(key)
		s.internalError(c, err)
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		dummyPasswordCheck(input.Password)
		s.logger.Warn("login failed", "ip", c.ClientIP())
		writeError(c, http.StatusUnauthorized, "login_failed", "", "Login or password is incorrect")
		return
	}
	if comparePassword(passwordHash, input.Password) != nil {
		s.logger.Warn("login failed", "ip", c.ClientIP())
		writeError(c, http.StatusUnauthorized, "login_failed", "", "Login or password is incorrect")
		return
	}
	s.limiter.reset(key)
	// Expired sessions are otherwise only removed when their owner comes back.
	_, _ = s.db.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE expires_at <= now() OR created_at <= now() - interval '7 days'`)
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		s.internalError(c, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	hash := tokenHash(token)
	now := time.Now()
	if _, err := s.db.ExecContext(c.Request.Context(), `INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ($1, $2::text::uuid, $3, $4, $3)`, hash, userID, now, now.Add(sessionIdle)); err != nil {
		s.internalError(c, err)
		return
	}
	user, err := s.loadUser(c.Request.Context(), userID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, token, int(sessionIdle.Seconds()), "/", "", s.config.CookieSecure, true)
	s.logger.Info("user logged in", "user_id", user.ID, "role", user.Role)
	c.JSON(http.StatusOK, user)
}

func (s *Server) logout(c *gin.Context) {
	if cookie, err := c.Cookie(sessionCookie); err == nil && cookie != "" {
		_, _ = s.db.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE token_hash = $1`, tokenHash(cookie))
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, "", -1, "/", "", s.config.CookieSecure, true)
	c.Status(http.StatusNoContent)
}

func (s *Server) changePassword(c *gin.Context) {
	p := s.currentPrincipal(c)
	var input struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	if utf8.RuneCountInString(input.Current) > 128 || utf8.RuneCountInString(input.Next) > 128 {
		writeError(c, http.StatusBadRequest, "validation", "next", "Invalid password length")
		return
	}
	if utf8.RuneCountInString(input.Next) < 8 {
		writeError(c, http.StatusBadRequest, "weak_password", "next", "Password must contain at least 8 characters")
		return
	}
	var oldHash string
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT password_hash FROM users WHERE id::text = $1`, p.ID).Scan(&oldHash); err != nil {
		s.internalError(c, err)
		return
	}
	if comparePassword(oldHash, input.Current) != nil {
		writeError(c, http.StatusBadRequest, "wrong_password", "current", "Current password is incorrect")
		return
	}
	hash, err := hashPassword(input.Next)
	if err != nil {
		s.internalError(c, err)
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET password_hash = $2, must_change_password = false WHERE id::text = $1`, p.ID, hash); err != nil {
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE user_id::text = $1 AND token_hash <> $2`, p.ID, p.tokenHash); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func decodeJSON(c *gin.Context, destination any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	decoder := json.NewDecoder(c.Request.Body)
	if err := decoder.Decode(destination); err != nil {
		writeError(c, http.StatusBadRequest, "validation", "", "Invalid JSON body")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(c, http.StatusBadRequest, "validation", "", "Invalid JSON body")
		return false
	}
	return true
}

func writeError(c *gin.Context, status int, code, field, message string) {
	if message == "" {
		message = code
	}
	var body apiErrorBody
	body.Error.Code = code
	body.Error.Message = message
	body.Error.Field = field
	c.AbortWithStatusJSON(status, body)
}

func (s *Server) internalError(c *gin.Context, err error) {
	s.logger.Error("request failed", "error", err, "path", c.Request.URL.Path)
	writeError(c, http.StatusInternalServerError, "server", "", "Internal server error")
}

func (s *Server) databaseError(c *gin.Context, err error, loginField string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if loginField != "" || pgErr.ConstraintName == "users_login_key" {
			writeError(c, http.StatusConflict, "login_taken", loginField, "Login is already in use")
			return
		}
		if pgErr.ConstraintName == "one_open_sheet_per_type" {
			writeError(c, http.StatusConflict, "duplicate", "type", "Student already has an open sheet of this type")
			return
		}
	}
	s.internalError(c, err)
}

func tokenHash(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func hashPassword(password string) (string, error) {
	return security.HashPassword(password)
}

func comparePassword(hash, password string) error {
	if !security.VerifyPassword(hash, password) {
		return errors.New("password mismatch")
	}
	return nil
}

func dummyPasswordCheck(password string) {
	dummyHashOnce.Do(func() {
		dummyHash, _ = security.HashPassword("not-a-real-user-password")
	})
	_ = security.VerifyPassword(dummyHash, password)
}

func stringPtr(value string) *string { return &value }

func validEnum(value string, options []string) bool {
	for _, candidate := range options {
		if value == candidate {
			return true
		}
	}
	return false
}

func validLogin(value string) bool {
	if len(value) < 3 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func normalizePerson(name string, min, max int) (string, bool) {
	name = strings.TrimSpace(name)
	count := utf8.RuneCountInString(name)
	return name, count >= min && count <= max
}

func parsePage(c *gin.Context, defaultSize int) (page, pageSize int, ok bool) {
	page = 1
	pageSize = defaultSize
	if raw := c.Query("page"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || value < 1 {
			writeError(c, http.StatusBadRequest, "validation", "page", "Page must be a positive integer")
			return 0, 0, false
		}
		page = int(value)
	}
	if raw := c.Query("pageSize"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeError(c, http.StatusBadRequest, "validation", "pageSize", "Page size must be between 1 and 100")
			return 0, 0, false
		}
		pageSize = value
	}
	return page, pageSize, true
}

func pageOffset(page, pageSize int) int64 {
	return int64(page-1) * int64(pageSize)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// A pgx exec can be safely retried only after a transaction rolls back. The
// small helper is used by handlers that create users on import.
func uniqueViolation(err error) bool { return isUniqueViolation(err) }

type dbQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Server) generateTemporaryPassword() (string, error) {
	return store.RandomPassword(10)
}

type rateLimiter struct {
	mu      sync.Mutex
	entries map[string][]time.Time
	checks  uint64
}

func newRateLimiter() *rateLimiter { return &rateLimiter{entries: make(map[string][]time.Time)} }

func (l *rateLimiter) allow(key string, limit int, window time.Duration) (bool, int) {
	now := time.Now()
	cutoff := now.Add(-window)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.checks++
	if l.checks%512 == 0 {
		for candidate, attempts := range l.entries {
			if len(attempts) == 0 || now.Sub(attempts[len(attempts)-1]) > time.Hour {
				delete(l.entries, candidate)
			}
		}
	}
	items := l.entries[key]
	kept := items[:0]
	for _, at := range items {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		l.entries[key] = kept
		retry := int(kept[0].Add(window).Sub(now).Seconds()) + 1
		if retry < 1 {
			retry = 1
		}
		return false, retry
	}
	l.entries[key] = append(kept, now)
	return true, 0
}

func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}
