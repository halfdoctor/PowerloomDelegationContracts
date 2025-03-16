import { expect } from "chai";
import pkg from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = pkg;

describe("PowerloomDelegation2", function () {
    let PowerloomDelegation2;
    let powerloomDelegation2;
    let mockPowerloomNodes;
    let MockPowerloomState;
    let mockPowerloomState;
    let owner;
    let addr1;
    let addr2;
    let burnerWallet;

    const BASE_DELEGATION_FEE_PER_DAY = ethers.parseEther("10");
    const MAX_SLOTS = 10;

    beforeEach(async function () {
        // Get signers
        [owner, addr1, addr2, burnerWallet] = await ethers.getSigners();

        try {
            // Mock PowerloomNodes contract
            const MockPowerloomNodes = await ethers.getContractFactory("MockPowerloomNodes");
            mockPowerloomNodes = await MockPowerloomNodes.deploy();
            await mockPowerloomNodes.waitForDeployment();
            //console.log("PowerloomNodes deployed at:", mockPowerloomNodes.target); // Log deployment address
        } catch (error) {
            console.error("Error deploying MockPowerloomNodes:", error);
            throw error; // Re-throw to fail the test setup
        }

        MockPowerloomState = await ethers.getContractFactory("MockPowerloomState");
        mockPowerloomState = await MockPowerloomState.deploy();

        // Deploy PowerloomDelegation2
        PowerloomDelegation2 = await ethers.getContractFactory("PowerloomDelegation2");
        powerloomDelegation2 = await PowerloomDelegation2.deploy(
            await mockPowerloomState.getAddress(),
            await mockPowerloomNodes.getAddress(),
            burnerWallet.address
        );
    });

    describe("Pause Functionality", function () {
      it("Should pause and unpause correctly", async function () {
          // First pause the contract
          await powerloomDelegation2.pause();
  
          // Setup for delegation attempt
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
  
          // Attempt to create delegation while paused
          const delegationPeriodInDays = 30;
          const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
          await expect(
              powerloomDelegation2.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                  value: totalFee
              })
          ).to.be.revertedWithCustomError(powerloomDelegation2, "EnforcedPause");
  
          // Unpause and try again
          await powerloomDelegation2.unpause();
          await expect(
              powerloomDelegation2.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                  value: totalFee
              })
          ).to.not.be.reverted;
      });
  });
  

  describe("Fee Management", function () {
      it("Should allow owner to withdraw fees", async function () {
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
          const delegationPeriodInDays = 30;
          const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
          await powerloomDelegation2.connect(addr1).createDelegation([1], delegationPeriodInDays, {
              value: totalFee
          });

          const initialBalance = await ethers.provider.getBalance(owner.address);
          await powerloomDelegation2.withdrawFees();
          const finalBalance = await ethers.provider.getBalance(owner.address);
          
          expect(finalBalance).to.be.gt(initialBalance);
      });
  });

  describe("Non-owner Access Control", function() {
    it("should not allow non-owners to call pause", async function () {
      await expect(powerloomDelegation2.connect(addr1).pause()).to.be.revertedWithCustomError(
        powerloomDelegation2, // Check on the powerloomDelegation2 contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call unpause", async function () {
      await expect(powerloomDelegation2.connect(addr1).unpause()).to.be.revertedWithCustomError(
        powerloomDelegation2, // Check on the powerloomDelegation2 contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call withdrawFees", async function () {
      await expect(powerloomDelegation2.connect(addr1).withdrawFees()).to.be.revertedWithCustomError(
        powerloomDelegation2, // Check on the powerloomDelegation2 contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateBurnerWallet", async function () {
      await expect(powerloomDelegation2.connect(addr1).updateBurnerWallet(addr2.address)).to.be.revertedWithCustomError(
        powerloomDelegation2, // Check on the powerloomDelegation2 contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateDelegationFee", async function () {
      await expect(powerloomDelegation2.connect(addr1).updateDelegationFee(ethers.parseEther("1"))).to.be.revertedWithCustomError(
        powerloomDelegation2, // Check on the powerloomDelegation2 contract
        "OwnableUnauthorizedAccount"
      );
    });
  })

  describe("Events", function(){
    it("Should emit FeeEvent when receiving ether", async function() {
      await expect(
        owner.sendTransaction({ to: powerloomDelegation2.target, value: ethers.parseEther("1") })
      ).to.emit(powerloomDelegation2, "FeeEvent");
    })
    it("Should emit FeeEvent when receiving ether through fallback", async function() {
      await expect(
        owner.sendTransaction({ to: powerloomDelegation2.target, value: ethers.parseEther("1"), data: "0x1234" })
      ).to.emit(powerloomDelegation2, "FeeEvent");
    })
  })
  
  describe("Delegation Management - Edge Cases", function() {
    it("Should fail to check expiry of an inactive delegation", async function() {
      await expect(powerloomDelegation2.checkDelegationExpiry(1)).to.be.revertedWith("Delegation not active");
    })
    it("Should return the right information if the delegation was never created", async function() {
      const delegationInfo = await powerloomDelegation2.connect(addr1).getDelegationInfo(1);
      expect(delegationInfo.burnerWallet).to.equal(ethers.ZeroAddress);
      expect(delegationInfo.slotId).to.equal(0);
      expect(delegationInfo.active).to.be.false;
    })
  })

  describe("Multiple Slot Delegation", function () {
      it("Should create delegations for multiple slots", async function () {
          const numSlots = 5;
          const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
          const delegationPeriodInDays = 30;
          const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays) * BigInt(numSlots);

          // Set node owners and snapshotters for each slot
          for (let i = 0; i < numSlots; i++) {
              await mockPowerloomNodes.setNodeOwner(i + 1, addr1.address);
              await mockPowerloomState.setSnapshotter(i + 1, burnerWallet.address);
          }

          const tx = await powerloomDelegation2.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });
          const receipt = await tx.wait();
          const blockTime = await time.latest();

          // Check delegation info for each slot
          for (let i = 0; i < numSlots; i++) {
              let found = false;
               for (const log of receipt.logs) {
                  try {
                      const event = powerloomDelegation2.interface.parseLog(log);
                      if (event && event.name === 'DelegationCreated' && event.args.delegator === addr1.address && event.args.slotId == i + 1) {
                          expect(event.args.burnerWallet).to.equal(burnerWallet.address);
                          expect(event.args.startTime).to.equal(blockTime);
                          expect(event.args.endTime).to.equal(blockTime + delegationPeriodInDays * 24 * 60 * 60);
                          found = true;
                      }
                  } catch (error) {
                      //ignore
                  }

              }
              expect(found).to.be.true;
              const delegationInfo = await powerloomDelegation2.connect(addr1).getDelegationInfo(i + 1);
              expect(delegationInfo.burnerWallet).to.equal(burnerWallet.address);
              expect(delegationInfo.slotId).to.equal(i + 1);
              expect(delegationInfo.active).to.be.true;
          }
      });
      it("Should revert if incorrect fee is provided for multiple slots", async function () {
        const numSlots = 3;
        const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
        const delegationPeriodInDays = 30;
        const incorrectFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays) * BigInt(numSlots -1) ; // Providing incorrect fee

        // Set node owners and snapshotters for each slot
        for (let i = 0; i < numSlots; i++) {
          await mockPowerloomNodes.setNodeOwner(i + 1, addr1.address);
          await mockPowerloomState.setSnapshotter(i + 1, burnerWallet.address);
        }

        await expect(
          powerloomDelegation2.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: incorrectFee })
        ).to.be.revertedWith("Incorrect delegation fee");
      });
  });

  describe("Updating Fee", function () {
      it("Should update the delegation fee and use it for new delegations", async function () {
          const newFee = ethers.parseEther("200");
          await powerloomDelegation2.updateDelegationFee(newFee);
          expect(await powerloomDelegation2.BASE_DELEGATION_FEE_PER_DAY()).to.equal(newFee);

          //check if the event is emitted
          await expect(powerloomDelegation2.updateDelegationFee(newFee)).to.emit(powerloomDelegation2, "DelegationFeeUpdated");

          // Create a new delegation with the updated fee
          await mockPowerloomNodes.setNodeOwner(3, addr1.address);
          await mockPowerloomState.setSnapshotter(3, burnerWallet.address);
          const delegationPeriodInDays = 30;
          const totalFee = newFee * BigInt(delegationPeriodInDays);
          await expect(powerloomDelegation2.connect(addr1).createDelegation([3], delegationPeriodInDays, {
            value: totalFee
          })).to.not.be.reverted;
      });
  });
});