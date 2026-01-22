import { expect } from "chai";
import { ethers } from "hardhat";
import { MultisigWallet, ProxyFactory, MultisigWalletProxy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MultisigWallet", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
  let wallet: MultisigWallet;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  const THRESHOLD = 2;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner] = await ethers.getSigners();

    // Deploy implementation
    const MultisigWallet = await ethers.getContractFactory("MultisigWallet");
    implementation = await MultisigWallet.deploy();
    await implementation.waitForDeployment();

    // Deploy factory
    const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
    factory = await ProxyFactory.deploy(await implementation.getAddress());
    await factory.waitForDeployment();

    // Create a wallet through factory
    const owners = [owner1.address, owner2.address, owner3.address];
    const salt = ethers.randomBytes(32);

    const tx = await factory
      .connect(owner1)
      .createWallet(owners, THRESHOLD, salt);
    const receipt = await tx.wait();

    // Get wallet address from event
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

    // Connect to wallet instance
    wallet = MultisigWallet.attach(walletAddress) as MultisigWallet;
  });

  describe("Initialization", function () {
    it("should initialize with correct owners and threshold", async function () {
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(3);
      expect(owners).to.include(owner1.address);
      expect(owners).to.include(owner2.address);
      expect(owners).to.include(owner3.address);

      expect(await wallet.threshold()).to.equal(THRESHOLD);
    });

    it("should set owner flags correctly", async function () {
      expect(await wallet.isOwner(owner1.address)).to.be.true;
      expect(await wallet.isOwner(owner2.address)).to.be.true;
      expect(await wallet.isOwner(owner3.address)).to.be.true;
      expect(await wallet.isOwner(nonOwner.address)).to.be.false;
    });

    it("should initialize nonce to 0", async function () {
      expect(await wallet.nonce()).to.equal(0);
    });

    it("should reject invalid threshold", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);

      await expect(
        factory.connect(owner1).createWallet(owners, 0, salt)
      ).to.be.revertedWith("Invalid threshold");

      await expect(
        factory.connect(owner1).createWallet(owners, 3, salt)
      ).to.be.revertedWith("Invalid threshold");
    });

    it("should reject empty owners array", async function () {
      const salt = ethers.randomBytes(32);

      await expect(
        factory.connect(owner1).createWallet([], THRESHOLD, salt)
      ).to.be.revertedWith("Owners required");
    });
  });

  describe("Transaction Proposal", function () {
    it("should allow owner to propose transaction", async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();

      expect(receipt?.logs).to.have.lengthOf.at.least(1);
    });

    it("should emit TransactionProposed event", async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      await expect(wallet.connect(owner1).proposeTransaction(to, value, data))
        .to.emit(wallet, "TransactionProposed");
    });

    it("should reject proposal from non-owner", async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      await expect(
        wallet.connect(nonOwner).proposeTransaction(to, value, data)
      ).to.be.revertedWith("Not an owner");
    });

    it("should reject proposal to zero address", async function () {
      const value = ethers.parseEther("1.0");
      const data = "0x";

      await expect(
        wallet.connect(owner1).proposeTransaction(ethers.ZeroAddress, value, data)
      ).to.be.revertedWith("Invalid destination address");
    });

    it("should create transaction with correct hash", async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });

      const parsedEvent = wallet.interface.parseLog(event as any);
      const txHash = parsedEvent?.args[0];

      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.to).to.equal(to);
      expect(transaction.value).to.equal(value);
      expect(transaction.data).to.equal(data);
      expect(transaction.executed).to.be.false;
      expect(transaction.numApprovals).to.equal(0);
    });
  });

  describe("Transaction Approval", function () {
    let txHash: string;

    beforeEach(async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });

      const parsedEvent = wallet.interface.parseLog(event as any);
      txHash = parsedEvent?.args[0];
    });

    it("should allow owner to approve transaction", async function () {
      await expect(wallet.connect(owner2).approveTransaction(txHash))
        .to.emit(wallet, "TransactionApproved")
        .withArgs(txHash, owner2.address);

      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.numApprovals).to.equal(1);
    });

    it("should prevent duplicate approvals", async function () {
      await wallet.connect(owner2).approveTransaction(txHash);

      await expect(
        wallet.connect(owner2).approveTransaction(txHash)
      ).to.be.revertedWith("Already approved");
    });

    it("should reject approval from non-owner", async function () {
      await expect(
        wallet.connect(nonOwner).approveTransaction(txHash)
      ).to.be.revertedWith("Not an owner");
    });

    it("should track approvals correctly", async function () {
      await wallet.connect(owner2).approveTransaction(txHash);
      expect(await wallet.hasApproved(txHash, owner2.address)).to.be.true;
      expect(await wallet.hasApproved(txHash, owner3.address)).to.be.false;

      await wallet.connect(owner3).approveTransaction(txHash);
      expect(await wallet.hasApproved(txHash, owner3.address)).to.be.true;
    });
  });

  describe("Transaction Execution", function () {
    let txHash: string;

    beforeEach(async function () {
      // Fund the wallet
      await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("10.0"),
      });

      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });

      const parsedEvent = wallet.interface.parseLog(event as any);
      txHash = parsedEvent?.args[0];
    });

    it("should execute transaction after threshold is met", async function () {
      // Get approvals
      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);

      const balanceBefore = await ethers.provider.getBalance(nonOwner.address);

      await expect(wallet.connect(owner3).executeTransaction(txHash))
        .to.emit(wallet, "TransactionExecuted")
        .withArgs(txHash, owner3.address);

      const balanceAfter = await ethers.provider.getBalance(nonOwner.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1.0"));

      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.executed).to.be.true;
    });

    it("should reject execution before threshold", async function () {
      await wallet.connect(owner1).approveTransaction(txHash);

      await expect(
        wallet.connect(owner2).executeTransaction(txHash)
      ).to.be.revertedWith("Not enough approvals");
    });

    it("should prevent double execution", async function () {
      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);

      await wallet.connect(owner3).executeTransaction(txHash);

      await expect(
        wallet.connect(owner3).executeTransaction(txHash)
      ).to.be.revertedWith("Transaction already executed");
    });

    it("should increment nonce after execution", async function () {
      const nonceBefore = await wallet.nonce();

      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      const nonceAfter = await wallet.nonce();
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });
  });

  describe("Approval Revocation", function () {
    let txHash: string;

    beforeEach(async function () {
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });

      const parsedEvent = wallet.interface.parseLog(event as any);
      txHash = parsedEvent?.args[0];

      await wallet.connect(owner1).approveTransaction(txHash);
    });

    it("should allow owner to revoke approval", async function () {
      await expect(wallet.connect(owner1).revokeApproval(txHash))
        .to.emit(wallet, "ApprovalRevoked")
        .withArgs(txHash, owner1.address);

      expect(await wallet.hasApproved(txHash, owner1.address)).to.be.false;

      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.numApprovals).to.equal(0);
    });

    it("should reject revocation if not approved", async function () {
      await expect(
        wallet.connect(owner2).revokeApproval(txHash)
      ).to.be.revertedWith("Not approved");
    });

    it("should reject revocation after execution", async function () {
      await owner1.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther("10.0"),
      });

      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      await expect(
        wallet.connect(owner1).revokeApproval(txHash)
      ).to.be.revertedWith("Transaction already executed");
    });
  });

  describe("Receive ETH", function () {
    it("should accept ETH transfers", async function () {
      const amount = ethers.parseEther("1.0");

      await expect(
        owner1.sendTransaction({
          to: await wallet.getAddress(),
          value: amount,
        })
      ).to.emit(wallet, "Received");

      const balance = await ethers.provider.getBalance(await wallet.getAddress());
      expect(balance).to.equal(amount);
    });
  });
});
