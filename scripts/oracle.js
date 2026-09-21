require('dotenv').config();
const { ethers } = require('ethers');
const WebSocket = require('ws');

const CONTRACT_ADDRESS = process.env.GUARD_ADDRESS;
const TRACKED_TICKERS = (process.env.TICKERS || 'TSLA').split(',').map((t) => t.trim());

const ABI = [
  'function setStockHaltStatus(bool isHalted) external',
  'function marketHalted() external view returns (bool)',
];

// Polygon.io stocks WebSocket. The LULD channel requires a plan that
// includes it — without that entitlement, fall back to polling SIP
// market-status via REST (see README, "Data source notes").
const WS_URL = process.env.STOCK_WS_URL || 'wss://socket.polygon.io/stocks';

if (!process.env.PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error('PRIVATE_KEY and GUARD_ADDRESS must be set (see .env.example)');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://sepolia.base.org');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const guard = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

async function pushHalt(ticker, halted) {
  console.log(`[ALERT] ${ticker} ${halted ? 'halted' : 'resumed'} — pushing on-chain...`);
  const tx = await guard.setStockHaltStatus(halted);
  const receipt = await tx.wait();
  console.log(
    `[ON-CHAIN] setStockHaltStatus(${halted}) confirmed, block=${receipt.blockNumber} tx=${tx.hash}`,
  );
}

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ action: 'auth', params: process.env.POLYGON_API_KEY }));
    for (const t of TRACKED_TICKERS) {
      ws.send(JSON.stringify({ action: 'subscribe', params: `LULD.${t}` }));
    }
  });

  ws.on('message', async (raw) => {
    let events;
    try {
      events = JSON.parse(raw);
    } catch {
      return;
    }
    for (const ev of events) {
      if (ev.ev === 'status') {
        console.log(`[WS] ${ev.status}: ${ev.message}`);
        continue;
      }
      // LULD event field names follow the Polygon docs; verify against the
      // entitlement of your plan before demo day.
      if (ev.ev === 'LULD' && TRACKED_TICKERS.includes(ev.T)) {
        const halted = ev.s === 'L' || ev.s === 'U' || ev.s === 'H';
        try {
          await pushHalt(ev.T, halted);
        } catch (err) {
          console.error(`[ERROR] pushHalt failed: ${err.message}`);
        }
      }
    }
  });

  ws.on('close', () => {
    console.warn('[WS] connection closed, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });
  ws.on('error', (err) => console.error(`[WS] ${err.message}`));
}

connect();
