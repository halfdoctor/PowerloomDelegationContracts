import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "dotenv/config";

// import "@nomicfoundation/hardhat-chai-matchers";
// import "@nomicfoundation/hardhat-ethers";
// import "hardhat-gas-reporter";

// export default {
//   solidity: "0.8.24",
//   networks: {
//     hardhat: {
//       chainId: 31337,  // Default chain ID for local Hardhat network
//     },
//   },
// };

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
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY // If needed for verification
  }
};
