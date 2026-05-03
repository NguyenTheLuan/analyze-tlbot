/* Command: /analyze - Phân tích 1 coin bằng candles thật, hỗ trợ futures/spot và DeepSeek */
let CONFIG_KEY = "BOT_CONFIG"

// ===== CONFIG =====
let APP = {
  defaultMarket: "futures",
  defaultTimeframe: "D1",
  validMarkets: { spot: true, futures: true },
  validFrames: { H1: true, H2: true, H4: true, D1: true, D3: true, W1: true },
  httpTimeout: 8000,
  aiTimeout: 15000,
  aiMaxTokens: 1800,
  h1KlineLimit: 240,
  d1KlineLimit: 420,
  spotBaseUrl: "https://api.binance.com",
  futuresBaseUrl: "https://fapi.binance.com",
  frameWeights: { H1: 1, H2: 1, H4: 1.5, D1: 2, D3: 2, W1: 2.5 },
  scoring: {
    minFrameCandles: 35,
    swingLookback: 20,
    atrPeriod: 14,
    stopAtrBuffer: 0.5,
    pullbackAtr: 0.35,
    minRewardRisk: 1.5,
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    rsiBullMin: 52,
    rsiBullMax: 75,
    rsiHot: 75,
    rsiBearMax: 48,
    rsiBearMin: 25,
    macdFast: 12,
    macdSlow: 26,
    volumeLookback: 20,
    volumeSpike: 1.15,
    hotMovePct: 12,
    tooHotPct: 18,
    dumpPct: -8
  }
}

// ===== CONFIG STORAGE =====
function loadConfig() {
  let raw = Global.get(CONFIG_KEY)
  if (!raw) return {}
  if (typeof raw === "object") return raw

  try {
    return JSON.parse(raw)
  } catch (e) {
    return {}
  }
}

// ===== FORMAT HELPERS =====
function n(x) {
  let value = Number(x)
  return isNaN(value) ? 0 : value
}

function fmtPrice(value) {
  if (value <= 0) return "0"
  if (value < 0.000001) return value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")
  if (value < 0.001) return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
  if (value < 1) return value.toFixed(6)
  if (value < 100) return value.toFixed(4)
  return value.toFixed(2)
}

function fmtMoney(value) {
  if (value >= 1000000000) return "$" + (value / 1000000000).toFixed(2) + "B"
  if (value >= 1000000) return "$" + (value / 1000000).toFixed(1) + "M"
  if (value >= 1000) return "$" + (value / 1000).toFixed(1) + "K"
  return "$" + Math.round(value)
}

// ===== COMMAND PARAMS =====
function parseCommandParams(raw) {
  let out = { coin: "", market: APP.defaultMarket, timeframe: APP.defaultTimeframe }
  let text = String(raw || "").trim()
  if (!text) return out

  let parts = text.split(/\s+/)
  out.coin = parts[0].toUpperCase().replace("/", "").replace("USDT", "")

  for (let i = 1; i < parts.length; i++) {
    let p = parts[i].toLowerCase()
    let frame = p.toUpperCase()

    switch (true) {
      case APP.validMarkets[p]:
        out.market = p
        break
      case APP.validFrames[frame]:
        out.timeframe = frame
        break
    }
  }

  return out
}

function marketBaseUrl(market) {
  return market === "spot" ? APP.spotBaseUrl : APP.futuresBaseUrl
}

// ===== CANDLE HELPERS =====
function parseKlines(rows) {
  if (!Array.isArray(rows)) return []

  return rows.map(x => ({
    t: n(x[0]),
    o: n(x[1]),
    h: n(x[2]),
    l: n(x[3]),
    c: n(x[4]),
    v: n(x[5]),
    qv: n(x[7])
  }))
}

function aggregate(candles, size) {
  if (!candles || candles.length < size) return []

  let start = candles.length % size
  let out = []

  for (let i = start; i + size <= candles.length; i += size) {
    let part = candles.slice(i, i + size)
    out.push({
      t: part[0].t,
      o: part[0].o,
      h: Math.max.apply(null, part.map(x => x.h)),
      l: Math.min.apply(null, part.map(x => x.l)),
      c: part[part.length - 1].c,
      v: part.reduce((sum, x) => sum + x.v, 0),
      qv: part.reduce((sum, x) => sum + x.qv, 0)
    })
  }

  return out
}

// ===== INDICATORS =====
let IndicatorManager = {
  sma: function(values, period) {
    if (!values || values.length < period) return null

    let slice = values.slice(values.length - period)
    return slice.reduce((sum, value) => sum + value, 0) / period
  },

  ema: function(values, period) {
    if (!values || values.length < period) return null

    let k = 2 / (period + 1)
    let current = this.sma(values.slice(0, period), period)

    for (let i = period; i < values.length; i++) {
      current = values[i] * k + current * (1 - k)
    }

    return current
  },

  rsi: function(values, period) {
    if (!values || values.length <= period) return null

    let gains = 0
    let losses = 0

    for (let i = values.length - period; i < values.length; i++) {
      let diff = values[i] - values[i - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }

    if (losses === 0) return 100

    let rs = gains / losses
    return 100 - (100 / (1 + rs))
  },

  macdState: function(closes) {
    if (!closes || closes.length < APP.scoring.minFrameCandles) return "NEUTRAL"

    let fast = this.ema(closes, APP.scoring.macdFast)
    let slow = this.ema(closes, APP.scoring.macdSlow)
    if (fast === null || slow === null) return "NEUTRAL"

    let macd = fast - slow

    switch (true) {
      case macd > 0:
        return "BULLISH"
      case macd < 0:
        return "BEARISH"
      default:
        return "NEUTRAL"
    }
  },

  candleState: function(candles) {
    if (!candles || candles.length < 2) return "NEUTRAL"

    let c = candles[candles.length - 1]
    let range = c.h - c.l
    if (range <= 0) return "NEUTRAL"

    let body = Math.abs(c.c - c.o)
    let upperWick = c.h - Math.max(c.c, c.o)
    let lowerWick = Math.min(c.c, c.o) - c.l

    switch (true) {
      case body / range > 0.6 && c.c > c.o:
        return "BULLISH"
      case body / range > 0.6 && c.c < c.o:
        return "BEARISH"
      case lowerWick > body * 2 && c.c > c.l + range * 0.45:
        return "BULLISH"
      case upperWick > body * 2 && c.c < c.l + range * 0.55:
        return "BEARISH"
      default:
        return "NEUTRAL"
    }
  },

  atr: function(candles, period) {
    if (!candles || candles.length <= period) return null

    let trs = []
    for (let i = candles.length - period; i < candles.length; i++) {
      let current = candles[i]
      let prev = candles[i - 1]
      let tr = Math.max(
        current.h - current.l,
        Math.abs(current.h - prev.c),
        Math.abs(current.l - prev.c)
      )
      trs.push(tr)
    }

    return this.sma(trs, period)
  },

  swingLevels: function(candles, lookback) {
    if (!candles || candles.length < lookback) {
      return { high: null, low: null }
    }

    let slice = candles.slice(candles.length - lookback)
    return {
      high: Math.max.apply(null, slice.map(x => x.h)),
      low: Math.min.apply(null, slice.map(x => x.l))
    }
  },

  frameContext: function(candles) {
    let closes = candles.map(x => x.c)
    let volumes = candles.map(x => x.qv || x.v)

    return {
      closes: closes,
      volumes: volumes,
      last: candles[candles.length - 1],
      emaFast: this.ema(closes, APP.scoring.emaFast),
      emaSlow: this.ema(closes, Math.min(APP.scoring.emaSlow, Math.max(APP.scoring.emaFast, closes.length - 5))),
      rsi: this.rsi(closes, APP.scoring.rsiPeriod),
      macd: this.macdState(closes),
      candle: this.candleState(candles),
      atr: this.atr(candles, APP.scoring.atrPeriod),
      swing: this.swingLevels(candles, APP.scoring.swingLookback),
      volumeAverage: this.sma(volumes, Math.min(APP.scoring.volumeLookback, volumes.length))
    }
  }
}

// ===== FRAME SCORING =====
function frameSignal(label, candles) {
  if (!candles || candles.length < APP.scoring.minFrameCandles) {
    return { label: label, score: 0, bias: "NEUTRAL", rsi: null, note: "missing" }
  }

  let context = IndicatorManager.frameContext(candles)
  let close = context.last.c
  let currentRsi = context.rsi
  let volBull = context.volumeAverage && context.volumes[context.volumes.length - 1] > context.volumeAverage * APP.scoring.volumeSpike

  let bull = 0
  let bear = 0
  let notes = []

  if (context.emaFast && context.emaSlow && close > context.emaFast && context.emaFast > context.emaSlow) {
    bull += 2
    notes.push("EMA+")
  }

  if (context.emaFast && context.emaSlow && close < context.emaFast && context.emaFast < context.emaSlow) {
    bear += 2
    notes.push("EMA-")
  }

  if (currentRsi !== null && currentRsi > APP.scoring.rsiBullMin && currentRsi < APP.scoring.rsiBullMax) {
    bull += 1
    notes.push("RSI" + Math.round(currentRsi))
  }

  if (currentRsi !== null && currentRsi < APP.scoring.rsiBearMax && currentRsi > APP.scoring.rsiBearMin) {
    bear += 1
    notes.push("RSI" + Math.round(currentRsi))
  }

  switch (context.macd) {
    case "BULLISH":
      bull += 1
      break
    case "BEARISH":
      bear += 1
      break
  }

  switch (context.candle) {
    case "BULLISH":
      bull += 0.5
      break
    case "BEARISH":
      bear += 0.5
      break
  }

  if (volBull && bull > bear) bull += 0.5
  if (volBull && bear > bull) bear += 0.5

  let bias = "NEUTRAL"
  switch (true) {
    case bull > bear:
      bias = "BULLISH"
      break
    case bear > bull:
      bias = "BEARISH"
      break
  }

  return {
    label: label,
    score: bull - bear,
    bias: bias,
    rsi: currentRsi === null ? null : Math.round(currentRsi),
    note: notes.join("/")
  }
}

function analyzeFrames(h1, d1, selectedTimeframe) {
  let frames = {
    H1: h1,
    H2: aggregate(h1, 2),
    H4: aggregate(h1, 4),
    D1: d1,
    D3: aggregate(d1, 3),
    W1: aggregate(d1, 7)
  }

  let raw = 0
  let max = 0
  let bullWeight = 0
  let bearWeight = 0
  let parts = []
  let selectedSignal = null

  for (let key in frames) {
    let signal = frameSignal(key, frames[key])
    let weight = APP.frameWeights[key]
    if (key === selectedTimeframe) selectedSignal = signal

    let clipped = Math.max(-4, Math.min(4, signal.score))
    raw += clipped * weight
    max += 4 * weight

    if (signal.bias === "BULLISH") bullWeight += weight
    if (signal.bias === "BEARISH") bearWeight += weight

    parts.push(key + ":" + signal.bias + (signal.rsi ? "/RSI" + signal.rsi : ""))
  }

  let score = Math.round(((raw + max) / (max * 2)) * 10)
  if (score < 0) score = 0
  if (score > 10) score = 10

  let bias = "NEUTRAL"
  switch (true) {
    case bullWeight > bearWeight + 1:
      bias = "BULLISH"
      break
    case bearWeight > bullWeight + 1:
      bias = "BEARISH"
      break
  }

  return {
    score: score,
    bias: bias,
    frames: parts.join(", "),
    selectedBias: selectedSignal ? selectedSignal.bias : "NEUTRAL",
    selectedRsi: selectedSignal ? selectedSignal.rsi : null,
    frameCandles: frames[selectedTimeframe] || []
  }
}

// ===== TRADE PLAN =====
let TradePlanManager = {
  build: function(data) {
    let candles = data.frameCandles
    if (!candles || candles.length < APP.scoring.minFrameCandles) {
      return this.empty("Không đủ dữ liệu candles để tính entry/SL/TP.")
    }

    let context = IndicatorManager.frameContext(candles)
    let atr = context.atr || (data.price * 0.02)
    let swing = context.swing
    let entry = data.price
    let entryType = "Chờ xác nhận"
    let stopLoss = null

    switch (true) {
      case data.selectedBias === "BULLISH" && data.change > APP.scoring.hotMovePct:
        entry = Math.max(context.emaFast || data.price - atr, data.price - atr * APP.scoring.pullbackAtr)
        entryType = "Limit pullback"
        stopLoss = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
        break
      case data.selectedBias === "BULLISH":
        entry = context.emaFast && context.emaFast < data.price ? context.emaFast : data.price
        entryType = entry < data.price ? "Limit retest EMA20" : "Market sau nến xác nhận"
        stopLoss = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
        break
      case data.selectedBias === "BEARISH":
        return this.empty("Khung chính bearish, không ưu tiên setup LONG.")
      default:
        entry = context.emaFast || data.price
        entryType = "Chờ breakout/retest"
        stopLoss = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
        break
    }

    if (!stopLoss || stopLoss <= 0 || stopLoss >= entry) {
      stopLoss = entry - atr * 1.5
    }

    let risk = entry - stopLoss
    let tp1 = entry + risk * 1.5
    let tp2 = entry + risk * 2
    let tp3 = Math.max(entry + risk * 3, swing.high || entry + risk * 3)
    let rr = (tp2 - entry) / risk
    let action = rr >= APP.scoring.minRewardRisk && data.selectedBias === "BULLISH" ? "LONG nếu có trigger" : "WAIT"

    return {
      ok: true,
      action: action,
      entryType: entryType,
      entry: entry,
      marketEntry: data.price,
      stopLoss: stopLoss,
      tp1: tp1,
      tp2: tp2,
      tp3: tp3,
      rr: rr,
      atr: atr,
      note: action === "WAIT" ? "R:R hoặc bias chưa đủ đẹp, chờ setup rõ hơn." : "Chỉ vào khi có nến xác nhận và volume không suy yếu."
    }
  },

  empty: function(reason) {
    return {
      ok: false,
      action: "WAIT",
      entryType: "N/A",
      entry: null,
      marketEntry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      rr: null,
      atr: null,
      note: reason
    }
  }
}

// ===== MARKET DATA =====
async function getJson(url) {
  return await HTTP.get({ url: url, timeout: APP.httpTimeout })
}

async function getTicker(symbol, market) {
  let baseUrl = marketBaseUrl(market)
  let path = market === "spot" ? "/api/v3/ticker/24hr" : "/fapi/v1/ticker/24hr"
  let response = await getJson(baseUrl + path + "?symbol=" + symbol)

  return response
}

async function getKlines(symbol, interval, limit, market) {
  let baseUrl = marketBaseUrl(market)
  let path = market === "spot" ? "/api/v3/klines" : "/fapi/v1/klines"

  let response = await HTTP.get({
    url: baseUrl + path + "?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit,
    timeout: APP.httpTimeout
  })

  if (!response || !response.ok || !Array.isArray(response.data)) return []
  return parseKlines(response.data)
}

async function loadMarketData(symbol, preferredMarket) {
  let market = preferredMarket || APP.defaultMarket
  let ticker = await getTicker(symbol, market)

  if (!ticker || !ticker.ok) {
    market = market === "futures" ? "spot" : "futures"
    ticker = await getTicker(symbol, market)
  }

  if (!ticker || !ticker.ok) {
    return { ok: false, market: market }
  }

  let candles = await Promise.all([
    getKlines(symbol, "1h", APP.h1KlineLimit, market),
    getKlines(symbol, "1d", APP.d1KlineLimit, market)
  ])

  return {
    ok: true,
    market: market,
    ticker: ticker.data,
    h1: candles[0],
    d1: candles[1]
  }
}

// ===== SETUP PLAN =====
function setupPlan(data) {
  let action = "WAIT"
  let reason = "Chưa đủ xác nhận"

  switch (true) {
    case data.selectedBias === "BULLISH" && data.bias === "BULLISH" && data.score >= 7 && data.change <= APP.scoring.hotMovePct:
      action = "LONG theo pullback/confirm"
      reason = "Khung chính và đa khung cùng bullish, chưa quá nóng"
      break
    case data.selectedBias === "BULLISH" && data.change > APP.scoring.hotMovePct:
      action = "WAIT pullback"
      reason = "Tín hiệu bullish nhưng giá đã nóng, tránh FOMO"
      break
    case data.selectedBias === "BEARISH":
      action = "WAIT / tránh LONG"
      reason = "Khung chính bearish"
      break
  }

  return {
    action: action,
    reason: reason,
    trigger: "Chờ " + data.timeframe + " đóng nến xác nhận hoặc retest giữ EMA20",
    invalidation: "Mất đáy gần nhất trên " + data.timeframe + " hoặc khung chính chuyển bearish"
  }
}

function localAdvice(data) {
  let rsiText = data.selectedRsi ? "RSI khoảng " + data.selectedRsi : "RSI chưa rõ"

  switch (true) {
    case data.change > APP.scoring.tooHotPct:
      return "Xu hướng tăng rất nóng, " + rsiText + "; không mua đuổi, ưu tiên quan sát/chờ điều chỉnh."
    case data.change > APP.scoring.hotMovePct:
      return "Động lượng mạnh nhưng có rủi ro FOMO, " + rsiText + "; chờ pullback/retest."
    case data.selectedBias === "BULLISH" && data.bias === "BULLISH":
      return "Đa khung nghiêng bullish, " + rsiText + "; có thể theo dõi setup nếu trigger rõ."
    case data.selectedBias === "BEARISH":
      return "Khung chính bearish, " + rsiText + "; chưa ưu tiên LONG."
    default:
      return "Tín hiệu chưa thật sự rõ; nên chờ thêm xác nhận."
  }
}

// ===== AI SUMMARY =====
async function askDeepSeek(config, data) {
  if (!config || !config.deepseek_api_key) return ""

  let prompt =
    "Bạn là trader fulltime hơn 10 năm kinh nghiệm. Phân tích ngắn bằng tiếng Việt, không hứa lợi nhuận, không bịa dữ liệu.\n" +
    "Dữ liệu:\n" +
    "- Symbol: " + data.symbol + "\n" +
    "- Market: " + data.market + "\n" +
    "- Khung chính: " + data.timeframe + "\n" +
    "- Giá: $" + fmtPrice(data.price) + "\n" +
    "- 24h: " + data.change.toFixed(2) + "%\n" +
    "- Volume: " + fmtMoney(data.volume * 1000000) + "\n" +
    "- Score: " + data.score + "/10\n" +
    "- Bias: " + data.bias + "\n" +
    "- " + data.timeframe + ": " + data.selectedBias + ", RSI " + (data.selectedRsi || "unknown") + "\n" +
    "- Entry đẹp: " + (data.tradePlan && data.tradePlan.entry ? "$" + fmtPrice(data.tradePlan.entry) : "N/A") + "\n" +
    "- Stop Loss: " + (data.tradePlan && data.tradePlan.stopLoss ? "$" + fmtPrice(data.tradePlan.stopLoss) : "N/A") + "\n" +
    "- TP1/TP2/TP3: " + (data.tradePlan && data.tradePlan.tp1 ? "$" + fmtPrice(data.tradePlan.tp1) + " / $" + fmtPrice(data.tradePlan.tp2) + " / $" + fmtPrice(data.tradePlan.tp3) : "N/A") + "\n" +
    "- R:R TP2: " + (data.tradePlan && data.tradePlan.rr ? "1:" + data.tradePlan.rr.toFixed(2) : "N/A") + "\n" +
    "- Frames: " + data.frames + "\n\n" +
    "Trả lời theo format:\n" +
    "1. Xu hướng\n2. Động lượng/RSI\n3. Vùng hành động hợp lý\n4. Rủi ro\n5. Kết luận LONG/WAIT/AVOID"

  try {
    let response = await HTTP.post({
      url: "https://api.deepseek.com/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.deepseek_api_key
      },
      body: {
        model: config.deepseek_model || "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        thinking: { type: "disabled" },
        max_tokens: APP.aiMaxTokens,
        temperature: 0.2,
        stream: false
      },
      timeout: APP.aiTimeout
    })

    if (
      response &&
      response.ok &&
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content
    ) {
      return response.data.choices[0].message.content.trim()
    }
  } catch (e) {
    return ""
  }

  return ""
}

// ===== MAIN FLOW =====
let config = loadConfig()
let command = parseCommandParams(params)

if (!command.coin) {
  Bot.sendMessage("Dùng: /analyze <coin> [h1|h2|h4|d1|d3|w1] [futures|spot]\nVD: /analyze btc, /analyze pepe h4 futures")
  return
}

let symbol = command.coin + "USDT"
let progress = await Bot.sendMessage("Đang kiểm tra " + symbol + " trên " + command.market + "...")
let marketData = await loadMarketData(symbol, command.market)

if (!marketData.ok) {
  await progress.editText("Không tìm thấy cặp " + symbol + " trên Binance futures hoặc spot.")
  return
}

await progress.editText("Đang phân tích " + symbol + " (" + marketData.market + "), khung chính " + command.timeframe + "...")

let ticker = marketData.ticker
let price = n(ticker.lastPrice)
let change = n(ticker.priceChangePercent)
let volume = n(ticker.quoteVolume) / 1000000
let ta = analyzeFrames(marketData.h1, marketData.d1, command.timeframe)

let data = {
  symbol: command.coin,
  pair: symbol,
  market: marketData.market,
  timeframe: command.timeframe,
  price: price,
  change: change,
  volume: volume,
  score: ta.score,
  bias: ta.bias,
  selectedBias: ta.selectedBias,
  selectedRsi: ta.selectedRsi,
  frameCandles: ta.frameCandles,
  frames: ta.frames
}

let plan = setupPlan(data)
let tradePlan = TradePlanManager.build(data)
data.tradePlan = tradePlan
let advice = localAdvice(data)
let aiText = await askDeepSeek(config, data)

let text = "📊 " + data.symbol + " - PHÂN TÍCH KỸ THUẬT\n"
text += "🏦 Market: " + data.market + " | ⏱ Khung chính: " + data.timeframe + "\n"
text += "💰 Giá: $" + fmtPrice(data.price) + " | 📈 24h: " + data.change.toFixed(2) + "% | 🔊 Vol: " + fmtMoney(data.volume * 1000000) + "\n"
text += "🧭 Score: " + data.score + "/10 | Bias: " + data.bias + " | " + data.timeframe + ": " + data.selectedBias + "\n"
text += "🧩 Frames: " + data.frames + "\n\n"
text += "⚡ Nhận định nhanh:\n"
text += "→ " + advice + "\n\n"
text += "🎯 Kế hoạch:\n"
text += "• Hành động: " + plan.action + "\n"
text += "• Lý do: " + plan.reason + "\n"
text += "• Entry đẹp: " + (tradePlan.entry ? "$" + fmtPrice(tradePlan.entry) + " (" + tradePlan.entryType + ")" : "N/A") + "\n"
text += "• Entry market: " + (tradePlan.marketEntry ? "$" + fmtPrice(tradePlan.marketEntry) : "N/A") + "\n"
text += "• Stop Loss: " + (tradePlan.stopLoss ? "$" + fmtPrice(tradePlan.stopLoss) : "N/A") + "\n"
text += "• TP1: " + (tradePlan.tp1 ? "$" + fmtPrice(tradePlan.tp1) : "N/A") + "\n"
text += "• TP2: " + (tradePlan.tp2 ? "$" + fmtPrice(tradePlan.tp2) : "N/A") + "\n"
text += "• TP3: " + (tradePlan.tp3 ? "$" + fmtPrice(tradePlan.tp3) : "N/A") + "\n"
text += "• R:R tới TP2: " + (tradePlan.rr ? "1:" + tradePlan.rr.toFixed(2) : "N/A") + "\n"
text += "• Trigger: " + plan.trigger + "\n"
text += "• Invalidation: " + plan.invalidation + "\n"
text += "• Ghi chú: " + tradePlan.note + "\n\n"

if (aiText) {
  text += "🧠 DeepSeek:\n" + aiText + "\n\n"
} else {
  text += "🧠 DeepSeek: bỏ qua hoặc chưa cấu hình API key.\n\n"
}

text += "⚠️ Lưu ý: Chỉ tham khảo, không phải lời khuyên đầu tư. Luôn quản trị rủi ro."

try {
  await progress.editText(text)
} catch (e) {
  Bot.sendMessage(text)
}
