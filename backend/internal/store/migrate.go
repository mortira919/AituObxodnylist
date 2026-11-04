package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"fmt"
	"math/big"
	"strings"

	"github.com/aitu/clearance/backend/internal/security"
)

//go:embed migrations/001_init.sql
var migrationFS embed.FS

func Migrate(ctx context.Context, db *sql.DB) error {
	sqlText, err := migrationFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Serialise concurrent starts, including the first CREATE TABLE below.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(7274101)`); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}
	var applied bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1)`).Scan(&applied); err != nil {
		return fmt.Errorf("check migration version: %w", err)
	}
	if applied {
		return tx.Commit()
	}
	for _, statement := range strings.Split(string(sqlText), ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("run initial migration: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (1)`); err != nil {
		return err
	}
	return tx.Commit()
}

func Seed(ctx context.Context, db *sql.DB, adminLogin, adminPassword string) error {
	type template struct {
		typeName    string
		departments []string
	}
	templates := []template{
		{"graduation", []string{"library", "accounting", "dorm", "military", "it", "academic"}},
		{"expulsion", []string{"library", "accounting", "dorm", "military", "it", "academic"}},
		{"transfer", []string{"library", "accounting", "it", "academic"}},
		{"leave", []string{"library", "accounting", "academic"}},
		{"dorm", []string{"dorm", "accounting"}},
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range templates {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM templates WHERE type::text = $1)`, item.typeName).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		for _, department := range item.departments {
			if _, err := tx.ExecContext(ctx, `INSERT INTO templates(type, department) VALUES ($1::text::sheet_type, $2::text::dept) ON CONFLICT DO NOTHING`, item.typeName, department); err != nil {
				return fmt.Errorf("seed template %s: %w", item.typeName, err)
			}
		}
	}
	if (adminLogin == "") != (adminPassword == "") {
		return fmt.Errorf("ADMIN_LOGIN and ADMIN_PASSWORD must be set together")
	}
	if adminLogin != "" {
		if len(adminLogin) < 3 || len(adminLogin) > 64 || !validLogin(adminLogin) {
			return fmt.Errorf("ADMIN_LOGIN must match ^[a-z0-9._-]{3,64}$")
		}
		if len(adminPassword) < 8 || len(adminPassword) > 128 {
			return fmt.Errorf("ADMIN_PASSWORD must be 8–128 characters")
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			hash, err := security.HashPassword(adminPassword)
			if err != nil {
				return fmt.Errorf("hash initial administrator password: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO users(login, password_hash, name, role, must_change_password) VALUES ($1, $2, 'Администратор', 'admin', false)`, strings.TrimSpace(adminLogin), hash); err != nil {
				return fmt.Errorf("create initial administrator: %w", err)
			}
		}
	}
	return tx.Commit()
}

func validLogin(login string) bool {
	if len(login) < 3 || len(login) > 64 {
		return false
	}
	for _, r := range login {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

// RandomPassword creates a temporary password from an alphabet without visually
// ambiguous characters. It is intentionally exported for the HTTP layer.
func RandomPassword(length int) (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	var out strings.Builder
	out.Grow(length)
	for i := 0; i < length; i++ {
		value, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		out.WriteByte(alphabet[value.Int64()])
	}
	return out.String(), nil
}
