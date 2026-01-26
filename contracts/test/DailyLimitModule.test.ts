import { expect } from "chai";
import { ethers } from "hardhat";
import { MultisigWallet, ProxyFactory, DailyLimitModule } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("DailyLimitModule", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
  let wallet: MultisigWallet;
  let module: DailyLimitModule;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let recipient: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  const THRESHOLD = 2;
  const DAILY_LIMIT = ethers.parseEther("10.0");

  beforeEach(async function () {
    [owner1, owner2, owner3, recipient, nonOwner] = await ethers.getSigners();

    // Deploy implementation
    const MultisigWallet = await ethers.getContractFactory("MultisigWallet");
    implementation = await MultisigWallet.deploy();
    await implementation.waitForDeployment();

    // Deploy factory
    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    factory = await ProxyFactory.deploy(await implementation.getAddress());
    await factory.waitForDeployment();

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

    // Deploy module
    const DailyLimitModule = await ethers.getContractFactory("DailyLimitModule");
    module = await DailyLimitModule.deploy();
    await module.waitForDeployment();

    // Enable module (requires multisig)
    const enableModuleData = wallet.interface.encodeFunctionData("enableModule", [await module.getAddress()]);
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

    // Fund wallet
    await owner1.sendTransaction({
      to: await wallet.getAddress(),
      value: ethers.parseEther("100.0"),
    });
  });

  describe("setDailyLimit", function () {
    it("should set daily limit", async function () {
      await expect(module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT))
        .to.emit(module, "DailyLimitSet")
        .withArgs(await wallet.getAddress(), DAILY_LIMIT);

      const limit = await module.getDailyLimit(await wallet.getAddress());
      expect(limit.limit).to.equal(DAILY_LIMIT);
      expect(limit.spent).to.equal(0);
      expect(limit.lastReset).to.be.greaterThan(0);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT)
      ).to.be.revertedWith("Not an owner");
    });

    it("should reject when module not enabled", async function () {
      // Disable module
      const disableModuleData = wallet.interface.encodeFunctionData("disableModule", [await module.getAddress()]);
      const proposeTx = await wallet.connect(owner1).proposeTransaction(await wallet.getAddress(), 0, disableModuleData);
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

      await expect(
        module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT)
      ).to.be.revertedWith("Module not enabled");
    });
  });

  describe("executeBelowLimit", function () {
    beforeEach(async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT);
    });

    it("should execute transaction below limit", async function () {
      const value = ethers.parseEther("5.0");
      const balanceBefore = await ethers.provider.getBalance(recipient.address);

      await expect(module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, value))
        .to.emit(module, "TransactionExecuted");

      const balanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter - balanceBefore).to.equal(value);

      const limit = await module.getDailyLimit(await wallet.getAddress());
      expect(limit.spent).to.equal(value);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("1.0"))
      ).to.be.revertedWith("Not an owner");
    });

    it("should reject zero address destination", async function () {
      await expect(
        module.connect(owner1).executeBelowLimit(await wallet.getAddress(), ethers.ZeroAddress, ethers.parseEther("1.0"))
      ).to.be.revertedWith("Invalid destination");
    });

    it("should reject when limit not set", async function () {
      // Create new wallet without limit
      const owners = [owner1.address];
      const salt = ethers.randomBytes(32);
      const tx = await factory.connect(owner1).createWallet(owners, 1, salt);
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
      const newWalletAddress = parsedEvent?.args[0];
      const newWallet = await ethers.getContractAt("MultisigWallet", newWalletAddress) as MultisigWallet;

      // Enable module through single-owner multisig flow
      const enableModuleData = newWallet.interface.encodeFunctionData("enableModule", [await module.getAddress()]);
      const proposeTx = await newWallet.connect(owner1).proposeTransaction(newWalletAddress, 0, enableModuleData);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt?.logs.find((log) => {
        try {
          return newWallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });
      const proposeParsed = newWallet.interface.parseLog(proposeEvent as any);
      const txHash = proposeParsed?.args[0];
      await newWallet.connect(owner1).approveTransaction(txHash);
      await newWallet.connect(owner1).executeTransaction(txHash);

      // Fund the wallet
      await owner1.sendTransaction({
        to: newWalletAddress,
        value: ethers.parseEther("10.0"),
      });

      await expect(
        module.connect(owner1).executeBelowLimit(newWalletAddress, recipient.address, ethers.parseEther("1.0"))
      ).to.be.revertedWith("Daily limit not set");
    });

    it("should reject transaction exceeding limit", async function () {
      await expect(
        module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("11.0"))
      ).to.be.revertedWith("Exceeds daily limit");
    });

    it("should track cumulative spending", async function () {
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));
      
      const limit1 = await module.getDailyLimit(await wallet.getAddress());
      expect(limit1.spent).to.equal(ethers.parseEther("3.0"));

      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("4.0"));
      
      const limit2 = await module.getDailyLimit(await wallet.getAddress());
      expect(limit2.spent).to.equal(ethers.parseEther("7.0"));
    });

    it("should reset limit after 24 hours", async function () {
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));
      
      const limitBefore = await module.getDailyLimit(await wallet.getAddress());
      expect(limitBefore.spent).to.equal(ethers.parseEther("5.0"));

      // Fast forward 24 hours + 1 second
      await time.increase(24 * 60 * 60 + 1);

      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));
      
      const limitAfter = await module.getDailyLimit(await wallet.getAddress());
      expect(limitAfter.spent).to.equal(ethers.parseEther("5.0")); // Reset, then spent 5
    });
  });

  describe("resetDailyLimit", function () {
    beforeEach(async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT);
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));
    });

    it("should reset daily limit", async function () {
      await expect(module.connect(owner1).resetDailyLimit(await wallet.getAddress()))
        .to.emit(module, "DailyLimitReset")
        .withArgs(await wallet.getAddress());

      const limit = await module.getDailyLimit(await wallet.getAddress());
      expect(limit.spent).to.equal(0);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).resetDailyLimit(await wallet.getAddress())
      ).to.be.revertedWith("Not an owner");
    });
  });

  describe("getRemainingLimit", function () {
    beforeEach(async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT);
    });

    it("should return full limit when nothing spent", async function () {
      const remaining = await module.getRemainingLimit(await wallet.getAddress());
      expect(remaining).to.equal(DAILY_LIMIT);
    });

    it("should return remaining after spending", async function () {
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));
      
      const remaining = await module.getRemainingLimit(await wallet.getAddress());
      expect(remaining).to.equal(DAILY_LIMIT - ethers.parseEther("3.0"));
    });

    it("should return 0 when limit exceeded", async function () {
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, DAILY_LIMIT);
      
      const remaining = await module.getRemainingLimit(await wallet.getAddress());
      expect(remaining).to.equal(0);
    });

    it("should reset after 24 hours", async function () {
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("5.0"));
      
      await time.increase(24 * 60 * 60 + 1);

      const remaining = await module.getRemainingLimit(await wallet.getAddress());
      expect(remaining).to.equal(DAILY_LIMIT);
    });
  });

  describe("Edge Cases", function () {
    it("should handle limit exactly at threshold", async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT);
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, DAILY_LIMIT);
      
      const limit = await module.getDailyLimit(await wallet.getAddress());
      expect(limit.spent).to.equal(DAILY_LIMIT);
      
      // Should reject any additional spending
      await expect(
        module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, 1)
      ).to.be.revertedWith("Exceeds daily limit");
    });

    it("should handle multiple transactions summing to limit", async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), DAILY_LIMIT);
      
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("4.0"));
      await module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, ethers.parseEther("3.0"));

      const limit = await module.getDailyLimit(await wallet.getAddress());
      expect(limit.spent).to.equal(DAILY_LIMIT);
    });

    it("should handle zero limit", async function () {
      await module.connect(owner1).setDailyLimit(await wallet.getAddress(), 0);
      
      await expect(
        module.connect(owner1).executeBelowLimit(await wallet.getAddress(), recipient.address, 1)
      ).to.be.revertedWith("Daily limit not set");
    });
  });
});
