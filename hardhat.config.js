import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "dotenv/config";

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,  // Default chain ID for local Hardhat network
    },
    power: {
      url: "https://rpc.powerloom.network",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 7865, // Power network chain ID
    },
    power2: {
      url: "https://rpc-v2.powerloom.network",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 7869, // Power network chain ID
    }
  },
  etherscan: {
    apiKey: {
      'powerloom-mainnet-v2': 'empty'
    },
    customChains: [
      {
        network: "powerloom-mainnet-v2",
        chainId: 7869,
        urls: {
          apiURL: "https://explorer-powerloom-mainnet-v2-v52tbqo4if.t.conduit.xyz/api",
          browserURL: "https://explorer-powerloom-mainnet-v2-v52tbqo4if.t.conduit.xyz:443"
        }
      }
    ]
  }
};