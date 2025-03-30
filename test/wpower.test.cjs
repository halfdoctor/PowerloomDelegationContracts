const { expect } = require("chai");
const pkg = require("hardhat");
const { ethers } = pkg;
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("WPOWER", function () {
  // Define a fixture to reuse the same setup in every test
  async function deployWPOWERFixture() {
    // Get signers
    const [owner, alice, bob] = await ethers.getSigners();

    // Deploy the WPOWER contract
    const WPOWERFactory = await ethers.getContractFactory("WPOWER");
    const wpower = await WPOWERFactory.deploy();

    return { wpower, owner, alice, bob };
  }

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      
      expect(await wpower.name()).to.equal("Wrapped POWER");
      expect(await wpower.symbol()).to.equal("WPOWER");
      expect(await wpower.decimals()).to.equal(18);
    });

    it("Should start with zero total supply", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      
      expect(await wpower.totalSupply()).to.equal(0);
    });
  });

  describe("Deposits", function () {
    it("Should wrap tokens via deposit()", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const depositAmount = ethers.parseEther("1.0");
      
      // Deposit 1 ETH
      const tx = await wpower.deposit({ value: depositAmount });
      
      // Check events
      await expect(tx)
        .to.emit(wpower, "Deposit")
        .withArgs(owner.address, owner.address, depositAmount);
        
      // Check balances
      expect(await wpower.balanceOf(owner.address)).to.equal(depositAmount);
      expect(await wpower.totalSupply()).to.equal(depositAmount);
    });

    it("Should wrap tokens via receive() function", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const depositAmount = ethers.parseEther("1.0");
      
      // Send ETH directly to contract
      const tx = await owner.sendTransaction({
        to: await wpower.getAddress(),
        value: depositAmount
      });
      
      // Check balances
      expect(await wpower.balanceOf(owner.address)).to.equal(depositAmount);
    });

    it("Should wrap tokens to another address via depositTo()", async function () {
      const { wpower, owner, alice } = await loadFixture(deployWPOWERFixture);
      const depositAmount = ethers.parseEther("1.0");
      
      // Deposit 1 ETH to Alice
      const tx = await wpower.depositTo(alice.address, { value: depositAmount });
      
      // Check events
      await expect(tx)
        .to.emit(wpower, "Deposit")
        .withArgs(owner.address, alice.address, depositAmount);
        
      // Check balances
      expect(await wpower.balanceOf(alice.address)).to.equal(depositAmount);
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
      expect(await wpower.totalSupply()).to.equal(depositAmount);
    });

    it("Should revert depositTo() with zero address", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      const depositAmount = ethers.parseEther("1.0");
      
      await expect(
        wpower.depositTo(ethers.ZeroAddress, { value: depositAmount })
      ).to.be.revertedWithCustomError(wpower, "ZeroAddress");
    });

    it("Should revert deposit() with zero amount", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      
      await expect(
        wpower.deposit({ value: 0 })
      ).to.be.revertedWithCustomError(wpower, "ZeroAmount");
    });
  });

  describe("Withdrawals", function () {
    it("Should unwrap tokens via withdraw()", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // First deposit
      await wpower.deposit({ value: amount });
      
      // Get balance before withdrawal
      const balanceBefore = await ethers.provider.getBalance(owner.address);
      
      // Withdraw
      const tx = await wpower.withdraw(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      
      // Check events
      await expect(tx)
        .to.emit(wpower, "Withdrawal")
        .withArgs(owner.address, owner.address, amount);
        
      // Check balances - account for gas costs
      const balanceAfter = await ethers.provider.getBalance(owner.address);
      expect(balanceAfter).to.equal(balanceBefore + amount - gasUsed);
      
      // Token balance should be zero
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
      expect(await wpower.totalSupply()).to.equal(0);
    });

    it("Should unwrap tokens to another address via withdrawTo()", async function () {
      const { wpower, owner, alice } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // First deposit
      await wpower.deposit({ value: amount });
      
      // Get balance before withdrawal
      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      
      // Withdraw to Alice
      const tx = await wpower.withdrawTo(alice.address, amount);
      
      // Check events
      await expect(tx)
        .to.emit(wpower, "Withdrawal")
        .withArgs(owner.address, alice.address, amount);
        
      // Check balances
      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + amount);
      
      // Token balance should be zero
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
      expect(await wpower.totalSupply()).to.equal(0);
    });

    it("Should revert withdraw() with insufficient balance", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // Attempt to withdraw without depositing
      await expect(
        wpower.withdraw(amount)
      ).to.be.reverted; // Will revert with ERC20 insufficient balance error
    });

    it("Should revert withdrawTo() with zero address", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // First deposit
      await wpower.deposit({ value: amount });
      
      await expect(
        wpower.withdrawTo(ethers.ZeroAddress, amount)
      ).to.be.revertedWithCustomError(wpower, "ZeroAddress");
    });

    it("Should revert withdraw() with zero amount", async function () {
      const { wpower } = await loadFixture(deployWPOWERFixture);
      
      await expect(
        wpower.withdraw(0)
      ).to.be.revertedWithCustomError(wpower, "ZeroAmount");
    });
  });

  describe("ERC20 functionality", function () {
    it("Should allow token transfers", async function () {
      const { wpower, owner, alice } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // First deposit
      await wpower.deposit({ value: amount });
      
      // Transfer to Alice
      await wpower.transfer(alice.address, amount);
      
      // Check balances
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
      expect(await wpower.balanceOf(alice.address)).to.equal(amount);
    });

    it("Should allow token approvals and transferFrom", async function () {
      const { wpower, owner, alice, bob } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // First deposit
      await wpower.deposit({ value: amount });
      
      // Approve Alice to spend tokens
      await wpower.approve(alice.address, amount);
      
      // Alice transfers from owner to Bob
      await wpower.connect(alice).transferFrom(owner.address, bob.address, amount);
      
      // Check balances
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
      expect(await wpower.balanceOf(bob.address)).to.equal(amount);
      expect(await wpower.allowance(owner.address, alice.address)).to.equal(0);
    });
  });

  describe("Edge cases and security", function () {
    it("Should handle multiple deposits and withdrawals", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("0.5");
      
      // Multiple deposits
      await wpower.deposit({ value: amount });
      await wpower.deposit({ value: amount });
      
      expect(await wpower.balanceOf(owner.address)).to.equal(amount * 2n);
      
      // Partial withdrawal
      await wpower.withdraw(amount);
      
      expect(await wpower.balanceOf(owner.address)).to.equal(amount);
      
      // Complete withdrawal
      await wpower.withdraw(amount);
      
      expect(await wpower.balanceOf(owner.address)).to.equal(0);
    });

    it("Should return correct amounts from deposit and withdraw functions", async function () {
      const { wpower, owner } = await loadFixture(deployWPOWERFixture);
      const amount = ethers.parseEther("1.0");
      
      // Check deposit return value
      const depositResult = await wpower.deposit.staticCall({ value: amount });
      expect(depositResult).to.equal(amount);
      
      // Actually deposit
      await wpower.deposit({ value: amount });
      
      // Check withdraw return value
      const withdrawResult = await wpower.withdraw.staticCall(amount);
      expect(withdrawResult).to.equal(amount);
    });
  });
});