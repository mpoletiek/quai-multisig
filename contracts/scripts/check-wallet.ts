import hre from "hardhat";
import * as quais from "quais";
import { HttpNetworkConfig } from "hardhat/types";

const MultisigWalletJson = require("../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json");
const ProxyJson = require("../artifacts/contracts/MultisigWalletProxy.sol/MultisigWalletProxy.json");

async function main() {
  console.log("Checking wallet deployment...\n");

  const networkConfig = hre.network.config as HttpNetworkConfig;
  const provider = new quais.JsonRpcProvider(
    networkConfig.url,
    undefined,
    { usePathing: true }
  );

  // Get wallet address from command line, env var, or use default
  const walletAddress = process.argv[2] || process.env.MULTISIG_ADDRESS || "0x007D207798636d4Df2B45A0BDC052436eFA20a2A";

  if (!process.argv[2] && !process.env.MULTISIG_ADDRESS) {
    console.log("⚠️  Using default wallet address. Specify via:");
    console.log("   npx ts-node scripts/check-wallet.ts <wallet-address>");
    console.log("   or set MULTISIG_ADDRESS in .env");
    console.log();
  }

  console.log("Wallet address:", walletAddress);
  console.log();

  // Check if contract exists
  const code = await provider.getCode(walletAddress);
  console.log("Contract deployed:", code !== "0x" && code.length > 2);
  console.log("Deployed bytecode length:", code.length);
  console.log();

  if (code === "0x" || code.length <= 2) {
    console.log("❌ No contract at this address!");
    return;
  }

  // Compare with expected bytecode
  console.log("Expected bytecode length:", ProxyJson.deployedBytecode.length);
  console.log("Bytecode matches:", code.toLowerCase() === ProxyJson.deployedBytecode.toLowerCase());
  console.log();

  // Check for receive function in deployed bytecode
  const deployedBytecode = code.toLowerCase();
  const expectedBytecode = ProxyJson.deployedBytecode.toLowerCase();
  
  console.log("Deployed bytecode:", deployedBytecode.substring(0, 100), "...");
  console.log("Expected bytecode:", expectedBytecode.substring(0, 100), "...");
  console.log();

  // Try to interact with wallet
  try {
    const proxy = new quais.Contract(
      walletAddress,
      ProxyJson.abi,
      provider
    );

    const implAddress = await proxy.getImplementation();
    console.log("Implementation address:", implAddress);

    // Check if expected implementation is set in env
    if (process.env.MULTISIG_IMPLEMENTATION) {
      console.log("Expected implementation:", process.env.MULTISIG_IMPLEMENTATION);
      console.log("Implementation matches:", implAddress === process.env.MULTISIG_IMPLEMENTATION);
    }
    console.log();

    const multisig = new quais.Contract(
      walletAddress,
      MultisigWalletJson.abi,
      provider
    );

    const owners = await multisig.getOwners();
    const threshold = await multisig.threshold();
    const balance = await provider.getBalance(walletAddress);

    console.log("Wallet Details:");
    console.log("  Owners:", owners);
    console.log("  Threshold:", threshold.toString());
    console.log("  Balance:", quais.formatQuai(balance), "QUAI");

  } catch (error: any) {
    console.error("❌ Error reading wallet:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
