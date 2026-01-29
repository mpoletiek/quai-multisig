import { expect } from "chai";
import { ethers } from "hardhat";
import { MultisigWallet, ProxyFactory, SocialRecoveryModule, DailyLimitModule, WhitelistModule } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Integration Tests", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
  let wallet: MultisigWallet;
  let socialRecoveryModule: SocialRecoveryModule;
  let dailyLimitModule: DailyLimitModule;
  let whitelistModule: WhitelistModule;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let recipient: SignerWithAddress;
  let guardian1: SignerWithAddress;
  let guardian2: SignerWithAddress;

  const THRESHOLD = 2;

  beforeEach(async function () {
    [owner1, owner2, owner3, recipient, guardian1, guardian2] = await ethers.getSigners();

    // Deploy implementation
    const MultisigWallet = await ethers.getContractFactory("MultisigWallet");
    implementation = await MultisigWallet.deploy();
    await implementation.waitForDeployment();

    // Deploy factory
    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    factory = await ProxyFactory.deploy(await implementation.getAddress());
    await factory.waitForDeployment();

    // Deploy modules
    const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
    socialRecoveryModule = await SocialRecoveryModule.deploy();
    await socialRecoveryModule.waitForDeployment();

    const DailyLimitModule = await ethers.getContractFactory("DailyLimitModule");
    dailyLimitModule = await DailyLimitModule.deploy();
    await dailyLimitModule.waitForDeployment();

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    whitelistModule = await WhitelistModule.deploy();
    await whitelistModule.waitForDeployment();

    // Create wallet through factory
    const owners = [owner1.address, owner2.address, owner3.address];
    const salt = ethers.randomBytes(32);
    const tx = await factory.connect(owner1).createWallet(owners, THRESHOLD, salt);
    const receipt = await tx.wait();

    const event = receipt?.logs.find(
      (log) => {
        try {
          return factory.interface.parseLog(log as any)?.name === "WalletCreated";
        } catch {
          return false;
        }
      }
    );
    const parsedEvent = factory.interface.parseLog(event as any);
    const walletAddress = parsedEvent?.args[0];
    wallet = MultisigWallet.attach(walletAddress) as MultisigWallet;

    // Fund wallet
    await owner1.sendTransaction({
      to: await wallet.getAddress(),
      value: ethers.parseEther("100.0"),
    });
  });

  /**
   * Helper to execute a transaction through multisig
   * Proposes, approves, and executes in one call
   */
  async function executeMultisig(to: string, value: bigint, data: string) {
    const proposeTx = await wallet.connect(owner1).proposeTransaction(to, value, data);
    const proposeReceipt = await proposeTx.wait();
    const proposeEvent = proposeReceipt?.logs.find(
      (log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      }
    );
    const proposeParsed = wallet.interface.parseLog(proposeEvent as any);
    const txHash = proposeParsed?.args[0];

    await wallet.connect(owner1).approveTransaction(txHash);
    await wallet.connect(owner2).approveTransaction(txHash);
    await wallet.connect(owner3).executeTransaction(txHash);
  }

  async function enableModule(moduleAddress: string) {
    const enableModuleData = wallet.interface.encodeFunctionData("enableModule", [moduleAddress]);
    await executeMultisig(await wallet.getAddress(), 0n, enableModuleData);
  }

  /**
   * Helper to set daily limit through multisig (H-2 fix)
   */
  async function setDailyLimitViaMultisig(limit: bigint) {
    const setLimitData = dailyLimitModule.interface.encodeFunctionData("setDailyLimit", [
      await wallet.getAddress(),
      limit
    ]);
    await executeMultisig(await dailyLimitModule.getAddress(), 0n, setLimitData);
  }

  /**
   * Helper to add address to whitelist through multisig (H-2 fix)
   */
  async function addToWhitelistViaMultisig(addr: string, limit: bigint) {
    const addData = whitelistModule.interface.encodeFunctionData("addToWhitelist", [
      await wallet.getAddress(),
      addr,
      limit
    ]);
    await executeMultisig(await whitelistModule.getAddress(), 0n, addData);
  }

  /**
   * Helper to setup social recovery through multisig (H-2 fix)
   */
  async function setupRecoveryViaMultisig(guardians: string[], threshold: number, recoveryPeriod: number) {
    const setupData = socialRecoveryModule.interface.encodeFunctionData("setupRecovery", [
      await wallet.getAddress(),
      guardians,
      threshold,
      recoveryPeriod
    ]);
    await executeMultisig(await socialRecoveryModule.getAddress(), 0n, setupData);
  }

  describe("Factory → Wallet → Modules Flow", function () {
    it("should create wallet, enable modules, and use them", async function () {
      // Verify wallet was created
      expect(await factory.isWallet(await wallet.getAddress())).to.be.true;
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(3);

      // Enable all modules
      await enableModule(await socialRecoveryModule.getAddress());
      await enableModule(await dailyLimitModule.getAddress());
      await enableModule(await whitelistModule.getAddress());

      // Verify modules are enabled
      expect(await wallet.modules(await socialRecoveryModule.getAddress())).to.be.true;
      expect(await wallet.modules(await dailyLimitModule.getAddress())).to.be.true;
      expect(await wallet.modules(await whitelistModule.getAddress())).to.be.true;

      // Use DailyLimitModule (H-2 fix: configuration now requires multisig approval)
      await setDailyLimitViaMultisig(ethers.parseEther("10.0"));
      const balanceBefore1 = await ethers.provider.getBalance(recipient.address);
      // Execution still works with single owner (as intended)
      await dailyLimitModule.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));

      const balanceAfter1 = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter1 - balanceBefore1).to.equal(ethers.parseEther("5.0"));

      // Use WhitelistModule (H-2 fix: configuration now requires multisig approval)
      await addToWhitelistViaMultisig(recipient.address, ethers.parseEther("3.0"));
      const balanceBefore2 = await ethers.provider.getBalance(recipient.address);
      // Execution still works with single owner (as intended)
      await whitelistModule.connect(owner1).executeToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("2.0"), "0x");

      const balanceAfter2 = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter2 - balanceBefore2).to.equal(ethers.parseEther("2.0"));

      // Setup SocialRecoveryModule (H-2 fix: configuration now requires multisig approval)
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, 1 * 24 * 60 * 60);

      const config = await socialRecoveryModule.getRecoveryConfig(await wallet.getAddress());
      expect(config.guardians).to.deep.equal(guardians);
    });

    it("should reject direct module configuration by single owner (H-2 security fix)", async function () {
      await enableModule(await dailyLimitModule.getAddress());
      await enableModule(await whitelistModule.getAddress());
      await enableModule(await socialRecoveryModule.getAddress());

      // Single owner should NOT be able to configure modules directly
      await expect(
        dailyLimitModule.connect(owner1).setDailyLimit(await wallet.getAddress(), ethers.parseEther("10.0"))
      ).to.be.revertedWithCustomError(dailyLimitModule, "MustBeCalledByWallet");

      await expect(
        whitelistModule.connect(owner1).addToWhitelist(await wallet.getAddress(), recipient.address, 0)
      ).to.be.revertedWithCustomError(whitelistModule, "MustBeCalledByWallet");

      await expect(
        socialRecoveryModule.connect(owner1).setupRecovery(await wallet.getAddress(), [guardian1.address], 1, 86400)
      ).to.be.revertedWithCustomError(socialRecoveryModule, "MustBeCalledByWallet");
    });
  });

  describe("Module Interactions", function () {
    beforeEach(async function () {
      await enableModule(await dailyLimitModule.getAddress());
      await enableModule(await whitelistModule.getAddress());
    });

    it("should allow using multiple modules together", async function () {
      // Set daily limit (through multisig)
      await setDailyLimitViaMultisig(ethers.parseEther("10.0"));

      // Add to whitelist (through multisig)
      await addToWhitelistViaMultisig(recipient.address, ethers.parseEther("5.0"));

      const balanceBefore = await ethers.provider.getBalance(recipient.address);

      // Execute via daily limit (single owner OK)
      await dailyLimitModule.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));

      // Execute via whitelist (single owner OK)
      await whitelistModule.connect(owner1).executeToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("2.0"), "0x");

      const balanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("5.0"));
    });
  });

  describe("Social Recovery Full Flow", function () {
    beforeEach(async function () {
      await enableModule(await socialRecoveryModule.getAddress());
      const guardians = [guardian1.address, guardian2.address];
      // Setup recovery through multisig (H-2 fix)
      await setupRecoveryViaMultisig(guardians, 2, 1 * 24 * 60 * 60);
    });

    it("should complete full recovery flow (H-1 verification)", async function () {
      // This test verifies H-1: that execTransactionFromModule correctly
      // calls owner management functions on the wallet
      const newOwners = [guardian1.address, guardian2.address];

      // Initiate recovery
      const tx = await socialRecoveryModule.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => {
          try {
            return socialRecoveryModule.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = socialRecoveryModule.interface.parseLog(event as any);
      const recoveryHash = parsedEvent?.args[1];

      // Approve recovery
      await socialRecoveryModule.connect(guardian1).approveRecovery(await wallet.getAddress(), recoveryHash);
      await socialRecoveryModule.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);

      // Fast forward time
      await time.increase(1 * 24 * 60 * 60 + 1);

      // Execute recovery - this uses execTransactionFromModule to call
      // addOwner, removeOwner, and changeThreshold on the wallet
      await socialRecoveryModule.connect(guardian1).executeRecovery(await wallet.getAddress(), recoveryHash);

      // Verify owners changed - this proves execTransactionFromModule works correctly
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(2);
      expect(owners).to.include.members(newOwners);
      expect(await wallet.threshold()).to.equal(2);

      // Verify old owners are removed
      expect(owners).to.not.include(owner1.address);
      expect(owners).to.not.include(owner2.address);
      expect(owners).to.not.include(owner3.address);
    });

    it("should handle partial owner replacement via execTransactionFromModule (H-1)", async function () {
      // Test case where some old owners remain and some are replaced
      // This validates the execTransactionFromModule pattern handles both
      // adding new owners and removing old ones
      const newOwners = [owner1.address, guardian1.address]; // Keep owner1, add guardian1

      // Initiate recovery
      const tx = await socialRecoveryModule.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => {
          try {
            return socialRecoveryModule.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = socialRecoveryModule.interface.parseLog(event as any);
      const recoveryHash = parsedEvent?.args[1];

      // Approve recovery
      await socialRecoveryModule.connect(guardian1).approveRecovery(await wallet.getAddress(), recoveryHash);
      await socialRecoveryModule.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);

      // Fast forward time
      await time.increase(1 * 24 * 60 * 60 + 1);

      // Execute recovery
      await socialRecoveryModule.connect(guardian1).executeRecovery(await wallet.getAddress(), recoveryHash);

      // Verify owner state
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(2);
      expect(owners).to.include(owner1.address); // Kept
      expect(owners).to.include(guardian1.address); // Added
      expect(owners).to.not.include(owner2.address); // Removed
      expect(owners).to.not.include(owner3.address); // Removed
      expect(await wallet.threshold()).to.equal(2);
    });
  });
});
