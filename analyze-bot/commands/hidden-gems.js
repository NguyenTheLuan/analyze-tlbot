/* Command: /hidden-gems (TeleBotHost có thể alias /h → cùng file). Meme DEX: DexScreener boosts/profiles, fallback GeckoTerminal trending nếu chain không có boost — ví dụ Base. */
let CONFIG_KEY = "BOT_CONFIG"

let APP = {
  dexBaseUrl: "https://api.dexscreener.com",
  geckoBaseUrl: "https://api.geckoterminal.com/api/v2",
  goplusBaseUrl: "https://api.gopluslabs.io/api/v1",
  defaultChain: "solana",
  httpTimeout: 12000,
  goplusTimeout: 10000,
  pickCount: 4,
  seedCap: 22,
  seedCapAll: 30,
  batchTokens: 4,
  scanChainsAll: {
    ethereum: true,
    bsc: true,
    solana: true,
    base: true,
    ton: true
  },
  telegramSafeLimit: 3800,
  telegramSectionDivider: "------------------------------\n",
  aiTimeout: 10000,
  aiMaxTokens: 280,
  maxTaxPct: 12,
  topHolderFraction: 0.35,
  quoteSymbols: {
    ETH: true,
    WETH: true,
    USDC: true,
    USDT: true,
    DAI: true,
    USDD: true,
    BUSD: true,
    SOL: true,
    BNB: true,
    WBNB: true,
    TON: true,
    WBTC: true,
    BTC: true
  },
  stableBases: {
    USDC: true,
    USDT: true,
    DAI: true,
    BUSD: true,
    FDUSD: true,
    USDD: true,
    TUSD: true,
    PYUSD: true
  },
  filterSurvivor: {
    minLiquidityUsd: 18000,
    minVolumeH24: 35000,
    maxVolLiquidityRatio: 42,
    minPoolAgeMs: Math.floor(92 * 24 * 60 * 60 * 1000),
    minTxnsH24: 28,
    minFdvUsd: 15000,
    maxFdvUsd: 450000000,
    maxAbsPriceChangeH24: 2400
  },
  filterAggressive: {
    minLiquidityUsd: 22000,
    minVolumeH24: 42000,
    maxVolLiquidityRatio: 56,
    minPoolAgeMs: 3 * 60 * 60 * 1000,
    minTxnsH24: 32,
    minFdvUsd: 12000,
    maxFdvUsd: 600000000,
    maxAbsPriceChangeH24: 3500
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

function fmtUsd(x) {
  let v = n(x)
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B"
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M"
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K"
  return "$" + Math.round(v)
}

function normalizeDexChain(raw) {
  let x = String(raw || "").trim().toLowerCase()
  let map = {
    sol: "solana",
    solana: "solana",
    eth: "ethereum",
    ethereum: "ethereum",
    base: "base",
    bsc: "bsc",
    bnb: "bsc",
    binance: "bsc",
    arb: "arbitrum",
    arbitrum: "arbitrum",
    polygon: "polygon",
    matic: "polygon",
    opti: "optimism",
    optimism: "optimism",
    avax: "avalanche",
    avalanche: "avalanche",
    ton: "ton"
  }
  return map[x] || APP.defaultChain
}

function parseParams(raw) {
  let parts = String(raw || "").trim().split(/\s+/).filter(Boolean)
  let profile = "survivor"
  let chainToks = []

  for (let i = 0; i < parts.length; i++) {
    let low = parts[i].toLowerCase()
    if (low === "aggressive" || low === "agg" || low === "sniper") {
      profile = "aggressive"
      continue
    }
    if (low === "survivor" || low === "safe") {
      profile = "survivor"
      continue
    }
    chainToks.push(parts[i])
  }

  if (chainToks.length === 0) {
    return { mode: "all", profile: profile }
  }
  return { mode: "single", chain: normalizeDexChain(chainToks[0]), profile: profile }
}

function activeFilter(profileName) {
  return profileName === "aggressive" ? APP.filterAggressive : APP.filterSurvivor
}

function sameBaseAddress(chainId, a, b) {
  if (!a || !b) return false
  if (chainId === "solana") return String(a) === String(b)
  return String(a).toLowerCase() === String(b).toLowerCase()
}

function quoteOk(pair) {
  let q = pair.quoteToken && pair.quoteToken.symbol
  if (!q) return false
  return !!APP.quoteSymbols[String(q).toUpperCase()]
}

function stableBase(pair) {
  let s = pair.baseToken && pair.baseToken.symbol
  if (!s) return false
  return !!APP.stableBases[String(s).toUpperCase()]
}

function getGoPlusChainNum(dexChain) {
  let m = {
    ethereum: 1,
    bsc: 56,
    polygon: 137,
    arbitrum: 42161,
    base: 8453,
    optimism: 10,
    avalanche: 43114
  }
  return m[dexChain] !== undefined ? m[dexChain] : null
}

function geckoSlugForDexChain(dexChainId) {
  let m = {
    ethereum: "eth",
    bsc: "bsc",
    solana: "solana",
    base: "base",
    ton: "ton",
    arbitrum: "arbitrum",
    polygon: "polygon_pos",
    optimism: "optimism",
    avalanche: "avax"
  }
  return m[dexChainId] !== undefined ? m[dexChainId] : null
}

function buildGeckoIncludedMap(included) {
  let map = {}
  if (!Array.isArray(included)) return map

  for (let i = 0; i < included.length; i++) {
    let x = included[i]
    if (x && x.id) map[x.id] = x
  }

  return map
}

async function collectSeedsFromGeckoTrending(dexChainId, cap) {
  let slug = geckoSlugForDexChain(dexChainId)
  if (!slug) return []

  let url =
    APP.geckoBaseUrl +
    "/networks/" +
    slug +
    "/trending_pools?page=1&include=base_token"

  let body = await getJson(url, APP.httpTimeout)
  if (!body || !Array.isArray(body.data)) return []

  let inc = buildGeckoIncludedMap(body.included)
  let seen = {}
  let out = []

  for (let i = 0; i < body.data.length; i++) {
    let pool = body.data[i]
    let rel = pool.relationships && pool.relationships.base_token && pool.relationships.base_token.data
    if (!rel || !rel.id) continue

    let tok = inc[rel.id]
    if (!tok || !tok.attributes || !tok.attributes.address) continue

    let addr = String(tok.attributes.address).trim()
    if (!addr) continue

    let key = dexChainId + "_" + (dexChainId === "solana" ? addr : addr.toLowerCase())
    if (seen[key]) continue
    seen[key] = true

    let sym = tok.attributes.symbol || ""
    let poolName = pool.attributes && pool.attributes.name ? pool.attributes.name : ""

    out.push({
      chainId: dexChainId,
      address: addr,
      pageUrl: "",
      blurb: poolName ? "GeckoTerminal trending pool: " + poolName : "GeckoTerminal trending · " + sym,
      fromBoost: false,
      fromGecko: true
    })

    if (out.length >= cap) break
  }

  return out
}

async function collectSeedsMultiGeckoFallback() {
  let order = ["solana", "ethereum", "bsc", "base", "ton"]
  let out = []
  let seen = {}

  for (let i = 0; i < order.length; i++) {
    let ch = order[i]
    if (!APP.scanChainsAll[ch]) continue

    let chunk = await collectSeedsFromGeckoTrending(ch, 8)

    for (let j = 0; j < chunk.length; j++) {
      let s = chunk[j]
      let key = s.chainId + "_" + (s.chainId === "solana" ? s.address : s.address.toLowerCase())
      if (seen[key]) continue
      seen[key] = true
      out.push(s)
      if (out.length >= APP.seedCapAll) return out
    }
  }

  return out
}

function taxNum(x) {
  if (x === undefined || x === null || x === "") return 0
  return n(String(x).replace("%", ""))
}

function poolAgeMonths(pair) {
  let created = n(pair.pairCreatedAt)
  if (created <= 0) return null
  let ageDays = (Date.now() - created) / 86400000
  return ageDays / 30.4375
}

async function getJson(url, timeout) {
  let res = await HTTP.get({ url: url, timeout: timeout || APP.httpTimeout })
  if (!res || !res.ok) return null
  let d = res.data
  if (typeof d === "string") {
    try {
      d = JSON.parse(d)
    } catch (e) {
      return null
    }
  }
  return d
}

async function fetchGoPlusSolanaOne(address) {
  let url = APP.goplusBaseUrl + "/solana/token_security?contract_addresses=" + encodeURIComponent(address)
  let body = await getJson(url, APP.goplusTimeout)
  if (!body || n(body.code) !== 1 || !body.result) return null
  let keys = Object.keys(body.result)
  if (!keys.length) return null
  return body.result[keys[0]]
}

function auditEvmToken(row) {
  if (!row) {
    return { ok: false, summary: "GoPlus không trả dữ liệu — loại." }
  }

  let bad = []

  if (String(row.is_honeypot) === "1") bad.push("honeypot")
  if (String(row.honeypot_with_same_creator) === "1") bad.push("honeypot cùng creator")
  if (String(row.cannot_buy) === "1") bad.push("cannot_buy")
  if (String(row.cannot_sell_all) === "1") bad.push("cannot_sell_all")

  let buy = taxNum(row.buy_tax)
  let sell = taxNum(row.sell_tax)
  let xfer = taxNum(row.transfer_tax)

  if (buy > APP.maxTaxPct) bad.push("buy_tax " + buy + "%")
  if (sell > APP.maxTaxPct) bad.push("sell_tax " + sell + "%")
  if (xfer > APP.maxTaxPct) bad.push("transfer_tax " + xfer + "%")

  if (bad.length > 0) {
    return { ok: false, summary: "GoPlus chặn: " + bad.join(", ") }
  }

  return {
    ok: true,
    summary: "GoPlus: không cờ honeypot/cannot buy/sell; tax mua/bán/chuyển ~" + buy + "/" + sell + "/" + xfer + "%"
  }
}

function auditSolanaToken(row) {
  if (!row) {
    return { ok: false, summary: "GoPlus không trả dữ liệu — loại." }
  }

  let bad = []

  if (String(row.non_transferable) === "1") bad.push("non_transferable")

  if (row.mintable && String(row.mintable.status) === "1") bad.push("mintable")

  if (row.freezable && String(row.freezable.status) === "1") bad.push("freezable")

  if (row.balance_mutable_authority && String(row.balance_mutable_authority.status) === "1") {
    bad.push("mutable_balance")
  }

  let holders = row.holders
  if (Array.isArray(holders) && holders.length > 0) {
    let topPct = n(holders[0].percent)
    if (topPct > APP.topHolderFraction) {
      bad.push("top1 holder ~" + (topPct * 100).toFixed(1) + "% (> " + (APP.topHolderFraction * 100) + "%)")
    }
  }

  if (bad.length > 0) {
    return { ok: false, summary: "GoPlus chặn: " + bad.join(", ") }
  }

  return {
    ok: true,
    summary: "GoPlus: không freeze/mint nguy hiểm; top1 holder dưới " + (APP.topHolderFraction * 100) + "%"
  }
}

async function ensureEvmGoPlusRow(chainId, addr, cache) {
  let num = getGoPlusChainNum(chainId)
  if (!num) return null

  let k = String(addr).toLowerCase()
  if (!cache.evm[num]) cache.evm[num] = {}

  if (cache.evm[num][k] !== undefined) {
    return cache.evm[num][k]
  }

  let url = APP.goplusBaseUrl + "/token_security/" + num + "?contract_addresses=" + k
  let body = await getJson(url, APP.goplusTimeout)

  if (!body || n(body.code) !== 1 || !body.result) {
    cache.evm[num][k] = null
    return null
  }

  let row = body.result[k]
  if (!row) {
    let keys = Object.keys(body.result)
    row = keys.length ? body.result[keys[0]] : null
  }

  cache.evm[num][k] = row
  return row
}

async function pickSecuredCandidates(candidates) {
  let out = []
  let sorted = candidates.slice().sort((a, b) => b.score - a.score)
  let cache = { evm: {}, sol: {} }

  for (let i = 0; i < sorted.length && out.length < APP.pickCount; i++) {
    let c = sorted[i]
    let pair = c.pair
    let ch = pair.chainId || c.seed.chainId
    let addr = pair.baseToken.address

    let audit

    if (ch === "solana") {
      if (!cache.sol[addr]) {
        cache.sol[addr] = await fetchGoPlusSolanaOne(addr)
      }
      audit = auditSolanaToken(cache.sol[addr])
    } else if (getGoPlusChainNum(ch)) {
      let row = await ensureEvmGoPlusRow(ch, addr, cache)
      audit = auditEvmToken(row)
    } else {
      audit = {
        ok: true,
        summary: "Chain " + ch + ": chưa gắn GoPlus — chỉ lọc DexScreener + tuổi pool."
      }
    }

    if (!audit.ok) continue

    c.securitySummary = audit.summary
    out.push(c)
  }

  return out
}

function collectSeeds(chainId, boosts, profiles) {
  let seen = {}
  let out = []

  function pushOne(entry, isBoost) {
    if (!entry || entry.chainId !== chainId) return
    let addr = String(entry.tokenAddress || "").trim()
    if (!addr) return
    let key = chainId + "_" + (chainId === "solana" ? addr : addr.toLowerCase())
    if (seen[key]) return
    seen[key] = true
    out.push({
      chainId: chainId,
      address: addr,
      pageUrl: entry.url || "",
      blurb: entry.description || "",
      fromBoost: !!isBoost
    })
  }

  if (Array.isArray(boosts)) {
    for (let i = 0; i < boosts.length; i++) pushOne(boosts[i], true)
  }
  if (Array.isArray(profiles)) {
    for (let i = 0; i < profiles.length; i++) pushOne(profiles[i], false)
  }

  return out.slice(0, APP.seedCap)
}

function collectSeedsMulti(boosts, profiles) {
  let allow = APP.scanChainsAll
  let seen = {}
  let out = []

  function pushOne(entry, isBoost) {
    if (!entry || !allow[entry.chainId]) return

    let cid = entry.chainId
    let addr = String(entry.tokenAddress || "").trim()
    if (!addr) return

    let key = cid + "_" + (cid === "solana" ? addr : addr.toLowerCase())
    if (seen[key]) return
    seen[key] = true

    out.push({
      chainId: cid,
      address: addr,
      pageUrl: entry.url || "",
      blurb: entry.description || "",
      fromBoost: !!isBoost
    })
  }

  if (Array.isArray(boosts)) {
    for (let i = 0; i < boosts.length; i++) pushOne(boosts[i], true)
  }
  if (Array.isArray(profiles)) {
    for (let i = 0; i < profiles.length; i++) pushOne(profiles[i], false)
  }

  return out.slice(0, APP.seedCapAll)
}

function pairPassesFilters(pair, chainId, f) {
  if (!pair || pair.chainId !== chainId) return false
  if (!quoteOk(pair)) return false
  if (stableBase(pair)) return false

  let liq = n(pair.liquidity && pair.liquidity.usd)
  let vol = n(pair.volume && pair.volume.h24)
  if (liq < f.minLiquidityUsd) return false
  if (vol < f.minVolumeH24) return false
  if (liq > 0 && vol / liq > f.maxVolLiquidityRatio) return false

  let fdv = n(pair.fdv || pair.marketCap)
  if (fdv > 0 && (fdv < f.minFdvUsd || fdv > f.maxFdvUsd)) return false

  let pc = n(pair.priceChange && pair.priceChange.h24)
  if (Math.abs(pc) > f.maxAbsPriceChangeH24) return false

  let t = pair.txns && pair.txns.h24
  let buys = t ? n(t.buys) : 0
  let sells = t ? n(t.sells) : 0
  if (buys + sells < f.minTxnsH24) return false

  let created = n(pair.pairCreatedAt)
  if (created <= 0) return false

  let age = Date.now() - created
  if (age < f.minPoolAgeMs) return false

  return true
}

function pickBestPair(pairs, chainId, tokenAddress, f) {
  if (!Array.isArray(pairs)) return null

  let candidates = []
  for (let i = 0; i < pairs.length; i++) {
    let p = pairs[i]
    if (!p.baseToken || !sameBaseAddress(chainId, p.baseToken.address, tokenAddress)) continue
    if (!pairPassesFilters(p, chainId, f)) continue
    candidates.push(p)
  }

  candidates.sort((a, b) => n(b.liquidity.usd) - n(a.liquidity.usd))
  return candidates.length > 0 ? candidates[0] : null
}

function gemRankScore(pair, seed, profile) {
  let liq = n(pair.liquidity && pair.liquidity.usd)
  let vol = n(pair.volume && pair.volume.h24)
  let ratio = liq > 0 ? vol / liq : 0
  let h24 = n(pair.priceChange && pair.priceChange.h24)
  let m5 = n(pair.priceChange && pair.priceChange.m5)
  let m15 = pair.priceChange && pair.priceChange.m15 !== undefined ? n(pair.priceChange.m15) : null
  let h1 = n(pair.priceChange && pair.priceChange.h1)
  let s = 0

  if (ratio >= 0.7 && ratio <= 18) s += 3
  else if (ratio <= 35) s += 1

  if (liq >= 40000 && liq <= 2500000) s += 2.2
  else if (liq > 2500000) s += 0.8

  let t = pair.txns && pair.txns.h24
  if (t) {
    let tot = n(t.buys) + n(t.sells)
    if (tot > 0 && n(t.buys) / tot >= 0.53) s += 1.6
  }

  if (seed && seed.fromBoost) s += 0.7

  if (seed && seed.fromGecko) s += 0.35

  let a = Math.abs(h24)
  if (a >= 8 && a <= 180) s += 1.1

  if (profile === "aggressive") {
    if (m5 > 2 && m5 < 48 && h1 > -14) s += 1.15
    if (m15 !== null && m15 > 4 && m15 < 85) s += 0.85
    if (m5 < -22 || h1 < -18) s -= 1.15
  } else {
    if (m5 > 3 && m5 < 32) s += 0.55
    if (m5 < -18) s -= 0.45
  }

  let ch = pair.chainId
  if (ch === "ton") s -= 2.1

  return s
}

function momentumNote(pair, profile) {
  let h1 = n(pair.priceChange && pair.priceChange.h1)
  let h24 = n(pair.priceChange && pair.priceChange.h24)
  let t = pair.txns && pair.txns.h24
  let buys = t ? n(t.buys) : 0
  let sells = t ? n(t.sells) : 0
  let tot = buys + sells
  let buyRatio = tot > 0 ? buys / tot : 0.5
  let parts = []

  if (h24 > 40) parts.push("biến động 24h rất mạnh (+" + h24.toFixed(0) + "%)")
  else if (h24 > 12) parts.push("xung lực 24h +" + h24.toFixed(0) + "%")
  else if (h24 < -25) parts.push("sụt 24h mạnh (~" + h24.toFixed(0) + "%), rủi ro tiếp diễn")
  else parts.push("thay đổi giá 24h ~" + h24.toFixed(1) + "%")

  if (buyRatio >= 0.56) parts.push("giao dịch 24h nghiêng mua")
  else if (buyRatio <= 0.44) parts.push("giao dịch 24h nghiêng bán")

  if (profile === "survivor") {
    parts.push("H1 chỉ tham khảo; meme già nên xử lý theo D1/swing")
  } else {
    if (h1 > 6) parts.push("H1 đang nóng")
    else if (h1 < -6) parts.push("H1 yếu")
  }

  return parts.join(" · ") + " (số liệu pool DEX, không phải futures)."
}

async function askDeepSeek(config, rows, profileForAi) {
  if (!config || !config.deepseek_api_key || rows.length === 0) return ""

  let compact = rows.map((x, i) => {
    return (i + 1) + ". " + (x.chain || "?") + " " + x.symbol + " liq=" + fmtUsd(x.liq) + " vol24h=" + fmtUsd(x.vol) + " h24=" + x.h24 + "% boost=" + (x.fromBoost ? "y" : "n")
  }).join("\n")

  let tf =
    profileForAi === "aggressive"
      ? "Khung gợi ý: H1–H4 / ngắn hạn."
      : "Khung gợi ý: D1 / swing (meme đã lọc tuổi pool dài — không khuyên scalping M5)."

  let prompt =
    "Bạn là trader hiểu rủi ro DEX meme. " +
    tf +
    "\nDưới đây là vài token đã lọc thanh khoản + volume.\n" +
    "Viết tối đa 2 câu tiếng Việt: cảnh báo chung + không FOMO. Không hứa lợi nhuận, không bịa facts.\n\n" +
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
        messages: [{ role: "user", content: prompt }],
        thinking: { type: "disabled" },
        max_tokens: APP.aiMaxTokens,
        temperature: 0.25,
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

// ===== MAIN =====
let config = loadConfig()
let opts = parseParams(params)
let f = activeFilter(opts.profile)

let profTag = opts.profile === "aggressive" ? "aggressive (~3h+ pool)" : "survivor (~3 tháng+)"
let poolRuleShort =
  opts.profile === "aggressive"
    ? "pool ≥ ~3h + LP/vol + GoPlus"
    : "pool ≥ ~3 tháng + GoPlus"
let timeframeHint =
  opts.profile === "aggressive"
    ? "📌 Khung: ưu tiên H1–H4 / dòng tiền ngắn (meme còn nóng)."
    : "📌 Khung: meme già → xử lý D1 / swing; đừng scalping M5."

let scopeLabel = "chung (eth·bsc·sol·base·ton) · " + profTag
let progressHint = "đa chain · " + profTag

if (opts.mode === "single") {
  scopeLabel = opts.chain + " · " + profTag
  progressHint = opts.chain + " · " + profTag
}

let progress = await Bot.sendMessage(
  "Đang lấy meme DEX (" + progressHint + "): DexScreener/Gecko → " + poolRuleShort + "..."
)

let boosts = await getJson(APP.dexBaseUrl + "/token-boosts/latest/v1")
let profiles = await getJson(APP.dexBaseUrl + "/token-profiles/latest/v1")

let seeds =
  opts.mode === "all" ? collectSeedsMulti(boosts, profiles) : collectSeeds(opts.chain, boosts, profiles)

let usedGeckoFallback = false

if (seeds.length === 0) {
  usedGeckoFallback = true
  if (opts.mode === "all") {
    seeds = await collectSeedsMultiGeckoFallback()
  } else {
    seeds = await collectSeedsFromGeckoTrending(opts.chain, APP.seedCap)
  }
}

if (seeds.length === 0) {
  await progress.editText(
    opts.mode === "all"
      ? "Không có seed DexScreener và GeckoTerminal trending cũng trống/lỗi cho nhóm chain.\nThử sau hoặc /hidden-gems eth | bsc | sol | base | ton"
      : "Không có boosted/profile DexScreener cho " +
          opts.chain +
          " và GeckoTerminal trending không trả được token.\nThử chain khác hoặc /hidden-gems (chung)."
  )
  return
}

let mergedPairs = []
for (let i = 0; i < seeds.length; i += APP.batchTokens) {
  let chunk = seeds.slice(i, i + APP.batchTokens)
  let url = APP.dexBaseUrl + "/latest/dex/tokens/" + chunk.map(s => s.address).join(",")
  let body = await getJson(url)
  if (body && Array.isArray(body.pairs)) {
    for (let j = 0; j < body.pairs.length; j++) mergedPairs.push(body.pairs[j])
  }
}

let candidates = []
for (let i = 0; i < seeds.length; i++) {
  let seed = seeds[i]
  let best = pickBestPair(mergedPairs, seed.chainId, seed.address, f)
  if (!best) continue

  let sym = (best.baseToken && best.baseToken.symbol) || "?"
  let name = (best.baseToken && best.baseToken.name) || ""
  candidates.push({
    seed: seed,
    pair: best,
    symbol: sym,
    name: name,
    liq: n(best.liquidity && best.liquidity.usd),
    vol: n(best.volume && best.volume.h24),
    h24: n(best.priceChange && best.priceChange.h24).toFixed(1),
    fromBoost: seed.fromBoost,
    score: gemRankScore(best, seed, opts.profile)
  })
}

if (candidates.length === 0) {
  let whyTail =
    opts.profile === "aggressive"
      ? "Thường gặp: pool < ~3h, hoặc LP/vol/txns/FDV chưa đạt ngưỡng aggressive.\n" +
        "Có thể nới thêm APP.filterAggressive hoặc chạy lại sau."
      : "Thường gặp: pool quá mới so với survivor (~3 tháng), hoặc LP/vol/txns chưa đủ.\n" +
        "Thử: /hidden-gems eth aggressive (pool ~3h+)."

  await progress.editText(
    "Đã có " +
      seeds.length +
      " seed (" +
      scopeLabel +
      ") — chain vẫn có token trên DexScreener/Gecko.\n" +
      "Không có pool nào đạt lọc (" +
      poolRuleShort +
      ").\n" +
      whyTail
  )
  return
}

let top = await pickSecuredCandidates(candidates)

if (top.length === 0) {
  await progress.editText(
    "Có " +
      candidates.length +
      " pool qua lọc (" +
      poolRuleShort +
      ") nhưng không token nào qua GoPlus.\n" +
      "Thử chain khác hoặc đợi API."
  )
  return
}

let out = ""
let msgDiv = APP.telegramSectionDivider
out += "💎 HIDDEN GEMS · " + scopeLabel + "\n"
out +=
  (usedGeckoFallback ? "📌 Seed: GeckoTerminal (DexScreener boost trống).\n" : "📌 Seed: DexScreener boost/profile.\n") +
  "📌 Lọc: " +
  poolRuleShort +
  ".\n" +
  timeframeHint +
  "\n"
out += msgDiv

for (let i = 0; i < top.length; i++) {
  let row = top[i]
  let p = row.pair
  let base = p.baseToken || {}
  let dex = p.dexId || "dex"
  let pairAddr = p.pairAddress || ""
  let pChain = p.chainId || row.seed.chainId || "?"
  let ca = base.address || ""

  let line = ""
  line += "\n" + msgDiv + "#" + (i + 1) + " · " + pChain + " · " + row.symbol + "\n"
  if (row.name) line += row.name + "\n"
  line += "\n"
  line += "  LP      " + fmtUsd(row.liq) + "\n"
  line += "  Vol 24h " + fmtUsd(row.vol) + "\n"
  line += "  24h     " + row.h24 + "%\n"

  let ageM = poolAgeMonths(p)
  if (ageM !== null) line += "  Tuổi    ~" + ageM.toFixed(1) + " tháng\n"

  line += "  DEX     " + dex + "\n"
  if (p.url) {
    line += "\n  🔗 " + p.url + "\n"
  } else {
    line += "\n"
    if (ca) line += "  CA   " + ca + "\n"
    if (pairAddr) line += "  Pool " + pairAddr + "\n"
  }

  if (row.seed.blurb) {
    let blurb = String(row.seed.blurb).replace(/\n+/g, " ").trim()
    if (blurb.length > 180) blurb = blurb.slice(0, 177) + "…"
    line += "\n  📝 " + blurb + "\n"
  }

  line += "\n  🛡 " + (row.securitySummary || "") + "\n"
  line += "  📈 " + momentumNote(p, opts.profile) + "\n"

  out += line
}

out += "\n"

let ai = await askDeepSeek(
  config,
  top.map(x => ({
    chain: x.pair.chainId || x.seed.chainId,
    symbol: x.symbol,
    liq: x.liq,
    vol: x.vol,
    h24: x.h24,
    fromBoost: x.fromBoost
  })),
  opts.profile
)

if (ai && (out + "\n" + msgDiv + "🧠 DeepSeek\n" + ai).length < APP.telegramSafeLimit) {
  out += "\n" + msgDiv + "🧠 DeepSeek\n" + ai + "\n"
}

out +=
  "\n" +
  msgDiv +
  "⚠️ GoPlus/DexScreener chỉ snapshot; không bắt wash/MEV/rug sau đó. Không phải tư vấn đầu tư.\n"

if (out.length > APP.telegramSafeLimit) {
  out = out.slice(0, APP.telegramSafeLimit - 120) + "\n\n⚠️ Đã rút gọn tin nhắn."
}

try {
  await progress.editText(out)
} catch (e) {
  Bot.sendMessage(out)
}
