# DeepSeek API Reference

## Base Configuration

DeepSeek supports an OpenAI-compatible API.

- Base URL: `https://api.deepseek.com`
- Chat endpoint: `POST https://api.deepseek.com/chat/completions`
- Models: `deepseek-v4-flash`, `deepseek-v4-pro`
- Auth header: `Authorization: Bearer <DEEPSEEK_API_KEY>`
- Content type: `application/json`

Legacy aliases `deepseek-chat` and `deepseek-reasoner` may exist for compatibility, but prefer current model IDs.

## TBL HTTP.post Pattern

```javascript
let response = await HTTP.post({
  url: "https://api.deepseek.com/chat/completions",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey
  },
  body: {
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: "You are a careful technical-analysis assistant." },
      { role: "user", content: prompt }
    ],
    thinking: { type: "disabled" },
    stream: false,
    temperature: 0.3,
    max_tokens: 900
  },
  timeout: 12000
})
```

Extract the answer:

```javascript
let answer = response.data &&
  response.data.choices &&
  response.data.choices[0] &&
  response.data.choices[0].message &&
  response.data.choices[0].message.content
```

## Parameters To Use

- `model`: use `deepseek-v4-flash` for cost/speed, `deepseek-v4-pro` for deeper reasoning.
- `messages`: include `system` and `user`.
- `thinking`: set `{ type: "disabled" }` for short Telegram responses; enable only for complex analysis.
- `reasoning_effort`: use `high` or `max` when thinking is enabled.
- `temperature`: use `0.2` to `0.4` for more consistent market commentary.
- `max_tokens`: cap output for Telegram, usually `700` to `1200`.
- `response_format`: set `{ type: "json_object" }` only when the prompt explicitly asks for JSON.
- `user_id`: optional stable non-private ID such as `"tg_" + user.id`.

## Error Handling

Handle these cases before sending the AI answer:

- Missing API key
- HTTP timeout or non-2xx status
- `response.ok` is false
- `response.data.error` exists
- No `choices[0].message.content`
- Content is too long for Telegram

## Prompt Template

Use compact, structured prompts:

```text
Ngôn ngữ: Vietnamese
Vai trò: Chuyên gia phân tích kỹ thuật, thận trọng, không đưa lời hứa lợi nhuận.

Dữ liệu:
- Symbol: BTCUSDT
- Timeframe: 4H
- Giá hiện tại: 65000
- Xu hướng: EMA20 trên EMA50
- RSI: 62
- MACD: histogram tăng
- Hỗ trợ: 64000, 62000
- Kháng cự: 67000, 69000

Yêu cầu:
Viết nhận định ngắn cho Telegram gồm:
1. Xu hướng chính
2. Hỗ trợ/kháng cự
3. Kịch bản tăng
4. Kịch bản giảm
5. Rủi ro
6. Lưu ý không phải lời khuyên đầu tư
```

## Security Notes

- Never hardcode API keys in command source.
- Do not echo the key back to users.
- Restrict setup commands to the owner/admin.
- Do not send private Telegram profile details to DeepSeek unless necessary.
- Prefer `user_id: "tg_" + user.id` over sending names/usernames.
