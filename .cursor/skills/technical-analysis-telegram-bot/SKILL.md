---
name: technical-analysis-telegram-bot
description: Build Telegram technical-analysis bots on TeleBotHost using TBL and DeepSeek AI. Use when the user asks to create, design, review, or debug a Telegram bot for market/crypto/stock technical analysis, TeleBotHost/TBL commands, or DeepSeek API integration.
---

# Technical Analysis Telegram Bot

## Purpose

Use this skill when building a Telegram bot that runs on TeleBotHost/TBL, accepts market analysis requests, computes or receives technical-analysis context, and optionally calls DeepSeek for AI commentary.

## Default Architecture

Prefer a command-based TBL design:

1. `@` initializes bot config and defaults.
2. `/start` explains usage and shows a keyboard.
3. `/analyze` parses the user's symbol/timeframe/request.
4. A helper module such as `/ai_module` calls DeepSeek.
5. `!` catches runtime errors and returns a useful message.
6. `*` handles unknown messages and routes natural-language requests to `/analyze` when appropriate.

Keep API keys out of source code. Store secrets in `Bot` properties, owner-level settings, or a setup command restricted to the bot owner/admin.

## Implementation Workflow

1. Clarify the market data source first.
   If no source is provided, build the bot around user-provided OHLCV/indicator text and leave a clear placeholder for the external market data API.

2. Keep deterministic analysis separate from AI commentary.
   Calculate or validate indicators in TBL code where possible. Send DeepSeek a compact, structured summary, not raw unbounded chat history.

3. Use `HTTP.post` for DeepSeek.
   DeepSeek is OpenAI-compatible:
   - Base URL: `https://api.deepseek.com`
   - Endpoint: `POST /chat/completions`
   - Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>`
   - Models: `deepseek-v4-flash` or `deepseek-v4-pro`

4. Always include risk language.
   Technical-analysis output must be educational and must not promise profit or give guaranteed financial advice.

5. Design for TeleBotHost limits.
   Free plan has 15s execution timeout, no file system access, 512 KB output buffer, and limited storage. Keep prompts small and avoid long loops.

## TBL Coding Rules

- Use `Api` for raw Telegram Bot API methods and `Bot` for high-level helpers.
- Use `Bot.runCommand("/command", options)` to split flows.
- Use `require("/command")` for shared helper modules.
- Use `Bot.set`, `Bot.get`, `User.set`, and `Global.set` for persistent state.
- Use `await HTTP.get/post(...)` when the next step depends on the response.
- Always define `!` for runtime errors.
- Prefer `parse_mode: "HTML"` and escape user-controlled content before inserting it into HTML.

## DeepSeek Prompt Rules

Ask DeepSeek for structured output with these sections:

- `Xu hướng chính`
- `Hỗ trợ / kháng cự`
- `Tín hiệu chỉ báo`
- `Kịch bản tăng`
- `Kịch bản giảm`
- `Rủi ro`
- `Lưu ý: không phải lời khuyên đầu tư`

For JSON responses, set `response_format: { type: "json_object" }` and explicitly instruct the model to output valid JSON.

## Quality Checklist

- The bot has `/start`, `/help`, `/analyze`, and `!`.
- DeepSeek API key is not hardcoded.
- Error paths handle missing key, HTTP failure, invalid response, and empty user input.
- The AI prompt includes symbol, timeframe, price context, indicator context, and language.
- Messages are concise enough for Telegram and TeleBotHost buffers.
- The final analysis includes a disclaimer.

## References

- For TeleBotHost/TBL API notes, read [TBL_REFERENCE.md](TBL_REFERENCE.md).
- For DeepSeek request details, read [DEEPSEEK_REFERENCE.md](DEEPSEEK_REFERENCE.md).
- For starter command templates, read [EXAMPLES.md](EXAMPLES.md).
