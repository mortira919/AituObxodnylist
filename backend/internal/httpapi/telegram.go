package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type telegramUpdate struct {
	Message *struct {
		Text string `json:"text"`
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
	} `json:"message"`
}

func (s *Server) telegramLink(c *gin.Context) {
	p, ok := s.requireRole(c, "student")
	if !ok {
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM telegram_codes WHERE expires_at <= now()`); err != nil {
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM telegram_codes WHERE user_id::text = $1`, p.ID); err != nil {
		s.internalError(c, err)
		return
	}
	var code string
	for attempt := 0; attempt < 10; attempt++ {
		value, err := randomLinkCode()
		if err != nil {
			s.internalError(c, err)
			return
		}
		var exists bool
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT EXISTS (SELECT 1 FROM telegram_codes WHERE code = $1)`, value).Scan(&exists); err != nil {
			s.internalError(c, err)
			return
		}
		if !exists {
			code = value
			break
		}
	}
	if code == "" {
		s.internalError(c, fmt.Errorf("unable to allocate Telegram link code"))
		return
	}
	expiresAt := time.Now().Add(15 * time.Minute)
	if _, err := tx.ExecContext(c.Request.Context(), `INSERT INTO telegram_codes(code, user_id, expires_at) VALUES ($1, $2::text::uuid, $3)`, code, p.ID, expiresAt); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	botURL := "https://t.me/" + url.PathEscape(s.config.TelegramBotUsername) + "?start=" + url.QueryEscape(code)
	c.JSON(http.StatusOK, gin.H{"code": code, "botUrl": botURL, "expiresAt": formatTime(expiresAt)})
}

func (s *Server) telegramUnlink(c *gin.Context) {
	p, ok := s.requireRole(c, "student")
	if !ok {
		return
	}
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET telegram_chat_id = NULL WHERE id::text = $1`, p.ID); err != nil {
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM telegram_codes WHERE user_id::text = $1`, p.ID); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) telegramWebhook(c *gin.Context) {
	if s.config.TelegramSecret == "" || !hmac.Equal([]byte(c.GetHeader("X-Telegram-Bot-Api-Secret-Token")), []byte(s.config.TelegramSecret)) {
		c.Status(http.StatusNotFound)
		return
	}
	var update telegramUpdate
	if !decodeJSON(c, &update) {
		return
	}
	if update.Message == nil || update.Message.Chat.Type != "private" || update.Message.Chat.ID == 0 {
		c.Status(http.StatusOK)
		return
	}
	fields := strings.Fields(update.Message.Text)
	if len(fields) < 2 || !strings.HasPrefix(fields[0], "/start") {
		c.Status(http.StatusOK)
		return
	}
	code := strings.TrimSpace(fields[1])
	tx, err := s.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer tx.Rollback()
	var userID string
	err = tx.QueryRowContext(c.Request.Context(), `SELECT user_id::text FROM telegram_codes WHERE code = $1 AND expires_at > now() FOR UPDATE`, code).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.Status(http.StatusOK)
			go s.sendTelegramMessage(update.Message.Chat.ID, "Код не найден или устарел. Получите новый на сайте.")
			return
		}
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `UPDATE users SET telegram_chat_id = $2 WHERE id::text = $1`, userID, update.Message.Chat.ID); err != nil {
		if uniqueViolation(err) {
			c.Status(http.StatusOK)
			go s.sendTelegramMessage(update.Message.Chat.ID, "Этот Telegram уже привязан к другой учётной записи.")
			return
		}
		s.internalError(c, err)
		return
	}
	if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM telegram_codes WHERE code = $1`, code); err != nil {
		s.internalError(c, err)
		return
	}
	if err := tx.Commit(); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusOK)
	go s.sendTelegramMessage(update.Message.Chat.ID, "Telegram успешно подключён к обходному листу.")
}

func randomLinkCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	// Six digits: with four, anyone messaging the bot could guess a live code of another student.
	return fmt.Sprintf("%06d", value.Int64()+100000), nil
}

func (s *Server) notifyAfterMark(notification markNotification) {
	if !notification.changed || !notification.chatID.Valid || s.config.TelegramBotToken == "" {
		return
	}
	var message string
	if notification.debt {
		message = departmentLabel(notification.dept) + ": " + notification.note + "."
		if notification.due != "" {
			message += " Срок: " + notification.due + "."
		}
		message += " " + departmentOffice(notification.dept)
	} else if notification.closed {
		message = fmt.Sprintf("Обходной лист № %s закрыт. Проверка: %s/verify/%s", notification.number, strings.TrimRight(s.config.AppURL, "/"), notification.number)
	}
	if message != "" {
		go s.sendTelegramMessage(notification.chatID.Int64, message)
	}
}

func (s *Server) sendTelegramMessage(chatID int64, message string) {
	if s.config.TelegramBotToken == "" {
		return
	}
	body, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": message})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+s.config.TelegramBotToken+"/sendMessage", strings.NewReader(string(body)))
	if err != nil {
		s.logger.Warn("Telegram notification could not be created")
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		s.logger.Warn("Telegram notification transport failed")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		s.logger.Warn("Telegram notification rejected", "status", response.StatusCode)
	}
}

func departmentLabel(department string) string {
	labels := map[string]string{
		"library": "Библиотека", "accounting": "Бухгалтерия", "dorm": "Общежитие",
		"military": "Военно-учётный стол", "it": "IT-отдел", "academic": "Учебная часть",
	}
	return labels[department]
}

func departmentOffice(department string) string {
	offices := map[string]string{
		"library": "Каб. 104, пн–пт 9:00–17:00", "accounting": "Каб. 210, пн–пт 9:00–16:00",
		"dorm": "Общежитие, 1 этаж, комендант", "military": "Каб. 118, вт и чт 10:00–15:00",
		"it": "Каб. 305, пн–пт 9:00–18:00", "academic": "Каб. 201, пн–пт 9:00–17:00",
	}
	return offices[department]
}
