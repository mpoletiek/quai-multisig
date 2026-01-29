import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";

/**
 * Automatically copies contract ABIs to frontend after compilation
 * This runs as a post-compile hook, so ABIs stay in sync automatically
 */
export function setupAbiCopyTask() {
  task(TASK_COMPILE, "Compiles contracts and copies ABIs to frontend")
    .setAction(async (args, hre, runSuper) => {
      // Run the original compile task first
      const compilationOutput = await runSuper(args);

      // Only copy ABIs if compilation succeeded and artifacts exist
      try {
        copyAbisToFrontend();
      } catch (error) {
        console.warn("⚠️  Warning: Could not copy ABIs to frontend:", (error as Error).message);
        // Don't fail the compilation if ABI copy fails
      }

      return compilationOutput;
    });
}

/**
 * Copies contract ABIs from artifacts to frontend/src/config/abi/
 */
function copyAbisToFrontend() {
  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  const frontendAbiDir = path.join(__dirname, "..", "..", "frontend", "src", "config", "abi");

  // Check if frontend ABI directory exists
  if (!fs.existsSync(frontendAbiDir)) {
    console.log("ℹ️  Frontend ABI directory not found, skipping ABI copy");
    return;
  }

  // Check if artifacts exist
  if (!fs.existsSync(artifactsDir)) {
    console.log("ℹ️  Artifacts not found, skipping ABI copy");
    return;
  }

  let copiedCount = 0;

  // Contract configurations: [artifact path, output filename, include bytecode]
  const contracts = [
    {
      name: "MultisigWallet",
      artifactPath: path.join(artifactsDir, "MultisigWallet.sol", "MultisigWallet.json"),
      outputPath: path.join(frontendAbiDir, "MultisigWallet.json"),
      includeBytecode: false,
    },
    {
      name: "MultisigWalletProxy",
      artifactPath: path.join(artifactsDir, "MultisigWalletProxy.sol", "MultisigWalletProxy.json"),
      outputPath: path.join(frontendAbiDir, "MultisigWalletProxy.json"),
      includeBytecode: true,
    },
    {
      name: "ProxyFactory",
      artifactPath: path.join(artifactsDir, "ProxyFactory.sol", "ProxyFactory.json"),
      outputPath: path.join(frontendAbiDir, "ProxyFactory.json"),
      includeBytecode: false,
    },
    {
      name: "SocialRecoveryModule",
      artifactPath: path.join(artifactsDir, "modules", "SocialRecoveryModule.sol", "SocialRecoveryModule.json"),
      outputPath: path.join(frontendAbiDir, "SocialRecoveryModule.json"),
      includeBytecode: false,
    },
    {
      name: "DailyLimitModule",
      artifactPath: path.join(artifactsDir, "modules", "DailyLimitModule.sol", "DailyLimitModule.json"),
      outputPath: path.join(frontendAbiDir, "DailyLimitModule.json"),
      includeBytecode: false,
    },
    {
      name: "WhitelistModule",
      artifactPath: path.join(artifactsDir, "modules", "WhitelistModule.sol", "WhitelistModule.json"),
      outputPath: path.join(frontendAbiDir, "WhitelistModule.json"),
      includeBytecode: false,
    },
  ];

  console.log("\n📦 Copying ABIs to frontend...");

  for (const contract of contracts) {
    if (!fs.existsSync(contract.artifactPath)) {
      console.log(`⚠️  ${contract.name}: artifact not found, skipping`);
      continue;
    }

    try {
      const artifact = JSON.parse(fs.readFileSync(contract.artifactPath, "utf-8"));

      const output: any = {
        abi: artifact.abi,
      };

      // Include bytecode for contracts that need deployment (ProxyFactory uses this)
      if (contract.includeBytecode) {
        output.bytecode = artifact.bytecode;
        output.deployedBytecode = artifact.deployedBytecode;
      }

      fs.writeFileSync(contract.outputPath, JSON.stringify(output, null, 2));
      console.log(`✅ ${contract.name}`);
      copiedCount++;
    } catch (error) {
      console.warn(`⚠️  ${contract.name}: ${(error as Error).message}`);
    }
  }

  if (copiedCount > 0) {
    console.log(`✅ Copied ${copiedCount} ABI${copiedCount === 1 ? '' : 's'} to frontend`);
  }
}
