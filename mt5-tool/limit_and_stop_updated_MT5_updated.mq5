#property copyright "Expert Advisor - Improved Grid Trading"
#property link      ""
#property version   "2.00"
#property strict
#include <Trade\Trade.mqh>
CTrade trade;

//+------------------------------------------------------------------+
//| Input Parameters                                                 |
//+------------------------------------------------------------------+

// --- Core Grid Settings ---
input double   LotSize            = 0.05;       // Lot size per order
input int      NumOrders          = 30;         // Number of pending orders per side (above + below)
input int      Distance           = 1000;       // Spacing between orders (points)
input int      TP_Points          = 1000;       // Take profit distance (points)
input int      SL_Points          = 500;        // Stop loss distance (points)
input int      Slippage           = 3;          // Max slippage (points)
input int      MagicNumber        = 888888;     // EA magic number
input int      SafeThreshold      = 10;         // Safe zone around nearest order (points)
input int      TimeToRepeat       = 20;         // Check interval (seconds)

// --- Direction Settings ---
input bool     EnableBuyStop      = true;       // Enable Buy Stop orders (above price)
input bool     EnableBuyLimit     = true;       // Enable Buy Limit orders (below price)
input bool     EnableSellStop     = true;       // Enable Sell Stop orders (below price)
input bool     EnableSellLimit    = true;       // Enable Sell Limit orders (above price)

// --- Risk & Safety ---
input int      MaxSpreadPoints    = 50;         // Max allowed spread (points, 0=disabled)
input int      MaxOrdersTotal     = 200;        // Hard cap on total orders per EA
input bool     UseTimeFilter      = false;      // Restrict trading to specific hours
input int      StartHour          = 0;          // Trading start hour (server time, 0-23)
input int      EndHour            = 23;         // Trading end hour (server time, 0-23)
input bool     CloseOnFriday      = false;      // Close all positions before Friday close
input int      FridayCloseHour    = 21;         // Hour to close on Friday (server time)

// --- Filled Position Management ---
input bool     EnableTrailingStop = false;      // Enable trailing stop for filled positions
input int      TrailingStart      = 200;        // Profit points to start trailing (points)
input int      TrailingStep       = 50;         // Trailing step (points)
input bool     EnableBreakeven    = false;      // Move SL to breakeven when profit reached
input int      BreakevenTrigger   = 100;        // Profit points to trigger breakeven (points)

// --- Scaling (Multiplier) ---
input double   LotMultiplier      = 1.0;        // Lot multiplier per step (1.0 = fixed lot)
input double   TPMultiplier       = 1.0;        // TP multiplier per step (1.0 = fixed TP)
input double   DistanceMultiplier = 1.0;        // Distance multiplier per step (1.0 = fixed distance)

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
double   tickSize;
datetime lastCheckTime;
ulong    lastErrorLogTime = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // --- Validation ---
   if (LotSize <= 0)                      { Print("ERROR: LotSize must be > 0");        return INIT_PARAMETERS_INCORRECT; }
   if (NumOrders <= 0)                    { Print("ERROR: NumOrders must be > 0");      return INIT_PARAMETERS_INCORRECT; }
   if (Distance <= 0)                     { Print("ERROR: Distance must be > 0");       return INIT_PARAMETERS_INCORRECT; }
   if (!EnableBuyStop && !EnableBuyLimit && !EnableSellStop && !EnableSellLimit)
                                          { Print("ERROR: At least one order type must be enabled"); return INIT_PARAMETERS_INCORRECT; }
   if (MaxOrdersTotal < NumOrders * 2)    { Print("WARNING: MaxOrdersTotal is low for NumOrders"); /* Continue */ }

   // --- Initialization ---
   tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if (tickSize <= 0) tickSize = _Point;

   lastCheckTime = TimeCurrent();
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(Slippage);

   // Log current symbol info
   Print("==========================");
   Print("EA Initialized - v2.00");
   Print("Symbol: ", _Symbol);
   Print("Point: ", _Point, ", TickSize: ", tickSize);
   Print("Digits: ", _Digits);
   Print("Bid: ", SymbolInfoDouble(_Symbol, SYMBOL_BID));
   Print("Ask: ", SymbolInfoDouble(_Symbol, SYMBOL_ASK));
   Print("Spread: ", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD));
   Print("==========================");

   // --- Clean up any orphaned orders from previous run ---
   CleanupOrphanedOrders();

   // --- Initial order placement ---
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double mid = (ask + bid) / 2.0;

   if (EnableBuyStop)  CreateNewOrders(mid, ORDER_TYPE_BUY_STOP,  true);
   else                DeletePendingOrders(ORDER_TYPE_BUY_STOP);

   if (EnableBuyLimit) CreateNewOrders(mid, ORDER_TYPE_BUY_LIMIT, true);
   else                DeletePendingOrders(ORDER_TYPE_BUY_LIMIT);

   if (EnableSellStop)  CreateNewOrders(mid, ORDER_TYPE_SELL_STOP,  true);
   else                 DeletePendingOrders(ORDER_TYPE_SELL_STOP);

   if (EnableSellLimit) CreateNewOrders(mid, ORDER_TYPE_SELL_LIMIT, true);
   else                 DeletePendingOrders(ORDER_TYPE_SELL_LIMIT);

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("EA Deinitialized. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   // --- Rate limit ---
   if (TimeCurrent() - lastCheckTime < TimeToRepeat) return;
   lastCheckTime = TimeCurrent();

   // --- Market hours filter ---
   if (!IsTradingTimeAllowed()) return;

   // --- Spread check ---
   if (MaxSpreadPoints > 0)
   {
      long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if (spread > MaxSpreadPoints)
      {
         if (lastErrorLogTime != TimeCurrent())
         {
            Print("Spread too high: ", spread, " > ", MaxSpreadPoints, ". Skipping.");
            lastErrorLogTime = TimeCurrent();
         }
         return;
      }
   }

   // --- Friday close check ---
   if (CloseOnFriday)
   {
      MqlDateTime dt;
      TimeCurrent(dt);
      if (dt.day_of_week == 5 && dt.hour >= FridayCloseHour)
      {
         CloseAllPositions();
         return;
      }
   }

   // --- Process pending orders ---
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if (EnableBuyStop)   ProcessBuyStopOrders(ask);
   if (EnableBuyLimit)  ProcessBuyLimitOrders(bid);
   if (EnableSellStop)  ProcessSellStopOrders(bid);
   if (EnableSellLimit) ProcessSellLimitOrders(ask);

   // --- Manage filled positions ---
   if (EnableTrailingStop || EnableBreakeven)
      ManageFilledPositions();
}

//+------------------------------------------------------------------+
//| Check if current time is within trading hours                    |
//+------------------------------------------------------------------+
bool IsTradingTimeAllowed()
{
   if (!UseTimeFilter) return true;

   MqlDateTime dt;
   TimeCurrent(dt);

   if (dt.day_of_week == 0) // Sunday
      return false;
   if (dt.day_of_week == 6) // Saturday
      return false;

   if (StartHour <= EndHour)
      return (dt.hour >= StartHour && dt.hour < EndHour);
   else // Overnight session (e.g., 22:00 - 06:00)
      return (dt.hour >= StartHour || dt.hour < EndHour);
}

//+------------------------------------------------------------------+
//| Clean up any orders from previous EA instance                    |
//+------------------------------------------------------------------+
void CleanupOrphanedOrders()
{
   int deleted = 0;
   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber)
      {
         ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
         // Only delete pending orders (not market positions)
         if (type == ORDER_TYPE_BUY_STOP  || type == ORDER_TYPE_BUY_LIMIT ||
             type == ORDER_TYPE_SELL_STOP || type == ORDER_TYPE_SELL_LIMIT)
         {
            if (trade.OrderDelete(ticket))
               deleted++;
         }
      }
   }
   if (deleted > 0)
      Print("Cleaned up ", deleted, " orphaned pending orders.");
}

//+------------------------------------------------------------------+
//| Close all market positions                                       |
//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket > 0 &&
          PositionGetString(POSITION_SYMBOL) == _Symbol &&
          PositionGetInteger(POSITION_MAGIC) == MagicNumber)
      {
         trade.PositionClose(ticket, Slippage);
      }
   }
}

//+------------------------------------------------------------------+
//| Get number of pending orders of a specific type                 |
//+------------------------------------------------------------------+
int GetPendingOrderCount(ENUM_ORDER_TYPE orderType)
{
   int count = 0;
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == orderType)
      {
         count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Get the nearest pending order price for a given type            |
//| nearestToPrice=true → find closest to market                     |
//| nearestToPrice=false → find farthest from market (boundary)     |
//+------------------------------------------------------------------+
double GetNearestPendingPrice(ENUM_ORDER_TYPE orderType, double marketPrice, bool findClosest)
{
   double result = EMPTY_VALUE;
   double bestDiff = EMPTY_VALUE;

   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == orderType)
      {
         double orderPrice = OrderGetDouble(ORDER_PRICE_OPEN);
         double diff = MathAbs(orderPrice - marketPrice);

         if (result == EMPTY_VALUE ||
             (findClosest && diff < bestDiff) ||
             (!findClosest && diff > bestDiff))
         {
            result = orderPrice;
            bestDiff = diff;
         }
      }
   }
   return result;
}

//+------------------------------------------------------------------+
//| Calculate dynamic lot size based on step index                  |
//+------------------------------------------------------------------+
double CalculateLotSize(int step)
{
   double lot = LotSize * MathPow(LotMultiplier, step - 1);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   lot = MathMax(lot, minLot);
   lot = MathMin(lot, maxLot);
   lot = NormalizeDouble(MathRound(lot / lotStep) * lotStep, 2);
   return lot;
}

//+------------------------------------------------------------------+
//| Calculate dynamic TP based on step index                        |
//+------------------------------------------------------------------+
double CalculateTP(int step, double orderPrice, ENUM_ORDER_TYPE orderType)
{
   double tpPoints = TP_Points * MathPow(TPMultiplier, step - 1);

   if (orderType == ORDER_TYPE_BUY_STOP || orderType == ORDER_TYPE_BUY_LIMIT)
      return NormalizeDouble(orderPrice + tpPoints * tickSize, _Digits);
   else // SELL
      return NormalizeDouble(orderPrice - tpPoints * tickSize, _Digits);
}

//+------------------------------------------------------------------+
//| Calculate dynamic SL based on step index                        |
//+------------------------------------------------------------------+
double CalculateSL(int step, double orderPrice, ENUM_ORDER_TYPE orderType)
{
   double slPoints = SL_Points * MathPow(TPMultiplier, step - 1); // Use same multiplier

   if (orderType == ORDER_TYPE_BUY_STOP || orderType == ORDER_TYPE_BUY_LIMIT)
      return NormalizeDouble(orderPrice - slPoints * tickSize, _Digits);
   else // SELL
      return NormalizeDouble(orderPrice + slPoints * tickSize, _Digits);
}

//+------------------------------------------------------------------+
//| Calculate dynamic distance based on step index                  |
//+------------------------------------------------------------------+
double CalculateDistance(int step)
{
   return Distance * MathPow(DistanceMultiplier, step - 1);
}

//+------------------------------------------------------------------+  
//// Process Buy Stop Orders                                         
//// Buy Stop = placed ABOVE current price, triggered when price rises|
//+------------------------------------------------------------------+  
void ProcessBuyStopOrders(double currentPrice)
{
   // Find the lowest (closest to price) Buy Stop order
   double nearestPrice = GetNearestPendingPrice(ORDER_TYPE_BUY_STOP, currentPrice, true);
   double boundaryPrice = GetNearestPendingPrice(ORDER_TYPE_BUY_STOP, currentPrice, false);
   int count = GetPendingOrderCount(ORDER_TYPE_BUY_STOP);

   // If no orders exist, create fresh grid from current price
   if (count == 0)
   {
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_STOP, false);
      return;
   }

   // If price has moved above or close to our nearest order → recreate from new price
   // Safe zone: nearestPrice - SafeThreshold * tickSize
   double safeZone = nearestPrice - SafeThreshold * tickSize;

   if (currentPrice < safeZone)
   {
      Print("BuyStop: Price ", currentPrice, " crossed safe zone (", safeZone, "). Recreating.");
      DeletePendingOrders(ORDER_TYPE_BUY_STOP);
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_STOP, false);
   }

   // Fill any missing orders
   double refPrice = (boundaryPrice != EMPTY_VALUE) ? boundaryPrice : currentPrice;
   ManageMissingOrders(refPrice, currentPrice, ORDER_TYPE_BUY_STOP, true);
}

//+------------------------------------------------------------------+
//| Process Buy Limit Orders                                         |
//| Buy Limit = placed BELOW current price, triggered when price drops|
//+------------------------------------------------------------------+
void ProcessBuyLimitOrders(double currentPrice)
{
   // Find the highest (closest to price) Buy Limit order
   double nearestPrice = GetNearestPendingPrice(ORDER_TYPE_BUY_LIMIT, currentPrice, true);
   double boundaryPrice = GetNearestPendingPrice(ORDER_TYPE_BUY_LIMIT, currentPrice, false);
   int count = GetPendingOrderCount(ORDER_TYPE_BUY_LIMIT);

   if (count == 0)
   {
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_LIMIT, false);
      return;
   }

   // Safe zone: nearestPrice + SafeThreshold * tickSize
   double safeZone = nearestPrice + SafeThreshold * tickSize;

   if (currentPrice > safeZone)
   {
      Print("BuyLimit: Price ", currentPrice, " crossed safe zone (", safeZone, "). Recreating.");
      DeletePendingOrders(ORDER_TYPE_BUY_LIMIT);
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_LIMIT, false);
   }

   double refPrice = (boundaryPrice != EMPTY_VALUE) ? boundaryPrice : currentPrice;
   ManageMissingOrders(refPrice, currentPrice, ORDER_TYPE_BUY_LIMIT, false);
}

//+------------------------------------------------------------------+
//| Process Sell Stop Orders                                         |
//| Sell Stop = placed BELOW current price, triggered when price drops|
//+------------------------------------------------------------------+
void ProcessSellStopOrders(double currentPrice)
{
   // Find the highest (closest to price) Sell Stop order
   double nearestPrice = GetNearestPendingPrice(ORDER_TYPE_SELL_STOP, currentPrice, true);
   double boundaryPrice = GetNearestPendingPrice(ORDER_TYPE_SELL_STOP, currentPrice, false);
   int count = GetPendingOrderCount(ORDER_TYPE_SELL_STOP);

   if (count == 0)
   {
      CreateNewOrders(currentPrice, ORDER_TYPE_SELL_STOP, false);
      return;
   }

   // Safe zone: nearestPrice + SafeThreshold * tickSize
   double safeZone = nearestPrice + SafeThreshold * tickSize;

   if (currentPrice > safeZone)
   {
      Print("SellStop: Price ", currentPrice, " crossed safe zone (", safeZone, "). Recreating.");
      DeletePendingOrders(ORDER_TYPE_SELL_STOP);
      CreateNewOrders(currentPrice, ORDER_TYPE_SELL_STOP, false);
   }

   double refPrice = (boundaryPrice != EMPTY_VALUE) ? boundaryPrice : currentPrice;
   ManageMissingOrders(refPrice, currentPrice, ORDER_TYPE_SELL_STOP, false);
}

//+------------------------------------------------------------------+
//| Process Sell Limit Orders                                        |
//| Sell Limit = placed ABOVE current price, triggered when price rises|
//+------------------------------------------------------------------+
void ProcessSellLimitOrders(double currentPrice)
{
   // Find the lowest (closest to price) Sell Limit order
   double nearestPrice = GetNearestPendingPrice(ORDER_TYPE_SELL_LIMIT, currentPrice, true);
   double boundaryPrice = GetNearestPendingPrice(ORDER_TYPE_SELL_LIMIT, currentPrice, false);
   int count = GetPendingOrderCount(ORDER_TYPE_SELL_LIMIT);

   if (count == 0)
   {
      CreateNewOrders(currentPrice, ORDER_TYPE_SELL_LIMIT, false);
      return;
   }

   // Safe zone: nearestPrice - SafeThreshold * tickSize
   double safeZone = nearestPrice - SafeThreshold * tickSize;

   if (currentPrice < safeZone)
   {
      Print("SellLimit: Price ", currentPrice, " crossed safe zone (", safeZone, "). Recreating.");
      DeletePendingOrders(ORDER_TYPE_SELL_LIMIT);
      CreateNewOrders(currentPrice, ORDER_TYPE_SELL_LIMIT, false);
   }

   double refPrice = (boundaryPrice != EMPTY_VALUE) ? boundaryPrice : currentPrice;
   ManageMissingOrders(refPrice, currentPrice, ORDER_TYPE_SELL_LIMIT, true);
}

//+------------------------------------------------------------------+
//| Delete all pending orders of a specific type                    |
//+------------------------------------------------------------------+
void DeletePendingOrders(ENUM_ORDER_TYPE orderType)
{
   int deleted = 0;
   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == orderType)
      {
         if (trade.OrderDelete(ticket))
            deleted++;
      }
   }
   if (deleted > 0)
      Print("Deleted ", deleted, " orders of type ", EnumToString(orderType));
}

//+------------------------------------------------------------------+
//| Create a full set of new pending orders spreading from price     |
//| isInitial=true  → spreads evenly in one direction from price     |
//| isInitial=false → spreads outward from price                     |
//+------------------------------------------------------------------+
void CreateNewOrders(double basePrice, ENUM_ORDER_TYPE orderType, bool isInitial)
{
   int created = 0;

   for (int i = 1; i <= NumOrders; i++)
   {
      // Safety cap
      if (GetTotalOrderCount() >= MaxOrdersTotal)
      {
         Print("WARNING: Reached max orders (", MaxOrdersTotal, "). Stopping placement.");
         break;
      }

      double dist = CalculateDistance(i);
      double price;
      string comment;

      if (orderType == ORDER_TYPE_BUY_STOP)
      {
         if (isInitial)
            price = NormalizeDouble(basePrice - (NumOrders - i + 1) * dist * tickSize, _Digits);
         else
            price = NormalizeDouble(basePrice + i * dist * tickSize, _Digits);
         comment = "Buy Stop #" + IntegerToString(i);
      }
      else if (orderType == ORDER_TYPE_BUY_LIMIT)
      {
         price = NormalizeDouble(basePrice - i * dist * tickSize, _Digits);
         comment = "Buy Limit #" + IntegerToString(i);
      }
      else if (orderType == ORDER_TYPE_SELL_STOP)
      {
         price = NormalizeDouble(basePrice - i * dist * tickSize, _Digits);
         comment = "Sell Stop #" + IntegerToString(i);
      }
      else // ORDER_TYPE_SELL_LIMIT
      {
         if (isInitial)
            price = NormalizeDouble(basePrice + (NumOrders - i + 1) * dist * tickSize, _Digits);
         else
            price = NormalizeDouble(basePrice + i * dist * tickSize, _Digits);
         comment = "Sell Limit #" + IntegerToString(i);
      }

      double lot   = CalculateLotSize(i);
      double tp    = CalculateTP(i, price, orderType);
      double sl    = CalculateSL(i, price, orderType);

      // Place the order
      bool success = false;
      if (orderType == ORDER_TYPE_BUY_STOP)
         success = trade.BuyStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_BUY_LIMIT)
         success = trade.BuyLimit(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_SELL_STOP)
         success = trade.SellStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_SELL_LIMIT)
         success = trade.SellLimit(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);

      if (success)
         created++;
      else
         Print("Failed to create order #", i, ": ", trade.ResultRetcodeDescription());
   }

   Print("Created ", created, "/", NumOrders, " orders of type ", EnumToString(orderType));
}

//+------------------------------------------------------------------+
//| Fill missing orders to maintain the grid                         |
//+------------------------------------------------------------------+
void ManageMissingOrders(double boundaryPrice, double currentPrice, ENUM_ORDER_TYPE orderType, bool spreadUpward)
{
   int pendingOrders = GetPendingOrderCount(orderType);
   int ordersToAdd = NumOrders - pendingOrders;

   if (ordersToAdd <= 0) return;

   // boundaryPrice is the farthest existing order from price.
   // New orders go beyond it.
   double startPrice = (boundaryPrice != EMPTY_VALUE) ? boundaryPrice : currentPrice;
   int added = 0;

   for (int i = 1; i <= ordersToAdd; i++)
   {
      // Safety cap
      if (GetTotalOrderCount() >= MaxOrdersTotal)
      {
         Print("WARNING: Reached max orders (", MaxOrdersTotal, "). Stopping fill.");
         break;
      }

      int nextStep = pendingOrders + i;
      double dist = CalculateDistance(nextStep);
      double price;

      if (spreadUpward)
         price = NormalizeDouble(startPrice + i * dist * tickSize, _Digits);
      else
         price = NormalizeDouble(startPrice - i * dist * tickSize, _Digits);

      double lot = CalculateLotSize(nextStep);
      double tp  = CalculateTP(nextStep, price, orderType);
      double sl  = CalculateSL(nextStep, price, orderType);
      string comment = EnumToString(orderType) + " #" + IntegerToString(nextStep);

      bool success = false;
      if (orderType == ORDER_TYPE_BUY_STOP)
         success = trade.BuyStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_BUY_LIMIT)
         success = trade.BuyLimit(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_SELL_STOP)
         success = trade.SellStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
      else if (orderType == ORDER_TYPE_SELL_LIMIT)
         success = trade.SellLimit(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment);

      if (success)
         added++;
   }

   if (added > 0)
      Print("Added ", added, " missing orders of type ", EnumToString(orderType));
}

//+------------------------------------------------------------------+
//| Get total number of orders (all types) for this EA               |
//+------------------------------------------------------------------+
int GetTotalOrderCount()
{
   int count = 0;
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber)
      {
         count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Manage filled positions (trailing stop, breakeven)              |
//+------------------------------------------------------------------+
void ManageFilledPositions()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket <= 0) continue;
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if (PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentSL = PositionGetDouble(POSITION_SL);
      double currentTP = PositionGetDouble(POSITION_TP);
      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

      if (posType == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         double profitPoints = (bid - openPrice) / tickSize;

         // Breakeven logic
         if (EnableBreakeven && profitPoints >= BreakevenTrigger)
         {
            double breakevenSL = openPrice + SafeThreshold * tickSize;
            if (currentSL < breakevenSL || currentSL == 0)
            {
               if (trade.PositionModify(ticket, NormalizeDouble(breakevenSL, _Digits), currentTP))
                  Print("Buy breakeven set for ticket ", ticket);
            }
         }

         // Trailing stop logic
         if (EnableTrailingStop && profitPoints >= TrailingStart)
         {
            double newSL = bid - (TrailingStart + TrailingStep) * tickSize;
            if (newSL > currentSL)
            {
               if (trade.PositionModify(ticket, NormalizeDouble(newSL, _Digits), currentTP))
                  Print("Buy trailing updated for ticket ", ticket, " SL: ", newSL);
            }
         }
      }
      else if (posType == POSITION_TYPE_SELL)
      {
         double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         double profitPoints = (openPrice - ask) / tickSize;

         // Breakeven logic
         if (EnableBreakeven && profitPoints >= BreakevenTrigger)
         {
            double breakevenSL = openPrice - SafeThreshold * tickSize;
            if (currentSL > breakevenSL || currentSL == 0)
            {
               if (trade.PositionModify(ticket, NormalizeDouble(breakevenSL, _Digits), currentTP))
                  Print("Sell breakeven set for ticket ", ticket);
            }
         }

         // Trailing stop logic
         if (EnableTrailingStop && profitPoints >= TrailingStart)
         {
            double newSL = ask + (TrailingStart + TrailingStep) * tickSize;
            if (newSL < currentSL || currentSL == 0)
            {
               if (trade.PositionModify(ticket, NormalizeDouble(newSL, _Digits), currentTP))
                  Print("Sell trailing updated for ticket ", ticket, " SL: ", newSL);
            }
         }
      }
   }
}
//+------------------------------------------------------------------+
