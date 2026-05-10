# TeleBot - Telegram Trading Bot Suite

A collection of trading automation tools built for Telegram (via TeleBotHost) and MetaTrader 5.

## 📦 Projects

### 1. Analyze Bot (`analyze-bot/`)

A Telegram technical-analysis bot that runs as TeleBotHost commands. It scans cryptocurrency markets across Binance and DEX platforms, computes multi-timeframe indicators, and optionally uses **DeepSeek AI** to summarize the best trading candidates.

**Commands:**

| Command                         | Description                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/help`                         | Show help message                                                                                                               |
| `/bestcoin [tf] [top]`          | Scan Binance USDT-M Futures, score EMA/RSI/MACD/candle/volume on multiple timeframes (H1/H2/H4/D1/D3/W1), return top candidates |
| `/analyze <symbol> [tf] [type]` | Deep-dive analysis of a single symbol (futures or spot)                                                                         |
| `/gold [tf]`                    | XAU/USD analysis across H1–W1 (includes H8)                                                                                     |
| `/hidden-gems [chain] [mode]`   | Scan DEX/meme coins via DexScreener boosts + GeckoTerminal, filter by pool age (survivor ~3 months / aggressive ~3 hours)       |

**Features:**

- Binance USDT-M Futures data (top pairs by 24h volume)
- Multi-timeframe indicator scoring (EMA, RSI, MACD, candle patterns, volume)
- DeepSeek AI integration for natural-language summaries
- DEX scanning with survivorship bias filtering (3-month-old pools)

---

### 2. MT5 Tool — Grid Trading EA (`mt5-tool/`)

An **Expert Advisor (EA)** for MetaTrader 5 written in MQL5. It automates a grid-trading strategy by maintaining a set number of **Buy Stop** and **Buy Limit** pending orders above/below the current price.

**Parameters:**

| Parameter     | Default | Description                                |
| ------------- | ------- | ------------------------------------------ |
| LotSize       | 0.05    | Base lot size                              |
| NumOrders     | 30      | Number of orders to maintain               |
| Distance      | 1000    | Spacing between orders (points)            |
| TP_1Gia       | 1000    | Take profit distance (points)              |
| Slippage      | 3       | Max slippage                               |
| MagicNumber   | 888888  | EA magic number (for order identification) |
| SafeThreshold | 10      | Safe zone threshold (points)               |
| TimeToRepeat  | 20      | Check interval (seconds)                   |

**How it works:**

1. Maintains `NumOrders` pending Buy Stop orders above price and Buy Limit orders below price.
2. Orders are evenly spaced by `Distance` points.
3. Every `TimeToRepeat` seconds, checks if price has moved beyond the `SafeThreshold` — if so, deletes old orders and recreates them relative to the new price.
4. Every 10th order gets an adjusted take-profit (can be customized).
5. Automatically fills any missing orders to keep the grid intact.

Xem thêm: [`mt5-tool/README.md`](mt5-tool/README.md) để biết chi tiết cài đặt và tham số.

---

## 📁 Structure

```
telebot/
├── README.md               # This file
├── analyze-bot/            # TeleBotHost TBL command files
│   ├── README.md
│   └── commands/
│       ├── help.js
│       ├── bestcoin.js
│       ├── analyze.js
│       ├── gold.js
│       └── hidden-gems.js
└── mt5-tool/               # MetaTrader 5 Expert Advisor
    └── limit_and_stop_updated_MT5_updated.mq5
```

## 🚀 Usage

### Analyze Bot (Telegram)

Paste the `.js` files into TeleBotHost as individual commands. See `analyze-bot/README.md` for detailed setup.

### MT5 EA

Compile `mt5-tool/limit_and_stop_updated_MT5_updated.mq5` in MetaEditor and attach to any chart.
