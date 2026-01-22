import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";
import MultisigWalletABI from "../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json";

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const RPC_URL = "https://rpc.cyprus1.orchard.quai.network";
  const PRIVATE_KEY = process.env.CYPRUS1_PK;
  const WALLET_ADDRESS = process.argv[2] || "0x0047126ec7fbe515AbCE1b36ce97f838469e3bDB";

  if (!PRIVATE_KEY) {
    throw new Error("CYPRUS1_PK not set in .env file");
  }

  console.log("🔄 Incrementing nonce for wallet:", WALLET_ADDRESS);
  console.log("━".repeat(60));

  const provider = new quais.JsonRpcProvider(RPC_URL);
  const signer = new quais.Wallet(PRIVATE_KEY, provider);
  const wallet = new quais.Contract(WALLET_ADDRESS, MultisigWalletABI.abi, signer);

  // Get current nonce
  const currentNonce = await wallet.nonce();
  console.log("📊 Current nonce:", currentNonce.toString());

  // Get threshold
  const threshold = await wallet.threshold();
  console.log("🎯 Threshold:", threshold.toString());

  // Self-send a tiny amount (0.0001 QUAI) to increment nonce
  const dummyTo = WALLET_ADDRESS; // Send to self
  const dummyValue = quais.parseQuai("0.0001"); // Very small amount
  const dummyData = "0x"; // No data

  console.log("");
  console.log("📤 Proposing dummy transaction to increment nonce...");
  console.log("  To:", dummyTo);
  console.log("  Value:", quais.formatQuai(dummyValue), "QUAI");

  try {
    // Propose the transaction
    const proposeTx = await wallet.proposeTransaction(dummyTo, dummyValue, dummyData);
    console.log("✅ Proposal transaction sent:", proposeTx.hash);

    const proposeReceipt = await proposeTx.wait();
    console.log("✅ Proposal confirmed in block:", proposeReceipt.blockNumber);

    // Extract transaction hash from event
    let txHash: string | null = null;
    for (const log of proposeReceipt.logs) {
      try {
        const parsed = wallet.interface.parseLog(log);
        if (parsed && parsed.name === 'TransactionProposed') {
          txHash = parsed.args.txHash;
          break;
        }
      } catch (e) {
        // Skip logs that can't be parsed
      }
    }

    if (!txHash) {
      throw new Error("Could not find TransactionProposed event");
    }

    console.log("📝 Multisig transaction hash:", txHash);
    console.log("");

    // If threshold is 1, we can execute immediately
    if (threshold === 1n) {
      console.log("⚡ Threshold is 1, approving and executing immediately...");

      // Approve
      const approveTx = await wallet.approveTransaction(txHash);
      console.log("✅ Approval transaction sent:", approveTx.hash);
      await approveTx.wait();
      console.log("✅ Approval confirmed");

      // Execute
      const executeTx = await wallet.executeTransaction(txHash);
      console.log("✅ Execution transaction sent:", executeTx.hash);
      await executeTx.wait();
      console.log("✅ Execution confirmed");

      // Check new nonce
      const newNonce = await wallet.nonce();
      console.log("");
      console.log("━".repeat(60));
      console.log("✅ SUCCESS!");
      console.log("📊 Old nonce:", currentNonce.toString());
      console.log("📊 New nonce:", newNonce.toString());
      console.log("━".repeat(60));
      console.log("");
      console.log("You can now re-propose your cancelled transaction!");

    } else {
      console.log("⚠️  Threshold is", threshold.toString());
      console.log("📝 Transaction hash:", txHash);
      console.log("");
      console.log("Next steps:");
      console.log("1. Get", threshold.toString(), "owner(s) to approve transaction:", txHash);
      console.log("2. Execute the transaction");
      console.log("3. Then you can re-propose your cancelled transaction");
    }

  } catch (error: any) {
    console.error("");
    console.error("❌ Error:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
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
