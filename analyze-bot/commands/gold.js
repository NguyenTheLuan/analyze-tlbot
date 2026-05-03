/* Command: /gold - Vàng spot XAU/USD (kiểu broker FX / Exness), không dùng PAXG hay cặp crypto */
let CONFIG_KEY = "BOT_CONFIG"

let APP = {
  yahooSymbolXau: "XAUUSD%3DX",
  yahooSymbolGcFutures: "GC%3DF",
  yahooUserAgent: "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0",
  swissquoteXauUrl: "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
  defaultTimeframe: "D1",
  validFrames: { H1: true, H2: true, H4: true, D1: true, D3: true, W1: true },
  httpTimeout: 12000,
  aiTimeout: 15000,
  aiMaxTokens: 520,
  h1Range: "2y",
  d1Range: "10y",
  h1KlineLimit: 240,
  d1KlineLimit: 420,
  telegramChunkMax: 3900,
  frameWeights: { H1: 1, H2: 1, H4: 1.5, D1: 2, D3: 2, W1: 2.5 },
  /* Chỉ báo tối ưu cho XAU/USD: EMA 21/55 (MT4/FX phổ biến), RSI nới nhẹ vì vàng trend dai; nhiệt D1 vs H1 tách bạch */
  scoring: {
    minFrameCandles: 55,
    swingLookback: 20,
    atrPeriod: 14,
    stopAtrBuffer: 0.55,
    pullbackAtr: 0.4,
    minRewardRisk: 1.45,
    emaFast: 21,
    emaSlow: 55,
    rsiPeriod: 14,
    rsiBullMin: 50,
    rsiBullMax: 78,
    rsiHot: 78,
    rsiBearMax: 50,
    rsiBearMin: 22,
    macdFast: 12,
    macdSlow: 26,
    volumeLookback: 20,
    volumeSpike: 1.22,
    hotMoveD1Pct: 1.35,
    tooHotD1Pct: 2.35,
    hotMoveH1Pct: 0.42,
    tooHotH1Pct: 0.72,
    dumpD1Pct: -1.35,
    dumpH1Pct: -0.38,
    adxPeriod: 14,
    stochPeriod: 14,
    stochSmooth: 3,
    scalpRsiLow: 30,
    scalpRsiHigh: 70,
    scalpStochLow: 30,
    scalpStochHigh: 70
  }
}

function isIntradayTf(tf) {
  return tf === "H1" || tf === "H2" || tf === "H4"
}

function heatForPrimaryTf(timeframe, changeD1, changeH1) {
  if (isIntradayTf(timeframe)) {
    return {
      pct: changeH1,
      hot: APP.scoring.hotMoveH1Pct,
      tooHot: APP.scoring.tooHotH1Pct,
      heatDump: APP.scoring.dumpH1Pct,
      label: "H1"
    }
  }
  return {
    pct: changeD1,
    hot: APP.scoring.hotMoveD1Pct,
    tooHot: APP.scoring.tooHotD1Pct,
    heatDump: APP.scoring.dumpD1Pct,
    label: "D1"
  }
}

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
  if (value < 1) return value.toFixed(4)
  if (value < 100) return value.toFixed(2)
  return value.toFixed(2)
}

function splitForTelegram(fullText, maxLen) {
  let max = maxLen || 3900
  if (!fullText || fullText.length <= max) return [fullText]
  let parts = []
  let rest = fullText
  let guard = 0
  while (rest.length > 0 && guard < 30) {
    guard++
    if (rest.length <= max) {
      parts.push(rest)
      break
    }
    let chunk = rest.slice(0, max)
    let cut = chunk.lastIndexOf("\n\n")
    if (cut < Math.floor(max * 0.52)) cut = chunk.lastIndexOf("\n")
    if (cut < Math.floor(max * 0.4)) cut = max
    if (cut < 1) cut = Math.min(max, rest.length)
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest.length && guard >= 30) parts.push(rest)
  return parts
}

async function sendTelegramLong(progressMsg, fullText, chunkMax) {
  let chunks = splitForTelegram(fullText, chunkMax)
  let n = chunks.length
  if (n === 0) return
  let tag = n > 1 ? "\n\n[tin " + 1 + "/" + n + "]" : ""
  try {
    await progressMsg.editText(chunks[0] + tag)
  } catch (e1) {
    Bot.sendMessage(chunks[0] + tag)
  }
  for (let i = 1; i < n; i++) {
    let suffix = "\n\n[tin " + (i + 1) + "/" + n + "]"
    try {
      Bot.sendMessage(chunks[i] + suffix)
    } catch (e2) {
      Bot.sendMessage(chunks[i].slice(0, chunkMax))
    }
  }
}

function parseCommandParams(raw) {
  let out = { timeframe: APP.defaultTimeframe }
  let text = String(raw || "").trim()
  if (!text) return out
  let parts = text.split(/\s+/)
  for (let i = 0; i < parts.length; i++) {
    let frame = parts[i].toUpperCase()
    if (APP.validFrames[frame]) out.timeframe = frame
  }
  return out
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
      qv: part.reduce((sum, x) => sum + (x.qv || x.v), 0)
    })
  }
  return out
}

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
      if (diff >= 0) avgGain += diff
      else avgLoss -= diff
    }
    avgGain /= period
    avgLoss /= period
    for (let i = period + 1; i < values.length; i++) {
      let diff = values[i] - values[i - 1]
      let g = diff >= 0 ? diff : 0
      let l = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + g) / period
      avgLoss = (avgLoss * (period - 1) + l) / period
    }
    if (avgLoss === 0) return 100
    let rs = avgGain / avgLoss
    return 100 - 100 / (1 + rs)
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
    let trList = []
    for (let i = 1; i < candles.length; i++) {
      trList.push(this.trueRangeAt(candles, i))
    }
    if (trList.length < period) return null
    let atr = 0
    for (let i = 0; i < period; i++) atr += trList[i]
    atr /= period
    for (let i = period; i < trList.length; i++) {
      atr = (atr * (period - 1) + trList[i]) / period
    }
    return atr
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
      let dx = den === 0 ? 0 : (100 * Math.abs(lastPdi - lastMdi)) / den
      dxArr.push(dx)
    }
    if (dxArr.length < period) return null
    let adx = 0
    for (let i = 0; i < period; i++) adx += dxArr[i]
    adx /= period
    for (let i = period; i < dxArr.length; i++) {
      adx = (adx * (period - 1) + dxArr[i]) / period
    }
    return { adx: adx, plusDI: lastPdi, minusDI: lastMdi }
  },
  stochLast: function(candles, kPeriod, smooth) {
    if (!candles || candles.length < kPeriod + smooth + 1) return null
    let raw = []
    for (let i = kPeriod - 1; i < candles.length; i++) {
      let slice = candles.slice(i - kPeriod + 1, i + 1)
      let hh = Math.max.apply(null, slice.map(x => x.h))
      let ll = Math.min.apply(null, slice.map(x => x.l))
      let c = candles[i].c
      let den = hh - ll
      raw.push(den <= 0 ? 50 : ((c - ll) / den) * 100)
    }
    if (raw.length < smooth) return null
    let ks = []
    for (let j = smooth - 1; j < raw.length; j++) {
      ks.push(this.sma(raw.slice(j - smooth + 1, j + 1), smooth))
    }
    let k = ks[ks.length - 1]
    let d = ks.length >= 3 ? this.sma(ks.slice(ks.length - 3), 3) : null
    return { k: k, d: d }
  },
  goldExtras: function(candles) {
    if (!candles || candles.length < APP.scoring.minFrameCandles) return null
    let ctx = this.frameContext(candles)
    let close = ctx.last.c
    let atr = ctx.atr || close * 0.005
    let adxBlock = this.adxDiLast(candles, APP.scoring.adxPeriod)
    let st = this.stochLast(candles, APP.scoring.stochPeriod, APP.scoring.stochSmooth)
    let atrPct = close > 0 ? (atr / close) * 100 : null
    let adxLabel = "choppy / sideway"
    if (adxBlock && adxBlock.adx >= 25) {
      adxLabel = adxBlock.plusDI > adxBlock.minusDI ? "xu hướng tăng rõ" : "xu hướng giảm rõ"
    } else if (adxBlock && adxBlock.adx >= 20) {
      adxLabel = adxBlock.plusDI > adxBlock.minusDI ? "nghiêng tăng" : "nghiêng giảm"
    }
    return {
      atrPct: atrPct,
      adx: adxBlock ? adxBlock.adx : null,
      plusDI: adxBlock ? adxBlock.plusDI : null,
      minusDI: adxBlock ? adxBlock.minusDI : null,
      adxLabel: adxLabel,
      stochK: st ? st.k : null,
      stochD: st ? st.d : null
    }
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
      emaSlow:
        closes.length >= APP.scoring.emaSlow ? this.ema(closes, APP.scoring.emaSlow) : null,
      rsi: this.rsi(closes, APP.scoring.rsiPeriod),
      macd: this.macdState(closes),
      candle: this.candleState(candles),
      atr: this.atr(candles, APP.scoring.atrPeriod),
      swing: this.swingLevels(candles, APP.scoring.swingLookback),
      volumeAverage: this.sma(volumes, Math.min(APP.scoring.volumeLookback, volumes.length))
    }
  }
}

function frameSignal(label, candles) {
  if (!candles || candles.length < APP.scoring.minFrameCandles) {
    return { label: label, score: 0, bias: "NEUTRAL", rsi: null, note: "missing" }
  }
  let context = IndicatorManager.frameContext(candles)
  let close = context.last.c
  let currentRsi = context.rsi
  let volBull =
    context.volumeAverage &&
    context.volumeAverage > 0 &&
    context.volumes[context.volumes.length - 1] > context.volumeAverage * APP.scoring.volumeSpike

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

function sliceDataForTf(marketData, targetTf) {
  let ta = analyzeFrames(marketData.h1, marketData.d1, targetTf)
  let heat = heatForPrimaryTf(targetTf, marketData.changeD1, marketData.changeH1)
  let fc = ta.frameCandles
  let px = fc.length ? fc[fc.length - 1].c : marketData.price
  return {
    source: marketData.source,
    timeframe: targetTf,
    price: px,
    taLast: marketData.taLast,
    changeD1: marketData.changeD1,
    changeH1: marketData.changeH1,
    heatPct: heat.pct,
    heatHot: heat.hot,
    heatTooHot: heat.tooHot,
    heatDump: heat.heatDump,
    heatLabel: heat.label,
    spotLineAi: "",
    volume: 0,
    score: ta.score,
    bias: ta.bias,
    selectedBias: ta.selectedBias,
    selectedRsi: ta.selectedRsi,
    frameCandles: ta.frameCandles,
    frames: ta.frames
  }
}

let TradePlanManager = {
  buildShortRef: function(data) {
    let candles = data.frameCandles
    if (!candles || candles.length < APP.scoring.minFrameCandles) {
      return this.empty("Không đủ dữ liệu candles.")
    }
    let context = IndicatorManager.frameContext(candles)
    let atr = context.atr || data.price * 0.005
    let swing = context.swing
    let entry = data.price
    let entryType = "SHORT tham khảo"
    switch (true) {
      case !!(context.emaFast && context.emaFast > data.price):
        entry = context.emaFast
        entryType = "SHORT limit retest EMA21"
        break
      case !!(swing.high && swing.high > data.price):
        entry = swing.high - atr * 0.12
        entryType = "SHORT quanh kháng cự lookback"
        break
      default:
        entry = data.price + atr * 0.22
        entryType = "SHORT chờ yếu / ưu tiên chờ nến"
        break
    }
    let stopLoss = (swing.high || entry) + atr * APP.scoring.stopAtrBuffer
    if (stopLoss <= entry) stopLoss = entry + atr * 1.25
    let risk = stopLoss - entry
    let tp1 = entry - risk * 1.5
    let tp2 = entry - risk * 2
    let tp3 = swing.low ? Math.min(entry - risk * 2.75, swing.low - atr * 0.15) : entry - risk * 3
    let rr = risk > 0 ? (entry - tp2) / risk : 0
    return {
      ok: true,
      direction: "SHORT",
      action: "SHORT tham khảo (CFD) / tránh LONG spot",
      entryType: entryType,
      entry: entry,
      marketEntry: data.price,
      stopLoss: stopLoss,
      tp1: tp1,
      tp2: tp2,
      tp3: tp3,
      rr: rr,
      atr: atr,
      note:
        "Bearish khung chính: không khuyến khích mua đáy. Mức SHORT chỉ cho ai có CFD/hedge; vàng vật lý không short trực tiếp."
    }
  },

  build: function(data) {
    let candles = data.frameCandles
    if (!candles || candles.length < APP.scoring.minFrameCandles) {
      return this.empty("Không đủ dữ liệu candles để tính entry/SL/TP.")
    }

    if (data.selectedBias === "BEARISH") {
      return this.buildShortRef(data)
    }

    let context = IndicatorManager.frameContext(candles)
    let atr = context.atr || data.price * 0.005
    let swing = context.swing
    let entry = data.price
    let entryType = "Chờ xác nhận"
    let stopLoss = null

    switch (true) {
      case data.selectedBias === "BULLISH" && data.heatPct > data.heatHot:
        entry = Math.max((context.emaFast || data.price) - atr, data.price - atr * APP.scoring.pullbackAtr)
        entryType = "Limit pullback"
        stopLoss = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
        break
      case data.selectedBias === "BULLISH":
        entry = context.emaFast && context.emaFast < data.price ? context.emaFast : data.price
        entryType = entry < data.price ? "Limit retest EMA21" : "Market sau nến xác nhận"
        stopLoss = (swing.low || entry - atr) - atr * APP.scoring.stopAtrBuffer
        break
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
      note: action === "WAIT" ? "R:R hoặc bias chưa đủ đẹp, chờ setup rõ hơn." : "Chỉ vào khi có nến xác nhận trên khung chính."
    }
  },
  empty: function(reason) {
    return {
      ok: false,
      direction: "WAIT",
      action: "WAIT",
      entryType: "—",
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

function setupPlan(data) {
  let action = "WAIT"
  let reason = "Chưa đủ xác nhận"

  switch (true) {
    case data.selectedBias === "BULLISH" &&
      data.bias === "BULLISH" &&
      data.score >= 7 &&
      data.heatPct <= data.heatHot:
      action = "LONG theo pullback/confirm"
      reason = "Khung chính và đa khung cùng bullish, nhiệt " + data.heatLabel + " chưa quá mức"
      break
    case data.selectedBias === "BULLISH" && data.heatPct > data.heatHot:
      action = "WAIT pullback"
      reason =
        "Bullish nhưng Δ " + data.heatLabel + " đã nóng (" + data.heatPct.toFixed(3) + "%), tránh đuổi"
      break
    case data.selectedBias === "BEARISH":
      action = "WAIT LONG — xem SHORT tham khảo (CFD)"
      reason = "Khung chính bearish; không ưu tiên mua spot cho đến khi có đảo cấu trúc"
      break
  }

  let trigger =
    data.selectedBias === "BEARISH"
      ? "Chờ " +
        data.timeframe +
        " đóng yếu tại kháng cự / retest EMA21 thất bại hoặc tiếp diễn giảm có xác nhận"
      : "Chờ " + data.timeframe + " đóng nến xác nhận hoặc retest giữ EMA21"
  let invalidation =
    data.selectedBias === "BEARISH"
      ? "Phá vượt swing high / đỉnh gần nhất trên " + data.timeframe + " hoặc đa khung chuyển bullish rõ"
      : "Mất đáy gần nhất trên " + data.timeframe + " hoặc khung chính chuyển bearish"

  return {
    action: action,
    reason: reason,
    trigger: trigger,
    invalidation: invalidation
  }
}

function formatTradePlanCompact(plan, tradePlan, dataCtx, useSpotScale, spotMid, taRef) {
  let tpTag = tradePlan.direction === "SHORT" ? "TP2↓" : "TP2↑"
  let mktRef = tradePlan.marketEntry != null ? tradePlan.marketEntry : dataCtx.price
  let lines = []
  lines.push("• " + plan.action + " — " + plan.reason)
  if (tradePlan.ok) {
    lines.push("• Theo chart: " + tradePlan.action + " — " + tradePlan.entryType)
  }
  lines.push(
    "• Giá TA hiện tại: $" +
      fmtPrice(mktRef) +
      (useSpotScale ? " | spot ~$" + fmtPrice(spotMid) : "")
  )
  if (tradePlan.ok && tradePlan.entry != null) {
    let e =
      "$" +
      fmtPrice(tradePlan.entry) +
      (useSpotScale ? " → spot ~$" + fmtPrice(scaleToSpot(tradePlan.entry, spotMid, taRef)) : "")
    let s =
      "$" +
      fmtPrice(tradePlan.stopLoss) +
      (useSpotScale ? " → ~$" + fmtPrice(scaleToSpot(tradePlan.stopLoss, spotMid, taRef)) : "")
    let t2 =
      "$" +
      fmtPrice(tradePlan.tp2) +
      (useSpotScale ? " → ~$" + fmtPrice(scaleToSpot(tradePlan.tp2, spotMid, taRef)) : "")
    lines.push(
      "• Entry " + e + " | Stop " + s + " | " + tpTag + " " + t2 + " | R:R " + (tradePlan.rr ? "1:" + tradePlan.rr.toFixed(2) : "—")
    )
  } else {
    lines.push("• Entry / SL / TP: — (" + tradePlan.note + ")")
  }
  lines.push("• Kích hoạt: " + plan.trigger)
  lines.push("• Vô hiệu: " + plan.invalidation)
  if (tradePlan.ok && tradePlan.note) lines.push("• Lưu ý: " + tradePlan.note)
  return lines.join("\n")
}

function buildPeakDipCompact(data, marketData) {
  let fc = data.frameCandles
  if (!fc || fc.length < APP.scoring.minFrameCandles) {
    return "• Vùng giá: chưa đủ nến khung chính."
  }
  let ctf = IndicatorManager.frameContext(fc)
  let px = ctf.last.c
  let sh = ctf.swing.high
  let sl = ctf.swing.low
  let d1 = marketData.d1
  let d1c = d1 && d1.length >= 40 ? d1.slice(-90) : null
  let d1ctx = d1c ? IndicatorManager.frameContext(d1c) : null
  let dHigh = d1ctx ? d1ctx.swing.high : null
  let dLow = d1ctx ? d1ctx.swing.low : null
  let rTop = dHigh && dHigh > px ? dHigh : sh && sh > px ? sh : null
  let rBot = dLow && dLow < px ? dLow : sl && sl < px ? sl : null
  let rStr = rTop != null ? "~$" + fmtPrice(rTop) : "—"
  let sStr = rBot != null ? "~$" + fmtPrice(rBot) : "—"
  return "• Neo ~$" + fmtPrice(px) + " | Kháng gần " + rStr + " | Hỗ trợ gần " + sStr + " (vùng TA)."
}

function buildOutlookCompact(data) {
  let ex = data.goldExtras
  let regime = ex && ex.adxLabel ? ex.adxLabel : "—"
  let lines = [
    "• Trạng thái: " + regime + " — 3–5 phiên tới thường bám đuôi trừ khi tin đảo (CPI, Fed, DXY)."
  ]
  switch (data.selectedBias) {
    case "BEARISH":
      lines.push("• Kịch bản: ưu tiên test hỗ trợ / thanh khoản; hồi lên EMA21 có thể là vùng phản kháng nếu đóng yếu.")
      break
    case "BULLISH":
      lines.push("• Kịch bản: pullback có kiểm soát về EMA21/55 trước nhịp tăng; mất swing low gần thì hoãn.")
      break
    default:
      lines.push("• Kịch bản: sideway trong biên tới khi phá + xác nhận.")
  }
  return lines.join("\n")
}

function buildDowStatOneLiner(stats) {
  if (!stats) return ""
  return (
    "• Thống kê D1 (UTC): " +
    GOLD_DOW_VI[stats.maxRangeDow] +
    " hay biên độ TB lớn nhất (~" +
    stats.maxRangeAvg.toFixed(2) +
    "%/ngày trong mẫu) — không phải lịch tin."
  )
}

function buildWeeklyPlanUltraCompact(data, d1) {
  if (!d1 || d1.length < 40) {
    return "• Plan tuần (D1): chưa đủ lịch sử."
  }
  let dSlice = d1.slice(-120)
  let d1Sig = frameSignal("D1", dSlice)
  let wb = d1Sig.bias
  let ctx = IndicatorManager.frameContext(dSlice)
  let em21 = ctx.emaFast
  let hi = ctx.swing.high
  let lo = ctx.swing.low
  let e21 = em21 ? "$" + fmtPrice(em21) : "EMA21"
  let h = hi ? "$" + fmtPrice(hi) : "đỉnh"
  let l = lo ? "$" + fmtPrice(lo) : "đáy"
  switch (wb) {
    case "BEARISH":
      return (
        "• Plan tuần (D1 bear): không bắt đáy chủ động; chờ D1 trên " +
        e21 +
        " hoặc đảo H4. Short CFD ưu tiên retest " +
        e21 +
        "–" +
        h +
        " nếu từ chối (CFD/hedge, không áp vật lý)."
      )
    case "BULLISH":
      return (
        "• Plan tuần (D1 bull): canh mua lọc tại " +
        e21 +
        " / gần " +
        l +
        "; scale-out / short scalp nhẹ quanh " +
        h +
        "."
      )
    default:
      return "• Plan tuần (D1 sideway): biên " + l + " ↔ " + h + ", giảm size tới khi phá rõ."
  }
}

function buildScalpUltraCompact(data) {
  let rsi = data.selectedRsi
  let sk = data.goldExtras && data.goldExtras.stochK != null ? Math.round(data.goldExtras.stochK) : null
  let line1 =
    "• Scalp (30/70): RSI ~" +
    (rsi != null ? rsi : "—") +
    ", Stoch %K ~" +
    (sk != null ? sk : "—") +
    " — theo bias khung chính; không đuổi khi nhiệt quá cao."
  let line2 = isIntradayTf(data.timeframe)
    ? "• Phiên London/NY + spread sàn; SL/TP nhỏ trên M5/M15 tại broker."
    : "• Chạy /gold h1 hoặc h4 để khớp entry nhỏ; M5/M15 chỉ trên chart sàn."
  return line1 + "\n" + line2
}

function localAdvice(data) {
  let rsiText = data.selectedRsi ? "RSI khoảng " + data.selectedRsi : "RSI chưa rõ"
  let h = data.heatPct
  switch (true) {
    case h <= data.heatDump:
      return (
        "Δ " +
        data.heatLabel +
        " yếu/giảm mạnh (" +
        h.toFixed(3) +
        "%), " +
        rsiText +
        "; vàng hay spike rồi hồi — chờ cấu trúc rõ, không bắt dao rơi."
      )
    case h > data.heatTooHot:
      return (
        "Nhiệt Δ " +
        data.heatLabel +
        " rất cao (" +
        h.toFixed(3) +
        "%), " +
        rsiText +
        "; XAU dễ overextend — không đuổi, chờ hồi về EMA21/55 hoặc vùng hỗ trợ."
      )
    case h > data.heatHot:
      return (
        "Δ " +
        data.heatLabel +
        " đã nóng (" +
        h.toFixed(3) +
        "%), " +
        rsiText +
        "; ưu tiên chờ pullback/đóng nến xác nhận, tránh FOMO tin CPI/NFP."
      )
    case data.selectedBias === "BULLISH" && data.bias === "BULLISH":
      return "Đa khung nghiêng bullish, " + rsiText + "; có thể theo dõi setup nếu trigger rõ."
    case data.selectedBias === "BEARISH":
      return (
        "Bearish khung chính, " +
        rsiText +
        "; ưu tiên chờ hồi/retest kháng cự để xem phản ứng hoặc tham khảo SHORT CFD — tránh bắt dao long."
      )
    default:
      return "Tín hiệu chưa thật sự rõ; nên chờ thêm xác nhận."
  }
}

function buildGoldOutlook(data) {
  let ex = data.goldExtras
  let ctx =
    data.frameCandles && data.frameCandles.length >= APP.scoring.minFrameCandles
      ? IndicatorManager.frameContext(data.frameCandles)
      : null
  let sup = ctx && ctx.swing.low ? fmtPrice(ctx.swing.low) : ""
  let res = ctx && ctx.swing.high ? fmtPrice(ctx.swing.high) : ""
  let ema21 = ctx && ctx.emaFast ? fmtPrice(ctx.emaFast) : ""
  let adxStr = ex && ex.adx != null ? ex.adx.toFixed(1) : "—"
  let adxLab = ex ? ex.adxLabel : "—"
  let lines = []

  lines.push(
    "• Xu thế sức mạnh (ADX " +
      adxStr +
      "): " +
      adxLab +
      " — 3–5 phiên tới thường theo đuôi xu hướng này trừ khi có tin đảo (CPI, Fed, DXY)."
  )

  switch (data.selectedBias) {
    case "BEARISH":
      lines.push(
        "• Kịch bản dip: nhiều khả năng test về vùng hỗ trợ gần " +
          (sup || "đáy lookback") +
          " hoặc spike thanh khoản rồi hồi — không gọi đáy sớm."
      )
      lines.push(
        "• Kịch bản hồi: retest EMA21 quanh " +
          (ema21 || "vùng trung bình động") +
          " có thể là vùng phản kháng; nếu đóng yếu → xác suất tiếp giảm cao hơn."
      )
      break
    case "BULLISH":
      lines.push(
        "• Kịch bản tăng: pullback có kiểm soát về EMA21/55 trước khi nhắm lại " +
          (res || "đỉnh gần") +
          "; mất swing low gần nhất thì hoãn kịch bản."
      )
      lines.push("• Kịch bản điều chỉnh: nếu phá mạnh kháng cự + ADX tăng — có thể có nhịp kéo 3–5 phiên theo trend.")
      break
    default:
      lines.push(
        "• Sideway: lướt biên " +
          (sup || "hỗ trợ") +
          " ↔ " +
          (res || "kháng cự") +
          "; chờ phá có xác nhận (đóng nến + tin)."
      )
  }

  lines.push(
    "• Lưu ý lịch: “Thứ 5 / cuối tuần” hay biến động quanh dữ liệu Mỹ — bot không dự báo ngày cụ thể; chỉ kịch bản định tính."
  )
  return lines.join("\n")
}

let GOLD_DOW_VI = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"]

function formatUtcYmd(ms) {
  let d = new Date(ms)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth() + 1
  let day = d.getUTCDate()
  let p = function(n) {
    return n < 10 ? "0" + n : "" + n
  }
  return y + "-" + p(m) + "-" + p(day)
}

function analyzeDowFromD1(d1, maxBars) {
  if (!d1 || d1.length < 24) return null
  let slice = d1.slice(Math.max(0, d1.length - maxBars))
  let sumR = [0, 0, 0, 0, 0, 0, 0]
  let cnt = [0, 0, 0, 0, 0, 0, 0]
  let red = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < slice.length; i++) {
    let c = slice[i]
    let dow = new Date(c.t).getUTCDay()
    let den = c.o > 0 ? c.o : c.c > 0 ? c.c : 1
    let rng = ((c.h - c.l) / den) * 100
    sumR[dow] += rng
    cnt[dow]++
    if (c.c < c.o) red[dow]++
  }
  let avg = []
  let redRate = []
  let maxR = -1
  let maxRDow = 0
  let maxRed = -1
  let maxRedDow = 0
  for (let d = 0; d < 7; d++) {
    if (cnt[d] === 0) {
      avg.push(0)
      redRate.push(0)
      continue
    }
    let a = sumR[d] / cnt[d]
    let rr = red[d] / cnt[d]
    avg.push(a)
    redRate.push(rr)
    if (a > maxR) {
      maxR = a
      maxRDow = d
    }
    if (rr > maxRed) {
      maxRed = rr
      maxRedDow = d
    }
  }
  return {
    n: slice.length,
    rangeAvg: avg,
    redRate: redRate,
    count: cnt,
    maxRangeDow: maxRDow,
    maxRangeAvg: maxR < 0 ? 0 : maxR,
    maxRedDow: maxRedDow,
    maxRedRate: maxRed < 0 ? 0 : maxRed
  }
}

function nextUtcDatesForWeekday(fromBarMs, dowUtc, num) {
  let out = []
  let d = new Date(fromBarMs)
  d.setUTCDate(d.getUTCDate() + 1)
  let guard = 0
  while (out.length < num && guard < 400) {
    if (d.getUTCDay() === dowUtc) {
      out.push(d.getTime())
    }
    d.setUTCDate(d.getUTCDate() + 1)
    guard++
  }
  return out
}

function buildWeeklyBuySellPlan(data, d1) {
  if (!d1 || d1.length < 40) {
    return "• Chưa đủ D1 để lập plan theo tuần (cần thêm lịch sử)."
  }
  let dSlice = d1.slice(-120)
  let d1Sig = frameSignal("D1", dSlice)
  let weekBias = d1Sig.bias
  let ctx = IndicatorManager.frameContext(dSlice)
  let swing = ctx.swing
  let em21 = ctx.emaFast
  let em55 = ctx.emaSlow
  let hi = swing.high
  let lo = swing.low
  let lines = []

  lines.push(
    "🟢 Plan BUY (tuần này + 1–2 tuần kế, khung D1 — neo theo bias D1: " +
      weekBias +
      "; đa khung hiện " +
      data.bias +
      "):"
  )
  switch (weekBias) {
    case "BULLISH":
      lines.push(
        "• Canh mua có lọc: pullback về " +
          (em21 ? "$" + fmtPrice(em21) + " (EMA21 D1)" : "EMA21 D1") +
          " hoặc gần " +
          (lo ? "$" + fmtPrice(lo) + " (swing low gần)" : "hỗ trợ swing") +
          "; xác nhận nến trên H4/H1 trước khi vào full."
      )
      lines.push(
        "• Tránh FOMO khi giá xa EMA21 D1; có thể chia 2 lệnh (ví dụ 40% / 60%) theo nhịp hồi."
      )
      break
    case "BEARISH":
      lines.push(
        "• Không chủ động bắt đáy: chờ D1 đóng lấy lại trên " +
          (em21 ? "$" + fmtPrice(em21) : "EMA21") +
          " hoặc cấu trúc đảo rõ (HH/HL trên H4)."
      )
      lines.push(
        "• Nếu chỉ trade bounce ngắn: SL chặt dưới " +
          (lo ? "$" + fmtPrice(lo) : "đáy") +
          " — rủi ro cao."
      )
      break
    default:
      lines.push(
        "• Sideway: ưu tiên mua sát " +
          (lo ? "$" + fmtPrice(lo) : "biên dưới range") +
          "; giảm size nếu chưa phá " +
          (hi ? "$" + fmtPrice(hi) : "kháng cự") +
          "."
      )
  }

  lines.push("")
  lines.push("🔴 Plan SELL (chốt lời / short CFD — không áp vàng vật lý):")
  switch (weekBias) {
    case "BEARISH":
      lines.push(
        "• Short CFD ưu tiên trên retest kháng cự: " +
          (em21 && em21 > 0 ? "$" + fmtPrice(em21) + "–" : "") +
          (hi ? "$" + fmtPrice(hi) : "đỉnh lookback") +
          " nếu nến từ chối; SL trên đỉnh sóng."
      )
      lines.push("• Đang long spot: cân nhắc chốt một phần hoặc hedge khi khung chính bearish.")
      break
    case "BULLISH":
      lines.push(
        "• Scale-out gần " +
          (hi ? "$" + fmtPrice(hi) : "vùng supply/đỉnh") +
          "; short chỉ scalp khi quá mua H1/H4, không đánh ngược trend D1."
      )
      break
    default:
      lines.push(
        "• Range: canh chốt/short nhẹ tại " +
          (hi ? "$" + fmtPrice(hi) : "kháng cự trên") +
          ", cover gần " +
          (lo ? "$" + fmtPrice(lo) : "hỗ trợ") +
          "."
      )
  }

  if (em55) {
    lines.push(
      "• Neo tuần: EMA55 D1 ~ $" + fmtPrice(em55) + " — giữ trên thường ủng hộ bias bull tuần; mất có thể chuyển sang plan phòng thủ."
    )
  }
  return lines.join("\n")
}

function buildDowDipForecast(d1, stats) {
  if (!stats || !d1 || d1.length < 24) {
    return "• Chưa đủ D1 để thống kê ‘ngày nào dễ dip’."
  }
  let lastT = d1[d1.length - 1].t
  let lastD = new Date(lastT)
  let lines = []

  lines.push(
    "• Mốc thời gian: thứ trong tuần tính theo UTC (bảng D1 Yahoo). Giờ VN có thể lệch khi so ‘Thứ …’ địa phương."
  )
  lines.push(
    "• Phiên D1 cuối trong dữ liệu: " +
      GOLD_DOW_VI[lastD.getUTCDay()] +
      " " +
      formatUtcYmd(lastT) +
      " (UTC)."
  )
  lines.push(
    "• " +
      stats.n +
      " phiên gần nhất: biên độ TB lớn nhất vào " +
      GOLD_DOW_VI[stats.maxRangeDow] +
      " (~" +
      stats.maxRangeAvg.toFixed(2) +
      "% range/ngày) — ngày hay biến động trong mẫu lịch sử."
  )
  lines.push(
    "• Tỷ lệ nến đỏ (đóng < mở) cao nhất: " +
      GOLD_DOW_VI[stats.maxRedDow] +
      " (~" +
      (stats.maxRedRate * 100).toFixed(0) +
      "% phiên đỏ) — hay ‘yếu/rũ’ trong quá khứ, không phải lịch tin."
  )

  let nextVol = nextUtcDatesForWeekday(lastT, stats.maxRangeDow, 3)
  let nextRed = nextUtcDatesForWeekday(lastT, stats.maxRedDow, 3)
  lines.push(
    "• Các ngày (UTC) tiếp theo trùng " +
      GOLD_DOW_VI[stats.maxRangeDow] +
      " (thường biến động mạnh trong lịch sử): " +
      nextVol.map(formatUtcYmd).join(", ")
  )
  if (stats.maxRedDow !== stats.maxRangeDow) {
    lines.push(
      "• Các ngày (UTC) tiếp theo trùng " +
        GOLD_DOW_VI[stats.maxRedDow] +
        " (nhiều nến đỏ trong mẫu): " +
        nextRed.map(formatUtcYmd).join(", ")
    )
  }

  lines.push(
    "• ⚠️ Không khẳng định ‘Thứ 5 chắc dip’: chỉ xác suất theo dữ liệu + lịch tuần; tin Mỹ / DXY có thể phá pattern."
  )
  return lines.join("\n")
}

function buildPeakDipZones(data, marketData) {
  let fc = data.frameCandles
  if (!fc || fc.length < APP.scoring.minFrameCandles) {
    return "• Chưa đủ nến khung chính để ước lượng đỉnh/dip."
  }
  let ctf = IndicatorManager.frameContext(fc)
  let px = ctf.last.c
  let atr = ctf.atr || px * 0.005
  let sh = ctf.swing.high
  let sl = ctf.swing.low

  let d1 = marketData.d1
  let d1c = d1 && d1.length >= 40 ? d1.slice(-90) : null
  let d1ctx = d1c ? IndicatorManager.frameContext(d1c) : null
  let dHigh = d1ctx ? d1ctx.swing.high : null
  let dLow = d1ctx ? d1ctx.swing.low : null

  let lines = []
  lines.push("• Neo hiện tại (đóng nến cuối, khung " + data.timeframe + "): ~$" + fmtPrice(px))

  let res = []
  if (sh && sh > px + atr * 0.02) res.push({ v: sh, t: "đỉnh lookback " + data.timeframe })
  if (dHigh && dHigh > px + atr * 0.02 && (!sh || Math.abs(dHigh - sh) > atr * 0.08)) {
    res.push({ v: dHigh, t: "swing cao D1" })
  }
  res.push({ v: px + atr * 0.65, t: "mở rộng +0.65·ATR (vượt ngắn)" })
  res.push({ v: px + atr * 1.25, t: "mở rộng +1.25·ATR (break mạnh hơn)" })
  res.sort(function(a, b) {
    return a.v - b.v
  })

  lines.push("• Kháng cự / vùng đỉnh tham chiếu (trên giá):")
  let seenR = {}
  let nr = 0
  for (let i = 0; i < res.length && nr < 5; i++) {
    let key = "" + Math.round(res[i].v * 100)
    if (seenR[key]) continue
    seenR[key] = true
    nr++
    lines.push("  ◦ ~$" + fmtPrice(res[i].v) + " — " + res[i].t)
  }

  let sup = []
  if (sl && sl < px - atr * 0.02) sup.push({ v: sl, t: "đáy lookback " + data.timeframe })
  if (dLow && dLow < px - atr * 0.02 && (!sl || Math.abs(dLow - sl) > atr * 0.08)) {
    sup.push({ v: dLow, t: "swing thấp D1" })
  }
  if (ctf.emaFast && ctf.emaFast < px - atr * 0.02) {
    sup.push({ v: ctf.emaFast, t: "EMA21 " + data.timeframe })
  }
  sup.push({ v: px - atr * 0.72, t: "dip nông ~0.72·ATR" })
  sup.push({ v: px - atr * 1.28, t: "dip sâu ~1.28·ATR" })
  if (d1ctx && d1ctx.emaSlow && d1ctx.emaSlow < px) {
    sup.push({ v: d1ctx.emaSlow, t: "EMA55 D1 (hỗ trợ xu hướng tuần)" })
  }
  sup.sort(function(a, b) {
    return b.v - a.v
  })

  lines.push("• Hỗ trợ / vùng dip tham chiếu (dưới giá):")
  let seenS = {}
  let ns = 0
  for (let i = 0; i < sup.length && ns < 6; i++) {
    let key = "" + Math.round(sup[i].v * 100)
    if (seenS[key]) continue
    seenS[key] = true
    ns++
    lines.push("  ◦ ~$" + fmtPrice(sup[i].v) + " — " + sup[i].t)
  }

  if (dHigh && dLow && dHigh > dLow + atr * 0.05) {
    let r = dHigh - dLow
    lines.push(
      "• Fib retracement trong range D1 gần ($" + fmtPrice(dLow) + " → $" + fmtPrice(dHigh) + "), đo từ đỉnh xuống:"
    )
    lines.push("  ◦ 38.2%: ~$" + fmtPrice(dHigh - r * 0.382) + " | 50%: ~$" + fmtPrice(dHigh - r * 0.5))
    lines.push("  ◦ 61.8%: ~$" + fmtPrice(dHigh - r * 0.618) + " (dip sâu trong range)")
  }

  lines.push(
    "• ⚠️ Không phải dự đoán ‘chạm đỉnh chắc / đáy chắc’: chỉ vùng TA; tin và thanh khoản có thể đẩy vượt mọi mức."
  )
  return lines.join("\n")
}

function buildScalpIntradayHint(data) {
  let ex = data.goldExtras
  let rsi = data.selectedRsi
  let L = APP.scoring.scalpRsiLow
  let H = APP.scoring.scalpRsiHigh
  let sL = APP.scoring.scalpStochLow
  let sH = APP.scoring.scalpStochHigh
  let lines = []

  lines.push(
    "• Neo cổ điển: RSI " +
      L +
      "/" +
      H +
      ", Stoch %K " +
      sL +
      "/" +
      sH +
      " — mean-reversion; XAU hay ‘dính’ vùng quá mua/bán khi trend mạnh."
  )

  if (rsi != null) {
    if (rsi <= L) {
      lines.push(
        "• RSI ~" +
          rsi +
          " ≤ " +
          L +
          ": canh bounce scalp chỉ khi có nến xác nhận + SL dưới swing nhỏ; TP về EMA21 / giữa range — tránh trước giờ tin."
      )
    } else if (rsi >= H) {
      lines.push(
        "• RSI ~" +
          rsi +
          " ≥ " +
          H +
          ": không long đuổi; fade/short scalp (CFD) cần rejection giá rõ — RSI có thể lì trên " +
          H +
          " trong sóng tăng."
      )
    } else {
      lines.push(
        "• RSI ~" + rsi + " giữa " + L + "–" + H + ": scalp ưu tiên theo bias + Stoch, không đoán đỉnh đáy sớm."
      )
    }
  }

  if (ex && ex.stochK != null) {
    if (ex.stochK <= sL) {
      lines.push(
        "• Stoch %K ~" +
          Math.round(ex.stochK) +
          " thấp: nhịp hồi kỹ thuật; gợi ý chờ %K cắt lên %D hoặc H1 phá high nhỏ trước khi vào."
      )
    } else if (ex.stochK >= sH) {
      lines.push(
        "• Stoch %K ~" +
          Math.round(ex.stochK) +
          " cao: ưu tiên buy pullback hoặc đứng ngoài — short scalp ngược sóng dễ quét SL."
      )
    }
  }

  if (isIntradayTf(data.timeframe)) {
    lines.push(
      "• Khung " + data.timeframe + ": gần với scalp trong ngày; lọc theo spread thực tế + phiên London/NY."
    )
  } else {
    lines.push(
      "• Khung " +
        data.timeframe +
        ": bối cảnh lớn; scalp trong ngày nên chạy thêm /gold h1 hoặc h4 để khớp entry nhỏ."
    )
    lines.push("• Phiên: London + NY thường dẫn biên độ intraday — lọc theo spread thực tế trên sàn.")
  }

  lines.push(
    "• M5/M15: bot không tải nến đó — dùng chart sàn đặt SL/TP; các mức đỉnh/dip trong tin nhắn là tham chiếu."
  )
  return lines.join("\n")
}

async function fetchYahooChart(symbolEncoded, interval, range) {
  let url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    symbolEncoded +
    "?interval=" +
    interval +
    "&range=" +
    range

  let response = await HTTP.get({
    url: url,
    timeout: APP.httpTimeout,
    headers: { "User-Agent": APP.yahooUserAgent }
  })

  if (!response || !response.ok || !response.data) return { ok: false }

  let chart = response.data.chart
  if (!chart || chart.error || !chart.result || !chart.result[0]) return { ok: false }

  let r = chart.result[0]
  let ts = r.timestamp
  let q = r.indicators && r.indicators.quote && r.indicators.quote[0]
  if (!ts || !q || !Array.isArray(ts)) return { ok: false }

  let candles = []
  for (let i = 0; i < ts.length; i++) {
    let o = q.open[i]
    let h = q.high[i]
    let l = q.low[i]
    let c = q.close[i]
    let v = q.volume[i]
    if (o == null || h == null || l == null || c == null) continue
    candles.push({
      t: n(ts[i]) * 1000,
      o: n(o),
      h: n(h),
      l: n(l),
      c: n(c),
      v: v != null ? n(v) : 0,
      qv: v != null ? n(v) : 0
    })
  }

  if (candles.length < APP.scoring.minFrameCandles) return { ok: false }

  let meta = r.meta || {}
  return { ok: true, candles: candles, meta: meta }
}

function sliceLast(candles, maxLen) {
  if (!candles || candles.length <= maxLen) return candles
  return candles.slice(candles.length - maxLen)
}

function changeFromDaily(d1) {
  if (!d1 || d1.length < 2) return 0
  let last = d1[d1.length - 1].c
  let prev = d1[d1.length - 2].c
  if (prev <= 0) return 0
  return ((last - prev) / prev) * 100
}

function changeFromLastTwoBars(candles) {
  if (!candles || candles.length < 2) return 0
  let last = candles[candles.length - 1].c
  let prev = candles[candles.length - 2].c
  if (prev <= 0) return 0
  return ((last - prev) / prev) * 100
}

async function fetchSwissquoteSpot() {
  let response = await HTTP.get({
    url: APP.swissquoteXauUrl,
    timeout: APP.httpTimeout,
    headers: { "User-Agent": APP.yahooUserAgent }
  })
  if (!response || !response.ok || !Array.isArray(response.data) || response.data.length < 1) {
    return null
  }
  let spreads = response.data[0].spreadProfilePrices
  if (!spreads || spreads.length < 1) return null
  let p = spreads[0]
  let bid = n(p.bid)
  let ask = n(p.ask)
  if (bid <= 0 || ask <= 0) return null
  return { bid: bid, ask: ask, mid: (bid + ask) / 2 }
}

function scaleToSpot(level, spotMid, taRef) {
  if (level == null || spotMid == null || taRef == null || taRef <= 0) return level
  return level * (spotMid / taRef)
}

async function loadYahooGoldSeries(symbolEncoded, sourceLabel) {
  let h1full = await fetchYahooChart(symbolEncoded, "1h", APP.h1Range)
  if (!h1full.ok) {
    h1full = await fetchYahooChart(symbolEncoded, "1h", "1y")
  }
  let d1full = await fetchYahooChart(symbolEncoded, "1d", APP.d1Range)
  if (!d1full.ok) {
    d1full = await fetchYahooChart(symbolEncoded, "1d", "5y")
  }
  if (!h1full.ok || !d1full.ok) return { ok: false }

  let h1 = sliceLast(h1full.candles, APP.h1KlineLimit)
  let d1 = sliceLast(d1full.candles, APP.d1KlineLimit)
  let taLast = h1.length ? h1[h1.length - 1].c : d1[d1.length - 1].c
  let price = taLast
  let changeD1 = changeFromDaily(d1full.candles)
  let changeH1 = changeFromLastTwoBars(h1)

  return {
    ok: true,
    source: sourceLabel,
    h1: h1,
    d1: d1,
    price: price,
    taLast: taLast,
    change: changeD1,
    changeD1: changeD1,
    changeH1: changeH1,
    volume: 0
  }
}

async function loadGoldData() {
  let xau = await loadYahooGoldSeries(
    APP.yahooSymbolXau,
    "Yahoo · XAU/USD (spot FX — broker kiểu Exness/OANDA, không phải token/crypto)"
  )
  if (xau.ok) {
    xau.spot = await fetchSwissquoteSpot()
    xau.taKind = "SPOT_XAU"
    return xau
  }

  let gc = await loadYahooGoldSeries(
    APP.yahooSymbolGcFutures,
    "Yahoo · GC=F (COMEX vàng tương lai — KHÁC spot XAU/OANDA; có thể lệch vài chục USD/oz)"
  )
  if (gc.ok) {
    gc.spot = await fetchSwissquoteSpot()
    gc.taKind = "COMEX_GC"
    return gc
  }

  return { ok: false }
}

async function askDeepSeek(config, data, marketData) {
  if (!config || !config.deepseek_api_key) return ""

  let zones = buildPeakDipCompact(data, marketData)
  let outlook = buildOutlookCompact(data)
  let dowL = data.dowStats ? buildDowStatOneLiner(data.dowStats) : ""
  let weekL = buildWeeklyPlanUltraCompact(data, marketData.d1)
  let scalpL = buildScalpUltraCompact(data)

  let prompt =
    "Bạn là trader XAU/USD (spot hoặc GC=F nếu nguồn ghi). Trả lời tiếng Việt CỰC GỌN: tối đa 550 ký tự, 4–5 gạch đầu dòng ngắn.\n" +
    "Không hứa lợi nhuận; không bịa tin vĩ mô; không thêm mức giá mới ngoài dữ liệu.\n" +
    "Dữ liệu tóm tắt:\n" +
    "- " +
    data.source +
    "\n" +
    (data.spotLineAi ? "- " + data.spotLineAi + "\n" : "") +
    "- TA đóng H1 cuối ~$" +
    fmtPrice(data.taLast) +
    " | Δ H1 " +
    data.changeH1.toFixed(3) +
    "% | Δ D1 " +
    data.changeD1.toFixed(3) +
    "%\n" +
    "- Khung " +
    data.timeframe +
    ": " +
    data.selectedBias +
    ", RSI ~" +
    (data.selectedRsi || "—") +
    " | Đa khung " +
    data.bias +
    " | Score " +
    data.score +
    "/10\n" +
    "- Frames: " +
    data.frames +
    "\n" +
    (data.goldExtras && data.goldExtras.atrPct != null ? "- ATR% " + data.goldExtras.atrPct.toFixed(3) + "%\n" : "") +
    (data.goldExtras && data.goldExtras.adx != null
      ? "- ADX " +
        data.goldExtras.adx.toFixed(1) +
        " (" +
        data.goldExtras.adxLabel +
        ") | Stoch %K " +
        (data.goldExtras.stochK != null ? data.goldExtras.stochK.toFixed(0) : "—") +
        "\n"
      : "") +
    "- " +
    zones.replace(/^• /, "") +
    "\n" +
    "- " +
    outlook.replace(/^• /, "").replace(/\n• /g, " | ") +
    "\n" +
    (dowL ? "- " + dowL.replace(/^• /, "") + "\n" : "") +
    "- " +
    weekL.replace(/^• /, "") +
    "\n" +
    "- " +
    scalpL.replace(/^• /, "").replace(/\n• /g, " | ") +
    "\n" +
    "- Entry/SL/TP2/R:R (rule bot, khung chính): " +
    (data.tradePlan && data.tradePlan.entry
      ? "$" +
        fmtPrice(data.tradePlan.entry) +
        " / $" +
        fmtPrice(data.tradePlan.stopLoss) +
        " / $" +
        fmtPrice(data.tradePlan.tp2) +
        " / " +
        (data.tradePlan.rr ? "1:" + data.tradePlan.rr.toFixed(2) : "—")
      : "N/A") +
    "\n" +
    (isIntradayTf(data.timeframe) && data.tradePlanWeek && data.tradePlanWeek.entry
      ? "- Neo D1 thêm: $" +
        fmtPrice(data.tradePlanWeek.entry) +
        " / SL $" +
        fmtPrice(data.tradePlanWeek.stopLoss) +
        " / TP2 $" +
        fmtPrice(data.tradePlanWeek.tp2) +
        "\n"
      : "") +
    "\nNội dung cần có (ngắn): xu hướng tổng; WAIT vs LONG vs SHORT CFD; 1 dòng rủi ro (spread/phiên). Không nhắc lại toàn bộ số đã liệt kê."

  try {
    let response = await HTTP.post({
      url: "https://api.deepseek.com/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.deepseek_api_key
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

let config = loadConfig()
let command = parseCommandParams(params)

let progress = await Bot.sendMessage("Đang lấy XAU/USD (spot FX)…")
let marketData = await loadGoldData()

if (!marketData.ok) {
  await progress.editText(
    "Không lấy được dữ liệu vàng (đã thử XAU/USD spot và GC=F). Kiểm tra mạng hoặc thử lại sau. Không dùng cặp crypto."
  )
  return
}

await progress.editText("Đang phân tích XAU — " + marketData.source + ", khung " + command.timeframe + "...")

let ta = analyzeFrames(marketData.h1, marketData.d1, command.timeframe)

let heat = heatForPrimaryTf(command.timeframe, marketData.changeD1, marketData.changeH1)

let spotLineAi = ""
if (marketData.spot) {
  spotLineAi =
    "- Spot XAU/USD (Swissquote BBO mid ~ broker FX): bid " +
    fmtPrice(marketData.spot.bid) +
    " / ask " +
    fmtPrice(marketData.spot.ask) +
    " → mid $" +
    fmtPrice(marketData.spot.mid)
}

let data = {
  source: marketData.source,
  timeframe: command.timeframe,
  price: marketData.price,
  taLast: marketData.taLast,
  changeD1: marketData.changeD1,
  changeH1: marketData.changeH1,
  heatPct: heat.pct,
  heatHot: heat.hot,
  heatTooHot: heat.tooHot,
  heatDump: heat.heatDump,
  heatLabel: heat.label,
  spotLineAi: spotLineAi,
  volume: 0,
  score: ta.score,
  bias: ta.bias,
  selectedBias: ta.selectedBias,
  selectedRsi: ta.selectedRsi,
  frameCandles: ta.frameCandles,
  frames: ta.frames
}

data.goldExtras = IndicatorManager.goldExtras(data.frameCandles)

let plan = setupPlan(data)
let tradePlan = TradePlanManager.build(data)
data.tradePlan = tradePlan
let dataD1Slice = sliceDataForTf(marketData, "D1")
let planWeek = setupPlan(dataD1Slice)
let tradeWeek = TradePlanManager.build(dataD1Slice)
data.tradePlanWeek = tradeWeek
data.dowStats = analyzeDowFromD1(marketData.d1, 120)
let advice = localAdvice(data)
let aiText = await askDeepSeek(config, data, marketData)

let spotMid = marketData.spot ? marketData.spot.mid : null
let useSpotScale =
  spotMid != null && marketData.taKind === "COMEX_GC" && marketData.taLast > 0 && Math.abs(spotMid - marketData.taLast) > 2

let text = "🥇 XAU / VÀNG — PHÂN TÍCH KỸ THUẬT\n"
text += "📡 " + marketData.source + "\n"
if (marketData.spot) {
  text +=
    "💵 Spot: " +
    fmtPrice(marketData.spot.bid) +
    " – " +
    fmtPrice(marketData.spot.ask) +
    " | mid ≈ $" +
    fmtPrice(marketData.spot.mid) +
    "\n"
}
text += "📈 TA (đóng H1 cuối): $" + fmtPrice(marketData.taLast) + "/oz\n"
text +=
  "📊 Δ H1 " +
  marketData.changeH1.toFixed(3) +
  "% | Δ D1 " +
  marketData.changeD1.toFixed(3) +
  "%\n"
if (marketData.taKind === "COMEX_GC") {
  text += "ℹ️ GC=F lệch spot broker; % ngắn hạn gần Δ H1 hơn Δ D1.\n"
}
text += "⏱ Khung chính: " + data.timeframe + "\n"
text +=
  "🧭 " +
  data.score +
  "/10 | Đa khung " +
  data.bias +
  " | " +
  data.timeframe +
  ": " +
  data.selectedBias +
  "\n"
text += "🧩 " + data.frames + "\n"
if (
  data.goldExtras &&
  (data.goldExtras.adx != null || data.goldExtras.atrPct != null || data.goldExtras.stochK != null)
) {
  let ix = []
  if (data.goldExtras.atrPct != null) ix.push("ATR% " + data.goldExtras.atrPct.toFixed(3) + "%")
  if (data.goldExtras.adx != null) {
    ix.push(
      "ADX " +
        data.goldExtras.adx.toFixed(1) +
        " (" +
        data.goldExtras.adxLabel +
        ", +DI " +
        data.goldExtras.plusDI.toFixed(0) +
        "/-" +
        data.goldExtras.minusDI.toFixed(0) +
        ")"
    )
  }
  if (data.goldExtras.stochK != null) {
    ix.push(
      "Stoch %K " +
        data.goldExtras.stochK.toFixed(0) +
        (data.goldExtras.stochD != null ? "/%D " + data.goldExtras.stochD.toFixed(0) : "")
    )
  }
  if (ix.length) text += "📐 " + ix.join(" · ") + "\n"
}

text += "\n📋 Phân tích\n"
text += "→ " + advice + "\n"
text += buildPeakDipCompact(data, marketData) + "\n"
text += buildOutlookCompact(data) + "\n"
if (data.dowStats) text += buildDowStatOneLiner(data.dowStats) + "\n"

text += "\n📈 Xu hướng\n\n"
text += "Trong ngày:\n"
text += buildScalpUltraCompact(data) + "\n"
if (isIntradayTf(data.timeframe)) {
  text +=
    formatTradePlanCompact(plan, tradePlan, data, useSpotScale, spotMid, marketData.taLast) + "\n"
} else {
  text += "• H1: xem 🧩 Frames; Δ H1 " + marketData.changeH1.toFixed(3) + "%.\n"
}

text += "\nTrong tuần:\n"
text += buildWeeklyPlanUltraCompact(data, marketData.d1) + "\n"
if (isIntradayTf(data.timeframe)) {
  text +=
    formatTradePlanCompact(planWeek, tradeWeek, dataD1Slice, useSpotScale, spotMid, marketData.taLast) +
    "\n"
} else {
  text += formatTradePlanCompact(plan, tradePlan, data, useSpotScale, spotMid, marketData.taLast) + "\n"
}

if (aiText) {
  text += "\n🧠 Phân tích (AI):\n" + aiText + "\n\n"
} else {
  text += "\n🧠 Phân tích (AI): chưa bật API key.\n\n"
}

text +=
  "⚠️ XAU/USD là FX; spread và giờ phiên ảnh hưởng lớn. Chỉ tham khảo, không phải lời khuyên đầu tư."

await sendTelegramLong(progress, text, APP.telegramChunkMax)
