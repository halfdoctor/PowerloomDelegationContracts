import { expect } from "chai";
import pkg from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = pkg;

describe("PowerloomDelegation", function () {
    let PowerloomDelegation;
    let mockPowerloomNodes;
    let MockPowerloomState;
    let mockPowerloomState;
    let owner;
    let addr1;
    let addr2;
    let burnerWallet;

    const BASE_DELEGATION_FEE_PER_DAY = ethers.parseEther("1");
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

        // Deploy PowerloomDelegation
        PowerloomDelegation = await ethers.getContractFactory("PowerloomDelegation");
        PowerloomDelegation = await PowerloomDelegation.deploy(
            await mockPowerloomState.getAddress(),
            await mockPowerloomNodes.getAddress(),
            burnerWallet.address
        );
    });

    describe("Pause Functionality", function () {
      it("Should pause and unpause correctly", async function () {
          // First pause the contract
          await PowerloomDelegation.pause();
  
          // Setup for delegation attempt
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
  
          // Attempt to create delegation while paused
          const delegationPeriodInDays = 30;
          const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
          await expect(
              PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                  value: totalFee
              })
          ).to.be.revertedWithCustomError(PowerloomDelegation, "EnforcedPause");
  
          // Unpause and try again
          await PowerloomDelegation.unpause();
          await expect(
              PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
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
          await PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
              value: totalFee
          });

          const initialBalance = await ethers.provider.getBalance(owner.address);
          await PowerloomDelegation.withdrawFees();
          const finalBalance = await ethers.provider.getBalance(owner.address);
          
          expect(finalBalance).to.be.gt(initialBalance);
      });
  });

  describe("Non-owner Access Control", function() {
    it("should not allow non-owners to call pause", async function () {
      await expect(PowerloomDelegation.connect(addr1).pause()).to.be.revertedWithCustomError(
        PowerloomDelegation, // Check on the PowerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call unpause", async function () {
      await expect(PowerloomDelegation.connect(addr1).unpause()).to.be.revertedWithCustomError(
        PowerloomDelegation, // Check on the PowerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call withdrawFees", async function () {
      await expect(PowerloomDelegation.connect(addr1).withdrawFees()).to.be.revertedWithCustomError(
        PowerloomDelegation, // Check on the PowerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateBurnerWallet", async function () {
      await expect(PowerloomDelegation.connect(addr1).updateBurnerWallet(addr2.address)).to.be.revertedWithCustomError(
        PowerloomDelegation, // Check on the PowerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateDelegationFee", async function () {
      await expect(PowerloomDelegation.connect(addr1).updateDelegationFee(ethers.parseEther("1"))).to.be.revertedWithCustomError(
        PowerloomDelegation, // Check on the PowerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
  })

  describe("Events", function(){
    it("Should emit FeeEvent when receiving ether", async function() {
      await expect(
        owner.sendTransaction({ to: PowerloomDelegation.target, value: ethers.parseEther("1") })
      ).to.emit(PowerloomDelegation, "FeeEvent");
    })
    it("Should emit FeeEvent when receiving ether through fallback", async function() {
      await expect(
        owner.sendTransaction({ to: PowerloomDelegation.target, value: ethers.parseEther("1"), data: "0x1234" })
      ).to.emit(PowerloomDelegation, "FeeEvent");
    })
  })
  
  describe("Delegation Management - Edge Cases", function() {
    it("Should fail to check expiry of an inactive delegation", async function() {
      await expect(PowerloomDelegation.checkDelegationExpiry(1)).to.be.revertedWith("Slot ID not delegated to user");
    })
    it("Should return the right information if the delegation was never created", async function() {
      await expect(PowerloomDelegation.getDelegationInfo(1)).to.be.revertedWith("Slot ID not delegated to user");
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

          const tx = await PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });
          const receipt = await tx.wait();
          const blockTime = await time.latest();

          // Check delegation info for each slot
          for (let i = 0; i < numSlots; i++) {
              let found = false;
               for (const log of receipt.logs) {
                  try {
                      const event = PowerloomDelegation.interface.parseLog(log);
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
              const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
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
          PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: incorrectFee })
        ).to.be.revertedWith("Incorrect delegation fee");
      });
  });

  describe("Updating Fee", function () {
      it("Should update the delegation fee and use it for new delegations", async function () {
          const newFee = ethers.parseEther("2");
          await PowerloomDelegation.updateDelegationFee(newFee);
          expect(await PowerloomDelegation.BASE_DELEGATION_FEE_PER_DAY()).to.equal(newFee);

          //check if the event is emitted
          await expect(PowerloomDelegation.updateDelegationFee(newFee)).to.emit(PowerloomDelegation, "DelegationFeeUpdated");

          // Create a new delegation with the updated fee
          await mockPowerloomNodes.setNodeOwner(3, addr1.address);
          await mockPowerloomState.setSnapshotter(3, burnerWallet.address);
          const delegationPeriodInDays = 30;
          const totalFee = newFee * BigInt(delegationPeriodInDays);
          await expect(PowerloomDelegation.connect(addr1).createDelegation([3], delegationPeriodInDays, {
            value: totalFee
          })).to.not.be.reverted;
      });
  });
});