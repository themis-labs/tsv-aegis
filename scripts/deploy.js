require('dotenv').config();
const { ethers, run } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = process.env.ORACLE_ADDRESS || deployer.address;
  const maxDailyCap = process.env.MAX_DAILY_CAP || ethers.parseUnits('250000', 18);

  console.log(
    `Deploying TSVGuard: deployer=${deployer.address} oracle=${oracle} cap=${maxDailyCap}`,
  );

  const guard = await ethers.deployContract('TSVGuard', [oracle, maxDailyCap]);
  await guard.waitForDeployment();
  const address = await guard.getAddress();
  console.log(`TSVGuard deployed at ${address}`);

  if (process.env.VERIFY === 'true') {
    console.log('Waiting 5 confirmations before source verification...');
    await guard.deploymentTransaction().wait(5);
    try {
      await run('verify:verify', { address, constructorArguments: [oracle, maxDailyCap] });
      console.log('Source verified on explorer.');
    } catch (err) {
      console.warn(`Verification failed (retry manually): ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
