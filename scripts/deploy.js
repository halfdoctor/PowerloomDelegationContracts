// scripts/deploy.js
import pkg from 'hardhat';
const { ethers } = pkg;

async function main() {
  // Contract addresses from the network
  const POWERLOOM_STATEold = "0x670E0Cf8c8dF15B326D5E2Db4982172Ff8504909";
  const POWERLOOM_STATE = "0x000AA7d3a6a2556496f363B59e56D9aA1881548F";
  const POWERLOOM_NODESold = "0x0B91dAD5CcE2E91AFE1f794Ec9f4A6b19F67F512";
  const POWERLOOM_NODES = "0x414B8a78bF8c44dDF0Ce753D71CFBeC6ba1eEfbE";
  const INITIAL_BURNER_WALLET = "0x5872a748D5D71c242e66409510FE2212bDd021a1";

  console.log("Deploying PowerLoomDelegation...");

  // Get the contract factory
  const PowerLoomDelegation = await ethers.getContractFactory("PowerloomDelegation");

  // Deploy the implementation and proxy
  const powerloomDelegation = await PowerLoomDelegation.deploy(
    POWERLOOM_STATE,
    POWERLOOM_NODES,
    INITIAL_BURNER_WALLET
  );

  await powerloomDelegation.waitForDeployment();

  console.log("PowerLoomDelegation deployed to:", await powerloomDelegation.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });