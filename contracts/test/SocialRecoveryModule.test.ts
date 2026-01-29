import { expect } from "chai";
import { ethers } from "hardhat";
import { MultisigWallet, ProxyFactory, SocialRecoveryModule } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SocialRecoveryModule", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
  let wallet: MultisigWallet;
  let module: SocialRecoveryModule;
  let owner1: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let guardian1: SignerWithAddress;
  let guardian2: SignerWithAddress;
  let guardian3: SignerWithAddress;
  let nonOwner: SignerWithAddress;

  const THRESHOLD = 2;
  const RECOVERY_PERIOD = 1 * 24 * 60 * 60; // 1 day

  beforeEach(async function () {
    [owner1, owner2, owner3, guardian1, guardian2, guardian3, nonOwner] = await ethers.getSigners();

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
    const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
    module = await SocialRecoveryModule.deploy();
    await module.waitForDeployment();

    // Enable module (requires multisig)
    await executeMultisig(
      await wallet.getAddress(),
      0n,
      wallet.interface.encodeFunctionData("enableModule", [await module.getAddress()])
    );
  });

  /**
   * Helper to execute a transaction through multisig
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

  /**
   * Helper to setup recovery through multisig (H-2 fix)
   */
  async function setupRecoveryViaMultisig(
    guardians: string[],
    threshold: number,
    recoveryPeriod: number
  ) {
    const setupData = module.interface.encodeFunctionData("setupRecovery", [
      await wallet.getAddress(),
      guardians,
      threshold,
      recoveryPeriod
    ]);
    await executeMultisig(await module.getAddress(), 0n, setupData);
  }

  describe("setupRecovery", function () {
    it("should set up recovery configuration via multisig", async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      const threshold = 2;

      await setupRecoveryViaMultisig(guardians, threshold, RECOVERY_PERIOD);

      const config = await module.getRecoveryConfig(await wallet.getAddress());
      expect(config.guardians).to.deep.equal(guardians);
      expect(config.threshold).to.equal(threshold);
      expect(config.recoveryPeriod).to.equal(RECOVERY_PERIOD);
    });

    it("should reject setup from single owner (H-2 security fix)", async function () {
      const guardians = [guardian1.address, guardian2.address];
      // Single owner cannot directly call setupRecovery anymore
      await expect(
        module.connect(owner1).setupRecovery(await wallet.getAddress(), guardians, 2, RECOVERY_PERIOD)
      ).to.be.revertedWithCustomError(module, "MustBeCalledByWallet");
    });

    it("should reject setup from non-wallet address", async function () {
      const guardians = [guardian1.address, guardian2.address];
      await expect(
        module.connect(nonOwner).setupRecovery(await wallet.getAddress(), guardians, 2, RECOVERY_PERIOD)
      ).to.be.revertedWithCustomError(module, "MustBeCalledByWallet");
    });

    it("should reject empty guardians array", async function () {
      // Try to setup with empty guardians via multisig (should fail during execution)
      const setupData = module.interface.encodeFunctionData("setupRecovery", [
        await wallet.getAddress(),
        [],
        1,
        RECOVERY_PERIOD
      ]);

      // Propose and approve
      const proposeTx = await wallet.connect(owner1).proposeTransaction(await module.getAddress(), 0, setupData);
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

      // Execute should fail (transaction reverts internally)
      await expect(
        wallet.connect(owner3).executeTransaction(txHash)
      ).to.be.revertedWithCustomError(wallet, "TransactionExecutionFailed");
    });

    it("should prevent config update while recovery is pending", async function () {
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      // Initiate recovery
      const newOwners = [guardian1.address, guardian2.address];
      await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);

      // Try to update config via multisig - should fail during execution
      const setupData = module.interface.encodeFunctionData("setupRecovery", [
        await wallet.getAddress(),
        [guardian2.address, guardian3.address],
        2,
        RECOVERY_PERIOD
      ]);

      const proposeTx = await wallet.connect(owner1).proposeTransaction(await module.getAddress(), 0, setupData);
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

      await expect(
        wallet.connect(owner3).executeTransaction(txHash)
      ).to.be.revertedWithCustomError(wallet, "TransactionExecutionFailed");
    });
  });

  describe("initiateRecovery", function () {
    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);
    });

    it("should initiate recovery", async function () {
      const newOwners = [guardian1.address, guardian2.address];
      const newThreshold = 2;

      await expect(module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, newThreshold))
        .to.emit(module, "RecoveryInitiated");

      const nonce = await module.recoveryNonces(await wallet.getAddress());
      expect(nonce).to.equal(1);
    });

    it("should reject initiation from non-guardian", async function () {
      const newOwners = [guardian1.address];
      await expect(
        module.connect(nonOwner).initiateRecovery(await wallet.getAddress(), newOwners, 1)
      ).to.be.revertedWithCustomError(module, "NotAGuardian");
    });

    it("should reject empty new owners", async function () {
      await expect(
        module.connect(guardian1).initiateRecovery(await wallet.getAddress(), [], 1)
      ).to.be.revertedWithCustomError(module, "NewOwnersRequired");
    });

    it("should reject invalid new threshold", async function () {
      const newOwners = [guardian1.address];
      await expect(
        module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2)
      ).to.be.revertedWithCustomError(module, "InvalidThreshold");
    });

    it("should store requiredThreshold at initiation time", async function () {
      const newOwners = [guardian1.address, guardian2.address];
      const nonce = await module.recoveryNonces(await wallet.getAddress());
      const recoveryHash = module.getRecoveryHash(
        await wallet.getAddress(),
        newOwners,
        2,
        nonce + 1n
      );
      
      await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.requiredThreshold).to.equal(2); // Should match config threshold
    });

    it("should add recovery to pending list", async function () {
      const newOwners = [guardian1.address, guardian2.address];
      const nonce = await module.recoveryNonces(await wallet.getAddress());
      const expectedRecoveryHash = module.getRecoveryHash(
        await wallet.getAddress(),
        newOwners,
        2,
        nonce + 1n
      );
      
      const tx = await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
      const receipt = await tx.wait();
      
      // Extract recovery hash from event
      const event = receipt?.logs.find(
        (log) => {
          try {
            return module.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = module.interface.parseLog(event as any);
      const recoveryHash = parsedEvent?.args[1];

      const pendingHashes = await module.getPendingRecoveryHashes(await wallet.getAddress());
      expect(pendingHashes).to.include(recoveryHash);
      expect(await module.hasPendingRecoveries(await wallet.getAddress())).to.be.true;
    });
  });

  describe("approveRecovery", function () {
    let recoveryHash: string;
    let newOwners: string[];

    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      newOwners = [guardian1.address, guardian2.address];
      recoveryHash = await module.connect(guardian1).initiateRecovery.staticCall(
        await wallet.getAddress(),
        newOwners,
        2
      );
      await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
    });

    it("should allow guardian to approve recovery", async function () {
      await expect(module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash))
        .to.emit(module, "RecoveryApproved")
        .withArgs(await wallet.getAddress(), recoveryHash, guardian2.address);

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.approvalCount).to.equal(1);
    });

    it("should reject approval from non-guardian", async function () {
      await expect(
        module.connect(nonOwner).approveRecovery(await wallet.getAddress(), recoveryHash)
      ).to.be.revertedWithCustomError(module, "NotAGuardian");
    });

    it("should reject duplicate approval", async function () {
      await module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);
      await expect(
        module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash)
      ).to.be.revertedWithCustomError(module, "AlreadyApproved");
    });

    it("should track multiple approvals", async function () {
      await module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);
      await module.connect(guardian3).approveRecovery(await wallet.getAddress(), recoveryHash);

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.approvalCount).to.equal(2);
    });
  });

  describe("executeRecovery", function () {
    let recoveryHash: string;
    let newOwners: string[];

    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      newOwners = [guardian1.address, guardian2.address];
      const tx = await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
      const receipt = await tx.wait();
      
      // Extract recovery hash from event
      const event = receipt?.logs.find(
        (log) => {
          try {
            return module.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = module.interface.parseLog(event as any);
      recoveryHash = parsedEvent?.args[1];

      // Get approvals
      await module.connect(guardian1).approveRecovery(await wallet.getAddress(), recoveryHash);
      await module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);
    });

    it("should execute recovery after threshold and time delay", async function () {
      // Fast forward time
      await time.increase(RECOVERY_PERIOD);

      await expect(module.connect(guardian3).executeRecovery(await wallet.getAddress(), recoveryHash))
        .to.emit(module, "RecoveryExecuted")
        .withArgs(await wallet.getAddress(), recoveryHash);

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.executed).to.be.true;

      // Verify wallet owners changed
      const owners = await wallet.getOwners();
      expect(owners).to.have.lengthOf(2);
      expect(owners).to.include.members(newOwners);
      expect(await wallet.threshold()).to.equal(2);
    });

    it("should use requiredThreshold from initiation time", async function () {
      // Change config threshold (but can't while recovery pending)
      // So we test that the recovery uses the threshold stored at initiation
      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.requiredThreshold).to.equal(2);

      // Fast forward time
      await time.increase(RECOVERY_PERIOD);

      // Should execute with 2 approvals (stored threshold)
      await module.connect(guardian3).executeRecovery(await wallet.getAddress(), recoveryHash);
      const executedRecovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(executedRecovery.executed).to.be.true;
    });

    it("should reject execution before time delay", async function () {
      await expect(
        module.connect(guardian3).executeRecovery(await wallet.getAddress(), recoveryHash)
      ).to.be.revertedWithCustomError(module, "RecoveryPeriodNotElapsed");
    });

    it("should reject execution without enough approvals", async function () {
      // Create new recovery with only 1 approval
      const newRecoveryHash = await module.connect(guardian1).initiateRecovery.staticCall(
        await wallet.getAddress(),
        [guardian1.address],
        1
      );
      await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), [guardian1.address], 1);
      await module.connect(guardian1).approveRecovery(await wallet.getAddress(), newRecoveryHash);

      await time.increase(RECOVERY_PERIOD);

      // Try to execute with only 1 approval when threshold is 2
      await expect(
        module.connect(guardian3).executeRecovery(await wallet.getAddress(), newRecoveryHash)
      ).to.be.revertedWithCustomError(module, "NotEnoughApprovals");
    });

    it("should remove recovery from pending list after execution", async function () {
      await time.increase(RECOVERY_PERIOD);
      await module.connect(guardian3).executeRecovery(await wallet.getAddress(), recoveryHash);

      const pendingHashes = await module.getPendingRecoveryHashes(await wallet.getAddress());
      expect(pendingHashes).to.not.include(recoveryHash);
      expect(await module.hasPendingRecoveries(await wallet.getAddress())).to.be.false;
    });
  });

  describe("cancelRecovery", function () {
    let recoveryHash: string;

    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      const newOwners = [guardian1.address];
      const tx = await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 1);
      const receipt = await tx.wait();
      
      // Extract recovery hash from event
      const event = receipt?.logs.find(
        (log) => {
          try {
            return module.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = module.interface.parseLog(event as any);
      recoveryHash = parsedEvent?.args[1];
    });

    it("should allow owner to cancel recovery", async function () {
      await expect(module.connect(owner1).cancelRecovery(await wallet.getAddress(), recoveryHash))
        .to.emit(module, "RecoveryCancelled")
        .withArgs(await wallet.getAddress(), recoveryHash);

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.executionTime).to.equal(0); // Deleted
    });

    it("should reject cancellation from non-owner", async function () {
      await expect(
        module.connect(nonOwner).cancelRecovery(await wallet.getAddress(), recoveryHash)
      ).to.be.revertedWithCustomError(module, "NotAnOwner");
    });

    it("should remove recovery from pending list after cancellation", async function () {
      await module.connect(owner1).cancelRecovery(await wallet.getAddress(), recoveryHash);

      const pendingHashes = await module.getPendingRecoveryHashes(await wallet.getAddress());
      expect(pendingHashes).to.not.include(recoveryHash);
    });
  });

  describe("isGuardian", function () {
    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);
    });

    it("should return true for guardian", async function () {
      expect(await module.isGuardian(await wallet.getAddress(), guardian1.address)).to.be.true;
      expect(await module.isGuardian(await wallet.getAddress(), guardian2.address)).to.be.true;
    });

    it("should return false for non-guardian", async function () {
      expect(await module.isGuardian(await wallet.getAddress(), guardian3.address)).to.be.false;
      expect(await module.isGuardian(await wallet.getAddress(), nonOwner.address)).to.be.false;
    });
  });

  describe("Security: Threshold Locking", function () {
    beforeEach(async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);
    });

    it("should lock threshold at recovery initiation time", async function () {
      const newOwners = [guardian1.address, guardian2.address];
      const tx = await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), newOwners, 2);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => {
          try {
            return module.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = module.interface.parseLog(event as any);
      const recoveryHash = parsedEvent?.args[1];

      const recovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(recovery.requiredThreshold).to.equal(2);

      // Config updates are blocked while recovery is pending (tested in setupRecovery tests)
      // Even if we could change config, recovery should still use old threshold

      // Get approvals with stored threshold (2)
      await module.connect(guardian1).approveRecovery(await wallet.getAddress(), recoveryHash);
      await module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);

      await time.increase(RECOVERY_PERIOD);

      // Should execute with 2 approvals (stored threshold at initiation)
      await module.connect(guardian3).executeRecovery(await wallet.getAddress(), recoveryHash);
      const executedRecovery = await module.getRecovery(await wallet.getAddress(), recoveryHash);
      expect(executedRecovery.executed).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("should handle multiple pending recoveries", async function () {
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      // Initiate first recovery
      await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), [guardian1.address], 1);

      // Cancel first recovery
      const pendingHashes = await module.getPendingRecoveryHashes(await wallet.getAddress());
      await module.connect(owner1).cancelRecovery(await wallet.getAddress(), pendingHashes[0]);

      // Now should allow config update via multisig
      await setupRecoveryViaMultisig([guardian2.address], 1, RECOVERY_PERIOD);

      // Verify new config
      const config = await module.getRecoveryConfig(await wallet.getAddress());
      expect(config.guardians).to.deep.equal([guardian2.address]);
    });

    it("should handle recovery with same owners", async function () {
      const guardians = [guardian1.address, guardian2.address];
      await setupRecoveryViaMultisig(guardians, 2, RECOVERY_PERIOD);

      // Initiate recovery with same owners (should still work)
      // Make a copy of the array since ethers returns readonly arrays
      const currentOwners = [...await wallet.getOwners()];
      const tx = await module.connect(guardian1).initiateRecovery(await wallet.getAddress(), currentOwners, THRESHOLD);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log) => {
          try {
            return module.interface.parseLog(log as any)?.name === "RecoveryInitiated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent = module.interface.parseLog(event as any);
      const recoveryHash = parsedEvent?.args[1];

      await module.connect(guardian1).approveRecovery(await wallet.getAddress(), recoveryHash);
      await module.connect(guardian2).approveRecovery(await wallet.getAddress(), recoveryHash);

      await time.increase(RECOVERY_PERIOD);
      await module.connect(guardian1).executeRecovery(await wallet.getAddress(), recoveryHash);

      // Owners should remain the same
      const ownersAfter = await wallet.getOwners();
      expect(ownersAfter).to.deep.equal(currentOwners);
    });
  });
});
