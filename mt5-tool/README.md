# MT5 Grid Trading EA v2.00

An **Expert Advisor (EA)** for **MetaTrader 5** written in MQL5. It automates a full bidirectional grid-trading strategy using **Buy Stop**, **Buy Limit**, **Sell Stop**, and **Sell Limit** pending orders.

## 🎯 Strategy

The EA maintains a configurable number of pending orders on both sides of the market:

| Order Type     | Placement   | Triggers When Price  |
| -------------- | ----------- | -------------------- |
| **Buy Stop**   | Above price | Rises to order level |
| **Buy Limit**  | Below price | Drops to order level |
| **Sell Stop**  | Below price | Drops to order level |
| **Sell Limit** | Above price | Rises to order level |

Each order type can be independently enabled/disabled. When the price moves significantly past a safe threshold, the EA deletes all affected pending orders and recreates them relative to the new price. Missing orders from filled positions are automatically replaced.

## ✨ Key Improvements (v2.00)

| Feature                       | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| ✅ **Bidirectional Grid**     | Now supports all 4 order types (Buy/Sell × Stop/Limit)           |
| ✅ **Stop Loss**              | Every pending order now has a configurable SL                    |
| ✅ **Trailing Stop**          | Automatic trailing stop for filled positions                     |
| ✅ **Breakeven**              | Moves SL to breakeven when profit target is reached              |
| ✅ **Scaling Multipliers**    | Lot size, TP, and Distance can increase per step                 |
| ✅ **Spread Protection**      | Skip ticks when spread exceeds max threshold                     |
| ✅ **Time Filter**            | Restrict trading to specific hours / days                        |
| ✅ **Friday Close**           | Auto-close all positions before weekend                          |
| ✅ **Max Order Cap**          | Hard limit on total orders to protect against broker limits      |
| ✅ **Parameter Validation**   | Checks inputs on init and returns errors for bad config          |
| ✅ **Orphaned Order Cleanup** | Deletes stale orders from previous EA instances                  |
| ✅ **Better Logging**         | Detailed logs with order counts and error codes                  |
| ✅ **Initial Grid Layout**    | `isInitial` flag spreads orders evenly from mid-price on startup |
| ✅ **Dynamic Calculations**   | Each step can have different lot/TP/distance via multipliers     |

## ⚙️ Parameters

### Core Grid Settings

| Parameter       | Default | Description                                        |
| --------------- | ------- | -------------------------------------------------- |
| `LotSize`       | 0.05    | Base lot size for each order                       |
| `NumOrders`     | 30      | Number of pending orders to maintain per direction |
| `Distance`      | 1000    | Spacing between orders (points)                    |
| `TP_Points`     | 1000    | Take profit distance from order price (points)     |
| `SL_Points`     | 500     | Stop loss distance from order price (points)       |
| `Slippage`      | 3       | Max slippage (points)                              |
| `MagicNumber`   | 888888  | Unique identifier for this EA's orders             |
| `SafeThreshold` | 10      | Safe zone buffer around nearest order (points)     |
| `TimeToRepeat`  | 20      | Interval between checks (seconds)                  |

### Direction Settings

| Parameter         | Default | Description                         |
| ----------------- | ------- | ----------------------------------- |
| `EnableBuyStop`   | true    | Place Buy Stop orders above price   |
| `EnableBuyLimit`  | true    | Place Buy Limit orders below price  |
| `EnableSellStop`  | true    | Place Sell Stop orders below price  |
| `EnableSellLimit` | true    | Place Sell Limit orders above price |

### Risk & Safety

| Parameter         | Default | Description                                          |
| ----------------- | ------- | ---------------------------------------------------- |
| `MaxSpreadPoints` | 50      | Skip execution when spread exceeds this (0=disabled) |
| `MaxOrdersTotal`  | 200     | Hard cap on total pending orders                     |
| `UseTimeFilter`   | false   | Restrict to specific trading hours                   |
| `StartHour`       | 0       | Trading start hour (server time, 0-23)               |
| `EndHour`         | 23      | Trading end hour (server time, 0-23)                 |
| `CloseOnFriday`   | false   | Auto-close all positions before weekend              |
| `FridayCloseHour` | 21      | Hour to close on Friday (server time)                |

### Filled Position Management

| Parameter            | Default | Description                                 |
| -------------------- | ------- | ------------------------------------------- |
| `EnableTrailingStop` | false   | Enable trailing stop for filled positions   |
| `TrailingStart`      | 200     | Profit points needed to activate trailing   |
| `TrailingStep`       | 50      | Distance to trail behind price (points)     |
| `EnableBreakeven`    | false   | Move SL to breakeven when profit target hit |
| `BreakevenTrigger`   | 100     | Profit points to trigger breakeven          |

### Scaling Multipliers

| Parameter            | Default | Description                                  |
| -------------------- | ------- | -------------------------------------------- |
| `LotMultiplier`      | 1.0     | Lot size multiplier per step (1.0=fixed)     |
| `TPMultiplier`       | 1.0     | TP distance multiplier per step (1.0=fixed)  |
| `DistanceMultiplier` | 1.0     | Grid spacing multiplier per step (1.0=fixed) |

### Scaling Examples

- `LotMultiplier = 1.5` → Order #1: 0.05, #2: 0.075, #3: 0.113, etc.
- `DistanceMultiplier = 1.2` → Gaps widen progressively (1000, 1200, 1440...)
- `TPMultiplier = 1.1` → TP increases per step for higher risk/reward on outer orders

## 🔄 How It Works

1. **OnInit**: Validates parameters, cleans orphaned orders, places initial grid centered on mid-price
2. **OnTick** (runs every `TimeToRepeat` seconds):
   - Checks time/spread/friday filters
   - Processes each enabled order type independently
   - For each type, finds the nearest order to price
   - If price crosses the safe threshold → deletes & recreates grid from current price
   - Replaces any orders that got filled (maintains `NumOrders` count)
3. **Position Management** (if enabled):
   - Trailing stop adjusts SL as price moves favorably
   - Breakeven moves SL to entry + buffer when profit target is reached

## 🛠️ Installation

1. Open **MetaEditor** in MT5
2. Copy the `.mq5` file to `MQL5/Experts/`
3. Compile (F7)
4. Attach the EA to a chart in MT5
5. Adjust parameters as needed in the Inputs tab

## ⚠️ Notes

- ✓ **Version 2.00** - Major rewrite with bidirectional grid and risk management
- Orders use `ORDER_TIME_GTC` (Good Till Cancelled) — stay until filled or deleted
- Always test on a **demo account** first
- The EA manages both pending orders and filled positions
- Each order type is processed independently — you can enable only what you need

## 📊 Suggested Configurations

### Conservative (Single Direction)

```
EnableBuyStop  = true
EnableBuyLimit = false
EnableSellStop = false
EnableSellLimit= false
NumOrders      = 10
LotSize        = 0.01
```

### Full Grid (Aggressive)

```
EnableBuyStop  = true
EnableBuyLimit = true
EnableSellStop = true
EnableSellLimit= true
NumOrders      = 20
LotMultiplier  = 1.3
TPMultiplier   = 1.1
```

### Scalping Grid

```
Distance       = 300
NumOrders      = 15
TP_Points      = 200
SL_Points      = 300
SafeThreshold  = 5
TimeToRepeat   = 5
```
