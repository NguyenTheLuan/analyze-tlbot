# Analyze Bot

TeleBotHost/TBL command files for the Telegram technical-analysis bot.

## Copy To TeleBotHost

Create these commands in TeleBotHost and paste the matching file content:

- `/bestcoin` -> `commands/bestcoin.js`
- `/analyze` -> `commands/analyze.js`

## Current MVP

`/bestcoin` is a standalone TeleBotHost command. It scans Binance USDT-M Futures top USDT pairs by 24h quote volume, fetches real candles, builds `H1/H2/H4/D1/D3/W1`, scores EMA/RSI/MACD/candle/volume conditions, then optionally asks DeepSeek to summarize top candidates if `BOT_CONFIG.deepseek_api_key` exists in `Global`.

## Usage

```text
/bestcoin        # default: D1, top 30, lấy candles cho shortlist
/bestcoin h1
/bestcoin h4 50
/bestcoin d1 30
/analyze btc
/analyze pepe h4 futures
/analyze eth d1 spot
```

## Notes

- These files are plain TBL-compatible JavaScript, not Node.js scripts.
- Do not run them with `node`.
- `commands/bestcoin.js` intentionally does not use `require()` so it can be pasted as one command.
- Keep outputs concise because TeleBotHost has execution and output limits.
