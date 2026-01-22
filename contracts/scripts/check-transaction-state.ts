import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";
import MultisigWalletABI from "../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json";

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const RPC_URL = "https://rpc.cyprus1.orchard.quai.network";
  const provider = new quais.JsonRpcProvider(RPC_URL);

  // Get wallet address from command line argument or use default
  const WALLET_ADDRESS = process.argv[2] || process.env.MULTISIG_ADDRESS;

  if (!WALLET_ADDRESS) {
    console.error("Please provide wallet address as argument or set MULTISIG_ADDRESS in .env");
    process.exit(1);
  }

  console.log("🔍 Checking transaction state for wallet:", WALLET_ADDRESS);
  console.log("");

  const wallet = new quais.Contract(WALLET_ADDRESS, MultisigWalletABI.abi, provider);

  try {
    // Get current nonce
    const nonce = await wallet.nonce();
    console.log("📊 Current nonce:", nonce.toString());
    console.log("");

    // If user provided a transaction hash as third argument, check that specific transaction
    const TX_HASH = process.argv[3];

    if (TX_HASH) {
      console.log("Checking specific transaction:", TX_HASH);
      const tx = await wallet.transactions(TX_HASH);

      console.log("Transaction details:");
      console.log("  To:", tx.to);
      console.log("  Value:", tx.value.toString());
      console.log("  Data:", tx.data);
      console.log("  Executed:", tx.executed);
      console.log("  Cancelled:", tx.cancelled);
      console.log("  NumApprovals:", tx.numApprovals.toString());
      console.log("  Timestamp:", tx.timestamp.toString());
      console.log("  Proposer:", tx.proposer);
      console.log("");

      // Check if transaction exists
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      if (tx.to.toLowerCase() === zeroAddress.toLowerCase()) {
        console.log("❌ Transaction does not exist in contract");
      } else if (tx.cancelled) {
        console.log("✅ Transaction is CANCELLED - should be able to re-propose");
      } else if (tx.executed) {
        console.log("✅ Transaction was EXECUTED");
      } else {
        console.log("⏳ Transaction is PENDING");
      }
    } else {
      console.log("💡 To check a specific transaction, provide the transaction hash as third argument:");
      console.log("   npx ts-node scripts/check-transaction-state.ts <wallet-address> <tx-hash>");
    }

    // List owners
    console.log("");
    console.log("👥 Wallet owners:");
    const owners = await wallet.getOwners();
    for (let i = 0; i < owners.length; i++) {
      console.log(`  ${i + 1}. ${owners[i]}`);
    }

    // Get threshold
    const threshold = await wallet.threshold();
    console.log("");
    console.log("🎯 Required approvals:", threshold.toString());

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
