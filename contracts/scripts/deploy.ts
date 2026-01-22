import hre from "hardhat";
import * as quais from "quais";
import * as fs from "fs";
import * as path from "path";
import * as deployMetadata from "@quai/hardhat-deploy-metadata";
import { HttpNetworkConfig } from "hardhat/types";

// Import compiled contract artifacts
const MultisigWalletJson = require("../artifacts/contracts/MultisigWallet.sol/MultisigWallet.json");
const ProxyFactoryJson = require("../artifacts/contracts/ProxyFactory.sol/ProxyFactory.json");
const SocialRecoveryModuleJson = require("../artifacts/contracts/modules/SocialRecoveryModule.sol/SocialRecoveryModule.json");
const DailyLimitModuleJson = require("../artifacts/contracts/modules/DailyLimitModule.sol/DailyLimitModule.json");
const WhitelistModuleJson = require("../artifacts/contracts/modules/WhitelistModule.sol/WhitelistModule.json");

async function main() {
  console.log("Starting deployment to Quai Network...\n");
  console.log("Network:", hre.network.name);

  const networkConfig = hre.network.config as HttpNetworkConfig;
  console.log("RPC URL:", networkConfig.url);

  // Set up provider and wallet
  const provider = new quais.JsonRpcProvider(
    networkConfig.url,
    undefined,
    { usePathing: true }
  );

  const accounts = networkConfig.accounts as string[];
  
  if (!accounts || accounts.length === 0 || !accounts[0]) {
    throw new Error(
      "CYPRUS1_PK not set in .env file. Please set CYPRUS1_PK=your_private_key in the root .env file."
    );
  }
  
  // Ensure private key is properly formatted (remove any whitespace, ensure it starts with 0x)
  let privateKey = accounts[0].trim();
  if (!privateKey.startsWith('0x')) {
    privateKey = '0x' + privateKey;
  }
  
  if (privateKey.length !== 66) {
    throw new Error(
      `Invalid private key length: ${privateKey.length} (expected 66 characters including 0x prefix). ` +
      `Please check your CYPRUS1_PK in the .env file.`
    );
  }
  
  const wallet = new quais.Wallet(
    privateKey,
    provider
  );

  console.log("Deploying with account:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Account balance:", quais.formatQuai(balance), "QUAI\n");

  // Deploy MultisigWallet implementation
  console.log("Deploying MultisigWallet implementation...");

  // Get IPFS hash from bytecode before deployment
  const implementationIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
    MultisigWalletJson.bytecode
  );
  console.log("Metadata IPFS hash:", implementationIpfsHash);

  const MultisigWallet = new quais.ContractFactory(
    MultisigWalletJson.abi,
    MultisigWalletJson.bytecode,
    wallet,
    implementationIpfsHash
  );

  const implementation = await MultisigWallet.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  console.log("Transaction hash:", implementation.deploymentTransaction()?.hash);
  console.log("MultisigWallet implementation deployed to:", implementationAddress);

  // Deploy ProxyFactory
  console.log("\nDeploying ProxyFactory...");

  const factoryIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
    ProxyFactoryJson.bytecode
  );
  console.log("Metadata IPFS hash:", factoryIpfsHash);

  const ProxyFactory = new quais.ContractFactory(
    ProxyFactoryJson.abi,
    ProxyFactoryJson.bytecode,
    wallet,
    factoryIpfsHash
  );

  const factory = await ProxyFactory.deploy(implementationAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("Transaction hash:", factory.deploymentTransaction()?.hash);
  console.log("ProxyFactory deployed to:", factoryAddress);

  // Deploy SocialRecoveryModule
  console.log("\nDeploying SocialRecoveryModule...");

  const socialRecoveryIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
    SocialRecoveryModuleJson.bytecode
  );
  console.log("Metadata IPFS hash:", socialRecoveryIpfsHash);

  const SocialRecoveryModule = new quais.ContractFactory(
    SocialRecoveryModuleJson.abi,
    SocialRecoveryModuleJson.bytecode,
    wallet,
    socialRecoveryIpfsHash
  );

  const socialRecovery = await SocialRecoveryModule.deploy();
  await socialRecovery.waitForDeployment();
  const socialRecoveryAddress = await socialRecovery.getAddress();
  console.log("Transaction hash:", socialRecovery.deploymentTransaction()?.hash);
  console.log("SocialRecoveryModule deployed to:", socialRecoveryAddress);

  // Deploy DailyLimitModule
  console.log("\nDeploying DailyLimitModule...");

  const dailyLimitIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
    DailyLimitModuleJson.bytecode
  );
  console.log("Metadata IPFS hash:", dailyLimitIpfsHash);

  const DailyLimitModule = new quais.ContractFactory(
    DailyLimitModuleJson.abi,
    DailyLimitModuleJson.bytecode,
    wallet,
    dailyLimitIpfsHash
  );

  const dailyLimit = await DailyLimitModule.deploy();
  await dailyLimit.waitForDeployment();
  const dailyLimitAddress = await dailyLimit.getAddress();
  console.log("Transaction hash:", dailyLimit.deploymentTransaction()?.hash);
  console.log("DailyLimitModule deployed to:", dailyLimitAddress);

  // Deploy WhitelistModule
  console.log("\nDeploying WhitelistModule...");

  const whitelistIpfsHash = await hre.deployMetadata.pushMetadataToIPFSWithBytecode(
    WhitelistModuleJson.bytecode
  );
  console.log("Metadata IPFS hash:", whitelistIpfsHash);

  const WhitelistModule = new quais.ContractFactory(
    WhitelistModuleJson.abi,
    WhitelistModuleJson.bytecode,
    wallet,
    whitelistIpfsHash
  );

  const whitelist = await WhitelistModule.deploy();
  await whitelist.waitForDeployment();
  const whitelistAddress = await whitelist.getAddress();
  console.log("Transaction hash:", whitelist.deploymentTransaction()?.hash);
  console.log("WhitelistModule deployed to:", whitelistAddress);

  // Save deployment addresses
  const deployment = {
    network: hre.network.name,
    chainId: (await provider.getNetwork()).chainId.toString(),
    deployer: wallet.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MultisigWallet: implementationAddress,
      ProxyFactory: factoryAddress,
      SocialRecoveryModule: socialRecoveryAddress,
      DailyLimitModule: dailyLimitAddress,
      WhitelistModule: whitelistAddress,
    },
    ipfsHashes: {
      MultisigWallet: implementationIpfsHash,
      ProxyFactory: factoryIpfsHash,
      SocialRecoveryModule: socialRecoveryIpfsHash,
      DailyLimitModule: dailyLimitIpfsHash,
      WhitelistModule: whitelistIpfsHash,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const deploymentFile = path.join(
    deploymentsDir,
    `deployment-${hre.network.name}-${Date.now()}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

  console.log("\n✅ Deployment complete!");
  console.log("Deployment details saved to:", deploymentFile);
  console.log("\nContract Addresses:");
  console.log("-------------------");
  console.log("MultisigWallet Implementation:", implementationAddress);
  console.log("ProxyFactory:", factoryAddress);
  console.log("SocialRecoveryModule:", socialRecoveryAddress);
  console.log("DailyLimitModule:", dailyLimitAddress);
  console.log("WhitelistModule:", whitelistAddress);

  console.log("\n📝 Add these to your .env file:");
  console.log("-------------------");
  console.log(`MULTISIG_IMPLEMENTATION=${implementationAddress}`);
  console.log(`PROXY_FACTORY=${factoryAddress}`);
  console.log(`SOCIAL_RECOVERY_MODULE=${socialRecoveryAddress}`);
  console.log(`DAILY_LIMIT_MODULE=${dailyLimitAddress}`);
  console.log(`WHITELIST_MODULE=${whitelistAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
