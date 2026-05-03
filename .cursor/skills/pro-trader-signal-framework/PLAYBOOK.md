# Trader Signal Playbook

## Indicator Roles

Each indicator should answer one question only.

| Question | Tools | Use |
| --- | --- | --- |
| Market is trending or ranging? | Structure, EMA200, ADX | Decide playbook |
| Trend direction? | HH/HL, LH/LL, EMA20/50/200 | Set bias |
| Where can price react? | Swing levels, range, VWAP, volume node | Define zones |
| Is momentum strong? | RSI, MACD histogram, candle body | Confirm pace |
| Is move supported? | Volume, OBV, breakout volume | Confirm participation |
| How wide is risk? | ATR, recent candle range | Place stop and size |

Do not stack five indicators that say the same thing. EMA, MACD, and RSI all include price-derived momentum; volume and structure add different information.

## Practical Indicator Defaults

Use these defaults unless the user provides another system:

- EMA: `20`, `50`, `200`
- RSI: `14`
- MACD: `12, 26, 9`
- ATR: `14`
- Volume average: `20` candles
- VWAP: intraday sessions

## Regime Detection

Bull trend:

- Price above EMA50 and EMA200
- EMA20 above EMA50
- Structure prints higher highs and higher lows
- Pullbacks hold above prior swing lows

Bear trend:

- Price below EMA50 and EMA200
- EMA20 below EMA50
- Structure prints lower highs and lower lows
- Bounces fail below prior swing highs

Range:

- EMA200 flat
- Price crosses EMA20/50 repeatedly
- RSI oscillates around 40-60
- Breakouts fail or lack volume

Transition:

- Break of structure against previous trend
- EMA20/50 flatten or cross
- Momentum divergence near major level
- Volume spike with rejection wick

## Confluence Examples

Strong long setup:

- `W1/D3` not bearish, `D1` uptrend, `H4` pullback to EMA50
- `H2/H1` shows reaction instead of chasing mid-candle
- Price reacts at prior breakout zone
- RSI holds above 50
- Pullback volume fades, reaction candle volume expands
- Stop can sit below swing low with at least `1:2` reward/risk

Weak long setup:

- Lower timeframe RSI oversold
- Higher timeframe downtrend
- No support zone nearby
- Volume still rising on sell candles
- Stop would be wide or unclear

Strong short setup:

- `W1/D3` resistance or downtrend context
- `D1/H4` lower high or failed reclaim
- Retest of broken support as resistance
- RSI fails near 50
- MACD histogram rolls over
- Volume confirms rejection

No-trade setup:

- Price mid-range
- EMA200 flat
- Conflicting signals
- No nearby invalidation level
- Reward/risk below `1:1.5`

## Scoring Rules

Market structure `0-2`:

- `2`: clear trend or clean range edge
- `1`: structure readable but imperfect
- `0`: chop/noise

Higher timeframe `0-2`:

- `2`: all relevant timeframes align
- `1`: mixed but tradable
- `0`: lower timeframe fights higher timeframe

Key level `0-2`:

- `2`: price reacts at major level
- `1`: minor level or zone not clean
- `0`: price in the middle of nowhere

Momentum `0-1.5`:

- `1.5`: RSI/MACD/candles aligned
- `0.75`: partial alignment
- `0`: momentum contradicts setup

Volume `0-1.5`:

- `1.5`: volume confirms breakout/rejection
- `0.75`: neutral volume
- `0`: volume contradicts setup

Risk/reward `0-1`:

- `1`: invalidation clear and reward/risk at least `1:2`
- `0.5`: acceptable but not ideal
- `0`: stop/target unclear or reward/risk poor

## Risk Management Rules

- Risk per idea should usually be `0.25%` to `1%` of account.
- Do not average down unless the strategy explicitly defines it before entry.
- Move stop only for structure-based reasons, not emotion.
- Avoid entering directly into major resistance/support.
- If news or high-impact event is near, reduce size or wait.
- If volatility is abnormal, widen stop only if size is reduced.

## Language Rules

Prefer:

- "bias đang nghiêng về..."
- "cần xác nhận bằng..."
- "kịch bản bị vô hiệu nếu..."
- "vùng đáng chú ý..."
- "không nên đuổi theo nếu..."

Avoid:

- "chắc chắn tăng"
- "all in"
- "kèo thơm"
- "cam kết lợi nhuận"
- "mua ngay/bán ngay" without trigger and invalidation
