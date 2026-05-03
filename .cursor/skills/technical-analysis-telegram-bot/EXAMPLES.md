# TBL Starter Commands

These examples are starting points for TeleBotHost commands. Adjust owner checks, market-data source, and wording before deploying.

## `@` Initialization

```javascript
if (!Bot.has("deepseek_model")) {
  Bot.set("deepseek_model", "deepseek-v4-flash", "String")
}

if (!Bot.has("bot_language")) {
  Bot.set("bot_language", "Vietnamese", "String")
}
```

## `/start`

```javascript
Bot.sendKeyboard(
  "Xin chào " + user.first_name + "!\n\nBot này hỗ trợ phân tích kỹ thuật và tạo nhận định AI qua DeepSeek.\n\nDùng: /analyze BTCUSDT 4H RSI 62, EMA20 > EMA50, hỗ trợ 64000, kháng cự 67000",
  "Phân tích mẫu,Help"
)
```

## `/help`

```javascript
Bot.sendMessage(
  "Lệnh hỗ trợ:\n" +
  "/analyze <symbol> <timeframe> <dữ liệu> - tạo nhận định kỹ thuật\n" +
  "/set_deepseek_key <key> - cài API key, chỉ admin\n" +
  "/help - xem hướng dẫn\n\n" +
  "Lưu ý: Nội dung chỉ dùng cho tham khảo, không phải lời khuyên đầu tư."
)
```

## `/set_deepseek_key`

```javascript
// Replace this with your real owner Telegram ID.
const OWNER_ID = 123456789

if (user.id !== OWNER_ID) {
  Bot.sendMessage("Bạn không có quyền dùng lệnh này.")
  return
}

if (!params || params.length < 20) {
  Bot.sendMessage("Dùng: /set_deepseek_key <DEEPSEEK_API_KEY>")
  return
}

Bot.set("deepseek_api_key", params.trim(), "String")
Bot.sendMessage("Đã lưu DeepSeek API key.")
```

## `/ai_module`

```javascript
async function askDeepSeek(prompt) {
  const apiKey = Bot.get("deepseek_api_key")
  if (!apiKey) {
    return {
      ok: false,
      error: "Chưa cài DeepSeek API key. Admin dùng /set_deepseek_key <key>."
    }
  }

  const model = Bot.get("deepseek_model") || "deepseek-v4-flash"

  let response = await HTTP.post({
    url: "https://api.deepseek.com/chat/completions",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: {
      model: model,
      messages: [
        {
          role: "system",
          content: "Bạn là trợ lý phân tích kỹ thuật thận trọng. Trả lời tiếng Việt, rõ ràng, ngắn gọn, luôn nhắc không phải lời khuyên đầu tư."
        },
        { role: "user", content: prompt }
      ],
      thinking: { type: "disabled" },
      stream: false,
      temperature: 0.3,
      max_tokens: 900,
      user_id: "tg_" + user.id
    },
    timeout: 12000
  })

  if (!response || !response.ok) {
    return {
      ok: false,
      error: "DeepSeek request failed: " + (response ? response.status : "no response")
    }
  }

  if (response.data && response.data.error) {
    return {
      ok: false,
      error: response.data.error.message || "DeepSeek trả về lỗi."
    }
  }

  let content = response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    response.data.choices[0].message.content

  if (!content) {
    return { ok: false, error: "Không đọc được nội dung trả lời từ DeepSeek." }
  }

  return { ok: true, content: content }
}

module.exports = { askDeepSeek }
```

## `/analyze`

```javascript
const { askDeepSeek } = require("/ai_module")

let input = options && options.text ? options.text : params

if (!input || input.trim().length < 5) {
  Bot.sendMessage(
    "Dùng: /analyze <symbol> <timeframe> <dữ liệu>\n\n" +
    "Ví dụ: /analyze BTCUSDT 4H giá 65000, RSI 62, EMA20 > EMA50, hỗ trợ 64000, kháng cự 67000"
  )
  return
}

msg.sendChatAction("typing")

let prompt =
  "Ngôn ngữ: Vietnamese\n" +
  "Vai trò: Chuyên gia phân tích kỹ thuật thận trọng, không hứa lợi nhuận.\n\n" +
  "Dữ liệu người dùng cung cấp:\n" + input.trim() + "\n\n" +
  "Hãy viết nhận định ngắn cho Telegram gồm:\n" +
  "1. Xu hướng chính\n" +
  "2. Hỗ trợ / kháng cự\n" +
  "3. Tín hiệu chỉ báo\n" +
  "4. Kịch bản tăng\n" +
  "5. Kịch bản giảm\n" +
  "6. Rủi ro\n" +
  "7. Lưu ý không phải lời khuyên đầu tư"

let result = await askDeepSeek(prompt)

if (!result.ok) {
  Bot.sendMessage(result.error)
  return
}

Bot.sendMessage(result.content)
```

## `*` Fallback

```javascript
if (!message) {
  return
}

let text = String(message).trim()

if (text.toLowerCase() === "help") {
  Bot.runCommand("/help")
  return
}

if (text.toLowerCase() === "phân tích mẫu") {
  Bot.runCommand("/analyze", {
    text: "BTCUSDT 4H giá 65000, RSI 62, EMA20 > EMA50, MACD histogram tăng, hỗ trợ 64000/62000, kháng cự 67000/69000"
  })
  return
}

Bot.sendMessage("Mình chưa hiểu. Gõ /help để xem cách dùng.")
```

## `!` Error Handler

```javascript
Bot.sendMessage(
  "Bot gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.\n\n" +
  "Chi tiết kỹ thuật: " + (error && error.message ? error.message : "unknown error")
)
```
