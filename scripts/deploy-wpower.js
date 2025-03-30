// scripts/deploy-wpower.js
import pkg from 'hardhat';
const { ethers } = pkg;

async function main() {
  console.log(`Deploying WPOWER to ${network.name}...`);

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);
  
  // Get the contract balance before deployment
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

  // Deploy the WPOWER contract
  const WPOWERFactory = await ethers.getContractFactory("WPOWER");
  const wpower = await WPOWERFactory.deploy();
  
  // Wait for the contract to be deployed
  await wpower.waitForDeployment();
  
  // Get the deployed contract address
  const wpowerAddress = await wpower.getAddress();
  
  console.log(`WPOWER deployed to: ${wpowerAddress}`);
  
  // Log transaction hash
  console.log(`Deployment transaction: ${wpower.deploymentTransaction().hash}`);
  
  // Display gas used if available
  if (wpower.deploymentTransaction().gasLimit) {
    console.log(`Gas limit: ${wpower.deploymentTransaction().gasLimit.toString()}`);
  }

  // Output verification command if not on a local network
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\nTo verify on Etherscan, run:");
    console.log(`npx hardhat verify --network ${network.name} ${wpowerAddress}`);
  }

  return { wpower, wpowerAddress };
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });