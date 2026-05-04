/* Command: /help - Liệt kê lệnh và cách dùng ngắn gọn */
let div = "------------------------------\n"

/* TeleBotHost gửi parse_mode Markdown: tránh [text](url) không đủ; escape \_ * ` [ nếu cần ký tự thường. */
let msg =
  "📌 HƯỚNG DẪN LỆNH\n" +
  div +
  "/analyze coin khung market\n" +
  "  coin: btc, pepe, … | khung: H1 H2 H4 D1 D3 W1 (mặc định D1)\n" +
  "  market: futures hoặc spot (mặc định futures)\n" +
  "  VD: /analyze btc · /analyze pepe h4 futures\n" +
  div +
  "/gold khung\n" +
  "  Vàng XAU/USD (Yahoo), mặc định D1.\n" +
  "  khung: H1 H2 H4 H8 D1 D3 W1\n" +
  "  VD: /gold h4 · /gold w1\n" +
  div +
  "/bestcoin khung số\n" +
  "  Quét top volume Binance USDT-M futures, xếp hạng + tier + AI.\n" +
  "  Mặc định D1, top 100. VD: /bestcoin h4 50\n" +
  div +
  "/hidden-gems chain aggressive\n" +
  "  Meme DEX (DexScreener / GeckoTerminal). Chain: eth bsc sol base ton …\n" +
  "  Thêm aggressive nếu muốn pool ngắn hạn hơn.\n" +
  div +
  "Gợi ý alias TeleBotHost: /a giống analyze, /g giống gold, /bc giống bestcoin, /h giống hidden-gems.\n" +
  "DeepSeek: cấu hình BOT\\_CONFIG hoặc Global theo host — không hardcode api key trong file.\n" +
  div +
  "⚠️ Nội dung chỉ tham khảo kỹ thuật, không phải lời khuyên đầu tư."

Bot.sendMessage(msg)
