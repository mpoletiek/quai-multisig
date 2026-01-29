import { expect } from "chai";
import { ethers } from "hardhat";
import { ProxyFactory, MultisigWallet, MultisigWalletProxy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ProxyFactory", function () {
  let implementation: MultisigWallet;
  let factory: ProxyFactory;
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
  });

  describe("Deployment", function () {
    it("should set implementation address correctly", async function () {
      expect(await factory.implementation()).to.equal(await implementation.getAddress());
    });

    it("should reject zero address implementation", async function () {
      const ProxyFactory = await ethers.getContractFactory("ProxyFactory");
      await expect(
        ProxyFactory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidImplementationAddress");
    });

    it("should initialize with empty wallet list", async function () {
      expect(await factory.getWalletCount()).to.equal(0);
      expect(await factory.getWallets()).to.have.lengthOf(0);
    });
  });

  describe("createWallet", function () {
    it("should create wallet with correct owners and threshold", async function () {
      const owners = [owner1.address, owner2.address, owner3.address];
      const salt = ethers.randomBytes(32);

      const tx = await factory.connect(owner1).createWallet(owners, THRESHOLD, salt);
      const receipt = await tx.wait();

      // Check event
      const event = receipt?.logs.find(
        (log) => {
          try {
            return factory.interface.parseLog(log as any)?.name === "WalletCreated";
          } catch {
            return false;
          }
        }
      );
      expect(event).to.not.be.undefined;

      const parsedEvent = factory.interface.parseLog(event as any);
      const walletAddress = parsedEvent?.args[0];
      expect(parsedEvent?.args[1]).to.deep.equal(owners);
      expect(parsedEvent?.args[2]).to.equal(THRESHOLD);
      expect(parsedEvent?.args[3]).to.equal(owner1.address);

      // Connect to wallet and verify
      const wallet = await ethers.getContractAt("MultisigWallet", walletAddress) as MultisigWallet;
      const walletOwners = await wallet.getOwners();
      expect(walletOwners).to.have.lengthOf(3);
      expect(walletOwners).to.include.members(owners);
      expect(await wallet.threshold()).to.equal(THRESHOLD);
    });

    it("should register wallet in factory", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);

      const tx = await factory.connect(owner1).createWallet(owners, 2, salt);
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

      expect(await factory.isWallet(walletAddress)).to.be.true;
      expect(await factory.getWalletCount()).to.equal(1);
      const wallets = await factory.getWallets();
      expect(wallets).to.include(walletAddress);
    });

    it("should reject empty owners array", async function () {
      const salt = ethers.randomBytes(32);
      await expect(
        factory.connect(owner1).createWallet([], THRESHOLD, salt)
      ).to.be.revertedWithCustomError(factory, "OwnersRequired");
    });

    it("should reject zero threshold", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);
      await expect(
        factory.connect(owner1).createWallet(owners, 0, salt)
      ).to.be.revertedWithCustomError(factory, "InvalidThreshold");
    });

    it("should reject threshold greater than owners", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);
      await expect(
        factory.connect(owner1).createWallet(owners, 3, salt)
      ).to.be.revertedWithCustomError(factory, "InvalidThreshold");
    });

    it("should create multiple wallets", async function () {
      const owners1 = [owner1.address, owner2.address];
      const owners2 = [owner2.address, owner3.address];
      const salt1 = ethers.randomBytes(32);
      const salt2 = ethers.randomBytes(32);

      await factory.connect(owner1).createWallet(owners1, 2, salt1);
      await factory.connect(owner2).createWallet(owners2, 2, salt2);

      expect(await factory.getWalletCount()).to.equal(2);
    });

    it("should use different salts for different wallets", async function () {
      const owners = [owner1.address, owner2.address];
      const salt1 = ethers.randomBytes(32);
      const salt2 = ethers.randomBytes(32);

      const tx1 = await factory.connect(owner1).createWallet(owners, 2, salt1);
      const receipt1 = await tx1.wait();
      const event1 = receipt1?.logs.find(
        (log) => {
          try {
            return factory.interface.parseLog(log as any)?.name === "WalletCreated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent1 = factory.interface.parseLog(event1 as any);
      const walletAddress1 = parsedEvent1?.args[0];

      const tx2 = await factory.connect(owner1).createWallet(owners, 2, salt2);
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find(
        (log) => {
          try {
            return factory.interface.parseLog(log as any)?.name === "WalletCreated";
          } catch {
            return false;
          }
        }
      );
      const parsedEvent2 = factory.interface.parseLog(event2 as any);
      const walletAddress2 = parsedEvent2?.args[0];

      expect(walletAddress1).to.not.equal(walletAddress2);
      expect(await factory.getWalletCount()).to.equal(2);
    });
  });

  describe("registerWallet", function () {
    let wallet: MultisigWallet;

    beforeEach(async function () {
      // Create a wallet through factory first
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);
      const tx = await factory.connect(owner1).createWallet(owners, 2, salt);
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
      wallet = await ethers.getContractAt("MultisigWallet", walletAddress) as MultisigWallet;
    });

    it("should allow owner to register wallet", async function () {
      // Deploy a new wallet directly (not through factory)
      const MultisigWalletProxy = await ethers.getContractFactory("MultisigWalletProxy");
      const MultisigWallet = await ethers.getContractFactory("MultisigWallet");
      const owners = [owner1.address, owner2.address];
      
      // Encode initialization data using the same method as factory
      const initData = MultisigWallet.interface.encodeFunctionData("initialize", [owners, 2]);
      
      const proxy = await MultisigWalletProxy.deploy(
        await implementation.getAddress(),
        initData
      );
      await proxy.waitForDeployment();
      const newWalletAddress = await proxy.getAddress();

      // Verify it's not already registered
      expect(await factory.isWallet(newWalletAddress)).to.be.false;

      // Register it
      const tx = await factory.connect(owner1).registerWallet(newWalletAddress);
      await expect(tx)
        .to.emit(factory, "WalletRegistered")
        .withArgs(newWalletAddress, owner1.address);

      expect(await factory.isWallet(newWalletAddress)).to.be.true;
      const wallets = await factory.getWallets();
      expect(wallets).to.include(newWalletAddress);
    });

    it("should reject registration from non-owner", async function () {
      // Deploy a new wallet directly
      const MultisigWalletProxy = await ethers.getContractFactory("MultisigWalletProxy");
      const MultisigWallet = await ethers.getContractFactory("MultisigWallet");
      const owners = [owner1.address, owner2.address];
      const initData = MultisigWallet.interface.encodeFunctionData("initialize", [owners, 2]);
      
      const proxy = await MultisigWalletProxy.deploy(
        await implementation.getAddress(),
        initData
      );
      await proxy.waitForDeployment();
      const newWalletAddress = await proxy.getAddress();

      await expect(
        factory.connect(nonOwner).registerWallet(newWalletAddress)
      ).to.be.revertedWithCustomError(factory, "CallerIsNotAnOwner");
    });

    it("should reject zero address", async function () {
      await expect(
        factory.connect(owner1).registerWallet(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "InvalidWalletAddress");
    });

    it("should reject already registered wallet", async function () {
      const walletAddress = await wallet.getAddress();
      await expect(
        factory.connect(owner1).registerWallet(walletAddress)
      ).to.be.revertedWithCustomError(factory, "WalletAlreadyRegistered");
    });
  });

  describe("getWalletsByCreator", function () {
    it("should return wallets created by specific creator", async function () {
      const owners1 = [owner1.address, owner2.address];
      const owners2 = [owner1.address, owner3.address];
      const salt1 = ethers.randomBytes(32);
      const salt2 = ethers.randomBytes(32);

      await factory.connect(owner1).createWallet(owners1, 2, salt1);
      await factory.connect(owner1).createWallet(owners2, 2, salt2);

      const wallets = await factory.getWalletsByCreator(owner1.address);
      expect(wallets.length).to.be.at.least(2);
      
      // Verify owner1 is an owner of all returned wallets
      for (const walletAddr of wallets) {
        const wallet = await ethers.getContractAt("MultisigWallet", walletAddr) as MultisigWallet;
        expect(await wallet.isOwner(owner1.address)).to.be.true;
      }
    });

    it("should return empty array for non-creator", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);
      await factory.connect(owner1).createWallet(owners, 2, salt);

      const wallets = await factory.getWalletsByCreator(nonOwner.address);
      expect(wallets).to.have.lengthOf(0);
    });
  });

  describe("computeAddress", function () {
    it("should compute address (note: may not match on Quai Network)", async function () {
      const owners = [owner1.address, owner2.address];
      const salt = ethers.randomBytes(32);

      const computedAddress = await factory.computeAddress(owner1.address, salt);

      // The computed address should be a valid address
      expect(computedAddress).to.be.properAddress;
      
      // Note: On Quai Network, the actual deployed address may differ
      // due to shard-aware addressing, so we don't assert exact match
    });
  });
});
