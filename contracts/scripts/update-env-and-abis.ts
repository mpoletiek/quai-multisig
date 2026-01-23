import * as fs from "fs";
import * as path from "path";

/**
 * Script to update .env files and frontend ABIs after deployment
 * Usage: npx hardhat run scripts/update-env-and-abis.ts --network cyprus1
 */

async function main() {
  // Find the latest deployment file
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFiles = fs.readdirSync(deploymentsDir)
    .filter((f) => f.startsWith("deployment-cyprus1-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (deploymentFiles.length === 0) {
    console.error("No deployment files found!");
    process.exit(1);
  }

  const latestDeploymentFile = path.join(deploymentsDir, deploymentFiles[0]);
  console.log(`Reading deployment from: ${deploymentFiles[0]}`);

  const deployment = JSON.parse(fs.readFileSync(latestDeploymentFile, "utf-8"));
  const { contracts } = deployment;

  console.log("\n📝 Updating .env files...");
  console.log("-------------------");

  // Update root .env file
  const rootEnvPath = path.join(__dirname, "..", "..", ".env");
  updateEnvFile(rootEnvPath, contracts, false);

  // Update frontend/.env file
  const frontendEnvPath = path.join(__dirname, "..", "..", "frontend", ".env");
  updateEnvFile(frontendEnvPath, contracts, true);

  console.log("\n📦 Copying ABIs to frontend...");
  console.log("-------------------");

  // Copy ABIs to frontend
  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  const frontendAbiDir = path.join(__dirname, "..", "..", "frontend", "src", "config", "abi");

  // Copy MultisigWallet ABI
  const multisigWalletArtifact = path.join(artifactsDir, "MultisigWallet.sol", "MultisigWallet.json");
  const multisigWalletAbi = JSON.parse(fs.readFileSync(multisigWalletArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "MultisigWallet.json"),
    JSON.stringify({ abi: multisigWalletAbi.abi }, null, 2)
  );
  console.log("✅ Copied MultisigWallet.json");

  // Copy MultisigWalletProxy ABI and bytecode
  const proxyArtifact = path.join(artifactsDir, "MultisigWalletProxy.sol", "MultisigWalletProxy.json");
  const proxyAbi = JSON.parse(fs.readFileSync(proxyArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "MultisigWalletProxy.json"),
    JSON.stringify({ 
      abi: proxyAbi.abi, 
      bytecode: proxyAbi.bytecode,
      deployedBytecode: proxyAbi.deployedBytecode 
    }, null, 2)
  );
  console.log("✅ Copied MultisigWalletProxy.json");

  // Copy ProxyFactory ABI
  const factoryArtifact = path.join(artifactsDir, "ProxyFactory.sol", "ProxyFactory.json");
  const factoryAbi = JSON.parse(fs.readFileSync(factoryArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "ProxyFactory.json"),
    JSON.stringify({ abi: factoryAbi.abi }, null, 2)
  );
  console.log("✅ Copied ProxyFactory.json");

  // Copy SocialRecoveryModule ABI
  const socialRecoveryArtifact = path.join(artifactsDir, "modules", "SocialRecoveryModule.sol", "SocialRecoveryModule.json");
  const socialRecoveryAbi = JSON.parse(fs.readFileSync(socialRecoveryArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "SocialRecoveryModule.json"),
    JSON.stringify({ abi: socialRecoveryAbi.abi }, null, 2)
  );
  console.log("✅ Copied SocialRecoveryModule.json");

  // Copy DailyLimitModule ABI
  const dailyLimitArtifact = path.join(artifactsDir, "modules", "DailyLimitModule.sol", "DailyLimitModule.json");
  const dailyLimitAbi = JSON.parse(fs.readFileSync(dailyLimitArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "DailyLimitModule.json"),
    JSON.stringify({ abi: dailyLimitAbi.abi }, null, 2)
  );
  console.log("✅ Copied DailyLimitModule.json");

  // Copy WhitelistModule ABI
  const whitelistArtifact = path.join(artifactsDir, "modules", "WhitelistModule.sol", "WhitelistModule.json");
  const whitelistAbi = JSON.parse(fs.readFileSync(whitelistArtifact, "utf-8"));
  fs.writeFileSync(
    path.join(frontendAbiDir, "WhitelistModule.json"),
    JSON.stringify({ abi: whitelistAbi.abi }, null, 2)
  );
  console.log("✅ Copied WhitelistModule.json");

  console.log("\n✅ All updates complete!");
  console.log("\nContract Addresses:");
  console.log("-------------------");
  console.log(`MULTISIG_IMPLEMENTATION=${contracts.MultisigWallet}`);
  console.log(`PROXY_FACTORY=${contracts.ProxyFactory}`);
  console.log(`SOCIAL_RECOVERY_MODULE=${contracts.SocialRecoveryModule}`);
  console.log(`DAILY_LIMIT_MODULE=${contracts.DailyLimitModule}`);
  console.log(`WHITELIST_MODULE=${contracts.WhitelistModule}`);
}

function updateEnvFile(envPath: string, contracts: any, isFrontend: boolean) {
  const prefix = isFrontend ? "VITE_" : "";
  
  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }

  // Update or add contract addresses
  const envVars: { [key: string]: string } = {
    [`${prefix}MULTISIG_IMPLEMENTATION`]: contracts.MultisigWallet,
    [`${prefix}PROXY_FACTORY`]: contracts.ProxyFactory,
    [`${prefix}SOCIAL_RECOVERY_MODULE`]: contracts.SocialRecoveryModule,
    [`${prefix}DAILY_LIMIT_MODULE`]: contracts.DailyLimitModule,
    [`${prefix}WHITELIST_MODULE`]: contracts.WhitelistModule,
  };

  // Update existing lines or append new ones
  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
      console.log(`✅ Updated ${key} in ${path.basename(envPath)}`);
    } else {
      // Append if not found
      envContent += (envContent.endsWith("\n") ? "" : "\n") + `${key}=${value}\n`;
      console.log(`✅ Added ${key} to ${path.basename(envPath)}`);
    }
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Updated ${path.basename(envPath)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
