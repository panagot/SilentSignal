require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.26",
  networks: {
    hardhat: {
      type: "edr-simulated",
    },
    baseSepolia: {
      type: "http",
      url: BASE_SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 84532,
    },
  },
};
