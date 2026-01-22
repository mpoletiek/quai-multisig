import hre from "hardhat";
import * as quais from "quais";

async function main() {
  const walletAddress = process.argv[2] || "0x00786226b7c87684132caa01b6b119faD91Bfd9F";
  console.log(`Checking wallet: ${walletAddress}\n`);

  const networkConfig = hre.network.config as any;
  const provider = new quais.JsonRpcProvider(
    networkConfig.url,
    undefined,
    { usePathing: true }
  );

  // Get implementation address from proxy
  const proxy = new quais.Contract(
    walletAddress,
    ["function implementation() view returns (address)"],
    provider
  );

  try {
    const implAddress = await proxy.implementation();
    console.log(`Implementation address: ${implAddress}`);

    // Check if implementation has cancelTransaction
    const impl = new quais.Contract(
      implAddress,
      ["function cancelTransaction(bytes32) external"],
      provider
    );

    // Try to estimate gas for a dummy hash
    try {
      const dummyHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
      await impl.cancelTransaction.estimateGas(dummyHash);
      console.log("✓ Implementation HAS cancelTransaction function");
    } catch (error: any) {
      if (error.code === 'CALL_EXCEPTION') {
        console.log("✗ Implementation DOES NOT HAVE cancelTransaction function");
        console.log("  This wallet was deployed with an old implementation.");
      } else {
        console.log("✓ Implementation HAS cancelTransaction function (estimation failed for other reason)");
      }
    }
  } catch (error: any) {
    console.error("Error checking implementation:", error.message);
  }
}

main().catch(console.error);
