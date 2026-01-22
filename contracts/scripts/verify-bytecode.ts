import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MultisigWalletProxyJson = require("../artifacts/contracts/MultisigWalletProxy.sol/MultisigWalletProxy.json");

async function main() {
  const RPC_URL = process.env.RPC_URL || "https://rpc.orchard.quai.network";
  const WALLET_ADDRESS = process.env.WALLET_ADDRESS || "0x0021F2a671B6bFd9c94EEc60Fa34033ec9c175e3";

  console.log("🔍 Verifying MultisigWalletProxy Bytecode");
  console.log("━".repeat(60));
  console.log("Wallet address:", WALLET_ADDRESS);
  console.log("");

  const provider = new quais.JsonRpcProvider(
    RPC_URL,
    undefined,
    { usePathing: true }
  );

  // Get on-chain bytecode
  console.log("📡 Fetching on-chain bytecode...");
  const onChainCode = await provider.getCode(WALLET_ADDRESS);
  const onChainBytecode = onChainCode.replace('0x', '');

  // Get expected bytecode
  const expectedBytecode = MultisigWalletProxyJson.deployedBytecode.replace('0x', '');

  console.log("✅ On-chain bytecode length:", onChainBytecode.length);
  console.log("✅ Expected bytecode length:", expectedBytecode.length);
  console.log("");

  // Extract IPFS hashes
  const ipfsMarker = 'a264697066735822';
  const onChainIdx = onChainBytecode.lastIndexOf(ipfsMarker);
  const expectedIdx = expectedBytecode.lastIndexOf(ipfsMarker);

  if (onChainIdx !== -1 && expectedIdx !== -1) {
    const onChainHash = onChainBytecode.slice(onChainIdx + ipfsMarker.length, onChainIdx + ipfsMarker.length + 68);
    const expectedHash = expectedBytecode.slice(expectedIdx + ipfsMarker.length, expectedIdx + ipfsMarker.length + 68);
    
    console.log("📦 IPFS Hashes:");
    console.log("  On-chain:   ", onChainHash);
    console.log("  Expected:  ", expectedHash);
    console.log("  Match:     ", onChainHash === expectedHash);
    console.log("");
  }

  // Check if bytecodes match
  const bytecodeMatch = onChainBytecode.toLowerCase() === expectedBytecode.toLowerCase();
  console.log("━".repeat(60));
  if (bytecodeMatch) {
    console.log("✅ BYTECODE MATCHES - Wallet has correct receive() function");
    console.log("   The wallet should be able to receive QUAI.");
  } else {
    console.log("❌ BYTECODE MISMATCH - Wallet has OLD bytecode");
    console.log("   This wallet was deployed with bytecode that doesn't include");
    console.log("   the fixed receive() function.");
    console.log("");
    console.log("⚠️  SOLUTION: Deploy a NEW wallet using the updated frontend.");
    console.log("   The old wallet cannot be fixed without redeployment.");
  }
  console.log("━".repeat(60));

  // Check for receive function patterns
  console.log("");
  console.log("🔍 Checking for receive() function patterns:");
  console.log("  Has delegatecall (f4):", onChainBytecode.includes('f4'));
  console.log("  Has calldatacopy (36):", onChainBytecode.includes('36'));
  console.log("  Has returndatacopy (3e):", onChainBytecode.includes('3e'));
  console.log("  Has assembly switch (5b):", onChainBytecode.includes('5b'));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
