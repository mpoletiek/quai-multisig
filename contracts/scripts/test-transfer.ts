import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Helper function to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation "${operation}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

async function main() {
  // Use Cyprus1 shard RPC for Cyprus1 addresses (0x00...)
  // Try multiple RPC endpoints
  const RPC_URLS = [
    process.env.RPC_URL || "https://rpc.orchard.quai.network",
    "https://rpc.cyprus1.orchard.quai.network",
    "https://rpc.quai.network"
  ];
  const PRIVATE_KEY = process.env.CYPRUS1_PK;

  if (!PRIVATE_KEY || PRIVATE_KEY === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("CYPRUS1_PK not set in .env file");
  }

  // The wallet address reported as failing
  const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS || "0x0047126ec7fbe515AbCE1b36ce97f838469e3bDB";

  console.log("🔍 Testing Quai transfer to multisig wallet");
  console.log("━".repeat(60));
  console.log("⏰ Starting at:", new Date().toISOString());
  console.log("");

  // Try connecting to different RPC endpoints
  let provider: quais.JsonRpcProvider | null = null;
  let RPC_URL = "";
  
  for (const url of RPC_URLS) {
    try {
      console.log(`📡 Trying RPC: ${url}...`);
      const testProvider = new quais.JsonRpcProvider(
        url,
        undefined,
        { usePathing: true }
      );
      
      // Test connection with a quick call
      await withTimeout(
        testProvider.getBlockNumber(),
        5000,
        `connect to ${url}`
      );
      
      provider = testProvider;
      RPC_URL = url;
      console.log(`✅ Connected to: ${url}`);
      break;
    } catch (error: any) {
      console.log(`❌ Failed to connect to ${url}: ${error.message}`);
      continue;
    }
  }
  
  if (!provider) {
    throw new Error("Failed to connect to any RPC endpoint");
  }
  
  const wallet = new quais.Wallet(PRIVATE_KEY, provider);

  console.log("👤 Sender address:", wallet.address);
  console.log("🎯 Multisig address:", MULTISIG_ADDRESS);
  console.log("");

  try {
    // Check sender balance with timeout
    console.log("💰 Checking sender balance...");
    const senderBalance = await withTimeout(
      provider.getBalance(wallet.address),
      30000,
      "getBalance(sender)"
    );
    console.log("✅ Sender balance:", quais.formatQuai(senderBalance), "QUAI");
    console.log("");

    // Check multisig balance before with timeout
    console.log("💰 Checking multisig balance (before)...");
    const balanceBefore = await withTimeout(
      provider.getBalance(MULTISIG_ADDRESS),
      30000,
      "getBalance(multisig)"
    );
    console.log("✅ Multisig balance (before):", quais.formatQuai(balanceBefore), "QUAI");
    console.log("");

    // Check if contract exists with timeout
    console.log("📄 Checking contract code...");
    const code = await withTimeout(
      provider.getCode(MULTISIG_ADDRESS),
      30000,
      "getCode"
    );
    console.log("✅ Contract deployed:", code !== "0x" && code.length > 2);
    console.log("✅ Bytecode length:", code.length, "characters");
    console.log("");

    // Prepare transaction
    const transferAmount = quais.parseQuai("0.001"); // 0.001 QUAI
    console.log("💸 Attempting to send:", quais.formatQuai(transferAmount), "QUAI");
    console.log("");

    // Estimate gas first with timeout
    console.log("⚙️  Estimating gas...");
    let gasEstimate;
    try {
      gasEstimate = await withTimeout(
        provider.estimateGas({
          from: wallet.address,
          to: MULTISIG_ADDRESS,
          value: transferAmount,
          data: "0x" // Empty data - plain transfer
        }),
        30000,
        "estimateGas"
      );
      console.log("✅ Gas estimate:", gasEstimate.toString());
    } catch (gasError: any) {
      console.error("⚠️  Gas estimation failed:", gasError.message);
      console.log("📝 Using default gas limit: 21000");
      gasEstimate = 21000n;
    }

    // Get gas price with timeout (fallback if it fails)
    console.log("⚙️  Getting gas price...");
    let feeData;
    try {
      feeData = await withTimeout(
        provider.getFeeData(),
        30000,
        "getFeeData"
      );
      console.log("✅ Gas price:", feeData.gasPrice?.toString());
    } catch (gasPriceError: any) {
      console.log("⚠️  Could not get gas price, using default");
      // Use a default gas price for Quai Network
      feeData = { gasPrice: 1000000000n }; // 1 gwei
      console.log("✅ Using default gas price:", feeData.gasPrice.toString());
    }
    console.log("");

    // Send transaction
    console.log("📤 Sending transaction...");
    const tx = await wallet.sendTransaction({
      from: wallet.address,
      to: MULTISIG_ADDRESS,
      value: transferAmount,
      gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
    });

    console.log("✅ Transaction hash:", tx.hash);
    console.log("⏳ Waiting for confirmation (this may take a while)...");
    console.log("⏰ Started waiting at:", new Date().toISOString());

    // Wait for receipt with timeout
    const receipt = await withTimeout(
      tx.wait(),
      120000, // 2 minute timeout
      "tx.wait()"
    );
    
    console.log("✅ Receipt received at:", new Date().toISOString());

    if (!receipt) {
      console.error("❌ No receipt received");
      return;
    }

    console.log("");
    console.log("━".repeat(60));
    console.log("📊 Transaction Receipt:");
    console.log("━".repeat(60));

    // Type guard for TransactionReceipt
    if ('status' in receipt) {
      console.log("✅ Status:", receipt.status === 1 ? "Success" : "Failed");
      console.log("📦 Block number:", receipt.blockNumber);
      console.log("⛽ Gas used:", receipt.gasUsed.toString());
      console.log("💵 Transaction fee:", quais.formatQuai(receipt.gasUsed * (feeData.gasPrice || 0n)), "QUAI");
      console.log("");

      // Check multisig balance after with timeout
      console.log("💰 Checking multisig balance (after)...");
      const balanceAfter = await withTimeout(
        provider.getBalance(MULTISIG_ADDRESS),
        30000,
        "getBalance(multisig after)"
      );
      console.log("✅ Multisig balance (after):", quais.formatQuai(balanceAfter), "QUAI");

      const balanceChange = balanceAfter - balanceBefore;
      console.log("📈 Balance change:", quais.formatQuai(balanceChange), "QUAI");
      console.log("");

      if (receipt.status === 1) {
        console.log("✅ Transfer successful!");
      } else {
        console.log("❌ Transfer failed (reverted)");
        console.log("Receipt:", JSON.stringify(receipt, null, 2));
      }
    } else {
      console.log("Receipt type:", typeof receipt);
      console.log("Receipt:", JSON.stringify(receipt, null, 2));
    }

  } catch (error: any) {
    console.error("");
    console.error("━".repeat(60));
    console.error("❌ Error occurred:");
    console.error("━".repeat(60));
    console.error("⏰ Error time:", new Date().toISOString());
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);

    if (error.transaction) {
      console.error("");
      console.error("Transaction details:");
      console.error("  From:", error.transaction.from);
      console.error("  To:", error.transaction.to);
      console.error("  Value:", error.transaction.value?.toString());
      console.error("  Data:", error.transaction.data);
    }

    if (error.receipt) {
      console.error("");
      console.error("Receipt:");
      console.error(JSON.stringify(error.receipt, null, 2));
    }

    if (error.code) {
      console.error("");
      console.error("Error code:", error.code);
    }

    if (error.reason) {
      console.error("");
      console.error("Error reason:", error.reason);
    }

    console.error("");
    console.error("━".repeat(60));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
