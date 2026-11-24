'use strict';

/**
 * Sends alert and recovery messages through the Telegram Bot API.
 * Optional: without TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, createClient returns null
 * and alerts go to GitHub Issues only. The token is never logged.
 */
function createClient({ token, chatId, fetchImpl = fetch }) {
  if (!token || !chatId) return null;
  return {
    async send(text) {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Telegram sendMessage -> HTTP ${res.status} ${body.description || ''}`.trim());
      }
    },
  };
}

module.exports = { createClient };
