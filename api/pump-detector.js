// api/pump-detector.js — Detector de Pump Coordinado · Crypto Detector v4
// Scoring exacto del spec: social+2, clones+2, telegram+1, volume+2, whale+2, news+1
'use strict';
const axios = require('axios');

// ─── Keywords de pump coordinado ──────────────────────────────────────────────
const PUMP_KEYWORDS = [
  'last chance','don\'t miss','huge announcement','big announcement','massive pump',
  'to the moon','100x','1000x','before the announcement','before listing',
  'next gem','hidden gem','buy now','get in now','easy 10x','easy 100x',
  'buy before','fill your bags','load your bags','major exchange',
  'strategic partnership','big update soon','coming soon','going parabolic',
  'not financial advice but','ape in','early investors','don\'t sleep on',
  'explosive move','undervalued gem','última oportunidad'
];
const PUMP_PATTERNS = [
  /don'?t miss/i, /last chance/i, /huge announcement/i,
  /before.{0,20}(listing|announcement|launch)/i,
  /(\d{2,4})x (guaranteed|incoming|soon|potential)/i,
  /moon.{0,10}soon/i, /strategic partnership/i, /major exchange/i,
  /early (investor|opportunity)/i, /fill your bags/i,
  /big.{0,15}(news|update|announcement).{0,20}soon/i
];

const RISK_LEVELS = [
  { min: 7, label: 'PUMP CASI SEGURO', color: 'red',    emoji: '🚨' },
  { min: 4, label: 'SOSPECHOSO',       color: 'orange', emoji: '⚠️' },
  { min: 0, label: 'NORMAL',           color: 'green',  emoji: '✅' }
];

function getRiskLevel(score) {
  return RISK_LEVELS.find(r => score >= r.min) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

function detectPumpKeywords(text) {
  if (!text) return { found: [], patternMatches: 0 };
  const t = text.toLowerCase();
  const found = PUMP_KEYWORDS.filter(kw => t.includes(kw));
  const patternMatches = PUMP_PATTERNS.filter(p => p.test(text)).length;
  return { found, patternMatches };
}

function jaccardSim(a, b) {
  if (!a || !b) return 0;
  const wa = new Set(a.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w=>w.length>2));
  const wb = new Set(b.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w=>w.length>2));
  if (!wa.size || !wb.size) return 0;
  const inter = [...wa].filter(w=>wb.has(w)).length;
  return inter / (wa.size + wb.size - inter);
}

function detectClonedMessages(messages) {
  if (!messages || messages.length < 3) return { cloneRate: 0, clones: [], clonePairs: 0 };
  const msgs = messages.slice(0, 20);
  let clonePairs = 0; const clones = [];
  const totalPairs = (msgs.length * (msgs.length - 1)) / 2;
  for (let i = 0; i < msgs.length; i++) {
    for (let j = i+1; j < msgs.length; j++) {
      const sim = jaccardSim(msgs[i], msgs[j]);
      if (sim > 0.65) {
        clonePairs++;
        if (clones.length < 3) clones.push({ a: msgs[i].slice(0,70), b: msgs[j].slice(0,70), similarity: (sim*100).toFixed(0)+'%' });
      }
    }
  }
  return { cloneRate: totalPairs > 0 ? clonePairs/totalPairs : 0, clones, clonePairs };
}

// ─── S1 + S2: Spike social + Mensajes clonados (spec: +2 y +2) ───────────────
async function detectSocialAndClones(symbol, name) {
  const evidence = []; const signals = []; let score = 0;
  try {
    const subs = 'CryptoCurrency+CryptoMarkets+CryptoMoonShots+SatoshiStreetBets+altcoins';
    const q    = encodeURIComponent(symbol.toUpperCase());
    const ua   = { headers:{'User-Agent':'CryptoDetector/4.0'}, timeout:6000 };
    const [todayR, weekR] = await Promise.allSettled([
      axios.get(`https://www.reddit.com/r/${subs}/search.json?q=${q}&sort=new&limit=25&t=day&restrict_sr=0`, ua),
      axios.get(`https://www.reddit.com/r/${subs}/search.json?q=${q}&sort=new&limit=50&t=week&restrict_sr=0`, ua)
    ]);
    const todayPosts = todayR.status==='fulfilled' ? (todayR.value.data?.data?.children||[]) : [];
    const weekPosts  = weekR.status ==='fulfilled' ? (weekR.value.data?.data?.children ||[]) : [];
    const avgPerDay  = weekPosts.length / 7;
    const todayCount = todayPosts.length;
    const multiplier = avgPerDay > 0.5 ? todayCount/avgPerDay : (todayCount>8 ? 8 : 1);

    // S1 — Spike social +2
    if (multiplier >= 5) {
      score += 2;
      evidence.push(`Reddit: ${todayCount} posts hoy vs. ~${avgPerDay.toFixed(1)}/día (${multiplier.toFixed(1)}×) — explosión social`);
    } else if (multiplier >= 2.5) {
      score += 1;
      evidence.push(`Reddit: ${todayCount} posts hoy (${multiplier.toFixed(1)}× promedio — elevado)`);
    }
    signals.push({ type:'social_spike', multiplier:multiplier.toFixed(1), todayCount, avgPerDay:avgPerDay.toFixed(1) });

    const titles = todayPosts.map(p=>p.data?.title||'').filter(Boolean);

    // S2 — Mensajes clonados +2
    const { cloneRate, clones, clonePairs } = detectClonedMessages(titles);
    if (cloneRate >= 0.40) {
      score += 2;
      evidence.push(`Reddit: ${(cloneRate*100).toFixed(0)}% mensajes casi idénticos (${clonePairs} pares) — coordinación masiva`);
      signals.push({ type:'cloned_messages', clones, cloneRate:(cloneRate*100).toFixed(0)+'%' });
    } else if (cloneRate >= 0.20) {
      score += 1;
      evidence.push(`Reddit: ${(cloneRate*100).toFixed(0)}% mensajes similares — nivel leve`);
      signals.push({ type:'cloned_messages', clones, cloneRate:(cloneRate*100).toFixed(0)+'%' });
    }

    // Lenguaje explícito de pump en títulos
    const pumpPosts = titles.filter(t=>{ const k=detectPumpKeywords(t); return k.found.length>0||k.patternMatches>0; });
    if (pumpPosts.length >= 2) {
      evidence.push(`Reddit: ${pumpPosts.length} posts con frases de pump ("${pumpPosts[0].slice(0,50)}"...)`);
      signals.push({ type:'pump_language', samples:pumpPosts.slice(0,2) });
    }
  } catch(_) {}
  return { score:Math.min(score,4), evidence, signals };
}

// ─── S3: Crecimiento artificial Telegram (spec: +1) ──────────────────────────
async function detectTelegramGrowth(symbol, getRedisKey) {
  const evidence = []; let score = 0;
  try {
    const token = await getRedisKey('TELEGRAM_BOT_TOKEN');
    if (!token) { evidence.push('Telegram: configura TELEGRAM_BOT_TOKEN para activar esta señal'); return { score:0, evidence, available:false }; }
    const names = [`${symbol.toLowerCase()}official`,`${symbol.toLowerCase()}token`,`${symbol.toLowerCase()}coin`];
    for (const gname of names) {
      try {
        const r = await axios.get(`https://api.telegram.org/bot${token}/getChat?chat_id=@${gname}`,{timeout:4000});
        if (r.data?.ok) {
          const members = r.data.result?.member_count || 0;
          if (members > 5000) { score=1; evidence.push(`Telegram @${gname}: ${members.toLocaleString()} miembros — comunidad grande (monitorizar crecimiento súbito)`); }
          else if (members > 0) { evidence.push(`Telegram @${gname}: ${members.toLocaleString()} miembros`); }
          break;
        }
      } catch(_) {}
    }
    if (score===0 && evidence.length===0) evidence.push(`Telegram: sin grupo oficial detectado para ${symbol.toUpperCase()}`);
  } catch(_) {}
  return { score, evidence, available:true };
}

// ─── S4: Volumen anormal sin noticias (spec: +2) ──────────────────────────────
async function detectVolumeAnomaly(coinGeckoId, current_volume, market_cap) {
  const evidence = []; let score = 0;
  try {
    const r = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinGeckoId}/market_chart?vs_currency=usd&days=7&interval=daily`,
      {timeout:8000}
    );
    const vols = (r.data?.total_volumes||[]).map(v=>v[1]).filter(v=>v>0);
    if (vols.length >= 3) {
      const avgVol   = vols.slice(0,-1).reduce((s,v)=>s+v,0)/Math.max(vols.length-1,1);
      const todayVol = current_volume || vols[vols.length-1];
      const mult     = avgVol > 0 ? todayVol/avgVol : 0;
      if (mult >= 10) { score=2; evidence.push(`Volumen ${mult.toFixed(0)}× media 7d ($${(todayVol/1e6).toFixed(1)}M vs. $${(avgVol/1e6).toFixed(1)}M) — señal crítica`); }
      else if (mult >= 4) { score=2; evidence.push(`Volumen ${mult.toFixed(1)}× media 7d ($${(todayVol/1e6).toFixed(1)}M) — anormal`); }
      else if (mult >= 2) { score=1; evidence.push(`Volumen ${mult.toFixed(1)}× media 7d — elevado`); }
      const vcRatio = market_cap>0 ? (current_volume/market_cap)*100 : 0;
      if (vcRatio > 60)  { score=Math.min(score+1,2); evidence.push(`Vol/Cap ${vcRatio.toFixed(0)}% — presión extrema (posibles insiders)`); }
      else if (vcRatio>30) { evidence.push(`Vol/Cap ${vcRatio.toFixed(0)}% — inusualmente alto`); }
    }
  } catch(_) {}
  return { score:Math.min(score,2), evidence };
}

// ─── S5: Ballenas — Glassnode + heurística precio (spec: +2) ─────────────────
async function detectWhaleActivity(symbol, coinGeckoId, market_cap, total_volume, getRedisKey) {
  const evidence = []; let score = 0;
  try {
    const glassKey = await getRedisKey('GLASSNODE_API_KEY');
    if (glassKey) {
      try {
        const r = await axios.get(
          'https://api.glassnode.com/v1/metrics/transactions/transfers_volume_from_exchanges_sum',
          {timeout:6000, params:{a:symbol.toUpperCase(), api_key:glassKey, i:'24h', c:'native'}}
        );
        const data = r.data||[];
        if (data.length>=2) {
          const prev=data[data.length-2]?.v||0, curr=data[data.length-1]?.v||0;
          const mult = prev>0 ? curr/prev : 0;
          if (mult>=3)   { score=2; evidence.push(`Glassnode: inflows ${mult.toFixed(1)}× — ballenas entrando a exchanges (preparando dump)`); }
          else if(mult>=1.5) { score=1; evidence.push(`Glassnode: inflows ${mult.toFixed(1)}× — whale activity elevada`); }
        }
      } catch(_) {}
    } else {
      evidence.push('Glassnode: sin API key — configura GLASSNODE_API_KEY para señal de ballenas');
    }
    // Heurística: precio +5% en 1h con alto volumen = acumulación coordinada
    try {
      const r2 = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinGeckoId}?localization=false&tickers=false&community_data=false&developer_data=false`,
        {timeout:5000}
      );
      const chg1h = r2.data?.market_data?.price_change_percentage_1h_in_currency?.usd||0;
      const chg7d = r2.data?.market_data?.price_change_percentage_7d||0;
      if (chg1h>5 && total_volume>market_cap*0.20)  { score=Math.max(score,1); evidence.push(`Precio +${chg1h.toFixed(1)}% en 1h con alto volumen — posible acumulación coordinada`); }
      if (chg7d<-20 && total_volume>market_cap*0.15) { score=Math.max(score,1); evidence.push(`Bajó ${chg7d.toFixed(0)}% en 7d pero volumen elevado — re-acumulación post-dump posible`); }
    } catch(_) {}
  } catch(_) {}
  return { score:Math.min(score,2), evidence };
}

// ─── S6: Noticias vacías o con lenguaje de pump (spec: +1) ───────────────────
async function detectVacuousNews(symbol, name) {
  const evidence=[]; const flaggedNews=[]; let score=0;
  try {
    const [ccR, cdR] = await Promise.allSettled([
      axios.get(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${symbol.toUpperCase()}`,{timeout:5000}),
      axios.get('https://www.coindesk.com/arc/outboundfeeds/rss/',{timeout:5000,headers:{'User-Agent':'CryptoDetector/4.0'}})
    ]);
    const ccArts = ccR.status==='fulfilled' ? (ccR.value.data?.Data||[]).slice(0,10) : [];
    ccArts.forEach(a=>{
      const kw=detectPumpKeywords((a.title||'')+' '+(a.body||'').slice(0,300));
      if (kw.found.length>0||kw.patternMatches>0) flaggedNews.push({title:a.title, source:a.source_info?.name||'CryptoCompare', keywords:kw.found.slice(0,3)});
    });
    if (cdR.status==='fulfilled') {
      const xml=cdR.value.data||'';
      const items=(xml.match(/<item>([\s\S]*?)<\/item>/g)||[]).slice(0,15);
      items.forEach(item=>{
        const title=(item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)||[])[1]||(item.match(/<title>(.*?)<\/title>/)||[])[1]||'';
        if (title.toLowerCase().includes(symbol.toLowerCase())||title.toLowerCase().includes(name.toLowerCase())) {
          const kw=detectPumpKeywords(title);
          if (kw.found.length>0||kw.patternMatches>0) flaggedNews.push({title, source:'CoinDesk', keywords:kw.found.slice(0,3)});
        }
      });
    }
    if (flaggedNews.length>=1) { score=1; evidence.push(`${flaggedNews.length} noticia${flaggedNews.length>1?'s':''} con lenguaje sospechoso: "${flaggedNews[0].title.slice(0,70)}..."`); }
  } catch(_) {}
  return { score:Math.min(score,1), evidence, flaggedNews:flaggedNews.slice(0,5) };
}

// ─── S7: Order book manipulado — Binance (+1 bonus) ─────────────────────────
async function detectOrderBookManipulation(symbol) {
  const evidence=[]; let score=0;
  try {
    const pair=symbol.toUpperCase()+'USDT';
    const r=await axios.get(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=20`,{timeout:5000});
    const bids=(r.data?.bids||[]).map(b=>({price:parseFloat(b[0]),qty:parseFloat(b[1])}));
    const asks=(r.data?.asks||[]).map(a=>({price:parseFloat(a[0]),qty:parseFloat(a[1])}));
    if (bids.length>=5 && asks.length>=5) {
      const midPrice=(bids[0].price+asks[0].price)/2;
      const totalBidV=bids.reduce((s,b)=>s+b.qty*b.price,0);
      const totalAskV=asks.reduce((s,a)=>s+a.qty*a.price,0);
      const imbalance=totalBidV/Math.max(totalAskV,1);
      if (imbalance>5) { score=1; evidence.push(`Binance: ratio Bids/Asks ${imbalance.toFixed(1)}× — buy wall artificial sospechoso`); }
      else if (imbalance<0.2) { score=1; evidence.push(`Binance: ratio Bids/Asks ${imbalance.toFixed(2)}× — sell wall extremo (posible dump preparado)`); }
      const maxBid=Math.max(...bids.map(b=>b.qty*b.price));
      const wallPct=(maxBid/Math.max(totalBidV,1))*100;
      if (wallPct>30) { evidence.push(`Binance: una orden = ${wallPct.toFixed(0)}% del libro de compras — wall manipulado`); score=1; }
      const spread=((asks[0].price-bids[0].price)/midPrice)*100;
      if (spread>3) evidence.push(`Binance: spread ${spread.toFixed(1)}% — liquidez muy baja`);
    }
  } catch(_) {}
  return { score:Math.min(score,1), evidence };
}

// ─── S8: LunarCrush spike (+1 bonus) ─────────────────────────────────────────
async function detectLunarCrushSpike(symbol, getRedisKey) {
  const evidence=[]; let score=0;
  try {
    const key=await getRedisKey('LUNARCRUSH_API_KEY');
    if (!key) return {score:0,evidence:[]};
    const r=await axios.get(`https://lunarcrush.com/api4/public/coins/${symbol.toLowerCase()}/v1`,
      {timeout:5000,headers:{Authorization:`Bearer ${key}`,'User-Agent':'CryptoDetector/4.0'}});
    const d=r.data?.data;
    if (!d) return {score:0,evidence:[]};
    if ((d.galaxy_score||0)>80)     { score+=1; evidence.push(`LunarCrush Galaxy Score: ${d.galaxy_score}/100 — trending extremo`); }
    if ((d.alt_rank||999)<10)       { score=Math.min(score+1,1); evidence.push(`LunarCrush Alt Rank #${d.alt_rank} — top 10 trending`); }
    if ((d.social_volume||0)>50000) { score=Math.min(score+1,1); evidence.push(`LunarCrush Social Volume: ${(d.social_volume||0).toLocaleString()} menciones masivas`); }
    if ((d.average_sentiment||3)>4.2) evidence.push(`LunarCrush Sentiment: ${(d.average_sentiment||0).toFixed(1)}/5 — artificialmente positivo`);
    score=Math.min(score,1);
  } catch(_) {}
  return {score,evidence};
}

// ─── S9: Timing sincronizado (+1 bonus) ──────────────────────────────────────
function detectTimingSync(socialSignals, volumeScore, newsScore, whaleScore) {
  const evidence=[]; let score=0;
  const activeSources=[
    socialSignals.some(s=>s.type==='social_spike'&&parseFloat(s.multiplier)>=3) ? 1:0,
    volumeScore>=2 ? 1:0,
    newsScore>=1   ? 1:0,
    whaleScore>=1  ? 1:0
  ].reduce((a,b)=>a+b,0);
  if (activeSources>=3) { score=1; evidence.push('Timing sincronizado: spike social + volumen + ballenas/noticias simultáneos — patrón no orgánico'); }
  else if (activeSources>=2) evidence.push('Correlación temporal entre 2 fuentes — monitorizar');
  return {score,evidence,activeSources};
}

// ─── MOTOR PRINCIPAL ──────────────────────────────────────────────────────────
async function analyzePumpForAsset(asset, getRedisKey) {
  const {id,symbol,name,market_cap,total_volume} = asset;
  if ((market_cap||0) > 200_000_000) return null;

  const [social, volume, news, whale, telegram, orderBook, lunar] = await Promise.allSettled([
    detectSocialAndClones(symbol, name),
    detectVolumeAnomaly(id, total_volume, market_cap),
    detectVacuousNews(symbol, name),
    detectWhaleActivity(symbol, id, market_cap, total_volume, getRedisKey),
    detectTelegramGrowth(symbol, getRedisKey),
    detectOrderBookManipulation(symbol),
    detectLunarCrushSpike(symbol, getRedisKey)
  ]);

  const r = {
    social:    social.status    ==='fulfilled' ? social.value    : {score:0,evidence:[],signals:[]},
    volume:    volume.status    ==='fulfilled' ? volume.value    : {score:0,evidence:[]},
    news:      news.status      ==='fulfilled' ? news.value      : {score:0,evidence:[],flaggedNews:[]},
    whale:     whale.status     ==='fulfilled' ? whale.value     : {score:0,evidence:[]},
    telegram:  telegram.status  ==='fulfilled' ? telegram.value  : {score:0,evidence:[]},
    orderBook: orderBook.status ==='fulfilled' ? orderBook.value : {score:0,evidence:[]},
    lunar:     lunar.status     ==='fulfilled' ? lunar.value     : {score:0,evidence:[]}
  };

  const timing = detectTimingSync(r.social.signals||[], r.volume.score, r.news.score, r.whale.score);

  // Scoring exacto del spec
  const socialSpike    = Math.min(r.social.score, 2);                      // cap +2
  const clonedMessages = Math.min(Math.max(r.social.score - 2, 0), 2);     // segundos +2
  const telegramScore  = r.telegram.score;                                  // +1
  const volumeScore    = r.volume.score;                                    // +2
  const whaleScore     = r.whale.score;                                     // +2
  const newsScore      = r.news.score;                                      // +1
  // Bonus no en spec original
  const orderBookScore = r.orderBook.score;                                 // +1
  const lunarScore     = r.lunar.score;                                     // +1
  const timingScore    = timing.score;                                      // +1

  const totalScore = Math.min(
    socialSpike + clonedMessages + telegramScore + volumeScore + whaleScore + newsScore +
    orderBookScore + lunarScore + timingScore,
    12
  );

  const riskLevel = getRiskLevel(totalScore);
  const allEvidence = [
    ...r.social.evidence, ...r.volume.evidence, ...r.whale.evidence,
    ...r.news.evidence, ...r.telegram.evidence, ...r.orderBook.evidence,
    ...r.lunar.evidence, ...timing.evidence
  ].filter(Boolean);

  if (totalScore === 0) return null;

  return {
    assetId:     id,
    symbol:      symbol.toUpperCase(),
    name,
    market_cap,
    total_volume,
    totalScore,
    riskLevel:   riskLevel.label,
    riskColor:   riskLevel.color,
    riskEmoji:   riskLevel.emoji,
    detectedAt:  new Date().toISOString(),
    breakdown: {
      socialSpike:      {label:'📱 Spike Social',       score:socialSpike,    max:2, specWeight:'+2'},
      clonedMessages:   {label:'🗣️ Mensajes Clonados',  score:clonedMessages, max:2, specWeight:'+2'},
      telegramGrowth:   {label:'💬 Telegram Growth',    score:telegramScore,  max:1, specWeight:'+1'},
      volumeAnomaly:    {label:'📊 Volumen sin News',    score:volumeScore,    max:2, specWeight:'+2'},
      whaleActivity:    {label:'🐋 Whale Activity',      score:whaleScore,     max:2, specWeight:'+2'},
      vacuousNews:      {label:'📰 Noticias Vacías',     score:newsScore,      max:1, specWeight:'+1'},
      orderBook:        {label:'📉 Order Book Manip.',   score:orderBookScore, max:1, specWeight:'+1*'},
      lunarCrush:       {label:'🌙 LunarCrush',         score:lunarScore,     max:1, specWeight:'+1*'},
      timingSync:       {label:'⏱️ Timing Sincronizado', score:timingScore,    max:1, specWeight:'+1*'}
    },
    evidence:       allEvidence,
    flaggedNews:    r.news.flaggedNews||[],
    clonedSignals:  (r.social.signals||[]).filter(s=>s.type==='cloned_messages'),
    pumpLanguage:   (r.social.signals||[]).filter(s=>s.type==='pump_language'),
    activeSources:  timing.activeSources
  };
}

// ─── ESCANEO COMPLETO ─────────────────────────────────────────────────────────
async function runPumpScan(getRedisKey) {
  let cryptos = [];
  try {
    const r = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false',
      {timeout:12000}
    );
    cryptos = (r.data||[]).filter(c=>(c.market_cap||0)>=1_000_000&&(c.market_cap||0)<=200_000_000);
  } catch(e) {
    return {success:false, error:'Error CoinGecko: '+e.message, detections:[]};
  }

  const candidates = cryptos
    .sort((a,b)=>{
      const rA=(a.total_volume||0)/Math.max(a.market_cap||1,1);
      const rB=(b.total_volume||0)/Math.max(b.market_cap||1,1);
      return rB-rA;
    })
    .slice(0,20);

  const detections = [];
  for (let i=0; i<candidates.length; i+=4) {
    const batch = candidates.slice(i, i+4);
    const results = await Promise.allSettled(batch.map(c=>analyzePumpForAsset(c,getRedisKey)));
    results.forEach(r=>{ if (r.status==='fulfilled'&&r.value!==null) detections.push(r.value); });
    if (i+4 < candidates.length) await new Promise(r=>setTimeout(r,2000));
  }

  detections.sort((a,b)=>b.totalScore-a.totalScore);

  return {
    success:true,
    scannedCount:candidates.length,
    detectionsCount:detections.length,
    detections,
    scannedAt:new Date().toISOString()
  };
}

module.exports = {runPumpScan, analyzePumpForAsset, getRiskLevel};
