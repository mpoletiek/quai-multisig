import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";
import MultisigWalletABI from "../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json";

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const WALLET_ADDRESS = "0x0047126ec7fbe515AbCE1b36ce97f838469e3bDB";
  const TX_HASH = "0xdf7c45c3610e4903c001c691e3916f1c52e4d4b34528cec74e3bf8b9ed02d095";

  console.log("Checking transaction:", TX_HASH);
  console.log("In wallet:", WALLET_ADDRESS);
  console.log("");

  const provider = new quais.JsonRpcProvider("https://rpc.cyprus1.orchard.quai.network");
  const wallet = new quais.Contract(WALLET_ADDRESS, MultisigWalletABI.abi, provider);

  try {
    const tx = await wallet.transactions(TX_HASH);

    console.log("Transaction state:");
    console.log("  To:", tx.to);
    console.log("  Value:", tx.value.toString());
    console.log("  Executed:", tx.executed);
    console.log("  Cancelled:", tx.cancelled);
    console.log("  NumApprovals:", tx.numApprovals.toString());

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    if (tx.to.toLowerCase() === zeroAddress.toLowerCase()) {
      console.log("\n❌ Transaction does NOT exist in contract");
    } else if (tx.cancelled) {
      console.log("\n✅ Transaction is CANCELLED - should be able to re-propose");
    } else if (tx.executed) {
      console.log("\n✅ Transaction was EXECUTED");
    } else {
      console.log("\n⏳ Transaction is PENDING");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
