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

  async function enableModule(moduleAddress: string) {
    const enableModuleData = wallet.interface.encodeFunctionData("enableModule", [moduleAddress]);
    const proposeTx = await wallet.connect(owner1).proposeTransaction(await wallet.getAddress(), 0, enableModuleData);
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

      // Use DailyLimitModule
      await dailyLimitModule.connect(owner1).setDailyLimit(await wallet.getAddress(), ethers.parseEther("10.0"));
      const balanceBefore1 = await ethers.provider.getBalance(recipient.address);
      await dailyLimitModule.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));

      const balanceAfter1 = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter1 - balanceBefore1).to.equal(ethers.parseEther("5.0"));

      // Use WhitelistModule
      await whitelistModule.connect(owner1).addToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));
      const balanceBefore2 = await ethers.provider.getBalance(recipient.address);
      await whitelistModule.connect(owner1).executeToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("2.0"), "0x");

      const balanceAfter2 = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter2 - balanceBefore2).to.equal(ethers.parseEther("2.0"));

      // Setup SocialRecoveryModule
      const guardians = [guardian1.address, guardian2.address];
      await socialRecoveryModule.connect(owner1).setupRecovery(await wallet.getAddress(), guardians, 2, 1 * 24 * 60 * 60);
      
      const config = await socialRecoveryModule.getRecoveryConfig(await wallet.getAddress());
      expect(config.guardians).to.deep.equal(guardians);
    });
  });

  describe("Module Interactions", function () {
    beforeEach(async function () {
      await enableModule(await dailyLimitModule.getAddress());
      await enableModule(await whitelistModule.getAddress());
    });

    it("should allow using multiple modules together", async function () {
      // Set daily limit
      await dailyLimitModule.connect(owner1).setDailyLimit(await wallet.getAddress(), ethers.parseEther("10.0"));

      // Add to whitelist
      await whitelistModule.connect(owner1).addToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));

      const balanceBefore = await ethers.provider.getBalance(recipient.address);

      // Execute via daily limit
      await dailyLimitModule.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));

      // Execute via whitelist
      await whitelistModule.connect(owner1).executeToWhitelist(await wallet.getAddress(), recipient.address, ethers.parseEther("2.0"), "0x");

      const balanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("5.0"));
    });
  });

  describe("Social Recovery Full Flow", function () {
    beforeEach(async function () {
      await enableModule(await socialRecoveryModule.getAddress());
      const guardians = [guardian1.address, guardian2.address];
      await socialRecoveryModule.connect(owner1).setupRecovery(await wallet.getAddress(), guardians, 2, 1 * 24 * 60 * 60);
    });

    it("should complete full recovery flow", async function () {
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

      // Execute recovery
      await socialRecoveryModule.connect(guardian1).executeRecovery(await wallet.getAddress(), recoveryHash);

      // Verify owners changed
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(2);
      expect(owners).to.include.members(newOwners);
      expect(await wallet.threshold()).to.equal(2);
    });
  });
});
