import hre from "hardhat";
import * as quais from "quais";
import { HttpNetworkConfig } from "hardhat/types";

const MultisigWalletJson = require("../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json");
const ProxyJson = require("../artifacts/contracts/MultisigWalletProxy.sol/MultisigWalletProxy.json");

async function main() {
  console.log("Debugging proxy deployment...\n");

  const networkConfig = hre.network.config as HttpNetworkConfig;
  const provider = new quais.JsonRpcProvider(
    networkConfig.url,
    undefined,
    { usePathing: true }
  );

  const accounts = networkConfig.accounts as string[];
  const wallet = new quais.Wallet(accounts[0], provider);

  // Implementation address from env var or command line
  const implementationAddress = process.env.MULTISIG_IMPLEMENTATION || process.argv[2];

  if (!implementationAddress) {
    console.error("❌ Implementation address not provided!");
    console.error("Set MULTISIG_IMPLEMENTATION in .env or pass as argument:");
    console.error("  npx hardhat run scripts/debug-proxy.ts --network cyprus1 -- <implementation-address>");
    process.exit(1);
  }

  console.log("Testing direct proxy deployment...");
  console.log("Implementation:", implementationAddress);
  console.log("Deployer:", wallet.address);
  console.log();

  // Encode initialization data
  const iface = new quais.Interface(MultisigWalletJson.abi);
  const initData = iface.encodeFunctionData("initialize", [
    [wallet.address], // owners
    1 // threshold
  ]);

  console.log("Init data:", initData);
  console.log();

  try {
    // Try deploying proxy directly with IPFS hash
    console.log("Deploying proxy with IPFS metadata...");

    // Get IPFS hash for proxy
    const proxyIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
      ProxyJson.bytecode
    );
    console.log("Proxy IPFS hash:", proxyIpfsHash);

    const ProxyFactory = new quais.ContractFactory(
      ProxyJson.abi,
      ProxyJson.bytecode,
      wallet,
      proxyIpfsHash
    );

    const proxy = await ProxyFactory.deploy(implementationAddress, initData);
    await proxy.waitForDeployment();

    const proxyAddress = await proxy.getAddress();
    console.log("✅ Proxy deployed to:", proxyAddress);

    // Try to interact with it
    const multisig = new quais.Contract(
      proxyAddress,
      MultisigWalletJson.abi,
      wallet
    );

    const owners = await multisig.getOwners();
    console.log("Owners:", owners);
    const threshold = await multisig.threshold();
    console.log("Threshold:", threshold.toString());

  } catch (error: any) {
    console.error("\n❌ Error:");
    console.error("Code:", error.code);
    console.error("Message:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
