import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  // Use Cyprus1 shard RPC for Cyprus1 addresses (0x00...)
  const RPC_URL = "https://rpc.cyprus1.orchard.quai.network";
  const PRIVATE_KEY = process.env.CYPRUS1_PK;

  if (!PRIVATE_KEY || PRIVATE_KEY === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("CYPRUS1_PK not set in .env file");
  }

  // The wallet address reported as failing
  const MULTISIG_ADDRESS = "0x0021F2a671B6bFd9c94EEc60Fa34033ec9c175e3";

  console.log("🔍 Testing Quai transfer to multisig wallet");
  console.log("━".repeat(60));

  // Connect to network
  const provider = new quais.JsonRpcProvider(RPC_URL);
  const wallet = new quais.Wallet(PRIVATE_KEY, provider);

  console.log("📡 Connected to:", RPC_URL);
  console.log("👤 Sender address:", wallet.address);
  console.log("🎯 Multisig address:", MULTISIG_ADDRESS);
  console.log("");

  // Check sender balance
  const senderBalance = await provider.getBalance(wallet.address);
  console.log("💰 Sender balance:", quais.formatQuai(senderBalance), "QUAI");

  // Check multisig balance before
  const balanceBefore = await provider.getBalance(MULTISIG_ADDRESS);
  console.log("💰 Multisig balance (before):", quais.formatQuai(balanceBefore), "QUAI");
  console.log("");

  // Check if contract exists
  const code = await provider.getCode(MULTISIG_ADDRESS);
  console.log("📄 Contract deployed:", code !== "0x" && code.length > 2);
  console.log("📄 Bytecode length:", code.length, "characters");
  console.log("");

  // Prepare transaction
  const transferAmount = quais.parseQuai("0.001"); // 0.001 QUAI
  console.log("💸 Attempting to send:", quais.formatQuai(transferAmount), "QUAI");
  console.log("");

  try {
    // Estimate gas first
    console.log("⚙️  Estimating gas...");
    const gasEstimate = await provider.estimateGas({
      from: wallet.address,
      to: MULTISIG_ADDRESS,
      value: transferAmount,
      data: "0x" // Empty data - plain transfer
    });
    console.log("⛽ Gas estimate:", gasEstimate.toString());

    // Get gas price
    const feeData = await provider.getFeeData();
    console.log("⛽ Gas price:", feeData.gasPrice?.toString());
    console.log("");

    // Send transaction
    console.log("📤 Sending transaction...");
    const tx = await wallet.sendTransaction({
      from: wallet.address,
      to: MULTISIG_ADDRESS,
      value: transferAmount,
      gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
    });

    console.log("📝 Transaction hash:", tx.hash);
    console.log("⏳ Waiting for confirmation...");

    // Wait for receipt
    const receipt = await tx.wait();

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

      // Check multisig balance after
      const balanceAfter = await provider.getBalance(MULTISIG_ADDRESS);
      console.log("💰 Multisig balance (after):", quais.formatQuai(balanceAfter), "QUAI");

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
    console.error("━".repeat(60));
    console.error("❌ Transaction failed with error:");
    console.error("━".repeat(60));
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);

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

    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
