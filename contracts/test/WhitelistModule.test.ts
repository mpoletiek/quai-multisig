import { expect } from "chai";
import { ethers } from "hardhat";
import { MultisigWallet, ProxyFactory, WhitelistModule } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WhitelistModule", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
  let wallet: MultisigWallet;
  let module: WhitelistModule;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let whitelistedAddr: SignerWithAddress;
  let nonWhitelistedAddr: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  const THRESHOLD = 2;
  const WHITELIST_LIMIT = ethers.parseEther("5.0");

  beforeEach(async function () {
    [owner1, owner2, owner3, whitelistedAddr, nonWhitelistedAddr, nonOwner] = await ethers.getSigners();

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
    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    module = await WhitelistModule.deploy();
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

  describe("addToWhitelist", function () {
    it("should add address to whitelist", async function () {
      await expect(module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT))
        .to.emit(module, "AddressWhitelisted")
        .withArgs(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT);

      expect(await module.isWhitelisted(await wallet.getAddress(), whitelistedAddr.address)).to.be.true;
      expect(await module.getWhitelistLimit(await wallet.getAddress(), whitelistedAddr.address)).to.equal(WHITELIST_LIMIT);
    });

    it("should allow unlimited limit (0)", async function () {
      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, 0);
      expect(await module.getWhitelistLimit(await wallet.getAddress(), whitelistedAddr.address)).to.equal(0);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT)
      ).to.be.revertedWith("Not an owner");
    });

    it("should reject zero address", async function () {
      await expect(
        module.connect(owner1).addToWhitelist(await wallet.getAddress(), ethers.ZeroAddress, WHITELIST_LIMIT)
      ).to.be.revertedWith("Invalid address");
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
        module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT)
      ).to.be.revertedWith("Module not enabled");
    });
  });

  describe("removeFromWhitelist", function () {
    beforeEach(async function () {
      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT);
    });

    it("should remove address from whitelist", async function () {
      await expect(module.connect(owner1).removeFromWhitelist(await wallet.getAddress(), whitelistedAddr.address))
        .to.emit(module, "AddressRemovedFromWhitelist")
        .withArgs(await wallet.getAddress(), whitelistedAddr.address);

      expect(await module.isWhitelisted(await wallet.getAddress(), whitelistedAddr.address)).to.be.false;
      expect(await module.getWhitelistLimit(await wallet.getAddress(), whitelistedAddr.address)).to.equal(0);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).removeFromWhitelist(await wallet.getAddress(), whitelistedAddr.address)
      ).to.be.revertedWith("Not an owner");
    });
  });

  describe("executeToWhitelist", function () {
    beforeEach(async function () {
      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT);
    });

    it("should execute transaction to whitelisted address", async function () {
      const value = ethers.parseEther("3.0");
      const balanceBefore = await ethers.provider.getBalance(whitelistedAddr.address);

      await expect(module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, value, "0x"))
        .to.emit(module, "WhitelistTransactionExecuted")
        .withArgs(await wallet.getAddress(), whitelistedAddr.address, value);

      const balanceAfter = await ethers.provider.getBalance(whitelistedAddr.address);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });

    it("should reject from non-owner", async function () {
      await expect(
        module.connect(nonOwner).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, ethers.parseEther("1.0"), "0x")
      ).to.be.revertedWith("Not an owner");
    });

    it("should reject non-whitelisted address", async function () {
      await expect(
        module.connect(owner1).executeToWhitelist(await wallet.getAddress(), nonWhitelistedAddr.address, ethers.parseEther("1.0"), "0x")
      ).to.be.revertedWith("Address not whitelisted");
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
        module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, ethers.parseEther("1.0"), "0x")
      ).to.be.revertedWith("Module not enabled");
    });

    it("should reject transaction exceeding limit", async function () {
      await expect(
        module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, ethers.parseEther("6.0"), "0x")
      ).to.be.revertedWith("Exceeds whitelist limit");
    });

    it("should allow unlimited transactions when limit is 0", async function () {
      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), nonWhitelistedAddr.address, 0);

      const value = ethers.parseEther("50.0");
      const balanceBefore = await ethers.provider.getBalance(nonWhitelistedAddr.address);
      await module.connect(owner1).executeToWhitelist(await wallet.getAddress(), nonWhitelistedAddr.address, value, "0x");

      const balanceAfter = await ethers.provider.getBalance(nonWhitelistedAddr.address);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });
  });

  describe("batchAddToWhitelist", function () {
    it("should batch add addresses to whitelist", async function () {
      const addresses = [whitelistedAddr.address, nonWhitelistedAddr.address];
      const limits = [WHITELIST_LIMIT, ethers.parseEther("3.0")];

      const tx = module.connect(owner1).batchAddToWhitelist(await wallet.getAddress(), addresses, limits);
      await expect(tx)
        .to.emit(module, "AddressWhitelisted")
        .withArgs(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT)
        .and.to.emit(module, "AddressWhitelisted")
        .withArgs(await wallet.getAddress(), nonWhitelistedAddr.address, ethers.parseEther("3.0"));

      expect(await module.isWhitelisted(await wallet.getAddress(), whitelistedAddr.address)).to.be.true;
      expect(await module.isWhitelisted(await wallet.getAddress(), nonWhitelistedAddr.address)).to.be.true;
    });

    it("should reject array length mismatch", async function () {
      const addresses = [whitelistedAddr.address];
      const limits = [WHITELIST_LIMIT, ethers.parseEther("3.0")];

      await expect(
        module.connect(owner1).batchAddToWhitelist(await wallet.getAddress(), addresses, limits)
      ).to.be.revertedWith("Array length mismatch");
    });

    it("should reject from non-owner", async function () {
      const addresses = [whitelistedAddr.address];
      const limits = [WHITELIST_LIMIT];

      await expect(
        module.connect(nonOwner).batchAddToWhitelist(await wallet.getAddress(), addresses, limits)
      ).to.be.revertedWith("Not an owner");
    });

    it("should handle empty batch", async function () {
      await module.connect(owner1).batchAddToWhitelist(await wallet.getAddress(), [], []);
      // Should not revert
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT);
    });

    it("should handle limit exactly at threshold", async function () {
      // Execute at exactly the limit
      const balanceBefore = await ethers.provider.getBalance(whitelistedAddr.address);
      await module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT, "0x");

      const balanceAfter = await ethers.provider.getBalance(whitelistedAddr.address);
      expect(balanceAfter - balanceBefore).to.equal(WHITELIST_LIMIT);

      // Should reject amount exceeding limit (WhitelistModule checks per-transaction, not cumulative)
      await expect(
        module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, WHITELIST_LIMIT + 1n, "0x")
      ).to.be.revertedWith("Exceeds whitelist limit");
    });

    it("should handle contract calls with data", async function () {
      // Execute with data (contract call)
      const data = "0x1234";
      const value = ethers.parseEther("1.0");
      const balanceBefore = await ethers.provider.getBalance(whitelistedAddr.address);
      await module.connect(owner1).executeToWhitelist(await wallet.getAddress(), whitelistedAddr.address, value, data);

      // Should succeed
      const balanceAfter = await ethers.provider.getBalance(whitelistedAddr.address);
      expect(balanceAfter - balanceBefore).to.equal(value);
    });

    it("should handle removing and re-adding address", async function () {
      await module.connect(owner1).removeFromWhitelist(await wallet.getAddress(), whitelistedAddr.address);
      expect(await module.isWhitelisted(await wallet.getAddress(), whitelistedAddr.address)).to.be.false;

      await module.connect(owner1).addToWhitelist(await wallet.getAddress(), whitelistedAddr.address, ethers.parseEther("3.0"));
      expect(await module.isWhitelisted(await wallet.getAddress(), whitelistedAddr.address)).to.be.true;
      expect(await module.getWhitelistLimit(await wallet.getAddress(), whitelistedAddr.address)).to.equal(ethers.parseEther("3.0"));
    });
  });
});
