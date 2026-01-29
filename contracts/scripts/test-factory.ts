import hre from "hardhat";
import * as quais from "quais";
import { HttpNetworkConfig } from "hardhat/types";

const ProxyFactoryJson = require("../artifacts/contracts/ProxyFactory.sol/ProxyFactory.json");

async function main() {
  console.log("Testing ProxyFactory wallet creation...\n");

  const networkConfig = hre.network.config as HttpNetworkConfig;
  const provider = new quais.JsonRpcProvider(
    networkConfig.url,
    undefined,
    { usePathing: true }
  );

  const accounts = networkConfig.accounts as string[];
  const wallet = new quais.Wallet(accounts[0], provider);

  console.log("Using wallet:", wallet.address);

  // Factory address from env var or command line
  const factoryAddress = process.env.PROXY_FACTORY || process.argv[2];

  if (!factoryAddress) {
    console.error("❌ Factory address not provided!");
    console.error("Set PROXY_FACTORY in .env or pass as argument:");
    console.error("  npx hardhat run scripts/test-factory.ts --network cyprus1 -- <factory-address>");
    process.exit(1);
  }

  console.log("Factory address:", factoryAddress);
  console.log();

  const factory = new quais.Contract(
    factoryAddress,
    ProxyFactoryJson.abi,
    wallet
  );

  // Test parameters
  const owners = [wallet.address];
  const threshold = 1;
  const salt = quais.hexlify(quais.randomBytes(32));

  console.log("Test parameters:");
  console.log("  Owners:", owners);
  console.log("  Threshold:", threshold);
  console.log("  Salt:", salt);
  console.log();

  try {
    console.log("Calling createWallet...");
    const tx = await factory.createWallet(owners, threshold, salt);
    console.log("Transaction sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);

    // Find WalletCreated event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed?.name === 'WalletCreated';
      } catch {
        return false;
      }
    });

    if (event) {
      const parsedEvent = factory.interface.parseLog(event);
      console.log("\n✅ Wallet created successfully!");
      console.log("Wallet address:", parsedEvent?.args.wallet);
    }
  } catch (error: any) {
    console.error("\n❌ Error creating wallet:");
    console.error("Code:", error.code);
    console.error("Message:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.data) {
      console.error("Data:", error.data);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
