/* Command: /bestcoin - Quét Binance top volume, tính TA thật từ candles và chọn vài coin có thể chơi */
let CONFIG_KEY = "BOT_CONFIG"

// ===== CONFIG =====
// Giữ toàn bộ tham số ở đây để dễ chỉnh mà không phải lần theo cả file.
let APP = {
  marketName: "Binance Futures USDT-M",
  futuresBaseUrl: "https://fapi.binance.com",
  defaultTimeframe: "D1",
  defaultLimit: 50,
  minLimit: 10,
  maxLimit: 100,
  batchSize: 5,
  rankingSize: 10,
  maxAnalysisPerTier: 1,
  telegramSafeLimit: 3800,
  h1KlineLimit: 240,
  d1KlineLimit: 420,
  httpTimeout: 8000,
  klineTimeout: 7000,
  aiTimeout: 10000,
  aiMaxTokens: 220,
  validFrames: { H1: true, H2: true, H4: true, D1: true, D3: true, W1: true },
  frameWeights: { H1: 1, H2: 1, H4: 1.5, D1: 2, D3: 2, W1: 2.5 },
  blockedPairs: ["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT", "TRYUSDT"],
  majorCoins: ["BTC", "ETH", "BNB"],
  scoring: {
    minFrameCandles: 35,
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    rsiBullMin: 52,
    rsiBullMax: 75,
    rsiBearMax: 48,
    rsiBearMin: 25,
    macdFast: 12,
    macdSlow: 26,
    volumeLookback: 20,
    volumeSpike: 1.15,
    playableMinScore: 7,
    strongSetupScore: 7.5,
    watchlistMinScore: 6.5,
    minPlayableVolumeM: 5,
    tier2VolumeM: 30,
    strongVolumeM: 300,
    goodVolumeM: 100,
    warmMovePct: 10,
    hotMovePct: 12,
    tooHotPct: 18,
    dumpPct: -8,
    selectedBullBonus: 1,
    selectedBearPenalty: 1.5,
    majorCoinOpportunityPenalty: 1.5
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
  let out = { timeframe: APP.defaultTimeframe, limit: APP.defaultLimit }
  if (!raw) return out

  let parts = String(raw).trim().split(/\s+/)

  for (let i = 0; i < parts.length; i++) {
    let p = parts[i].toUpperCase()
    let asNumber = parseInt(p)

    if (APP.validFrames[p]) out.timeframe = p
    else if (!isNaN(asNumber)) out.limit = asNumber
  }

  if (out.limit > APP.maxLimit) out.limit = APP.maxLimit
  if (out.limit < APP.minLimit) out.limit = APP.minLimit

  return out
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
      volumeAverage: this.sma(volumes, Math.min(APP.scoring.volumeLookback, volumes.length))
    }
  }
}

// ===== FRAME SCORING =====

function frameSignal(label, candles) {
  if (!candles || candles.length < APP.scoring.minFrameCandles) {
    return { label: label, score: 0, bias: "NEUTRAL", note: "missing" }
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

  let weights = APP.frameWeights
  let raw = 0
  let max = 0
  let bullWeight = 0
  let bearWeight = 0
  let parts = []
  let selectedSignal = null

  for (let key in frames) {
    let s = frameSignal(key, frames[key])
    let weight = weights[key]
    if (key === selectedTimeframe) selectedSignal = s
    let clipped = Math.max(-4, Math.min(4, s.score))

    raw += clipped * weight
    max += 4 * weight

    if (s.bias === "BULLISH") bullWeight += weight
    if (s.bias === "BEARISH") bearWeight += weight

    parts.push(key + ":" + s.bias + (s.rsi ? "/RSI" + s.rsi : ""))
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
    selectedScore: selectedSignal ? selectedSignal.score : 0,
    selectedRsi: selectedSignal ? selectedSignal.rsi : null
  }
}

// ===== SETUP SELECTION =====
function isMajorCoin(symbol) {
  return APP.majorCoins.indexOf(symbol) >= 0
}

function getTier(candidate) {
  if (isMajorCoin(candidate.symbol)) {
    return {
      id: 1,
      label: "Tier 1",
      note: "coin lớn, thanh khoản cao, ROI thường thấp hơn nhưng rủi ro thấp hơn"
    }
  }

  if (candidate.volume >= APP.scoring.tier2VolumeM) {
    return {
      id: 2,
      label: "Tier 2",
      note: "altcoin thanh khoản tốt, ROI/rủi ro cân bằng hơn"
    }
  }

  return {
    id: 3,
    label: "Tier 3",
    note: "coin nhỏ hơn, ROI có thể cao hơn nhưng rủi ro lớn hơn"
  }
}

function opportunityScore(candidate) {
  let score = candidate.finalScore

  if (candidate.tier === 1) score -= APP.scoring.majorCoinOpportunityPenalty
  if (candidate.tier === 2) score += 0.5
  if (candidate.tier === 3 && candidate.volume >= APP.scoring.minPlayableVolumeM) score += 0.25
  if (candidate.change > APP.scoring.hotMovePct) score -= 1
  if (candidate.change > APP.scoring.tooHotPct) score -= 2
  if (candidate.volume < APP.scoring.minPlayableVolumeM) score -= 1
  if (candidate.selectedBias === "BULLISH") score += 0.5

  return score
}

function setupPlan(candidate) {
  let action = "Watchlist"
  let reason = "Chờ xác nhận thêm"

  switch (true) {
    case candidate.selectedBias === "BULLISH" && candidate.bias === "BULLISH" && candidate.finalScore >= APP.scoring.strongSetupScore && candidate.change <= APP.scoring.hotMovePct:
      action = "Có thể canh LONG"
      reason = "Khung chính và đa khung cùng nghiêng bullish, chưa quá nóng"
      break
    case candidate.selectedBias === "BULLISH" && candidate.finalScore >= APP.scoring.playableMinScore:
      action = "Theo dõi pullback"
      reason = "Khung chính bullish nhưng vẫn cần tránh đuổi giá"
      break
    case candidate.selectedBias === "NEUTRAL" && candidate.finalScore >= APP.scoring.strongSetupScore:
      action = "Chờ breakout"
      reason = "Điểm cao nhưng khung chính chưa rõ, cần nến xác nhận"
      break
  }

  let trigger = "Chờ " + candidate.timeframe + " đóng nến xác nhận theo hướng setup hoặc retest giữ EMA20"
  let invalidation = "Mất đáy gần nhất trên " + candidate.timeframe + " hoặc khung chính chuyển bearish"

  if (candidate.change > APP.scoring.hotMovePct) {
    trigger = "Không đuổi giá; chỉ canh pullback về EMA20/EMA50 H1-H4 rồi có nến phản ứng"
    invalidation = "Pullback vỡ luôn EMA50 H4 hoặc volume bán tăng mạnh"
  }

  return {
    action: action,
    reason: reason,
    trigger: trigger,
    invalidation: invalidation
  }
}

function pickPlayable(results) {
  let nonTier1 = results.filter(x => x.tier !== 1)
  let strict = results.filter(x =>
    x.finalScore >= APP.scoring.playableMinScore &&
    x.selectedBias === "BULLISH" &&
    x.volume >= APP.scoring.minPlayableVolumeM &&
    x.change > -5 &&
    x.change < APP.scoring.tooHotPct &&
    x.tier !== 1
  )

  let balanced = results.filter(x =>
    x.finalScore >= APP.scoring.watchlistMinScore &&
    x.volume >= APP.scoring.minPlayableVolumeM &&
    x.change > APP.scoring.dumpPct &&
    x.change < 22 &&
    (x.selectedBias === "BULLISH" || x.selectedBias === "NEUTRAL") &&
    x.tier !== 1
  )

  let fallback = nonTier1.filter(x =>
    x.finalScore >= APP.scoring.watchlistMinScore &&
    x.volume >= APP.scoring.minPlayableVolumeM &&
    x.change > APP.scoring.dumpPct &&
    (x.selectedBias === "BULLISH" || x.selectedBias === "NEUTRAL")
  )

  let emergencyFallback = results.filter(x =>
    x.finalScore >= APP.scoring.watchlistMinScore &&
    x.volume >= APP.scoring.minPlayableVolumeM &&
    x.change > APP.scoring.dumpPct &&
    (x.selectedBias === "BULLISH" || x.selectedBias === "NEUTRAL")
  )

  let picked = strict.length > 0 ? strict : (balanced.length > 0 ? balanced : (fallback.length > 0 ? fallback : emergencyFallback))
  picked.sort((a, b) => {
    return opportunityScore(b) - opportunityScore(a)
  })

  return picked.slice(0, 5).map(x => {
    let plan = setupPlan(x)
    x.action = plan.action
    x.reason = plan.reason
    x.trigger = plan.trigger
    x.invalidation = plan.invalidation
    return x
  })
}

function localAdvice(candidate) {
  let rsiText = candidate.selectedRsi ? "RSI khoảng " + candidate.selectedRsi : "RSI chưa rõ"

  switch (true) {
    case candidate.change > APP.scoring.tooHotPct:
      return "Xu hướng tăng rất nóng, " + rsiText + ", volume cao; khuyến nghị ngắn: không đuổi giá, ưu tiên quan sát hoặc chờ điều chỉnh."
    case candidate.change > APP.scoring.warmMovePct:
      return "Xu hướng tăng mạnh, " + rsiText + ", động lượng tốt nhưng có rủi ro FOMO; khuyến nghị ngắn: chờ pullback/retest rồi mới cân nhắc."
    case candidate.selectedBias === "BULLISH" && candidate.bias === "BULLISH":
      return "Đa khung nghiêng bullish, " + rsiText + ", volume đủ tốt; khuyến nghị ngắn: có thể canh theo xu hướng nếu có trigger và stop rõ."
    case candidate.selectedBias === "BULLISH":
      return "Khung chính bullish nhưng đa khung chưa hoàn toàn đồng thuận; khuyến nghị ngắn: theo dõi thêm xác nhận, không vào vội."
    case candidate.selectedBias === "NEUTRAL":
      return "Điểm kỹ thuật khá nhưng bias khung chính chưa rõ; khuyến nghị ngắn: chờ breakout hoặc retest rõ ràng."
    default:
      return "Tín hiệu chưa đủ sạch; khuyến nghị ngắn: chỉ đưa vào watchlist, chưa ưu tiên vào lệnh."
  }
}

function ensurePlan(candidate) {
  if (!candidate.action) {
    let plan = setupPlan(candidate)
    candidate.action = plan.action
    candidate.reason = plan.reason
    candidate.trigger = plan.trigger
    candidate.invalidation = plan.invalidation
  }

  return candidate
}

function pickTierCandidates(results, tierId, limit) {
  let list = results.filter(x =>
    x.tier === tierId &&
    x.finalScore >= APP.scoring.watchlistMinScore &&
    x.volume >= APP.scoring.minPlayableVolumeM &&
    x.change > APP.scoring.dumpPct &&
    (x.selectedBias === "BULLISH" || x.selectedBias === "NEUTRAL")
  )

  list.sort((a, b) => opportunityScore(b) - opportunityScore(a))
  return list.slice(0, limit).map(x => ensurePlan(x))
}

function uniqueCandidates(list) {
  let seen = {}
  let out = []

  for (let i = 0; i < list.length; i++) {
    let item = list[i]
    if (seen[item.symbol]) continue
    seen[item.symbol] = true
    out.push(item)
  }

  return out
}

// ===== MARKET DATA =====
async function getKlines(symbol, interval, limit) {
  let res = await HTTP.get({
    url: APP.futuresBaseUrl + "/fapi/v1/klines?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit,
    timeout: APP.klineTimeout
  })

  if (!res || !res.ok || !Array.isArray(res.data)) return []
  return parseKlines(res.data)
}

async function analyzeCoin(coin, selectedTimeframe) {
  let pairData = await Promise.all([
    getKlines(coin.symbol, "1h", APP.h1KlineLimit),
    getKlines(coin.symbol, "1d", APP.d1KlineLimit)
  ])
  let h1 = pairData[0]
  let d1 = pairData[1]
  let ta = analyzeFrames(h1, d1, selectedTimeframe)

  let liquidityScore = 0
  if (coin.volume >= APP.scoring.strongVolumeM) liquidityScore = 1
  else if (coin.volume >= APP.scoring.goodVolumeM) liquidityScore = 0.5

  let finalScore = ta.score + liquidityScore
  if (ta.selectedBias === "BULLISH") finalScore += APP.scoring.selectedBullBonus
  if (ta.selectedBias === "BEARISH") finalScore -= APP.scoring.selectedBearPenalty
  if (coin.change < APP.scoring.dumpPct) finalScore -= 1
  if (coin.change > APP.scoring.tooHotPct) finalScore -= 1
  if (finalScore < 0) finalScore = 0
  if (finalScore > 10) finalScore = 10

  let result = {
    symbol: coin.symbol.replace("USDT", ""),
    pair: coin.symbol,
    price: coin.price,
    change: coin.change,
    volume: coin.volume,
    taScore: ta.score,
    finalScore: finalScore,
    bias: ta.bias,
    selectedBias: ta.selectedBias,
    selectedScore: ta.selectedScore,
    selectedRsi: ta.selectedRsi,
    timeframe: selectedTimeframe,
    frames: ta.frames
  }

  let tier = getTier(result)
  result.tier = tier.id
  result.tierLabel = tier.label
  result.tierNote = tier.note

  return result
}

async function analyzeBatch(coins, batchSize, selectedTimeframe) {
  let output = []

  for (let i = 0; i < coins.length; i += batchSize) {
    let chunk = coins.slice(i, i + batchSize)
    let analyzed = await Promise.all(chunk.map(async coin => {
      try {
        return await analyzeCoin(coin, selectedTimeframe)
      } catch (e) {
        return null
      }
    }))

    for (let j = 0; j < analyzed.length; j++) {
      if (analyzed[j]) output.push(analyzed[j])
    }
  }

  return output
}

// ===== AI SUMMARY =====
async function askDeepSeek(config, candidates) {
  if (!config || !config.deepseek_api_key || candidates.length === 0) return ""

  let compact = candidates.map((x, i) => (
    (i + 1) + ". " + x.symbol +
    " tier=" + x.tier +
    " score=" + x.finalScore + "/10" +
    ", bias=" + x.bias +
    ", " + x.timeframe + "=" + x.selectedBias +
    ", rsi=" + (x.selectedRsi || "unknown") +
    ", 24h=" + x.change.toFixed(2) + "%" +
    ", vol=" + x.volume.toFixed(1) + "M" +
    ", frames=" + x.frames
  )).join("\n")

  let prompt =
    "Bạn là trader fulltime hơn 10 năm kinh nghiệm. Dưới đây là các coin đã được lọc bằng TA thật từ H1,H2,H4,D1,D3,W1.\n" +
    "Tóm tắt toàn bộ trong tối đa 3 dòng. Mỗi dòng cực ngắn, ưu tiên coin đáng chú ý nhất từng tier.\n" +
    "Nếu coin tăng quá nóng, ưu tiên nói thận trọng chốt lời/quan sát/chờ điều chỉnh. Không hứa lợi nhuận, không nói chắc chắn, không bịa dữ liệu.\n\n" +
    compact

  try {
    let aiRes = await HTTP.post({
      url: "https://api.deepseek.com/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.deepseek_api_key
      },
      body: {
        model: config.deepseek_model || "deepseek-v4-flash",
        messages: [
          { role: "user", content: prompt }
        ],
        thinking: { type: "disabled" },
        max_tokens: APP.aiMaxTokens,
        temperature: 0.2,
        stream: false
      },
      timeout: APP.aiTimeout
    })

    if (
      aiRes &&
      aiRes.ok &&
      aiRes.data &&
      aiRes.data.choices &&
      aiRes.data.choices[0] &&
      aiRes.data.choices[0].message &&
      aiRes.data.choices[0].message.content
    ) {
      return aiRes.data.choices[0].message.content.trim()
    }
  } catch (e) {
    return ""
  }

  return ""
}

// ===== MAIN FLOW =====
let config = loadConfig()
let commandOptions = parseCommandParams(params)
let selectedTimeframe = commandOptions.timeframe
let limit = commandOptions.limit

let progress = await Bot.sendMessage("Đang quét top " + limit + " " + APP.marketName + " pairs, khung chính " + selectedTimeframe + "...")

let tickersRes = await HTTP.get({
  url: APP.futuresBaseUrl + "/fapi/v1/ticker/24hr",
  timeout: APP.httpTimeout
})

if (!tickersRes || !tickersRes.ok || !Array.isArray(tickersRes.data)) {
  throw new Error("Lỗi lấy ticker Binance")
}

let tickers = tickersRes.data.filter(t => {
  if (!t.symbol || !t.symbol.endsWith("USDT")) return false
  if (APP.blockedPairs.indexOf(t.symbol) >= 0) return false
  return n(t.quoteVolume) > 0
})

tickers.sort((a, b) => n(b.quoteVolume) - n(a.quoteVolume))

let top = tickers.slice(0, limit).map(t => ({
  symbol: t.symbol,
  price: n(t.lastPrice),
  change: n(t.priceChangePercent),
  volume: n(t.quoteVolume) / 1000000
}))

let results = await analyzeBatch(top, APP.batchSize, selectedTimeframe)

if (results.length === 0) {
  await progress.editText("Không phân tích được coin nào. Thử lại sau.")
  return
}

results.sort((a, b) => b.finalScore - a.finalScore)

let ranking = results.slice(0, APP.rankingSize)
let tier1List = pickTierCandidates(results, 1, APP.maxAnalysisPerTier)
let tier2List = pickTierCandidates(results, 2, APP.maxAnalysisPerTier)
let tier3List = pickTierCandidates(results, 3, APP.maxAnalysisPerTier)
let analysisList = uniqueCandidates(tier1List.concat(tier2List).concat(tier3List))
if (analysisList.length === 0) analysisList = results.slice(0, 5).map(x => ensurePlan(x))

let rankingText = "🔎 XẾP HẠNG TOP " + limit + " COIN THEO BULLISH SCORE (tối đa 10)\n"
rankingText += "Market: " + APP.marketName + "\n"
rankingText += "Khung chính: " + selectedTimeframe + " | Xác nhận: H1/H2/H4/D1/D3/W1\n\n"
rankingText += "| Hạng | Coin | Giá | 24h% | Volume (M) | Score/10 |\n"
rankingText += "|------|------|-----|------|------------|----------|\n"

let compactRanking = ranking.slice(0, 8)
for (let i = 0; i < compactRanking.length; i++) {
  let r = compactRanking[i]
  rankingText += "| " + (i + 1) + " | " + r.symbol + " | $" + fmtPrice(r.price) + " | " + r.change.toFixed(2) + "% | $" + r.volume.toFixed(1) + "M | " + r.finalScore + "/10 |\n"
}

rankingText += "\n💡 Tier 1: BTC/ETH/BNB | Tier 2: alt thanh khoản tốt | Tier 3: nhỏ hơn/rủi ro cao hơn.\n"
rankingText += "Điểm ≥7 và khung " + selectedTimeframe + " không bearish là nhóm đáng chú ý.\n"

if (analysisList.length === 0) {
  rankingText += "\n⚠️ Không có setup thật sự sạch. Các coin bên dưới chỉ nên xem như watchlist, chưa nên vào lệnh nếu chưa có trigger.\n"
}

let tierText = "🤖 Nhận định theo tier:\n\n"

function appendTierSection(title, list) {
  if (list.length === 0) {
    tierText += title + "\n"
    tierText += "Không có candidate đủ sạch trong tier này.\n\n"
    return
  }

  tierText += title + "\n"

  for (let i = 0; i < list.length; i++) {
    let r = ensurePlan(list[i])

    tierText += "▪️ " + r.symbol + " (" + r.tierLabel + ", điểm " + r.finalScore + "/10, " + selectedTimeframe + ": " + r.selectedBias + "):\n"
    tierText += "   → " + localAdvice(r) + "\n"
    tierText += "   Trigger: " + r.trigger + "\n\n"
  }
}

appendTierSection("Tier 1 - Market leaders", tier1List)
appendTierSection("Tier 2 - Alt thanh khoản tốt", tier2List)
appendTierSection("Tier 3 - Nhỏ hơn, rủi ro cao hơn", tier3List)

let aiText = await askDeepSeek(config, analysisList)
let finalText = rankingText + "\n" + tierText

if (aiText && (finalText + "\n🧠 DeepSeek:\n" + aiText).length < APP.telegramSafeLimit) {
  finalText += "\n🧠 DeepSeek:\n" + aiText + "\n"
}

let riskNote = "\n⚠️ Chỉ là setup theo dõi, không phải lời khuyên đầu tư. Chỉ vào lệnh khi có trigger và quản trị rủi ro."
if ((finalText + riskNote).length < APP.telegramSafeLimit) {
  finalText += riskNote
}

if (finalText.length > APP.telegramSafeLimit) {
  finalText = finalText.slice(0, APP.telegramSafeLimit - 120) + "\n\n⚠️ Nội dung đã được rút gọn để gửi trong 1 tin nhắn."
}

try {
  await progress.editText(finalText)
} catch (e) {
  Bot.sendMessage(finalText)
}
