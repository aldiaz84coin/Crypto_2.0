// api/exchange-connector.js — Conector de exchanges para Crypto Detector v4
'use strict';
const axios = require('axios');
const crypto = require('crypto');

// ─── BINANCE ──────────────────────────────────────────────────────────────────
// Testnet: https://testnet.binance.vision   (gratis, sin dinero real)
// Real:    https://api.binance.com
const BINANCE_TESTNET = 'https://testnet.binance.vision';
const BINANCE_REAL    = 'https://api.binance.com';

function binanceSign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function binanceRequest(method, path, params = {}, keys = {}, testnet = true) {
  const base      = testnet ? BINANCE_TESTNET : BINANCE_REAL;
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const qs        = Object.entries(allParams).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const signature = binanceSign(qs, keys.secret || '');
  const url       = `${base}${path}?${qs}&signature=${signature}`;
  const r = await axios({ method, url,
    headers: { 'X-MBX-APIKEY': keys.apiKey || '', 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000
  });
  return r.data;
}

// Obtener precio actual de un par en Binance
async function binanceGetPrice(symbol, testnet = true) {
  const base = testnet ? BINANCE_TESTNET : BINANCE_REAL;
  const pair = symbol.toUpperCase() + 'USDT';
  try {
    const r = await axios.get(`${base}/api/v3/ticker/price?symbol=${pair}`, { timeout: 5000 });
    return { success: true, symbol: pair, price: parseFloat(r.data.price) };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Obtener balance de cuenta en Binance
async function binanceGetBalance(keys, testnet = true) {
  try {
    const data = await binanceRequest('GET', '/api/v3/account', {}, keys, testnet);
    const balances = (data.balances || [])
      .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }));
    return { success: true, balances, canTrade: data.canTrade };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Colocar orden de mercado en Binance
async function binancePlaceOrder(symbol, side, quoteQty, keys, testnet = true) {
  // quoteQty = USD a gastar (para compra) o qty de activo (para venta)
  const pair = symbol.toUpperCase() + 'USDT';
  try {
    const params = { symbol: pair, side: side.toUpperCase(), type: 'MARKET' };
    if (side.toUpperCase() === 'BUY') {
      params.quoteOrderQty = quoteQty.toFixed(2);  // USD a gastar
    } else {
      params.quantity = quoteQty.toFixed(6);        // cantidad de activo a vender
    }
    const data = await binanceRequest('POST', '/api/v3/order', params, keys, testnet);
    return {
      success:   true,
      orderId:   data.orderId,
      symbol:    data.symbol,
      side:      data.side,
      status:    data.status,
      executedQty: parseFloat(data.executedQty),
      cummulativeQuoteQty: parseFloat(data.cummulativeQuoteQty),
      fills:     data.fills || []
    };
  } catch(e) {
    return { success: false, error: e.response?.data?.msg || e.message };
  }
}

// Verificar conectividad y credenciales de Binance
async function binancePing(keys, testnet = true) {
  try {
    const base = testnet ? BINANCE_TESTNET : BINANCE_REAL;
    await axios.get(`${base}/api/v3/ping`, { timeout: 5000 });
    const account = await binanceGetBalance(keys, testnet);
    return {
      success:    account.success,
      connected:  true,
      testnet,
      canTrade:   account.canTrade,
      usdtBalance: account.balances?.find(b => b.asset === 'USDT')?.free || 0,
      error:      account.error
    };
  } catch(e) {
    return { success: false, connected: false, error: e.message };
  }
}

// ─── COINBASE ADVANCED TRADE ──────────────────────────────────────────────────
// Coinbase Advanced Trade API (sustituye a Coinbase Pro)
// Sandbox: https://api-public.sandbox.exchange.coinbase.com
// Real:    https://api.coinbase.com/api/v3/brokerage
const COINBASE_REAL    = 'https://api.coinbase.com/api/v3/brokerage';
const COINBASE_SANDBOX = 'https://api-public.sandbox.exchange.coinbase.com';

// Coinbase usa JWT (API key v3) o API+Secret legacy
function coinbaseSign(timestamp, method, path, body, secret) {
  const msg = timestamp + method.toUpperCase() + path + (body || '');
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

async function coinbaseRequest(method, path, body = null, keys = {}, sandbox = false) {
  const base      = sandbox ? COINBASE_SANDBOX : COINBASE_REAL;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr   = body ? JSON.stringify(body) : '';
  const signature = coinbaseSign(timestamp, method, path, bodyStr, keys.secret || '');
  const r = await axios({
    method,
    url: base + path,
    headers: {
      'CB-ACCESS-KEY':       keys.apiKey    || '',
      'CB-ACCESS-SIGN':      signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'Content-Type':        'application/json',
      'User-Agent':          'CryptoDetector/4.0'
    },
    data: body || undefined,
    timeout: 8000
  });
  return r.data;
}

async function coinbaseGetBalance(keys, sandbox = false) {
  try {
    const data = await coinbaseRequest('GET', '/accounts', null, keys, sandbox);
    const accounts = (data.accounts || [])
      .filter(a => parseFloat(a.available_balance?.value || 0) > 0)
      .map(a => ({
        asset:     a.currency,
        free:      parseFloat(a.available_balance?.value || 0),
        total:     parseFloat(a.balance?.value || 0)
      }));
    return { success: true, accounts };
  } catch(e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

async function coinbasePlaceOrder(symbol, side, amountUSD, keys, sandbox = false) {
  const productId = symbol.toUpperCase() + '-USD';
  const clientOrderId = `cd_${Date.now()}_${symbol}`;
  try {
    const body = {
      client_order_id: clientOrderId,
      product_id:      productId,
      side:            side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      order_configuration: {
        market_market_ioc: {
          quote_size: amountUSD.toFixed(2)  // USD
        }
      }
    };
    const data = await coinbaseRequest('POST', '/orders', body, keys, sandbox);
    return {
      success:        true,
      orderId:        data.success_response?.order_id || clientOrderId,
      status:         data.success ? 'FILLED' : 'PENDING',
      productId,
      side
    };
  } catch(e) {
    return { success: false, error: e.response?.data?.message || e.message };
  }
}

async function coinbasePing(keys, sandbox = false) {
  try {
    const balance = await coinbaseGetBalance(keys, sandbox);
    return {
      success:    balance.success,
      connected:  true,
      sandbox,
      usdBalance: balance.accounts?.find(a => a.asset === 'USD')?.free || 0,
      error:      balance.error
    };
  } catch(e) {
    return { success: false, connected: false, error: e.message };
  }
}

// ─── INTERFAZ UNIFICADA ───────────────────────────────────────────────────────
// Abstrae Binance y Coinbase en la misma API interna

async function getExchangePrice(symbol, exchangeName, keys, isTestnet) {
  if (exchangeName === 'binance') return binanceGetPrice(symbol, isTestnet);
  // Coinbase: precio desde CoinGecko en modo simulado (más fiable para sandbox)
  try {
    const r = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`,
      { timeout: 5000 }
    );
    const price = r.data?.[symbol]?.usd;
    if (price) return { success: true, symbol, price };
    return { success: false, error: 'No price found' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

async function placeOrder(symbol, side, amountUSD, config, keys) {
  const { exchange, mode } = config;
  const isTestnet = mode !== 'real';

  // En modo simulado: siempre devuelve éxito sin llamar al exchange
  if (mode === 'simulated') {
    return {
      success:     true,
      simulated:   true,
      orderId:     `SIM_${Date.now()}_${symbol}`,
      symbol,
      side,
      amountUSD,
      exchange,
      note: 'Orden simulada — no se ejecutó en el exchange'
    };
  }

  // Modo real: llamar al exchange configurado
  if (exchange === 'binance') {
    return binancePlaceOrder(symbol, side, amountUSD, keys, isTestnet);
  } else if (exchange === 'coinbase') {
    return coinbasePlaceOrder(symbol, side, amountUSD, keys, isTestnet);
  }
  return { success: false, error: `Exchange desconocido: ${exchange}` };
}

async function pingExchange(exchangeName, keys, isTestnet) {
  if (exchangeName === 'binance')  return binancePing(keys, isTestnet);
  if (exchangeName === 'coinbase') return coinbasePing(keys, !isTestnet);
  return { success: false, error: 'Exchange no soportado' };
}

async function getAccountBalance(exchangeName, keys, isTestnet) {
  if (exchangeName === 'binance')  return binanceGetBalance(keys, isTestnet);
  if (exchangeName === 'coinbase') return coinbaseGetBalance(keys, !isTestnet);
  return { success: false, error: 'Exchange no soportado' };
}

module.exports = {
  placeOrder,
  pingExchange,
  getAccountBalance,
  getExchangePrice,
  binancePing,
  coinbasePing
};
