---
name: pro-trader-signal-framework
description: Apply a disciplined full-time trader technical-analysis framework using market structure, multi-timeframe trend, levels, momentum, volume, volatility, setups, and risk management. Use when creating trading analysis logic, signal scoring, Telegram bot prompts, or AI commentary for crypto, forex, stocks, or futures.
---

# Pro Trader Signal Framework

## Core Principle

Never rely on one indicator. Build analysis from context to execution:

1. Market regime
2. Higher-timeframe bias
3. Key levels
4. Momentum and volume confirmation
5. Volatility-based risk
6. Entry trigger
7. Invalidated-if condition

Output must be probabilistic, not predictive. Say "scenario", "bias", "confirmation", and "invalidation"; avoid "sure win", "guaranteed", or overconfident calls.

## Signal Stack

Use these signals in order.

### 1. Market Structure

Primary signs:

- Higher high / higher low: uptrend
- Lower high / lower low: downtrend
- Equal highs/lows: range or liquidity area
- Break of structure: trend may continue
- Change of character: trend may be weakening

Always identify whether price is trending, ranging, or in transition before interpreting indicators.

### 2. Multi-Timeframe Bias

Only use these timeframes unless the user explicitly asks otherwise:

- `W1`: macro trend and major support/resistance
- `D3`: high-timeframe swing bias and larger market structure
- `D1`: primary trend and daily reaction zones
- `H4`: main setup timeframe
- `H2`: confirmation and refinement
- `H1`: execution trigger and invalidation detail

Default mapping:

- Swing trade: `W1/D3` macro bias, `D1/H4` setup, `H2/H1` trigger
- Position trade: `W1` macro bias, `D3/D1` setup, `H4` trigger
- Intraday within this system: `D1` bias, `H4/H2` setup, `H1` trigger

Rule: Do not take a lower-timeframe signal seriously when it directly fights a strong higher-timeframe trend unless it is clearly a countertrend scalp.

### 3. Key Levels

Prioritize levels in this order:

- Major swing high / swing low
- Previous day/week high and low
- Consolidation range high and low
- High-volume node or obvious reaction zone
- Round number levels
- Fibonacci retracement only after real swing points are clear

Levels are zones, not exact prices. Prefer "area around 64,000-64,500" over one exact number.

### 4. Trend Tools

Use moving averages as regime filters, not standalone entries:

- EMA20: short-term momentum
- EMA50: medium trend
- EMA200: long-term regime
- VWAP: intraday fair value, especially for crypto/futures

Common reads:

- Price above EMA20/50 and EMA20 > EMA50: bullish momentum
- Price below EMA20/50 and EMA20 < EMA50: bearish momentum
- Price far from EMA20/VWAP: extension risk, avoid chasing
- EMA200 flat with price crossing both ways: range/noise

### 5. Momentum Tools

Use RSI, MACD, or Stochastic to confirm pace, not to predict reversal alone.

RSI:

- `50` is the trend-line. Above 50 favors bulls; below 50 favors bears.
- `60-70` can be healthy bullish momentum in an uptrend.
- `30-40` can be healthy bearish momentum in a downtrend.
- Divergence matters more near key levels.

MACD:

- Histogram expanding with trend supports continuation.
- Histogram weakening near a level warns of exhaustion.
- Crossovers are late unless aligned with structure.

### 6. Volume And Flow

Volume answers whether the move has participation.

Use:

- Breakout volume above recent average
- Volume spike at support/resistance
- Rising volume with trend continuation
- Falling volume into pullback
- OBV or volume delta if available

Suspicious signals:

- Breakout without volume
- Price rising while volume fades near resistance
- Big wick with volume spike at a major level

### 7. Volatility And Risk

Use ATR or recent candle range to size stops and targets.

Rules:

- Stop must sit beyond invalidation, not at an arbitrary percentage.
- If stop distance is too large for account risk, skip the trade.
- Avoid new entries when ATR expands sharply after a long candle unless waiting for pullback.
- In low volatility compression, expect fakeouts until volume confirms expansion.

## Confluence Score

When building a bot, score signals from `0` to `10`.

Suggested weights:

- Market structure: `0-2`
- Higher-timeframe alignment: `0-2`
- Key level reaction: `0-2`
- Momentum confirmation: `0-1.5`
- Volume confirmation: `0-1.5`
- Risk/reward quality: `0-1`

Interpretation:

- `0-3`: no trade / noise
- `4-5`: watchlist only
- `6-7`: valid setup if trigger appears
- `8-10`: strong confluence, still requires risk control

Never output "buy/sell now" only because score is high. Include entry trigger and invalidation.

## Setup Templates

### Trend Pullback

Conditions:

- Higher timeframe trending
- Price pulls back to EMA20/EMA50, VWAP, or prior breakout zone
- RSI holds above 40-50 in uptrend or below 50-60 in downtrend
- Pullback volume lower than impulse volume
- Entry only after bullish/bearish reaction candle

### Breakout Retest

Conditions:

- Clear range or resistance/support
- Breakout closes outside zone with volume
- Retest holds the broken level
- Momentum remains aligned
- Invalidation is back inside the range

### Range Reversal

Conditions:

- EMA200 flat or price mean-reverting
- Price reaches range high/low
- Wick rejection or failed breakout
- RSI divergence or momentum exhaustion
- Target is range midpoint first, opposite side second

## Output Format

Use this structure for Telegram or AI commentary:

```text
Bias: [Bullish/Bearish/Neutral]
Market regime: [Trend/Range/Transition]
Confluence: [score]/10

Key levels:
- Support: [...]
- Resistance: [...]

Bullish scenario:
- Trigger:
- Target zones:
- Invalidation:

Bearish scenario:
- Trigger:
- Target zones:
- Invalidation:

Risk notes:
- [...]

Disclaimer: Nội dung chỉ phục vụ tham khảo, không phải lời khuyên đầu tư.
```

## Bot Behavior Rules

- If data is incomplete, say what is missing instead of inventing indicators.
- If signals conflict, mark bias as neutral and describe both scenarios.
- If price is extended, warn about chasing.
- If no invalidation can be defined, do not produce a trade setup.
- For leveraged products, emphasize position sizing and liquidation risk.

## References

- For indicator details and scoring examples, read [PLAYBOOK.md](PLAYBOOK.md).
- For bot prompt examples, read [PROMPTS.md](PROMPTS.md).
