# TeleBotHost TBL Reference

## Core Model

TBL is command-based. Commands run when a trigger matches, instead of using event listeners.

Common command metadata:

- `Command`: trigger name such as `/start`, `/help`, `*`, `!`
- `answer`: static reply before code executes
- `keyboard`: reply keyboard rows, using commas for same row and `\n` for new row
- `aliases`: alternate triggers
- `need_reply`: waits for the next user message

Special commands:

- `@`: initialization before other commands
- `!`: runtime error handler
- `@@`: post-processing after every command
- `*`: fallback for unmatched commands and updates
- `/inline_query`: inline query handler
- `/channel_update`: channel update handler
- `/handle_{update_type}`: dynamic handler for non-message Telegram updates

## Global Values

Frequently used values:

- `update`: raw Telegram update
- `request`: simplified update object
- `message`: text content for message updates
- `msg`: Telegram message object with helpers
- `user`: current user object
- `chat`: current chat object
- `bot`: bot metadata
- `params`: text after a command
- `options`: data passed from another command or API callback
- `content`: HTTP response body in callback commands
- `error`: error object inside `!`

## Bot Class

Use `Bot` for high-level helpers.

Common methods:

- `Bot.sendMessage(textOrObject, options)`
- `Bot.sendKeyboard(text, keyboard)`
- `Bot.sendPhoto`, `Bot.sendDocument`, `Bot.sendAudio`, `Bot.sendVideo`, `Bot.sendVoice`
- `Bot.runCommand("/command", options)`
- `Bot.read("/command")`
- `Bot.readCommand("/command")`
- `Bot.inspect(...)`
- `Bot.set`, `Bot.get`, `Bot.del`, `Bot.getAll`, `Bot.has`, `Bot.count`, `Bot.getNames`
- `Bot.getUsers(...)` must be awaited

Use bot properties for configuration shared by the bot, such as `deepseek_api_key`, `default_model`, or feature flags.

## Api Class

Use `Api` for raw Telegram Bot API access.

Examples:

```javascript
Api.sendMessage({ chat_id: user.telegramid, text: "Hello" })

let me = await Api.getMe()

Api.call("getChat", { chat_id: chat.id })
```

`Api` supports direct calls, `await`, `on_run` callbacks, and chained methods from returned messages.

## HTTP Class

Use `HTTP.get` and `HTTP.post` for external APIs.

```javascript
let response = await HTTP.post({
  url: "https://api.example.com/path",
  headers: { "Authorization": "Bearer TOKEN" },
  body: { key: "value" },
  timeout: 12000
})

if (!response.ok) {
  Bot.sendMessage("Request failed: " + response.status)
  return
}
```

Response fields usually include:

- `ok`
- `status`
- `statusText`
- `content`
- `data`
- `headers`
- `cookies`

## Storage

Use the smallest scope that fits:

- `User`: per-user settings and watchlists
- `Bot`: bot-level config and shared settings
- `Global`: account-level config shared across bots
- `Libs.ResourcesLib`: counters and balances

Supported property types include `String`, `Number`, `Boolean`, `List`, `Date`, and `Json`.

## Modules And Libraries

Useful built-ins:

- `modules.lodash`: data utilities
- `modules.moment` or `modules.dayjs`: dates
- `modules.zod`: validation
- `modules.crypto` or `crypto`: hashing/signing
- `modules.qs`: query strings
- `modules.validator`: input validation
- `Libs.tgutil`: Telegram escaping, links, mentions, inline buttons
- `Libs.mcl`: membership checks
- `Libs.random`: random helpers

## Require

Create reusable modules as commands:

```javascript
// Command: /math_module
function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null
  let slice = values.slice(values.length - period)
  return slice.reduce((sum, value) => sum + value, 0) / period
}

module.exports = { sma }
```

Use them elsewhere:

```javascript
const { sma } = require("/math_module")
```

## Platform Limits

Free plan notes:

- Execution timeout: 15 seconds
- Output buffer: 512 KB
- Parallel processes: up to 10 with `Promise.all`
- File system: disabled
- Persistent storage: 20 MB per account

Keep prompts and responses compact.
