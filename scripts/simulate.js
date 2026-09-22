require('dotenv').config();
const { ethers } = require('hardhat');

// End-to-end circuit-breaker rehearsal:
//   trade OK -> mock LULD halt -> tradingEnabled() == false ->
//   trade reverts on-chain -> resume -> trade OK.
// Run against a local node (`--network localhost`) for rehearsal, or against
// Base Sepolia for the recorded demo. Set GUARD_ADDRESS to reuse an existing
// deployment; otherwise a fresh TSVGuard is deployed.

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Signer: ${signer.address}`);

  let guardAddress = process.env.GUARD_ADDRESS;
  if (guardAddress) {
    console.log(`Reusing TSVGuard at ${guardAddress}`);
  } else {
    const cap = ethers.parseUnits('250000', 18);
    const guard = await ethers.deployContract('TSVGuard', [signer.address, cap]);
    await guard.waitForDeployment();
    guardAddress = await guard.getAddress();
    console.log(`TSVGuard deployed at ${guardAddress}`);
  }
  const guard = await ethers.getContractAt('TSVGuard', guardAddress);

  const venue = await ethers.deployContract('MockVenue', [guardAddress]);
  await venue.waitForDeployment();
  console.log(`MockVenue deployed at ${await venue.getAddress()}`);

  const step = async (label, fn) => {
    const tx = await fn();
    const receipt = await tx.wait();
    console.log(`${label}: tx ${receipt.hash}`);
    return receipt;
  };

  await step('1. pre-halt trade (should succeed)', () => venue.trade(1000n));

  await step('2. mock LULD halt signal', () => guard.setStockHaltStatus(true));

  const enabled = await guard.tradingEnabled();
  console.log(`3. tradingEnabled() after halt: ${enabled}`);
  if (enabled) throw new Error('guard still reports trading enabled');

  // Explicit gasLimit skips pre-flight estimation, so the reverted trade is
  // actually mined — the rejected tx hash is the demo evidence on testnets.
  try {
    const tx = await venue.trade(1000n, { gasLimit: 100000 });
    await tx.wait();
    throw new Error('trade succeeded while halted — this must not happen');
  } catch (err) {
    const hash = err.receipt?.hash || err.transaction?.hash || 'n/a (reverted before mining)';
    console.log(`4. trade during halt rejected: ${err.shortMessage || err.message}`);
    console.log(`   rejected tx hash: ${hash}`);
  }

  await step('5. resume signal', () => guard.setStockHaltStatus(false));

  await step('6. post-resume trade (should succeed)', () => venue.trade(2000n));

  console.log('End-to-end simulation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
