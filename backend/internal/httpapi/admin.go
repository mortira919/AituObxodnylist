package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type staffCredential struct {
	User              User   `json:"user"`
	TemporaryPassword string `json:"temporaryPassword"`
}

func (s *Server) listUsers(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	page, pageSize, ok := parsePage(c, 50)
	if !ok {
		return
	}
	var total int
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT count(*) FROM users WHERE role <> 'student'`).Scan(&total); err != nil {
		s.internalError(c, err)
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT id::text, name, login, role::text, department::text, active,
		telegram_chat_id IS NOT NULL, must_change_password FROM users WHERE role <> 'student'
		ORDER BY lower(name), name LIMIT $1 OFFSET $2`, pageSize, pageOffset(page, pageSize))
	if err != nil {
		s.internalError(c, err)
		return
	}
	items := make([]User, 0, pageSize)
	for rows.Next() {
		var user User
		var department sql.NullString
		if err := rows.Scan(&user.ID, &user.Name, &user.Login, &user.Role, &department, &user.Active, &user.TelegramLinked, &user.MustChangePassword); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		if department.Valid {
			user.DepartmentID = stringPtr(department.String)
		}
		items = append(items, user)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (s *Server) createUser(c *gin.Context) {
	p, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	var input struct {
		Name         string  `json:"name"`
		Login        string  `json:"login"`
		Role         string  `json:"role"`
		DepartmentID *string `json:"departmentId"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	input.Name, ok = normalizePerson(input.Name, 3, 120)
	if !ok {
		writeError(c, http.StatusBadRequest, "validation", "name", "Name must contain 3–120 characters")
		return
	}
	input.Login = strings.TrimSpace(input.Login)
	if !validLogin(input.Login) {
		writeError(c, http.StatusBadRequest, "validation", "login", "Invalid login format")
		return
	}
	if input.Role != "officer" && input.Role != "admin" {
		writeError(c, http.StatusBadRequest, "validation", "role", "Role must be officer or admin")
		return
	}
	department := ""
	if input.Role == "officer" {
		if input.DepartmentID == nil || strings.TrimSpace(*input.DepartmentID) == "" {
			writeError(c, http.StatusBadRequest, "department_required", "departmentId", "An officer must have a department")
			return
		}
		department = strings.TrimSpace(*input.DepartmentID)
		if !validEnum(department, departments) {
			writeError(c, http.StatusBadRequest, "validation", "departmentId", "Invalid department")
			return
		}
	}
	password, err := s.generateTemporaryPassword()
	if err != nil {
		s.internalError(c, err)
		return
	}
	hash, err := hashPassword(password)
	if err != nil {
		s.internalError(c, err)
		return
	}
	var departmentArg any
	if input.Role == "officer" {
		departmentArg = department
	}
	var id string
	err = s.db.QueryRowContext(c.Request.Context(), `INSERT INTO users(name, login, password_hash, role, department, must_change_password)
		VALUES ($1, $2, $3, $4::text::role, $5::text::dept, true) RETURNING id::text`, input.Name, input.Login, hash, input.Role, departmentArg).Scan(&id)
	if err != nil {
		if uniqueViolation(err) {
			writeError(c, http.StatusConflict, "login_taken", "login", "Login is already in use")
			return
		}
		s.internalError(c, err)
		return
	}
	user, err := s.loadUser(c.Request.Context(), id)
	if err != nil {
		s.internalError(c, err)
		return
	}
	s.logger.Info("staff account created", "actor_id", p.ID, "user_id", user.ID, "role", user.Role)
	c.JSON(http.StatusCreated, staffCredential{User: user, TemporaryPassword: password})
}

func (s *Server) updateUser(c *gin.Context) {
	actor, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	var input struct {
		Name         *string `json:"name"`
		DepartmentID *string `json:"departmentId"`
		Active       *bool   `json:"active"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	if input.Name != nil {
		name, valid := normalizePerson(*input.Name, 3, 120)
		if !valid {
			writeError(c, http.StatusBadRequest, "validation", "name", "Name must contain 3–120 characters")
			return
		}
		input.Name = &name
	}
	if input.DepartmentID != nil {
		department := strings.TrimSpace(*input.DepartmentID)
		if !validEnum(department, departments) {
			writeError(c, http.StatusBadRequest, "validation", "departmentId", "Invalid department")
			return
		}
		input.DepartmentID = &department
	}
	if input.Name == nil && input.DepartmentID == nil && input.Active == nil {
		writeError(c, http.StatusBadRequest, "validation", "", "At least one field is required")
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	var role string
	err = tx.QueryRowContext(c.Request.Context(), `SELECT role::text FROM users WHERE id::text = $1 FOR UPDATE`, c.Param("id")).Scan(&role)
	if err == sql.ErrNoRows || err == nil && role == "student" {
		writeError(c, http.StatusNotFound, "not_found", "", "Staff user not found")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	if input.Active != nil && !*input.Active && c.Param("id") == actor.ID {
		writeError(c, http.StatusForbidden, "forbidden", "", "You cannot deactivate your own account")
		return
	}
	if input.DepartmentID != nil && role != "officer" {
		writeError(c, http.StatusBadRequest, "validation", "departmentId", "Only officers can be assigned a department")
		return
	}
	if input.Name != nil {
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET name = $2 WHERE id::text = $1`, c.Param("id"), *input.Name); err != nil {
			s.internalError(c, err)
			return
		}
	}
	if input.DepartmentID != nil {
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET department = $2::text::dept WHERE id::text = $1`, c.Param("id"), *input.DepartmentID); err != nil {
			s.internalError(c, err)
			return
		}
	}
	if input.Active != nil {
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET active = $2 WHERE id::text = $1`, c.Param("id"), *input.Active); err != nil {
			s.internalError(c, err)
			return
		}
		if !*input.Active {
			if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE user_id::text = $1`, c.Param("id")); err != nil {
				s.internalError(c, err)
				return
			}
			s.logger.Info("user deactivated", "actor_id", actor.ID, "user_id", c.Param("id"))
		}
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	user, err := s.loadUser(c.Request.Context(), c.Param("id"))
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, user)
}

func (s *Server) resetPassword(c *gin.Context) {
	actor, ok := s.requireRole(c, "admin")
	if !ok {
		return
	}
	id := c.Param("id")
	if id == actor.ID {
		writeError(c, http.StatusForbidden, "forbidden", "", "Use account password change to update your own password")
		return
	}
	password, err := s.generateTemporaryPassword()
	if err != nil {
		s.internalError(c, err)
		return
	}
	hash, err := hashPassword(password)
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
	result, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET password_hash = $2, must_change_password = true WHERE id::text = $1`, id, hash)
	if err != nil {
		s.internalError(c, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		s.internalError(c, err)
		return
	}
	if count == 0 {
		writeError(c, http.StatusNotFound, "not_found", "", "User not found")
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM sessions WHERE user_id::text = $1`, id); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	s.logger.Info("password reset", "actor_id", actor.ID, "user_id", id)
	c.JSON(http.StatusOK, gin.H{"temporaryPassword": password})
}

func (s *Server) getTemplates(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	templates, err := s.readTemplates(c.Request.Context(), s.db)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, templates)
}

func (s *Server) updateTemplate(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	typeName := c.Param("type")
	if !validEnum(typeName, sheetTypes) {
		writeError(c, http.StatusBadRequest, "validation", "type", "Invalid sheet type")
		return
	}
	var input struct {
		Departments []string `json:"departments"`
	}
	if !decodeJSON(c, &input) {
		return
	}
	if len(input.Departments) == 0 {
		writeError(c, http.StatusBadRequest, "no_depts", "", "A template must contain at least one department")
		return
	}
	selected := make(map[string]bool, len(input.Departments))
	for _, department := range input.Departments {
		if !validEnum(department, departments) {
			writeError(c, http.StatusBadRequest, "validation", "departments", "Invalid department")
			return
		}
		selected[department] = true
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(c.Request.Context(), `LOCK TABLE templates IN EXCLUSIVE MODE`); err != nil {
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM templates WHERE type::text = $1`, typeName); err != nil {
		s.internalError(c, err)
		return
	}
	for _, department := range departments {
		if selected[department] {
			if _, err := tx.ExecContext(c.Request.Context(), `INSERT INTO templates(type, department) VALUES ($1::text::sheet_type, $2::text::dept)`, typeName, department); err != nil {
				s.internalError(c, err)
				return
			}
		}
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	templates, err := s.readTemplates(c.Request.Context(), s.db)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, templates)
}

func (s *Server) readTemplates(ctx context.Context, query dbQuery) (map[string][]string, error) {
	templates := make(map[string][]string, len(sheetTypes))
	for _, typeName := range sheetTypes {
		templates[typeName] = []string{}
	}
	rows, err := query.QueryContext(ctx, `SELECT type::text, department::text FROM templates ORDER BY type::text, CASE department::text WHEN 'library' THEN 1 WHEN 'accounting' THEN 2 WHEN 'dorm' THEN 3 WHEN 'military' THEN 4 WHEN 'it' THEN 5 WHEN 'academic' THEN 6 END`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var typeName, department string
		if err := rows.Scan(&typeName, &department); err != nil {
			return nil, err
		}
		templates[typeName] = append(templates[typeName], department)
	}
	return templates, rows.Err()
}

func (s *Server) listAudit(c *gin.Context) {
	if _, ok := s.requireRole(c, "admin"); !ok {
		return
	}
	page, pageSize, ok := parsePage(c, 50)
	if !ok {
		return
	}
	filter := strings.TrimSpace(c.Query("sheet"))
	if utf8.RuneCountInString(filter) > 100 {
		writeError(c, http.StatusBadRequest, "validation", "sheet", "Sheet filter is too long")
		return
	}
	pattern := "%" + filter + "%"
	var total int
	if err := s.db.QueryRowContext(c.Request.Context(), `SELECT count(*) FROM audit_log WHERE $1 = '' OR sheet_number ILIKE $2`, filter, pattern).Scan(&total); err != nil {
		s.internalError(c, err)
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT at, actor_name, sheet_number, department::text, action::text, note
		FROM audit_log WHERE $1 = '' OR sheet_number ILIKE $2 ORDER BY at DESC, id DESC LIMIT $3 OFFSET $4`, filter, pattern, pageSize, pageOffset(page, pageSize))
	if err != nil {
		s.internalError(c, err)
		return
	}
	items := make([]AuditEntry, 0, pageSize)
	for rows.Next() {
		var item AuditEntry
		var at time.Time
		var department, note sql.NullString
		if err := rows.Scan(&at, &item.Actor, &item.Sheet, &department, &item.Action, &note); err != nil {
			rows.Close()
			s.internalError(c, err)
			return
		}
		item.At = formatTime(at)
		if department.Valid {
			item.Department = stringPtr(department.String)
		}
		if note.Valid {
			item.Note = note.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		s.internalError(c, err)
		return
	}
	rows.Close()
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}
