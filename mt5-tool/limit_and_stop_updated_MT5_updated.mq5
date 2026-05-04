#property copyright "Expert Advisor"
#property link      ""
#property version   "1.20"
#property strict
#include <Trade\Trade.mqh>
CTrade trade;

// Cài đặt tham số
input double LotSize         = 0.05;        // Lot thường
input int    NumOrders       = 30;          // Số lệnh cần giữ phía trên giá
input int    Distance        = 1000;        // Khoảng cách mỗi lệnh (point)
input int    TP_1Gia         = 1000;        // TP thường (point)
input int    Slippage        = 3;           // Độ trượt giá
input int    MagicNumber     = 888888;      // Số magic
input int    SafeThreshold   = 10;          // Ngưỡng an toàn (points)
input int    TimeToRepeat    = 20;          // Thời gian chạy lại

// Biến toàn cục
double tickSize;
datetime lastCheckTime;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   tickSize = _Point;
   lastCheckTime = TimeCurrent();
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(Slippage);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   // Cleanup code here
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if (TimeCurrent() - lastCheckTime < TimeToRepeat) return;
   lastCheckTime = TimeCurrent();

   double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   // Xử lý Buy Stop Orders
   ProcessBuyStopOrders(currentPrice);
   
   // Xử lý Buy Limit Orders
   ProcessBuyLimitOrders(currentPrice);
}

//+------------------------------------------------------------------+
//| Process Buy Stop Orders                                          |
//+------------------------------------------------------------------+
void ProcessBuyStopOrders(double currentPrice)
{
   double lowestPendingPrice = EMPTY_VALUE;
   int pendingOrders = 0;

   // Tìm giá thấp nhất của lệnh chờ
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_BUY_STOP)
      {
         pendingOrders++;
         double orderPrice = OrderGetDouble(ORDER_PRICE_OPEN);
         if (orderPrice < lowestPendingPrice || lowestPendingPrice == EMPTY_VALUE)
            lowestPendingPrice = orderPrice;
      }
   }

   // Tính toán ngưỡng an toàn
   double safeZone = lowestPendingPrice - SafeThreshold * tickSize;

   // Trường hợp 1: Giá < (lowestPendingPrice - SafeThreshold) → Hủy lệnh
   if (currentPrice < safeZone && pendingOrders > 0)
   {
      Print("Giá ", currentPrice, " vượt ngưỡng an toàn. Hủy lệnh!");
      DeletePendingOrders(ORDER_TYPE_BUY_STOP);
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_STOP);
   }
   // Trường hợp 2: Giá trong vùng an toàn → Không làm gì
   else if (currentPrice >= safeZone && currentPrice < lowestPendingPrice)
   {
      Print("Giá ", currentPrice, " trong vùng an toàn. Không hủy lệnh!");
   }
   // Trường hợp 3: Giá >= lowestPendingPrice → Duy trì lệnh
   else if (pendingOrders > 0)
   {
      Print("Giá ", currentPrice, " nằm trong dải lệnh.");
   }

   // Cập nhật lệnh thiếu
   ManageMissingOrders(lowestPendingPrice, currentPrice, ORDER_TYPE_BUY_STOP);
}

//+------------------------------------------------------------------+
//| Process Buy Limit Orders                                         |
//+------------------------------------------------------------------+
void ProcessBuyLimitOrders(double currentPrice)
{
   double highestPendingPrice = EMPTY_VALUE;
   int pendingOrders = 0;

   // Tìm giá cao nhất của lệnh chờ
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_BUY_LIMIT)
      {
         pendingOrders++;
         double orderPrice = OrderGetDouble(ORDER_PRICE_OPEN);
         if (orderPrice > highestPendingPrice || highestPendingPrice == EMPTY_VALUE)
            highestPendingPrice = orderPrice;
      }
   }

   // Tính toán ngưỡng an toàn
   double safeZone = highestPendingPrice + SafeThreshold * tickSize;

   // Trường hợp 1: Giá > (highestPendingPrice + SafeThreshold) → Hủy lệnh
   if (currentPrice > safeZone && pendingOrders > 0)
   {
      Print("Giá ", currentPrice, " vượt ngưỡng an toàn Buy Limit. Hủy lệnh!");
      DeletePendingOrders(ORDER_TYPE_BUY_LIMIT);
      CreateNewOrders(currentPrice, ORDER_TYPE_BUY_LIMIT);
   }
   // Trường hợp 2: Giá trong vùng an toàn → Không làm gì
   else if (currentPrice <= safeZone && currentPrice > highestPendingPrice)
   {
      Print("Giá ", currentPrice, " trong vùng an toàn Buy Limit. Không hủy lệnh!");
   }
   // Trường hợp 3: Giá <= highestPendingPrice → Duy trì lệnh
   else if (pendingOrders > 0)
   {
      Print("Giá ", currentPrice, " nằm trong dải lệnh Buy Limit.");
   }

   // Cập nhật lệnh thiếu
   ManageMissingOrders(highestPendingPrice, currentPrice, ORDER_TYPE_BUY_LIMIT);
}

//+------------------------------------------------------------------+
//| Delete Pending Orders                                            |
//+------------------------------------------------------------------+
void DeletePendingOrders(ENUM_ORDER_TYPE orderType)
{
   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == orderType)
      {
         trade.OrderDelete(ticket);
      }
   }
}

//+------------------------------------------------------------------+
//| Create New Orders                                                |
//+------------------------------------------------------------------+
void CreateNewOrders(double basePrice, ENUM_ORDER_TYPE orderType)
{
   for (int i = 1; i <= NumOrders; i++)
   {
      double price;
      if (orderType == ORDER_TYPE_BUY_STOP)
         price = NormalizeDouble(basePrice + i * Distance * tickSize, _Digits);
      else
         price = NormalizeDouble(basePrice - i * Distance * tickSize, _Digits);

      double tp = (i % 10 == 0) ? TP_1Gia * tickSize : TP_1Gia * tickSize;
      double lot = (i % 10 == 0) ? LotSize : LotSize;
      double takeProfit = NormalizeDouble(price + tp, _Digits);

      if (orderType == ORDER_TYPE_BUY_STOP)
         trade.BuyStop(lot, price, _Symbol, 0, takeProfit, ORDER_TIME_GTC, 0, "Buy Stop");
      else
         trade.BuyLimit(lot, price, _Symbol, 0, takeProfit, ORDER_TIME_GTC, 0, "Buy Limit");
   }
}

//+------------------------------------------------------------------+
//| Manage Missing Orders                                            |
//+------------------------------------------------------------------+
void ManageMissingOrders(double referencePrice, double currentPrice, ENUM_ORDER_TYPE orderType)
{
   int pendingOrders = 0;
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket > 0 &&
          OrderGetString(ORDER_SYMBOL) == _Symbol &&
          OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
          OrderGetInteger(ORDER_TYPE) == orderType)
      {
         pendingOrders++;
      }
   }

   int ordersToAdd = NumOrders - pendingOrders;
   if (ordersToAdd > 0)
   {
      double startPrice = (referencePrice != EMPTY_VALUE) ? referencePrice : currentPrice;
      for (int i = 1; i <= ordersToAdd; i++)
      {
         double price;
         if (orderType == ORDER_TYPE_BUY_STOP)
            price = NormalizeDouble(startPrice + i * Distance * tickSize, _Digits);
         else
            price = NormalizeDouble(startPrice - i * Distance * tickSize, _Digits);

         double tp = (i % 10 == 0) ? TP_1Gia * tickSize : TP_1Gia * tickSize;
         double lot = (i % 10 == 0) ? LotSize : LotSize;
         double takeProfit = NormalizeDouble(price + tp, _Digits);

         if (orderType == ORDER_TYPE_BUY_STOP)
            trade.BuyStop(lot, price, _Symbol, 0, takeProfit, ORDER_TIME_GTC, 0, "Buy Stop");
         else
            trade.BuyLimit(lot, price, _Symbol, 0, takeProfit, ORDER_TIME_GTC, 0, "Buy Limit");
      }
   }
}