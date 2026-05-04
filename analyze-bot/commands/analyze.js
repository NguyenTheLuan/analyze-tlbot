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
  telegramSectionDivider: "------------------------------\n",
  compactModeDefault: true,
  frameWeights: { H1: 1, H2: 1, H4: 1.5, D1: 2, D3: 2, W1: 2.5 },
  volumePulseWindows: [1, 2, 3, 4, 6, 12],
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
    structureLookback: 5,
    equalLevelTolerancePct: 0.12,
    triggerBodyMinRatio: 0.5,
    trapVolumeSpike: 1.35,
    regimeAdxTrendMin: 20,
    regimeAdxStrongMin: 25,
    volumeLookback: 20,
    volumeSpike: 1.15,
    hotMovePct: 12,
    tooHotPct: 18,
    dumpPct: -8
  }
}

function isCompactMode(config) {
  if (config && config.compact_mode === false) return false
  return APP.compactModeDefault
}

function toSingleLine(text, maxLen) {
  if (!text) return ""
  let line = String(text).replace(/\s+/g, " ").trim()
  if (line.length <= maxLen) return line
  return line.slice(0, maxLen - 1).trim() + "…"
}

function cleanAiText(text, maxLen) {
  if (!text) return ""
  let body = String(text).replace(/\r/g, "")
  body = body.replace(/```/g, "")
  body = body.replace(/[ \t]+\n/g, "\n")
  body = body.replace(/\n{3,}/g, "\n\n")
  body = body.replace(/^[ \t]+|[ \t]+$/g, "")
  return body.trim()
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
    let avgGain = 0
    let avgLoss = 0

    for (let i = 1; i <= period; i++) {
      let diff = values[i] - values[i - 1]
      if (diff > 0) avgGain += diff
      else avgLoss -= diff
    }
    avgGain /= period
    avgLoss /= period

    for (let i = period + 1; i < values.length; i++) {
      let diff = values[i] - values[i - 1]
      let gain = diff > 0 ? diff : 0
      let loss = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }

    if (avgLoss === 0) return 100

    let rs = avgGain / avgLoss
    return 100 - (100 / (1 + rs))
  },

  marketStructureState: function(candles, swingLen) {
    if (!candles || candles.length < swingLen * 2 + 10) {
      return { trend: "NEUTRAL", strength: 0, hh: false, hl: false, lh: false, ll: false }
    }
    let highs = []
    let lows = []
    for (let i = swingLen; i < candles.length - swingLen; i++) {
      let c = candles[i]
      let left = candles.slice(i - swingLen, i)
      let right = candles.slice(i + 1, i + swingLen + 1)
      let maxLeft = Math.max.apply(null, left.map(x => x.h))
      let maxRight = Math.max.apply(null, right.map(x => x.h))
      let minLeft = Math.min.apply(null, left.map(x => x.l))
      let minRight = Math.min.apply(null, right.map(x => x.l))
      if (c.h >= maxLeft && c.h >= maxRight) highs.push({ idx: i, price: c.h })
      if (c.l <= minLeft && c.l <= minRight) lows.push({ idx: i, price: c.l })
    }
    if (highs.length < 2 || lows.length < 2) {
      return { trend: "NEUTRAL", strength: 0, hh: false, hl: false, lh: false, ll: false }
    }

    let h1 = highs[highs.length - 2].price
    let h2 = highs[highs.length - 1].price
    let l1 = lows[lows.length - 2].price
    let l2 = lows[lows.length - 1].price
    let hh = h2 > h1
    let hl = l2 > l1
    let lh = h2 < h1
    let ll = l2 < l1
    let lastClose = candles[candles.length - 1].c
    let prevHigh = highs[highs.length - 2].price
    let prevLow = lows[lows.length - 2].price
    let bosBull = lastClose > prevHigh
    let bosBear = lastClose < prevLow
    let chochBull = lh && bosBull
    let chochBear = hl && bosBear
    if (hh && hl) return { trend: "BULLISH", strength: 2, hh: hh, hl: hl, lh: lh, ll: ll, bosBull: bosBull, bosBear: bosBear, chochBull: chochBull, chochBear: chochBear }
    if (lh && ll) return { trend: "BEARISH", strength: 2, hh: hh, hl: hl, lh: lh, ll: ll, bosBull: bosBull, bosBear: bosBear, chochBull: chochBull, chochBear: chochBear }
    return { trend: "NEUTRAL", strength: 0, hh: hh, hl: hl, lh: lh, ll: ll, bosBull: bosBull, bosBear: bosBear, chochBull: chochBull, chochBear: chochBear }
  },

  trueRangeAt: function(candles, i) {
    if (i < 1) return 0
    let c = candles[i]
    let p = candles[i - 1]
    return Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c))
  },

  adxDiLast: function(candles, period) {
    if (!candles || candles.length < period * 2 + 5) return null
    let tr = []
    let pdm = []
    let mdm = []
    for (let i = 1; i < candles.length; i++) {
      let up = candles[i].h - candles[i - 1].h
      let down = candles[i - 1].l - candles[i].l
      pdm.push(up > down && up > 0 ? up : 0)
      mdm.push(down > up && down > 0 ? down : 0)
      tr.push(this.trueRangeAt(candles, i))
    }

    let n = tr.length
    if (n < period * 2) return null
    let atrW = 0
    let spW = 0
    let smW = 0
    for (let i = 0; i < period; i++) {
      atrW += tr[i]
      spW += pdm[i]
      smW += mdm[i]
    }
    atrW /= period
    spW /= period
    smW /= period

    let dxArr = []
    let lastPdi = 0
    let lastMdi = 0
    for (let j = period; j < n; j++) {
      atrW = (atrW * (period - 1) + tr[j]) / period
      spW = (spW * (period - 1) + pdm[j]) / period
      smW = (smW * (period - 1) + mdm[j]) / period
      lastPdi = atrW > 0 ? (100 * spW) / atrW : 0
      lastMdi = atrW > 0 ? (100 * smW) / atrW : 0
      let den = lastPdi + lastMdi
      dxArr.push(den === 0 ? 0 : (100 * Math.abs(lastPdi - lastMdi)) / den)
    }
    if (dxArr.length < period) return null
    let adx = 0
    for (let i = 0; i < period; i++) adx += dxArr[i]
    adx /= period
    for (let i = period; i < dxArr.length; i++) adx = (adx * (period - 1) + dxArr[i]) / period
    return { adx: adx, plusDI: lastPdi, minusDI: lastMdi }
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
      structure: this.marketStructureState(candles, APP.scoring.structureLookback),
      adxBlock: this.adxDiLast(candles, APP.scoring.atrPeriod),
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

  switch (context.structure.trend) {
    case "BULLISH":
      bull += context.structure.strength * 0.5
      notes.push("HH/HL")
      break
    case "BEARISH":
      bear += context.structure.strength * 0.5
      notes.push("LH/LL")
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
  buildShortRef: function(data) {
    let candles = data.frameCandles
    if (!candles || candles.length < APP.scoring.minFrameCandles) {
      return this.empty("Không đủ dữ liệu candles để tính setup SHORT.")
    }
    let context = IndicatorManager.frameContext(candles)
    let atr = context.atr || (data.price * 0.02)
    let swing = context.swing
    let liq = detectLiquidityLevels(candles)
    let entry = context.emaFast && context.emaFast > data.price ? context.emaFast : data.price + atr * 0.2
    let stopBase = liq.eqHigh && liq.eqHigh > entry ? liq.eqHigh : (swing.high || entry + atr)
    let stopLoss = stopBase + atr * APP.scoring.stopAtrBuffer
    if (!stopLoss || stopLoss <= entry) stopLoss = entry + atr * 1.5

    let risk = stopLoss - entry
    let tp1 = entry - risk * 1.5
    let structTp = swing.low && swing.low < entry ? swing.low : null
    let tp2 = structTp != null ? Math.min(entry - risk * 2, structTp) : entry - risk * 2
    let tp3 = structTp != null ? Math.min(entry - risk * 3, structTp - atr * 0.8) : entry - risk * 3
    let rr = risk > 0 ? (entry - tp2) / risk : null
    let action = rr >= APP.scoring.minRewardRisk ? "SHORT tham khảo" : "WAIT"
    if (!data.entryTrigger || !data.entryTrigger.shortConfirmed) action = "WAIT"
    if (data.regime && data.regime.regime === "RANGE") action = "WAIT"
    if (data.volTrap && data.volTrap.shortTrap) action = "WAIT"
    return {
      ok: true,
      direction: "SHORT",
      action: action,
      entryType: "Limit retest EMA20 / kháng cự gần",
      entry: entry,
      marketEntry: data.price,
      stopLoss: stopLoss,
      tp1: tp1,
      tp2: tp2,
      tp3: tp3,
      rr: rr,
      atr: atr,
      note: action === "WAIT" ? "Short setup chưa đủ sạch, chờ xác nhận thêm." : "Khung chính bearish: short chỉ tham khảo, vào lệnh khi có nến xác nhận."
    }
  },

  build: function(data) {
    let candles = data.frameCandles
    if (!candles || candles.length < APP.scoring.minFrameCandles) {
      return this.empty("Không đủ dữ liệu candles để tính entry/SL/TP.")
    }

    let context = IndicatorManager.frameContext(candles)
    let atr = context.atr || (data.price * 0.02)
    let swing = context.swing
    let liq = detectLiquidityLevels(candles)
    let entry = data.price
    let entryType = "Chờ xác nhận"
    let stopLoss = null

    switch (true) {
      case data.selectedBias === "BULLISH" && data.change > APP.scoring.hotMovePct:
        entry = Math.max(context.emaFast || data.price - atr, data.price - atr * APP.scoring.pullbackAtr)
        entryType = "Limit pullback"
        stopLoss = ((liq.eqLow && liq.eqLow < entry) ? liq.eqLow : (swing.low || entry - atr)) - atr * APP.scoring.stopAtrBuffer
        break
      case data.selectedBias === "BULLISH":
        entry = context.emaFast && context.emaFast < data.price ? context.emaFast : data.price
        entryType = entry < data.price ? "Limit retest EMA20" : "Market sau nến xác nhận"
        stopLoss = ((liq.eqLow && liq.eqLow < entry) ? liq.eqLow : (swing.low || entry - atr)) - atr * APP.scoring.stopAtrBuffer
        break
      case data.selectedBias === "BEARISH":
        return this.buildShortRef(data)
      default:
        entry = context.emaFast || data.price
        entryType = "Chờ breakout/retest"
        stopLoss = ((liq.eqLow && liq.eqLow < entry) ? liq.eqLow : (swing.low || entry - atr)) - atr * APP.scoring.stopAtrBuffer
        break
    }

    if (!stopLoss || stopLoss <= 0 || stopLoss >= entry) {
      stopLoss = entry - atr * 1.5
    }

    let risk = entry - stopLoss
    let tp1 = entry + risk * 1.5
    let structTp = swing.high && swing.high > entry ? swing.high : null
    let tp2 = structTp != null ? Math.max(entry + risk * 2, structTp) : entry + risk * 2
    let tp3 = structTp != null ? Math.max(entry + risk * 3, structTp + atr * 0.8) : entry + risk * 3
    let rr = (tp2 - entry) / risk
    let action = rr >= APP.scoring.minRewardRisk && data.selectedBias === "BULLISH" ? "LONG nếu có trigger" : "WAIT"
    if (!data.entryTrigger || !data.entryTrigger.longConfirmed) action = "WAIT"
    if (data.regime && data.regime.regime === "RANGE") action = "WAIT"
    if (data.volTrap && data.volTrap.longTrap) action = "WAIT"

    return {
      ok: true,
      direction: "LONG",
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
      direction: "WAIT",
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

async function loadFuturesContext(symbol, market) {
  if (market !== "futures") {
    return { available: false, note: "Không áp dụng cho spot" }
  }
  try {
    let base = APP.futuresBaseUrl
    let responses = await Promise.all([
      HTTP.get({ url: base + "/fapi/v1/fundingRate?symbol=" + symbol + "&limit=1", timeout: APP.httpTimeout }),
      HTTP.get({ url: base + "/fapi/v1/openInterest?symbol=" + symbol, timeout: APP.httpTimeout }),
      HTTP.get({
        url: base + "/futures/data/globalLongShortAccountRatio?symbol=" + symbol + "&period=1h&limit=1",
        timeout: APP.httpTimeout
      })
    ])
    let funding = responses[0] && responses[0].ok && Array.isArray(responses[0].data) && responses[0].data[0]
      ? n(responses[0].data[0].fundingRate) * 100
      : null
    let oi = responses[1] && responses[1].ok && responses[1].data ? n(responses[1].data.openInterest) : null
    let ls = responses[2] && responses[2].ok && Array.isArray(responses[2].data) && responses[2].data[0]
      ? n(responses[2].data[0].longShortRatio)
      : null
    return { available: true, fundingPct: funding, openInterest: oi, longShortRatio: ls, note: "Binance futures context" }
  } catch (e) {
    return { available: false, note: "Chưa lấy được funding/OI/L-S ratio" }
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

  if (data.regime && data.regime.regime === "RANGE") {
    action = "WAIT"
    reason = "Thị trường đang sideway, ưu tiên chờ phá vỡ + xác nhận"
  }
  if (data.entryTrigger && data.selectedBias === "BULLISH" && !data.entryTrigger.longConfirmed) {
    action = "WAIT"
    reason = "Bias bullish nhưng chưa có trigger nến LONG rõ"
  }
  if (data.entryTrigger && data.selectedBias === "BEARISH" && !data.entryTrigger.shortConfirmed) {
    action = "WAIT"
    reason = "Bias bearish nhưng chưa có trigger nến SHORT rõ"
  }
  if (data.volTrap && (data.volTrap.longTrap || data.volTrap.shortTrap)) {
    action = "WAIT"
    reason = data.volTrap.note
  }

  return {
    action: action,
    reason: reason,
    trigger: "Chờ " + data.timeframe + " đóng nến xác nhận hoặc retest giữ EMA20",
    invalidation: "Mất đáy gần nhất trên " + data.timeframe + " hoặc khung chính chuyển bearish"
  }
}

function localAdvice(data) {
  if (data.volTrap && (data.volTrap.longTrap || data.volTrap.shortTrap)) {
    return data.volTrap.note + " Ưu tiên đứng ngoài chờ nến đóng rõ."
  }
  if (data.regime && data.regime.regime === "RANGE") {
    return "Thị trường sideway/rung lắc; giảm size hoặc chờ break xác nhận trước khi theo xu hướng."
  }
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

function analyzeVolumePulse(h1) {
  if (!h1 || h1.length < 40) {
    return {
      label: "chưa đủ dữ liệu volume",
      summary: "VOL: thiếu dữ liệu",
      buybackStrong: false,
      buybackCount: 0,
      selloffCount: 0
    }
  }

  let parts = []
  let buybackCount = 0
  let selloffCount = 0
  let buyFrames = []
  let sellFrames = []
  let buyScore = 0
  let sellScore = 0
  let dominant = { side: "", frame: "", score: 0 }
  for (let i = 0; i < APP.volumePulseWindows.length; i++) {
    let w = APP.volumePulseWindows[i]
    let bars = w === 1 ? h1 : aggregate(h1, w)
    if (!bars || bars.length < 8) continue

    let last = bars[bars.length - 1]
    let prev = bars[bars.length - 2]
    let vols = bars.slice(Math.max(0, bars.length - 7), bars.length - 1).map(x => x.qv || x.v)
    let avg = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : 0
    let ratio = avg > 0 ? (last.qv || last.v) / avg : 0
    let dp = prev.c > 0 ? ((last.c - prev.c) / prev.c) * 100 : 0
    let mark = dp >= 0 ? "↑" : "↓"
    parts.push(w + "h:" + ratio.toFixed(2) + "x" + mark)
    let impulse = Math.max(0, ratio - 1)
    if (ratio >= 1.12 && dp > 0) {
      buybackCount++
      buyFrames.push(w + "h")
      buyScore += impulse * w
      if (impulse * w > dominant.score) dominant = { side: "BUY", frame: w + "h", score: impulse * w }
    }
    if (ratio >= 1.12 && dp < 0) {
      selloffCount++
      sellFrames.push(w + "h")
      sellScore += impulse * w
      if (impulse * w > dominant.score) dominant = { side: "SELL", frame: w + "h", score: impulse * w }
    }
  }

  let buybackStrong = buybackCount >= 2
  let state = "CHỜ (VOL CHƯA RÕ)"
  if (buyScore >= sellScore * 1.25 && buybackCount > 0) state = "ƯU TIÊN MUA LẠI"
  else if (sellScore >= buyScore * 1.25 && selloffCount > 0) state = "ƯU TIÊN BÁN/XẢ"
  else if (buybackCount > 0 && selloffCount > 0) state = "XUNG ĐỘT 2 CHIỀU (CHỜ NẾN XÁC NHẬN)"

  let summary =
    state +
    " | Buy: " +
    (buyFrames.length ? buyFrames.join(",") : "—") +
    " | Sell: " +
    (sellFrames.length ? sellFrames.join(",") : "—") +
    (dominant.frame ? " | Chi phối: " + dominant.side + "@" + dominant.frame : "")

  let insight = "Volume chưa cho tín hiệu đủ rõ, ưu tiên chờ nến xác nhận."
  if (buyScore > 0 && sellScore === 0) {
    insight =
      "Lực mua lan rộng ở " +
      buyFrames.join(", ") +
      ", chưa thấy xả đáng kể; có thể là pha mua lại, nhưng vẫn cần trigger nến."
  } else if (sellScore > 0 && buyScore === 0) {
    insight =
      "Lực xả đồng pha ở " +
      sellFrames.join(", ") +
      ", rủi ro giảm tiếp cao; tránh bắt đáy sớm."
  } else if (sellScore >= buyScore * 1.25 && buybackCount > 0) {
    insight =
      "Có lực mua hồi ở " +
      buyFrames.join(", ") +
      " nhưng xả ở " +
      sellFrames.join(", ") +
      " vẫn chi phối; dễ là nhịp hồi kỹ thuật, chưa an toàn để đuổi long."
  } else if (buyScore >= sellScore * 1.25 && selloffCount > 0) {
    insight =
      "Lực mua đang lấy lại chủ động, dù vẫn có xả tại " +
      sellFrames.join(", ") +
      "; phù hợp chờ pullback + nến xác nhận trước khi vào."
  } else if (buybackCount > 0 && selloffCount > 0) {
    insight =
      "Dòng tiền 2 chiều, khả năng rung lắc/quét stop cao; chưa có phe thắng rõ, ưu tiên chờ break + xác nhận."
  }
  return {
    label: parts.join(" | "),
    summary: summary,
    insight: insight,
    buybackStrong: buybackStrong,
    buybackCount: buybackCount,
    selloffCount: selloffCount,
    buyFrames: buyFrames,
    sellFrames: sellFrames,
    buyScore: buyScore,
    sellScore: sellScore
  }
}

function analyzeRegime(data) {
  let candles = data.frameCandles
  if (!candles || candles.length < APP.scoring.minFrameCandles) {
    return { regime: "UNKNOWN", note: "Thiếu dữ liệu", adx: null }
  }
  let ctx = IndicatorManager.frameContext(candles)
  let adx = ctx.adxBlock ? ctx.adxBlock.adx : null
  let trend = ctx.structure ? ctx.structure.trend : "NEUTRAL"
  if (adx == null) return { regime: trend === "NEUTRAL" ? "RANGE" : "TREND", note: "Dựa theo structure", adx: null }

  if (adx >= APP.scoring.regimeAdxStrongMin && trend !== "NEUTRAL") {
    return { regime: "TREND", note: "Xu hướng rõ (ADX mạnh + structure)", adx: adx }
  }
  if (adx >= APP.scoring.regimeAdxTrendMin && trend !== "NEUTRAL") {
    return { regime: "TREND", note: "Xu hướng vừa", adx: adx }
  }
  return { regime: "RANGE", note: "Sideway/rung lắc", adx: adx }
}

function analyzeEntryTrigger(candles) {
  if (!candles || candles.length < 3) {
    return { longConfirmed: false, shortConfirmed: false, note: "Thiếu nến xác nhận" }
  }
  let prev = candles[candles.length - 2]
  let last = candles[candles.length - 1]
  let range = Math.max(0.0000001, last.h - last.l)
  let body = Math.abs(last.c - last.o)
  let upperWick = last.h - Math.max(last.c, last.o)
  let lowerWick = Math.min(last.c, last.o) - last.l
  let bodyRatio = body / range

  let bullEngulf = last.c > last.o && prev.c < prev.o && last.c >= prev.o && last.o <= prev.c
  let bearEngulf = last.c < last.o && prev.c > prev.o && last.o >= prev.c && last.c <= prev.o
  let bullPin = lowerWick > body * 1.8 && last.c >= last.l + range * 0.55
  let bearPin = upperWick > body * 1.8 && last.c <= last.l + range * 0.45
  let bullClose = last.c > prev.h && bodyRatio >= APP.scoring.triggerBodyMinRatio
  let bearClose = last.c < prev.l && bodyRatio >= APP.scoring.triggerBodyMinRatio

  let longConfirmed = bullEngulf || bullPin || bullClose
  let shortConfirmed = bearEngulf || bearPin || bearClose
  let note = "Chờ nến xác nhận"
  if (longConfirmed && !shortConfirmed) note = "Có trigger LONG"
  if (shortConfirmed && !longConfirmed) note = "Có trigger SHORT"
  if (longConfirmed && shortConfirmed) note = "Trigger nhiễu 2 chiều"
  return { longConfirmed: longConfirmed, shortConfirmed: shortConfirmed, note: note }
}

function analyzeVolumeTrap(candles) {
  if (!candles || candles.length < 25) return { longTrap: false, shortTrap: false, note: "Không đủ dữ liệu trap" }
  let last = candles[candles.length - 1]
  let prev = candles[candles.length - 2]
  let vols = candles.slice(candles.length - 21, candles.length - 1).map(x => x.qv || x.v)
  let avg = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : 0
  let ratio = avg > 0 ? (last.qv || last.v) / avg : 0
  let range = Math.max(0.0000001, last.h - last.l)
  let body = Math.abs(last.c - last.o)
  let bodyRatio = body / range
  let upperWick = last.h - Math.max(last.c, last.o)
  let lowerWick = Math.min(last.c, last.o) - last.l
  let longTrap = ratio >= APP.scoring.trapVolumeSpike && last.c > prev.c && (bodyRatio < 0.35 || upperWick > body * 1.5)
  let shortTrap = ratio >= APP.scoring.trapVolumeSpike && last.c < prev.c && (bodyRatio < 0.35 || lowerWick > body * 1.5)
  let note = "Không có trap rõ"
  if (longTrap && !shortTrap) note = "Cảnh báo bull-trap (volume cao nhưng đóng yếu)"
  if (shortTrap && !longTrap) note = "Cảnh báo bear-trap (volume cao nhưng đóng yếu)"
  if (shortTrap && longTrap) note = "Trap 2 chiều, tránh vào sớm"
  return { longTrap: longTrap, shortTrap: shortTrap, note: note }
}

function detectLiquidityLevels(candles) {
  if (!candles || candles.length < 30) return { eqHigh: null, eqLow: null }
  let recent = candles.slice(-30)
  let highs = recent.map(x => x.h)
  let lows = recent.map(x => x.l)
  let top = Math.max.apply(null, highs)
  let bot = Math.min.apply(null, lows)
  let tolHigh = top * (APP.scoring.equalLevelTolerancePct / 100)
  let tolLow = bot * (APP.scoring.equalLevelTolerancePct / 100)
  let nearHighs = highs.filter(x => Math.abs(x - top) <= tolHigh).length
  let nearLows = lows.filter(x => Math.abs(x - bot) <= tolLow).length
  return {
    eqHigh: nearHighs >= 2 ? top : null,
    eqLow: nearLows >= 2 ? bot : null
  }
}

function buildBuyReferencePlan(data) {
  let candles = data.frameCandles
  if (!candles || candles.length < APP.scoring.minFrameCandles) {
    return { entry: null, sl: null, tp2: null, rr: null }
  }
  let ctx = IndicatorManager.frameContext(candles)
  let atr = ctx.atr || data.price * 0.02
  let swing = ctx.swing
  let entry = ctx.emaFast && ctx.emaFast < data.price ? ctx.emaFast : data.price
  let sl = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
  if (!sl || sl <= 0 || sl >= entry) sl = entry - atr * 1.5
  let risk = entry - sl
  let tp2 = entry + risk * 2
  let rr = risk > 0 ? (tp2 - entry) / risk : null
  return { entry: entry, sl: sl, tp2: tp2, rr: rr }
}

function isSamePlan(a, b) {
  if (!a || !b || !a.entry || !b.entry || !a.stopLoss || !b.sl || !a.tp2 || !b.tp2) return false
  let near = function(x, y) {
    if (!x || !y) return false
    let base = Math.max(1, Math.abs(x), Math.abs(y))
    return Math.abs(x - y) / base < 0.002
  }
  return near(a.entry, b.entry) && near(a.stopLoss, b.sl) && near(a.tp2, b.tp2)
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
    "- Regime: " + (data.regime ? data.regime.regime : "N/A") + " (" + (data.regime ? data.regime.note : "—") + ")\n" +
    "- Trigger: " + (data.entryTrigger ? data.entryTrigger.note : "N/A") + "\n" +
    "- Volume trap: " + (data.volTrap ? data.volTrap.note : "N/A") + "\n" +
    "- Futures context: " +
    (data.futuresContext && data.futuresContext.available
      ? "Funding " +
        (data.futuresContext.fundingPct != null ? data.futuresContext.fundingPct.toFixed(4) + "%" : "N/A") +
        ", OI " +
        (data.futuresContext.openInterest != null ? fmtPrice(data.futuresContext.openInterest) : "N/A") +
        ", L/S " +
        (data.futuresContext.longShortRatio != null ? data.futuresContext.longShortRatio.toFixed(2) : "N/A")
      : "N/A") +
    "\n" +
    "- Vol signal: " + (data.volPulse ? data.volPulse.summary : "N/A") + "\n" +
    "- Vol read: " + (data.volPulse ? data.volPulse.insight : "N/A") + "\n\n" +
    "Trả lời theo format:\n" +
    "1. Xu hướng\n2. Động lượng/RSI\n3. Vùng hành động hợp lý\n4. Rủi ro\n5. Kết luận LONG/SHORT/WAIT (không mâu thuẫn Vol signal)"

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
let futuresContext = await loadFuturesContext(symbol, marketData.market)
let price = n(ticker.lastPrice)
let change = n(ticker.priceChangePercent)
let volume = n(ticker.quoteVolume) / 1000000
let ta = analyzeFrames(marketData.h1, marketData.d1, command.timeframe)
let volPulse = analyzeVolumePulse(marketData.h1)

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
data.volPulse = volPulse
data.futuresContext = futuresContext
data.regime = analyzeRegime(data)
data.entryTrigger = analyzeEntryTrigger(data.frameCandles)
data.volTrap = analyzeVolumeTrap(data.frameCandles)

let plan = setupPlan(data)
let tradePlan = TradePlanManager.build(data)
let buyRefPlan = buildBuyReferencePlan(data)
data.tradePlan = tradePlan
let advice = localAdvice(data)
if (
  data.volPulse &&
  data.volPulse.buybackStrong &&
  data.selectedBias !== "BEARISH" &&
  data.volPulse.buyScore > data.volPulse.sellScore * 1.1 &&
  data.regime &&
  data.regime.regime !== "RANGE" &&
  data.entryTrigger &&
  data.entryTrigger.longConfirmed &&
  (!data.volTrap || !data.volTrap.longTrap)
) {
  advice += " Volume đa khung có dấu hiệu mua lại."
}
let aiText = await askDeepSeek(config, data)
let compactMode = isCompactMode(config)

let msgDiv = APP.telegramSectionDivider
let text = "📊 " + data.symbol + " - PHÂN TÍCH KỸ THUẬT\n"
if (compactMode) {
  text += msgDiv
  text += "🏦 " + data.market + " | ⏱ " + data.timeframe + " | 💰 $" + fmtPrice(data.price) + " (" + data.change.toFixed(2) + "%)\n"
  text += "🧭 " + data.score + "/10 | Bias: " + data.bias + " | " + data.timeframe + ": " + data.selectedBias + "\n"
  if (data.regime) {
    text += "🧱 Regime: " + data.regime.regime + (data.regime.adx != null ? " (ADX " + data.regime.adx.toFixed(1) + ")" : "") + "\n"
  }
  if (data.futuresContext && data.futuresContext.available) {
    text +=
      "🧲 Funding " +
      (data.futuresContext.fundingPct != null ? data.futuresContext.fundingPct.toFixed(4) + "%" : "N/A") +
      " | OI " +
      (data.futuresContext.openInterest != null ? fmtPrice(data.futuresContext.openInterest) : "N/A") +
      " | L/S " +
      (data.futuresContext.longShortRatio != null ? data.futuresContext.longShortRatio.toFixed(2) : "N/A") +
      "\n"
  }
  if (data.volPulse) {
    text += "🔊 Vol signal: " + toSingleLine(data.volPulse.summary, 120) + "\n"
    text += "🧠 Vol read: " + toSingleLine(data.volPulse.insight, 140) + "\n"
  }
  if (data.entryTrigger) text += "🕯 Trigger: " + data.entryTrigger.note + "\n"
  if (data.volTrap) text += "⚠ Trap: " + data.volTrap.note + "\n"
  text += "\n⚡ " + toSingleLine(advice, 120) + "\n"
  text += "🎯 " + toSingleLine(plan.action + " — " + plan.reason, 120) + "\n"
  text +=
    "📌 " + (tradePlan.direction === "SHORT" ? "SHORT" : "Entry") + " " +
    (tradePlan.entry ? "$" + fmtPrice(tradePlan.entry) : "N/A") +
    " | SL " +
    (tradePlan.stopLoss ? "$" + fmtPrice(tradePlan.stopLoss) : "N/A") +
    " | TP2 " +
    (tradePlan.tp2 ? "$" + fmtPrice(tradePlan.tp2) : "N/A") +
    " | R:R " +
    (tradePlan.rr ? "1:" + tradePlan.rr.toFixed(2) : "N/A") +
    "\n"
  let showBuyRef = !isSamePlan(tradePlan, buyRefPlan) || tradePlan.action === "WAIT"
  if (showBuyRef) {
    text +=
      "🟢 BUY ref: Entry " +
      (buyRefPlan.entry ? "$" + fmtPrice(buyRefPlan.entry) : "N/A") +
      " | SL " +
      (buyRefPlan.sl ? "$" + fmtPrice(buyRefPlan.sl) : "N/A") +
      " | TP2 " +
      (buyRefPlan.tp2 ? "$" + fmtPrice(buyRefPlan.tp2) : "N/A") +
      " | R:R " +
      (buyRefPlan.rr ? "1:" + buyRefPlan.rr.toFixed(2) : "N/A") +
      "\n"
  }
  text += "\n✅ Trigger: " + toSingleLine(plan.trigger, 110) + "\n"
  text += "⛔ Invalid: " + toSingleLine(plan.invalidation, 110) + "\n"
  if (aiText) text += "\n🧠 AI:\n" + cleanAiText(aiText) + "\n"
  else text += "🧠 AI: chưa bật API key.\n"
} else {
  text += msgDiv
  text += "🏦 Market: " + data.market + " | ⏱ Khung chính: " + data.timeframe + "\n"
  text += "💰 Giá: $" + fmtPrice(data.price) + " | 📈 24h: " + data.change.toFixed(2) + "% | 🔊 Vol: " + fmtMoney(data.volume * 1000000) + "\n"
  text += "🧭 Score: " + data.score + "/10 | Bias: " + data.bias + " | " + data.timeframe + ": " + data.selectedBias + "\n"
  text += "🧩 Frames: " + data.frames + "\n"
  if (data.regime) text += "🧱 Regime: " + data.regime.regime + " — " + data.regime.note + "\n"
  if (data.futuresContext && data.futuresContext.available) {
    text +=
      "🧲 Futures context: Funding " +
      (data.futuresContext.fundingPct != null ? data.futuresContext.fundingPct.toFixed(4) + "%" : "N/A") +
      " | OI " +
      (data.futuresContext.openInterest != null ? fmtPrice(data.futuresContext.openInterest) : "N/A") +
      " | L/S " +
      (data.futuresContext.longShortRatio != null ? data.futuresContext.longShortRatio.toFixed(2) : "N/A") +
      "\n"
  }
  if (data.volPulse) text += "🔊 Vol signal: " + data.volPulse.summary + " | " + data.volPulse.label + "\n"
  if (data.volPulse) text += "🧠 Vol read: " + data.volPulse.insight + "\n"
  if (data.entryTrigger) text += "🕯 Trigger: " + data.entryTrigger.note + "\n"
  if (data.volTrap) text += "⚠ Trap: " + data.volTrap.note + "\n"
  text += msgDiv
  text += "⚡ Nhận định nhanh:\n"
  text += "→ " + advice + "\n"
  text += msgDiv
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
  text += "• Ghi chú: " + tradePlan.note + "\n"
  text += msgDiv
  if (aiText) {
    text += "🧠 DeepSeek:\n" + aiText + "\n"
  } else {
    text += "🧠 DeepSeek: bỏ qua hoặc chưa cấu hình API key.\n"
  }
}
text += msgDiv
text += "⚠️ Lưu ý: Chỉ tham khảo, không phải lời khuyên đầu tư. Luôn quản trị rủi ro."

try {
  await progress.editText(text)
} catch (e) {
  Bot.sendMessage(text)
}
