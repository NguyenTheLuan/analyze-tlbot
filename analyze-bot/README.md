# Analyze Bot

TeleBotHost/TBL command files for the Telegram technical-analysis bot.

## Copy To TeleBotHost

Create these commands in TeleBotHost and paste the matching file content:

- `/help` -> `commands/help.js`
- `/bestcoin` -> `commands/bestcoin.js`
- `/analyze` -> `commands/analyze.js`
- `/gold` -> `commands/gold.js` (XAU/USD, khung H1–W1 gồm H8)
- `/hidden-gems` -> `commands/hidden-gems.js` (meme DEX: DexScreener boosts, fallback GeckoTerminal trending nếu chain ít boost — ví dụ Base; pool ≥ ~3 tháng + GoPlus khi có)

## Current MVP

`/bestcoin` is a standalone TeleBotHost command. It scans Binance USDT-M Futures top USDT pairs by 24h quote volume, fetches real candles, builds `H1/H2/H4/D1/D3/W1`, scores EMA/RSI/MACD/candle/volume conditions, then optionally asks DeepSeek to summarize top candidates if `BOT_CONFIG.deepseek_api_key` exists in `Global`.

## Usage

```text
/help
/bestcoin        # default: D1, top 100
/bestcoin h1
/bestcoin h4 50
/bestcoin d1 30
/analyze btc
/analyze pepe h4 futures
/analyze eth d1 spot
/gold
/gold h4
/gold w1
/hidden-gems
/hidden-gems eth
/hidden-gems bsc
/hidden-gems sol
/hidden-gems base
/hidden-gems ton
/hidden-gems base aggressive
```

- Mặc định **survivor** (pool già ~3 tháng): bot gợi ý xử lý **D1 / swing**, không khuyên scalping M5.
- Thêm `aggressive` (pool ~3h+, LP/vol nhẹ hơn survivor): gợi ý **H1–H4** / dòng tiền ngắn hơn.

## Notes

- These files are plain TBL-compatible JavaScript, not Node.js scripts.
- Do not run them with `node`.
- `commands/bestcoin.js` intentionally does not use `require()` so it can be pasted as one command.
- Keep outputs concise because TeleBotHost has execution and output limits.
