package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type studentCredential struct {
	Student           Student `json:"student"`
	TemporaryPassword string  `json:"temporaryPassword"`
}

func (s *Server) listStudents(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	page, pageSize, ok := parsePage(c, 25)
	if !ok {
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(query) > 100 {
		writeError(c, http.StatusBadRequest, "validation", "q", "Search query is too long")
		return
	}
	var total int
	pattern := "%" + query + "%"
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT count(*) FROM students st JOIN users u ON u.id = st.user_id WHERE $1 = '' OR u.name ILIKE $2 OR st."group" ILIKE $2 OR u.login ILIKE $2`, query, pattern).Scan(&total); err != nil {
		s.internalError(c, err)
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT st.id::text, u.id::text, u.name, st."group", u.login,
		(SELECT count(*) FROM sheets sh WHERE sh.student_id = st.id AND sh.closed_at IS NULL)
		FROM students st JOIN users u ON u.id = st.user_id
		WHERE $1 = '' OR u.name ILIKE $2 OR st."group" ILIKE $2 OR u.login ILIKE $2
		ORDER BY lower(u.name), u.name LIMIT $3 OFFSET $4`, query, pattern, pageSize, pageOffset(page, pageSize))
	if err != nil {
		s.internalError(c, err)
		return
	}
	items := make([]Student, 0, pageSize)
	for rows.Next() {
		var student Student
		if err := rows.Scan(&student.ID, &student.UserID, &student.Name, &student.Group, &student.Login, &student.ActiveSheets); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		items = append(items, student)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (s *Server) createStudent(c *gin.Context) {
	p, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	var input struct {
		Name  string `json:"name"`
		Group string `json:"group"`
		Login string `json:"login"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	input.Name, ok = normalizePerson(input.Name, 3, 120)
	if !ok {
		writeError(c, http.StatusBadRequest, "validation", "name", "Name must contain 3–120 characters")
		return
	}
	input.Group = strings.TrimSpace(input.Group)
	if n := utf8.RuneCountInString(input.Group); n < 2 || n > 20 {
		writeError(c, http.StatusBadRequest, "validation", "group", "Group must contain 2–20 characters")
		return
	}
	input.Login = strings.TrimSpace(input.Login)
	if !validLogin(input.Login) {
		writeError(c, http.StatusBadRequest, "validation", "login", "Invalid login format")
		return
	}
	temporaryPassword, err := s.generateTemporaryPassword()
	if err != nil {
		s.internalError(c, err)
		return
	}
	student, err := s.insertStudent(c.Request.Context(), input.Name, input.Group, input.Login, temporaryPassword)
	if err != nil {
		if uniqueViolation(err) {
			writeError(c, http.StatusConflict, "login_taken", "login", "Login is already in use")
			return
		}
		s.internalError(c, err)
		return
	}
	s.logger.Info("student account created", "actor_id", p.ID, "student_id", student.ID)
	c.JSON(http.StatusCreated, studentCredential{Student: student, TemporaryPassword: temporaryPassword})
}

func (s *Server) updateStudent(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	var input struct {
		Name  *string `json:"name"`
		Group *string `json:"group"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	if input.Name != nil {
		name, ok := normalizePerson(*input.Name, 3, 120)
		if !ok {
			writeError(c, http.StatusBadRequest, "validation", "name", "Name must contain 3–120 characters")
			return
		}
		input.Name = &name
	}
	if input.Group != nil {
		group := strings.TrimSpace(*input.Group)
		if n := utf8.RuneCountInString(group); n < 2 || n > 20 {
			writeError(c, http.StatusBadRequest, "validation", "group", "Group must contain 2–20 characters")
			return
		}
		input.Group = &group
	}
	if input.Name == nil && input.Group == nil {
		writeError(c, http.StatusBadRequest, "validation", "", "At least one field is required")
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	var userID string
	if err := tx.QueryRowContext(c.Request.Context(), `SELECT user_id::text FROM students WHERE id::text = $1 FOR UPDATE`, c.Param("id")).Scan(&userID); err == sql.ErrNoRows {
		writeError(c, http.StatusNotFound, "not_found", "", "Student not found")
		return
	} else if err != nil {
		s.internalError(c, err)
		return
	}
	if input.Name != nil {
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET name = $2 WHERE id::text = $1`, userID, *input.Name); err != nil {
			s.internalError(c, err)
			return
		}
	}
	if input.Group != nil {
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE students SET "group" = $2 WHERE user_id::text = $1`, userID, *input.Group); err != nil {
			s.internalError(c, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	student, err := s.fetchStudent(c.Request.Context(), c.Param("id"))
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, student)
}

func (s *Server) insertStudent(ctx context.Context, name, group, login, password string) (Student, error) {
	hash, err := hashPassword(password)
	if err != nil {
		return Student{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Student{}, err
	}
	defer tx.Rollback()
	var userID, studentID string
	err = tx.QueryRowContext(ctx, `INSERT INTO users(login, password_hash, name, role, must_change_password) VALUES ($1, $2, $3, 'student', true) RETURNING id::text`, login, hash, name).Scan(&userID)
	if err != nil {
		return Student{}, err
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO students(user_id, "group") VALUES ($1::text::uuid, $2) RETURNING id::text`, userID, group).Scan(&studentID)
	if err != nil {
		return Student{}, err
	}
	if err := tx.Commit(); err != nil {
		return Student{}, err
	}
	return s.fetchStudent(ctx, studentID)
}

func (s *Server) fetchStudent(ctx context.Context, id string) (Student, error) {
	var student Student
	err := s.db.QueryRowContext(ctx, `SELECT st.id::text, u.id::text, u.name, st."group", u.login,
		(SELECT count(*) FROM sheets sh WHERE sh.student_id = st.id AND sh.closed_at IS NULL)
		FROM students st JOIN users u ON u.id = st.user_id WHERE st.id::text = $1`, id).
		Scan(&student.ID, &student.UserID, &student.Name, &student.Group, &student.Login, &student.ActiveSheets)
	return student, err
}

func (s *Server) importStudents(c *gin.Context) {
	p, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	key := "import:" + p.ID
	if allowed, retry := s.limiter.allow(key, 5, time.Hour); !allowed {
		c.Header("Retry-After", fmt.Sprintf("%d", retry))
		writeError(c, http.StatusTooManyRequests, "rate_limited", "", "Too many imports")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20+64<<10)
	if err := c.Request.ParseMultipartForm(2 << 20); err != nil {
		writeError(c, http.StatusBadRequest, "bad_file", "", "CSV file could not be read")
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		writeError(c, http.StatusBadRequest, "bad_file", "", "CSV file is required")
		return
	}
	defer file.Close()
	if header.Size > 2<<20 {
		writeError(c, http.StatusBadRequest, "bad_file", "", "CSV file is too large")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
	if err != nil || len(data) > 2<<20 || !utf8.Valid(data) {
		writeError(c, http.StatusBadRequest, "bad_file", "", "CSV must be UTF-8 and no larger than 2 MB")
		return
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	separator := detectCSVSeparator(data)
	reader := newImportReader(data, separator)
	rows := make([]csvRow, 0, 32)
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(c, http.StatusBadRequest, "bad_file", "", "CSV file could not be parsed")
			return
		}
		line, _ := reader.FieldPos(0)
		rows = append(rows, csvRow{fields: record, line: line})
		if len(rows) > 2000 {
			writeError(c, http.StatusBadRequest, "bad_file", "", "CSV contains more than 2000 rows")
			return
		}
	}
	if len(rows) == 0 || len(rows[0].fields) != 3 {
		writeError(c, http.StatusBadRequest, "bad_file", "", "CSV must contain name, group and login columns")
		return
	}
	start := 0
	if len(rows[0].fields) == 3 && strings.EqualFold(strings.TrimSpace(rows[0].fields[0]), "name") && strings.EqualFold(strings.TrimSpace(rows[0].fields[1]), "group") && strings.EqualFold(strings.TrimSpace(rows[0].fields[2]), "login") {
		start = 1
	}
	created := make([]studentCredential, 0)
	skipped := make([]gin.H, 0)
	for _, row := range rows[start:] {
		if len(row.fields) != 3 {
			skipped = append(skipped, gin.H{"line": row.line, "code": "validation"})
			continue
		}
		name := strings.TrimSpace(row.fields[0])
		group := strings.TrimSpace(row.fields[1])
		login := strings.TrimSpace(row.fields[2])
		if formulaCell(name) || formulaCell(group) || formulaCell(login) {
			skipped = append(skipped, gin.H{"line": row.line, "code": "validation"})
			continue
		}
		name, nameOK := normalizePerson(name, 3, 120)
		if !nameOK || utf8.RuneCountInString(group) < 2 || utf8.RuneCountInString(group) > 20 || !validLogin(login) {
			skipped = append(skipped, gin.H{"line": row.line, "code": "validation"})
			continue
		}
		password, err := s.generateTemporaryPassword()
		if err != nil {
			s.internalError(c, err)
			return
		}
		student, err := s.insertStudent(c.Request.Context(), name, group, login, password)
		if err != nil {
			if uniqueViolation(err) {
				skipped = append(skipped, gin.H{"line": row.line, "code": "login_taken"})
				continue
			}
			s.internalError(c, err)
			return
		}
		created = append(created, studentCredential{Student: student, TemporaryPassword: password})
	}
	s.logger.Info("student CSV import completed", "actor_id", p.ID, "created", len(created), "skipped", len(skipped))
	c.JSON(http.StatusOK, gin.H{"created": created, "skipped": skipped})
}

type csvRow struct {
	fields []string
	line   int
}

func detectCSVSeparator(data []byte) rune {
	line := data
	if index := bytes.IndexByte(data, '\n'); index >= 0 {
		line = data[:index]
	}
	commas, semicolons := 0, 0
	quoted := false
	for i := 0; i < len(line); i++ {
		if line[i] == '"' {
			if quoted && i+1 < len(line) && line[i+1] == '"' {
				i++
			} else {
				quoted = !quoted
			}
			continue
		}
		if quoted {
			continue
		}
		if line[i] == ',' {
			commas++
		}
		if line[i] == ';' {
			semicolons++
		}
	}
	if semicolons > commas {
		return ';'
	}
	return ','
}

func formulaCell(value string) bool {
	value = strings.TrimLeft(value, " \t\r\n")
	return strings.HasPrefix(value, "=") || strings.HasPrefix(value, "+") || strings.HasPrefix(value, "-") || strings.HasPrefix(value, "@")
}

// newImportReader reads one student per row. LazyQuotes keeps a stray quote inside a cell
// (a nickname like Ерлан "Ер" or a formula like =HYPERLINK("x")) from rejecting the whole file:
// such rows reach the per-row checks and are skipped there with "validation" or created.
func newImportReader(data []byte, separator rune) *csv.Reader {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.Comma = separator
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	return reader
}
