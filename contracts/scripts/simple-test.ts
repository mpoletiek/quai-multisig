import { quais } from "quais";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const RPC_URL = "https://rpc.cyprus1.orchard.quai.network";
  const MULTISIG_ADDRESS = "0x007D207798636d4Df2B45A0BDC052436eFA20a2A";

  console.log("Connecting to:", RPC_URL);
  const provider = new quais.JsonRpcProvider(RPC_URL);

  console.log("Checking balance...");
  const balance = await provider.getBalance(MULTISIG_ADDRESS);
  console.log("Balance:", quais.formatQuai(balance), "QUAI");

  console.log("Getting code...");
  const code = await provider.getCode(MULTISIG_ADDRESS);
  console.log("Deployed:", code !== "0x", "Length:", code.length);

  console.log("Done!");
}

main().catch(console.error);
