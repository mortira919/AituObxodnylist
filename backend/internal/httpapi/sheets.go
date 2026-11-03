package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type Mark struct {
	Department string `json:"department"`
	State      string `json:"state"`
	Note       string `json:"note,omitempty"`
	Due        string `json:"due,omitempty"`
	At         string `json:"at,omitempty"`
	By         string `json:"by,omitempty"`
}

type Sheet struct {
	Number    string  `json:"number"`
	Type      string  `json:"type"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"createdAt"`
	ClosedAt  *string `json:"closedAt"`
	Student   struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Group string `json:"group"`
	} `json:"student"`
	Marks []Mark       `json:"marks"`
	Audit []AuditEntry `json:"audit,omitempty"`
}

type AuditEntry struct {
	At         string  `json:"at"`
	Actor      string  `json:"actor"`
	Sheet      string  `json:"sheet"`
	Department *string `json:"department,omitempty"`
	Action     string  `json:"action"`
	Note       string  `json:"note,omitempty"`
}

type markInput struct {
	State string  `json:"state"`
	Note  *string `json:"note"`
	Due   *string `json:"due"`
}

var sheetNumberPattern = regexp.MustCompile(`^\d{4}-\d{4}$`)

func (s *Server) listSheets(c *gin.Context) {
	p, ok := s.requireRole(c, "officer", "admin")
	if !ok {
		return
	}
	page, pageSize, ok := parsePage(c, 25)
	if !ok {
		return
	}
	status := c.Query("status")
	if status != "" && !validEnum(status, []string{"created", "progress", "debt", "closed"}) {
		writeError(c, http.StatusBadRequest, "validation", "status", "Invalid sheet status")
		return
	}
	typeFilter := c.Query("type")
	if typeFilter != "" && !validEnum(typeFilter, sheetTypes) {
		writeError(c, http.StatusBadRequest, "validation", "type", "Invalid sheet type")
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(query) > 100 {
		writeError(c, http.StatusBadRequest, "validation", "q", "Search query is too long")
		return
	}
	department := c.Query("department")
	if p.Role == "officer" {
		if p.DepartmentID == nil {
			s.internalError(c, fmt.Errorf("officer %s has no department", p.ID))
			return
		}
		department = *p.DepartmentID
	} else if department != "" && !validEnum(department, departments) {
		writeError(c, http.StatusBadRequest, "validation", "department", "Invalid department")
		return
	}
	markState := c.Query("markState")
	if markState != "" && !validEnum(markState, []string{"pending", "clear", "debt"}) {
		writeError(c, http.StatusBadRequest, "validation", "markState", "Invalid mark state")
		return
	}
	if markState != "" && department == "" {
		writeError(c, http.StatusBadRequest, "validation", "markState", "A department is required when filtering by mark state")
		return
	}

	where := make([]string, 0, 5)
	args := make([]any, 0, 7)
	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if status != "" {
		add(`(CASE WHEN sh.closed_at IS NOT NULL THEN 'closed' WHEN EXISTS (SELECT 1 FROM marks md WHERE md.sheet_number = sh.number AND md.state = 'debt') THEN 'debt' WHEN EXISTS (SELECT 1 FROM marks mc WHERE mc.sheet_number = sh.number AND mc.state = 'clear') THEN 'progress' ELSE 'created' END) = $%d`, status)
	}
	if typeFilter != "" {
		add(`sh.type::text = $%d`, typeFilter)
	}
	if query != "" {
		args = append(args, "%"+query+"%")
		placeholder := fmt.Sprintf("$%d", len(args))
		where = append(where, `(u.name ILIKE `+placeholder+` OR st."group" ILIKE `+placeholder+` OR sh.number ILIKE `+placeholder+`)`)
	}
	if department != "" {
		args = append(args, department)
		departmentPlaceholder := fmt.Sprintf("$%d", len(args))
		markCondition := ""
		if markState != "" {
			args = append(args, markState)
			markCondition = fmt.Sprintf(" AND m.state::text = $%d", len(args))
		}
		where = append(where, `EXISTS (SELECT 1 FROM marks m WHERE m.sheet_number = sh.number AND m.department::text = `+departmentPlaceholder+markCondition+")")
	}
	filter := ""
	if len(where) > 0 {
		filter = " WHERE " + strings.Join(where, " AND ")
	}
	base := ` FROM sheets sh JOIN students st ON st.id = sh.student_id JOIN users u ON u.id = st.user_id` + filter
	var total int
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT count(*)`+base, args...).Scan(&total); err != nil {
		s.internalError(c, err)
		return
	}
	args = append(args, pageSize, pageOffset(page, pageSize))
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT sh.number`+base+fmt.Sprintf(` ORDER BY sh.created_at DESC, sh.number DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		s.internalError(c, err)
		return
	}
	var numbers []string
	for rows.Next() {
		var number string
		if err := rows.Scan(&number); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		numbers = append(numbers, number)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	items := make([]Sheet, 0, len(numbers))
	for _, number := range numbers {
		sheet, err := s.fetchSheet(c.Request.Context(), s.db, number)
		if err != nil {
			s.internalError(c, err)
			return
		}
		items = append(items, sheet)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (s *Server) mySheets(c *gin.Context) {
	p, ok := s.requireRole(c, "student")
	if !ok {
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT number FROM sheets WHERE student_id::text = $1 ORDER BY (closed_at IS NULL) DESC, COALESCE(closed_at, created_at) DESC`, *p.StudentID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	numbers := []string{}
	for rows.Next() {
		var number string
		if err := rows.Scan(&number); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		numbers = append(numbers, number)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	items := make([]Sheet, 0, len(numbers))
	for _, number := range numbers {
		sheet, err := s.fetchSheet(c.Request.Context(), s.db, number)
		if err != nil {
			s.internalError(c, err)
			return
		}
		items = append(items, sheet)
	}
	c.JSON(http.StatusOK, items)
}

func (s *Server) sheetSummary(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	location := almatyLocation()
	now := time.Now().In(location)
	start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, location)
	end := time.Date(now.Year()+1, time.January, 1, 0, 0, 0, 0, location)
	var active, withDebt, closed int
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT
		(SELECT count(*) FROM sheets WHERE closed_at IS NULL),
		(SELECT count(DISTINCT sh.number) FROM sheets sh JOIN marks m ON m.sheet_number = sh.number WHERE sh.closed_at IS NULL AND m.state = 'debt'),
		(SELECT count(*) FROM sheets WHERE closed_at >= $1 AND closed_at < $2)`, start, end).Scan(&active, &withDebt, &closed)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"active": active, "withDebt": withDebt, "closed": closed})
}

func (s *Server) sheetDetail(c *gin.Context) {
	p, ok := s.requireRole(c, "officer", "admin")
	if !ok {
		return
	}
	number := c.Param("number")
	sheet, err := s.fetchSheet(c.Request.Context(), s.db, number)
	if errorsIsNoRows(err) {
		writeError(c, http.StatusNotFound, "not_found", "", "Sheet not found")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	if p.Role == "officer" && (p.DepartmentID == nil || !sheetHasDepartment(sheet, *p.DepartmentID)) {
		writeError(c, http.StatusNotFound, "not_found", "", "Sheet not found")
		return
	}
	entries, err := s.fetchAudit(c.Request.Context(), s.db, `sheet_number = $1`, number)
	if err != nil {
		s.internalError(c, err)
		return
	}
	sheet.Audit = entries
	c.JSON(http.StatusOK, sheet)
}

func (s *Server) createSheet(c *gin.Context) {
	p, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	var input struct {
		StudentID string `json:"studentId"`
		Type      string `json:"type"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	input.StudentID = strings.TrimSpace(input.StudentID)
	if input.StudentID == "" {
		writeError(c, http.StatusBadRequest, "validation", "studentId", "Student is required")
		return
	}
	if !validEnum(input.Type, sheetTypes) {
		writeError(c, http.StatusBadRequest, "validation", "type", "Invalid sheet type")
		return
	}
	var exists bool
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT EXISTS (SELECT 1 FROM students WHERE id::text = $1)`, input.StudentID).Scan(&exists); err != nil {
		s.internalError(c, err)
		return
	}
	if !exists {
		writeError(c, http.StatusNotFound, "not_found", "", "Student not found")
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	var depts []string
	rows, err := tx.QueryContext(c.Request.Context(), `SELECT department::text FROM templates WHERE type::text = $1 ORDER BY CASE department::text WHEN 'library' THEN 1 WHEN 'accounting' THEN 2 WHEN 'dorm' THEN 3 WHEN 'military' THEN 4 WHEN 'it' THEN 5 WHEN 'academic' THEN 6 END`, input.Type)
	if err != nil {
		s.internalError(c, err)
		return
	}
	for rows.Next() {
		var dept string
		if err := rows.Scan(&dept); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		depts = append(depts, dept)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	if len(depts) == 0 {
		writeError(c, http.StatusBadRequest, "no_depts", "", "The template must contain at least one department")
		return
	}
	var openAlready bool
	if err := tx.QueryRowContext(c.Request.Context(), `SELECT EXISTS (SELECT 1 FROM sheets WHERE student_id::text = $1 AND type::text = $2 AND closed_at IS NULL)`, input.StudentID, input.Type).Scan(&openAlready); err != nil {
		s.internalError(c, err)
		return
	}
	if openAlready {
		writeError(c, http.StatusConflict, "duplicate", "type", "Student already has an open sheet of this type")
		return
	}
	location := almatyLocation()
	year := time.Now().In(location).Year()
	var sequence int
	if err := tx.QueryRowContext(c.Request.Context(), `INSERT INTO sheet_counters(year, last) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last = sheet_counters.last + 1 RETURNING last`, year).Scan(&sequence); err != nil {
		s.internalError(c, err)
		return
	}
	if sequence > 9999 {
		s.internalError(c, fmt.Errorf("sheet number limit exceeded for %d", year))
		return
	}
	number := fmt.Sprintf("%04d-%04d", year, sequence)
	if _, err := tx.ExecContext(c.Request.Context(), `INSERT INTO sheets(number, student_id, type, created_by) VALUES ($1, $2::text::uuid, $3::text::sheet_type, $4::text::uuid)`, number, input.StudentID, input.Type, p.ID); err != nil {
		if uniqueViolation(err) {
			writeError(c, http.StatusConflict, "duplicate", "type", "Student already has an open sheet of this type")
			return
		}
		s.internalError(c, err)
		return
	}
	for _, dept := range depts {
		if _, err := tx.ExecContext(c.Request.Context(), `INSERT INTO marks(sheet_number, department, state) VALUES ($1, $2::text::dept, 'pending')`, number, dept); err != nil {
			s.internalError(c, err)
			return
		}
	}
	if _, err := tx.ExecContext(c.Request.Context(), `INSERT INTO audit_log(actor_id, actor_name, sheet_number, action) VALUES ($1::text::uuid, $2, $3, 'create')`, p.ID, p.Name, number); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.databaseError(c, err, "")
		return
	}
	sheet, err := s.fetchSheet(c.Request.Context(), s.db, number)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusCreated, sheet)
}

func (s *Server) setMark(c *gin.Context) {
	p, ok := s.requireRole(c, "officer")
	if !ok {
		return
	}
	department := c.Param("department")
	if p.DepartmentID == nil || department != *p.DepartmentID {
		writeError(c, http.StatusForbidden, "forbidden", "", "Officers can only update their department")
		return
	}
	number := c.Param("number")
	if err := s.checkMarkTarget(c.Request.Context(), number, department); err != nil {
		s.writeMarkError(c, err)
		return
	}
	var input markInput
	if !decodeJSON(c, &input) {
		return
	}
	updated, notification, err := s.applyMark(c.Request.Context(), p, number, department, input)
	if err != nil {
		s.writeMarkError(c, err)
		return
	}
	s.notifyAfterMark(notification)
	c.JSON(http.StatusOK, updated)
}

func (s *Server) checkMarkTarget(ctx context.Context, number, department string) error {
	var closedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT closed_at FROM sheets WHERE number = $1`, number).Scan(&closedAt)
	if err == sql.ErrNoRows {
		return &apiError{Status: http.StatusNotFound, Code: "not_found"}
	}
	if err != nil {
		return err
	}
	if closedAt.Valid {
		return &apiError{Status: http.StatusConflict, Code: "closed"}
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM marks WHERE sheet_number = $1 AND department::text = $2)`, number, department).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return &apiError{Status: http.StatusBadRequest, Code: "foreign_dept"}
	}
	return nil
}

type markNotification struct {
	chatID  sql.NullInt64
	number  string
	debt    bool
	note    string
	due     string
	dept    string
	closed  bool
	changed bool
}

func (s *Server) applyMark(ctx context.Context, actor *principal, number, department string, input markInput) (Sheet, markNotification, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Sheet{}, markNotification{}, err
	}
	defer tx.Rollback()
	var closedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT closed_at FROM sheets WHERE number = $1 FOR UPDATE`, number).Scan(&closedAt)
	if err == sql.ErrNoRows {
		return Sheet{}, markNotification{}, &apiError{Status: http.StatusNotFound, Code: "not_found"}
	}
	if err != nil {
		return Sheet{}, markNotification{}, err
	}
	if closedAt.Valid {
		return Sheet{}, markNotification{}, &apiError{Status: http.StatusConflict, Code: "closed"}
	}
	var oldState string
	var oldNote, oldDue sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT state::text, note, due::text FROM marks WHERE sheet_number = $1 AND department::text = $2`, number, department).Scan(&oldState, &oldNote, &oldDue)
	if err == sql.ErrNoRows {
		return Sheet{}, markNotification{}, &apiError{Status: http.StatusBadRequest, Code: "foreign_dept"}
	}
	if err != nil {
		return Sheet{}, markNotification{}, err
	}
	note, due, validationError := normalizeMarkInput(input, time.Now().In(almatyLocation()).Format("2006-01-02"))
	if validationError != nil {
		return Sheet{}, markNotification{}, validationError
	}
	oldNoteValue, oldDueValue := "", ""
	if oldNote.Valid {
		oldNoteValue = oldNote.String
	}
	if oldDue.Valid {
		oldDueValue = oldDue.String
	}
	changed := oldState != input.State || oldNoteValue != note || oldDueValue != due
	if changed {
		var noteArg, dueArg any
		if input.State == "debt" {
			noteArg = note
			if due != "" {
				parsedDue, _ := time.Parse("2006-01-02", due)
				dueArg = parsedDue
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE marks SET state = $3::text::mark_state, note = $4, due = $5, updated_at = now(), updated_by = $6::text::uuid, updated_by_name = $7 WHERE sheet_number = $1 AND department::text = $2`, number, department, input.State, noteArg, dueArg, actor.ID, actor.Name); err != nil {
			return Sheet{}, markNotification{}, err
		}
		var auditNote any
		if input.State == "debt" {
			auditNote = note
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log(actor_id, actor_name, sheet_number, department, action, note) VALUES ($1::text::uuid, $2, $3, $4::text::dept, $5::text::audit_action, $6)`, actor.ID, actor.Name, number, department, input.State, auditNote); err != nil {
			return Sheet{}, markNotification{}, err
		}
	}
	var closes bool
	if changed {
		if err := tx.QueryRowContext(ctx, `SELECT NOT EXISTS (SELECT 1 FROM marks WHERE sheet_number = $1 AND state <> 'clear')`, number).Scan(&closes); err != nil {
			return Sheet{}, markNotification{}, err
		}
		if closes {
			if _, err := tx.ExecContext(ctx, `UPDATE sheets SET closed_at = now() WHERE number = $1 AND closed_at IS NULL`, number); err != nil {
				return Sheet{}, markNotification{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log(actor_name, sheet_number, action) VALUES ('Система', $1, 'close')`, number); err != nil {
				return Sheet{}, markNotification{}, err
			}
		}
	}
	var notification markNotification
	if changed {
		notification = markNotification{number: number, dept: department, changed: true, debt: input.State == "debt", note: note, due: due, closed: closes}
		if notification.debt || notification.closed {
			if err := tx.QueryRowContext(ctx, `SELECT u.telegram_chat_id FROM sheets sh JOIN students st ON st.id = sh.student_id JOIN users u ON u.id = st.user_id WHERE sh.number = $1`, number).Scan(&notification.chatID); err != nil {
				return Sheet{}, markNotification{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Sheet{}, markNotification{}, err
	}
	updated, err := s.fetchSheet(ctx, s.db, number)
	return updated, notification, err
}

func (s *Server) writeMarkError(c *gin.Context, err error) {
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		writeError(c, apiErr.Status, apiErr.Code, apiErr.Field, apiErr.Message)
		return
	}
	s.internalError(c, err)
}

func (s *Server) queueCounts(c *gin.Context) {
	p, ok := s.requireRole(c, "officer")
	if !ok {
		return
	}
	if p.DepartmentID == nil {
		s.internalError(c, fmt.Errorf("officer %s has no department", p.ID))
		return
	}
	var pending, debt, clear int
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT
		count(*) FILTER (WHERE m.state = 'pending' AND sh.closed_at IS NULL),
		count(*) FILTER (WHERE m.state = 'debt' AND sh.closed_at IS NULL),
		count(*) FILTER (WHERE m.state = 'clear')
		FROM marks m JOIN sheets sh ON sh.number = m.sheet_number WHERE m.department::text = $1`, *p.DepartmentID).Scan(&pending, &debt, &clear)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pending": pending, "debt": debt, "clear": clear})
}

func (s *Server) bulkClear(c *gin.Context) {
	p, ok := s.requireRole(c, "officer")
	if !ok {
		return
	}
	var input struct {
		Numbers []string `json:"numbers"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	if len(input.Numbers) < 1 || len(input.Numbers) > 200 {
		writeError(c, http.StatusBadRequest, "validation", "numbers", "Provide between 1 and 200 sheet numbers")
		return
	}
	if p.DepartmentID == nil {
		s.internalError(c, fmt.Errorf("officer %s has no department", p.ID))
		return
	}
	updated := make([]string, 0, len(input.Numbers))
	failed := make([]gin.H, 0)
	for _, number := range input.Numbers {
		if len(number) > 32 {
			failed = append(failed, gin.H{"number": number, "code": "not_found"})
			continue
		}
		if err := s.checkMarkTarget(c.Request.Context(), number, *p.DepartmentID); err != nil {
			var apiErr *apiError
			if errors.As(err, &apiErr) {
				failed = append(failed, gin.H{"number": number, "code": apiErr.Code})
				continue
			}
			s.internalError(c, err)
			return
		}
		sheet, notification, err := s.applyMark(c.Request.Context(), p, number, *p.DepartmentID, markInput{State: "clear"})
		if err != nil {
			var apiErr *apiError
			if errors.As(err, &apiErr) {
				failed = append(failed, gin.H{"number": number, "code": apiErr.Code})
				continue
			}
			s.internalError(c, err)
			return
		}
		updated = append(updated, sheet.Number)
		s.notifyAfterMark(notification)
	}
	c.JSON(http.StatusOK, gin.H{"updated": updated, "failed": failed})
}

func (s *Server) verify(c *gin.Context) {
	number := c.Param("number")
	if !sheetNumberPattern.MatchString(number) {
		c.JSON(http.StatusOK, gin.H{"found": false, "closed": false})
		return
	}
	var name, sheetType string
	var closedAt sql.NullTime
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT u.name, sh.type::text, sh.closed_at FROM sheets sh JOIN students st ON st.id = sh.student_id JOIN users u ON u.id = st.user_id WHERE sh.number = $1`, number).Scan(&name, &sheetType, &closedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, gin.H{"found": false, "closed": false})
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	shortName := makeShortName(name)
	if !closedAt.Valid {
		c.JSON(http.StatusOK, gin.H{"found": true, "closed": false, "shortName": shortName})
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT department::text FROM marks WHERE sheet_number = $1`, number)
	if err != nil {
		s.internalError(c, err)
		return
	}
	var stored []string
	for rows.Next() {
		var department string
		if err := rows.Scan(&department); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		stored = append(stored, department)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	departmentsInOrder(stored)
	c.JSON(http.StatusOK, gin.H{
		"found": true, "closed": true, "shortName": shortName, "number": number,
		"type": sheetType, "closedAt": formatTime(closedAt.Time), "departments": stored,
	})
}

func (s *Server) fetchSheet(ctx context.Context, query dbQuery, number string) (Sheet, error) {
	var sheet Sheet
	var createdAt time.Time
	var closedAt sql.NullTime
	err := query.QueryRowContext(ctx, `SELECT sh.number, sh.type::text, sh.created_at, sh.closed_at, st.id::text, u.name, st."group"
		FROM sheets sh JOIN students st ON st.id = sh.student_id JOIN users u ON u.id = st.user_id WHERE sh.number = $1`, number).
		Scan(&sheet.Number, &sheet.Type, &createdAt, &closedAt, &sheet.Student.ID, &sheet.Student.Name, &sheet.Student.Group)
	if err != nil {
		return Sheet{}, err
	}
	sheet.CreatedAt = formatTime(createdAt)
	if closedAt.Valid {
		sheet.ClosedAt = stringPtr(formatTime(closedAt.Time))
	} else {
		sheet.ClosedAt = nil
	}
	rows, err := query.QueryContext(ctx, `SELECT department::text, state::text, note, due::text, updated_at, updated_by_name
		FROM marks WHERE sheet_number = $1 ORDER BY CASE department::text WHEN 'library' THEN 1 WHEN 'accounting' THEN 2 WHEN 'dorm' THEN 3 WHEN 'military' THEN 4 WHEN 'it' THEN 5 WHEN 'academic' THEN 6 END`, number)
	if err != nil {
		return Sheet{}, err
	}
	sheet.Marks = make([]Mark, 0, 6)
	for rows.Next() {
		var mark Mark
		var note, due, by sql.NullString
		var at sql.NullTime
		if err := rows.Scan(&mark.Department, &mark.State, &note, &due, &at, &by); err != nil {
			rows.Close()
			return Sheet{}, err
		}
		if note.Valid {
			mark.Note = note.String
		}
		if due.Valid {
			mark.Due = due.String
		}
		if at.Valid {
			mark.At = formatTime(at.Time)
		}
		if by.Valid {
			mark.By = by.String
		}
		sheet.Marks = append(sheet.Marks, mark)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Sheet{}, err
	}
	rows.Close()
	sheet.Status = sheetStatus(sheet)
	return sheet, nil
}

func (s *Server) fetchAudit(ctx context.Context, query dbQuery, where string, args ...any) ([]AuditEntry, error) {
	rows, err := query.QueryContext(ctx, `SELECT at, actor_name, sheet_number, department::text, action::text, note FROM audit_log WHERE `+where+` ORDER BY at DESC, id DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]AuditEntry, 0)
	for rows.Next() {
		var entry AuditEntry
		var at time.Time
		var department, note sql.NullString
		if err := rows.Scan(&at, &entry.Actor, &entry.Sheet, &department, &entry.Action, &note); err != nil {
			return nil, err
		}
		entry.At = formatTime(at)
		if department.Valid {
			entry.Department = stringPtr(department.String)
		}
		if note.Valid {
			entry.Note = note.String
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func sheetStatus(sheet Sheet) string {
	if sheet.ClosedAt != nil {
		return "closed"
	}
	hasClear := false
	for _, mark := range sheet.Marks {
		if mark.State == "debt" {
			return "debt"
		}
		if mark.State == "clear" {
			hasClear = true
		}
	}
	if hasClear {
		return "progress"
	}
	return "created"
}

func makeShortName(name string) string {
	parts := strings.Fields(name)
	if len(parts) < 2 {
		return name
	}
	last := []rune(parts[len(parts)-1])
	if len(last) == 0 {
		return parts[0]
	}
	return parts[0] + " " + string(last[0]) + "."
}

func sheetHasDepartment(sheet Sheet, department string) bool {
	for _, mark := range sheet.Marks {
		if mark.Department == department {
			return true
		}
	}
	return false
}

func departmentsInOrder(items []string) {
	sort.Slice(items, func(i, j int) bool { return departmentPosition(items[i]) < departmentPosition(items[j]) })
}

func departmentPosition(department string) int {
	for i, value := range departments {
		if value == department {
			return i
		}
	}
	return len(departments)
}

func formatTime(value time.Time) string { return value.Format(time.RFC3339Nano) }

func almatyLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Almaty")
	if err != nil {
		return time.FixedZone("ALMT", 5*60*60)
	}
	return location
}

func errorsIsNoRows(err error) bool { return err == sql.ErrNoRows }

func normalizeMarkInput(input markInput, today string) (string, string, *apiError) {
	if input.State != "clear" && input.State != "debt" {
		return "", "", &apiError{Status: http.StatusBadRequest, Code: "validation", Field: "state", Message: "State must be clear or debt"}
	}
	if input.State == "clear" {
		return "", "", nil
	}
	note := ""
	if input.Note != nil {
		note = strings.TrimSpace(*input.Note)
	}
	if note == "" {
		return "", "", &apiError{Status: http.StatusBadRequest, Code: "note_required", Field: "note", Message: "Debt requires a note"}
	}
	if utf8.RuneCountInString(note) > 200 {
		return "", "", &apiError{Status: http.StatusBadRequest, Code: "note_too_long", Field: "note", Message: "Debt note is too long"}
	}
	due := ""
	if input.Due != nil && strings.TrimSpace(*input.Due) != "" {
		due = strings.TrimSpace(*input.Due)
		parsed, err := time.Parse("2006-01-02", due)
		if err != nil || parsed.Format("2006-01-02") != due {
			return "", "", &apiError{Status: http.StatusBadRequest, Code: "validation", Field: "due", Message: "Due date must use YYYY-MM-DD"}
		}
		if due < today {
			return "", "", &apiError{Status: http.StatusBadRequest, Code: "due_past", Field: "due", Message: "Due date cannot be in the past"}
		}
	}
	return note, due, nil
}
