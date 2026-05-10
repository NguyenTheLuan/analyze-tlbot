# MT5 Grid Trading EA

An **Expert Advisor (EA)** for **MetaTrader 5** written in MQL5. It automates a grid-trading strategy using **Buy Stop** and **Buy Limit** pending orders.

## 🎯 Strategy

The EA maintains a fixed number of pending orders above and below the current market price:

- **Buy Stop orders**: placed above the current price (grid expands upward)
- **Buy Limit orders**: placed below the current price (grid expands downward)

When the price moves significantly beyond a safe threshold, the EA deletes all pending orders and recreates them relative to the new price. This keeps the grid centered around the current price at all times.

## ⚙️ Parameters

| Parameter       | Default | Description                                      |
| --------------- | ------- | ------------------------------------------------ |
| `LotSize`       | 0.05    | Base lot size for each order                     |
| `NumOrders`     | 30      | Total number of pending orders to maintain       |
| `Distance`      | 1000    | Spacing between each order (in points)           |
| `TP_1Gia`       | 1000    | Take profit distance from order price (points)   |
| `Slippage`      | 3       | Maximum slippage allowed (points)                |
| `MagicNumber`   | 888888  | Unique magic number to identify this EA's orders |
| `SafeThreshold` | 10      | Safe zone around the deepest/highest order       |
| `TimeToRepeat`  | 20      | Interval between checks (seconds)                |

## 🔄 How It Works

1. **OnTick**: Runs every `TimeToRepeat` seconds.
2. **Buy Stop Processing**:
   - Finds the lowest pending Buy Stop order.
   - If price drops below `lowest pending price - SafeThreshold` → deletes all Buy Stop orders and recreates them from current price.
   - If any orders are missing, fills them back to `NumOrders`.
3. **Buy Limit Processing**:
   - Finds the highest pending Buy Limit order.
   - If price rises above `highest pending price + SafeThreshold` → deletes all Buy Limit orders and recreates them from current price.
   - Fills missing orders automatically.
4. Every **10th order** can have a custom lot size and take-profit (adjustable in code).

## 🛠️ Installation

1. Open **MetaEditor** in MT5.
2. Copy the `.mq5` file to `MQL5/Experts/`.
3. Compile (F7).
4. Attach the EA to a chart in MT5.

## ⚠️ Notes

- This EA only creates **pending orders** (Buy Stop / Buy Limit). It does **not** manage open market positions or trailing stops.
- Use on a demo account first to understand the grid behavior.
- The EA uses `ORDER_TIME_GTC` (Good Till Cancelled) — orders stay until filled or manually deleted.
- Tested with **version 1.20**.
