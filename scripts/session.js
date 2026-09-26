require('dotenv').config();
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = process.env.GUARD_ADDRESS;
const POLL_MS = Number(process.env.SESSION_POLL_MS || 30000);

// ERC-8392 Session enum values.
const SESSION = { REGULAR: 1, EXTENDED: 2, CLOSED: 4 };

// US equity session schedule in America/New_York wall time. Exchange
// holidays and early closes are not encoded here — wire an official
// calendar before relying on this outside the demo.
const ET = 'America/New_York';
const WEEKDAY_BOUNDARIES = [
  { minutes: 4 * 60, session: SESSION.EXTENDED }, // 04:00 pre-market opens
  { minutes: 9 * 60 + 30, session: SESSION.REGULAR }, // 09:30 regular session
  { minutes: 16 * 60, session: SESSION.EXTENDED }, // 16:00 post-market
  { minutes: 20 * 60, session: SESSION.CLOSED }, // 20:00 close
];

const ABI = [
  'function setMarketSession(uint8 session, uint64 nextTransition) external',
  'function marketSession() external view returns (uint8)',
];

if (!process.env.PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error('PRIVATE_KEY and GUARD_ADDRESS must be set (see .env.example)');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://sepolia.base.org');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const guard = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

function etParts(date) {
  const parts = {};
  for (const p of etFormatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Offset of ET wall time ahead of UTC at the given instant, in ms.
function etOffsetMs(date) {
  const p = etParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

// Convert an ET wall-clock time to a UTC epoch (ms), refining the offset once.
function etToUtcMs(year, month, day, minutes) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes) - etOffsetMs(new Date());
  return Date.UTC(year, month - 1, day, 0, minutes) - etOffsetMs(new Date(guess));
}

function sessionAt(date) {
  const p = etParts(date);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return SESSION.CLOSED;
  let session = SESSION.CLOSED;
  for (const b of WEEKDAY_BOUNDARIES) {
    if (p.minutes >= b.minutes) session = b.session;
  }
  return session;
}

// Next scheduled session change after `date`, as a unix timestamp (seconds).
function nextTransitionAt(date) {
  const p = etParts(date);
  for (let d = 0; d < 8; d++) {
    // Calendar arithmetic in UTC space: a calendar date has the same
    // weekday in every timezone, so UTC getters are safe here.
    const cal = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
    const wd = cal.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const y = cal.getUTCFullYear();
    const m = cal.getUTCMonth() + 1;
    const dd = cal.getUTCDate();
    for (const b of WEEKDAY_BOUNDARIES) {
      const t = etToUtcMs(y, m, dd, b.minutes);
      if (t > date.getTime()) return Math.floor(t / 1000);
    }
  }
  return 0;
}

async function tick(lastPushed) {
  const now = new Date();
  const session = sessionAt(now);
  if (session === lastPushed) return lastPushed;

  const next = nextTransitionAt(now);
  const names = { 1: 'REGULAR', 2: 'EXTENDED', 4: 'CLOSED' };
  console.log(
    `[SESSION] ${names[session]} — pushing on-chain (next transition ${new Date(next * 1000).toISOString()})...`,
  );
  try {
    const tx = await guard.setMarketSession(session, next);
    const receipt = await tx.wait();
    console.log(
      `[ON-CHAIN] setMarketSession(${session}, ${next}) confirmed, block=${receipt.blockNumber} tx=${tx.hash}`,
    );
    return session;
  } catch (err) {
    console.error(`[ERROR] setMarketSession failed: ${err.message}`);
    return lastPushed;
  }
}

async function main() {
  let lastPushed = Number(await guard.marketSession());
  console.log(`[INIT] on-chain session=${lastPushed}, polling every ${POLL_MS / 1000}s`);
  lastPushed = await tick(-1); // always push once at startup
  setInterval(async () => {
    lastPushed = await tick(lastPushed);
  }, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
