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

    it("should increment nonce on proposal (not execution)", async function () {
      // Nonce should already be incremented from the beforeEach proposal
      const nonceAfterProposal = await wallet.nonce();
      expect(nonceAfterProposal).to.equal(1n);

      // Execute the transaction
      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      // Nonce should NOT change on execution (only on proposal)
      const nonceAfterExecution = await wallet.nonce();
      expect(nonceAfterExecution).to.equal(1n);

      // Propose another transaction to verify nonce increments
      const to = nonOwner.address;
      const value = ethers.parseEther("0.5");
      const data = "0x";
      await wallet.connect(owner1).proposeTransaction(to, value, data);

      const nonceAfterSecondProposal = await wallet.nonce();
      expect(nonceAfterSecondProposal).to.equal(2n);
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

  describe("Transaction Cancellation", function () {
    let txHash: string;

    beforeEach(async function () {
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

    it("should allow proposer to cancel transaction", async function () {
      await expect(wallet.connect(owner1).cancelTransaction(txHash))
        .to.emit(wallet, "TransactionCancelled")
        .withArgs(txHash, owner1.address);

      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.cancelled).to.be.true;
    });

    it("should allow cancellation after threshold approvals", async function () {
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).approveTransaction(txHash);

      await expect(wallet.connect(owner1).cancelTransaction(txHash))
        .to.emit(wallet, "TransactionCancelled");
    });

    it("should prevent execution of cancelled transaction", async function () {
      // Get approvals first
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).approveTransaction(txHash);

      // Then cancel
      await wallet.connect(owner1).cancelTransaction(txHash);

      // Try to execute - should fail because transaction is cancelled
      await expect(
        wallet.connect(owner3).executeTransaction(txHash)
      ).to.be.revertedWith("Transaction already cancelled");
    });

    it("should reject cancellation from non-proposer before threshold", async function () {
      await expect(
        wallet.connect(owner2).cancelTransaction(txHash)
      ).to.be.revertedWith("Not proposer and not enough approvals to cancel");
    });
  });

  describe("Owner Management", function () {
    it("should add owner through multisig", async function () {
      const newOwner = nonOwner.address;
      const addOwnerData = wallet.interface.encodeFunctionData("addOwner", [newOwner]);

      const proposeTx = await wallet.connect(owner1).proposeTransaction(await wallet.getAddress(), 0, addOwnerData);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });
      const proposeParsed = wallet.interface.parseLog(proposeEvent as any);
      const txHash = proposeParsed?.args[0];

      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      expect(await wallet.isOwner(newOwner)).to.be.true;
      const owners = await wallet.getOwners();
      expect(owners).to.include(newOwner);
    });

    it("should remove owner through multisig", async function () {
      const removeOwnerData = wallet.interface.encodeFunctionData("removeOwner", [owner3.address]);

      const proposeTx = await wallet.connect(owner1).proposeTransaction(await wallet.getAddress(), 0, removeOwnerData);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });
      const proposeParsed = wallet.interface.parseLog(proposeEvent as any);
      const txHash = proposeParsed?.args[0];

      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      expect(await wallet.isOwner(owner3.address)).to.be.false;
      const owners = await wallet.getOwners();
      expect(owners).to.not.include(owner3.address);
    });

    it("should change threshold through multisig", async function () {
      const newThreshold = 3;
      const changeThresholdData = wallet.interface.encodeFunctionData("changeThreshold", [newThreshold]);

      const proposeTx = await wallet.connect(owner1).proposeTransaction(await wallet.getAddress(), 0, changeThresholdData);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });
      const proposeParsed = wallet.interface.parseLog(proposeEvent as any);
      const txHash = proposeParsed?.args[0];

      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      expect(await wallet.threshold()).to.equal(newThreshold);
    });
  });

  describe("Edge Cases", function () {
    it("should handle zero value transactions", async function () {
      const to = nonOwner.address;
      const value = 0n;
      const data = "0x";

      const tx = await wallet.connect(owner1).proposeTransaction(to, value, data);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
    });

    it("should handle contract calls with data", async function () {
      // Create a simple contract call (self-call to test)
      const data = wallet.interface.encodeFunctionData("threshold");
      const to = await wallet.getAddress();

      const proposeTx = await wallet.connect(owner1).proposeTransaction(to, 0, data);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt?.logs.find((log) => {
        try {
          return wallet.interface.parseLog(log as any)?.name === "TransactionProposed";
        } catch {
          return false;
        }
      });
      const proposeParsed = wallet.interface.parseLog(proposeEvent as any);
      const txHash = proposeParsed?.args[0];

      await wallet.connect(owner1).approveTransaction(txHash);
      await wallet.connect(owner2).approveTransaction(txHash);
      await wallet.connect(owner3).executeTransaction(txHash);

      // Transaction should execute successfully
      const transaction = await wallet.getTransaction(txHash);
      expect(transaction.executed).to.be.true;
    });

    it("should handle maximum threshold", async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      const salt = ethers.randomBytes(32);
      const tx = await factory.connect(owner1).createWallet(owners, 3, salt);
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
      const newWallet = await ethers.getContractAt("MultisigWallet", walletAddress) as MultisigWallet;

      expect(await newWallet.threshold()).to.equal(3);
    });

    it("should handle single owner wallet", async function () {
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
      const parsedEvent2 = factory.interface.parseLog(event as any);
      const walletAddress2 = parsedEvent2?.args[0];
      const newWallet = await ethers.getContractAt("MultisigWallet", walletAddress2) as MultisigWallet;

      expect(await newWallet.threshold()).to.equal(1);
      
      // Should be able to execute immediately
      const to = nonOwner.address;
      const value = ethers.parseEther("1.0");
      await owner1.sendTransaction({
        to: walletAddress2,
        value: ethers.parseEther("10.0"),
      });

      const proposeTx = await newWallet.connect(owner1).proposeTransaction(to, value, "0x");
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

      const transaction = await newWallet.getTransaction(txHash);
      expect(transaction.executed).to.be.true;
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
