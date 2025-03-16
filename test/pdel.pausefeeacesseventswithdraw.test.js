import { expect } from "chai";
import pkg from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = pkg;

describe("PowerloomDelegation", function () {
    let PowerloomDelegation;
    let powerloomDelegation;
    let mockPowerloomNodes;
    let MockPowerloomState;
    let mockPowerloomState;
    let owner;
    let addr1;
    let addr2;
    let burnerWallet;

    const DELEGATION_FEE = ethers.parseEther("300");
    const DELEGATION_PERIOD = 30 * 24 * 60 * 60; // 30 days in seconds
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
        powerloomDelegation = await PowerloomDelegation.deploy(
            await mockPowerloomState.getAddress(),
            await mockPowerloomNodes.getAddress(),
            burnerWallet.address
        );
    });

    describe("Pause Functionality", function () {
      it("Should pause and unpause correctly", async function () {
          // First pause the contract
          await powerloomDelegation.pause();
  
          // Setup for delegation attempt
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
  
          // Attempt to create delegation while paused
          await expect(
              powerloomDelegation.connect(addr1).createDelegation([1], {
                  value: DELEGATION_FEE
              })
          ).to.be.revertedWithCustomError(powerloomDelegation, "EnforcedPause");
  
          // Unpause and try again
          await powerloomDelegation.unpause();
          await expect(
              powerloomDelegation.connect(addr1).createDelegation([1], {
                  value: DELEGATION_FEE
              })
          ).to.not.be.reverted;
      });
  });
  

  describe("Fee Management", function () {
      it("Should allow owner to withdraw fees", async function () {
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
          await powerloomDelegation.connect(addr1).createDelegation([1], {
              value: DELEGATION_FEE
          });

          const initialBalance = await ethers.provider.getBalance(owner.address);
          await powerloomDelegation.withdrawFees();
          const finalBalance = await ethers.provider.getBalance(owner.address);
          
          expect(finalBalance).to.be.gt(initialBalance);
      });
  });

  describe("Non-owner Access Control", function() {
    it("should not allow non-owners to call pause", async function () {
      await expect(powerloomDelegation.connect(addr1).pause()).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call unpause", async function () {
      await expect(powerloomDelegation.connect(addr1).unpause()).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call withdrawFees", async function () {
      await expect(powerloomDelegation.connect(addr1).withdrawFees()).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateBurnerWallet", async function () {
      await expect(powerloomDelegation.connect(addr1).updateBurnerWallet(addr2.address)).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateDelegationFee", async function () {
      await expect(powerloomDelegation.connect(addr1).updateDelegationFee(ethers.parseEther("1"))).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
    it("should not allow non-owners to call updateDelegationPeriod", async function () {
      await expect(powerloomDelegation.connect(addr1).updateDelegationPeriod(60)).to.be.revertedWithCustomError(
        powerloomDelegation, // Check on the powerloomDelegation contract
        "OwnableUnauthorizedAccount"
      );
    });
  })

  describe("Events", function(){
    it("Should emit FeeEvent when receiving ether", async function() {
      await expect(
        owner.sendTransaction({ to: powerloomDelegation.target, value: ethers.parseEther("1") })
      ).to.emit(powerloomDelegation, "FeeEvent");
    })
    it("Should emit FeeEvent when receiving ether through fallback", async function() {
      await expect(
        owner.sendTransaction({ to: powerloomDelegation.target, value: ethers.parseEther("1"), data: "0x1234" })
      ).to.emit(powerloomDelegation, "FeeEvent");
    })
  })
  
  describe("Delegation Management - Edge Cases", function() {
    it("Should fail to check expiry of an inactive delegation", async function() {
      await expect(powerloomDelegation.checkDelegationExpiry(1)).to.be.revertedWith("Delegation not active");
    })
    it("Should return the right information if the delegation was never created", async function() {
      const delegationInfo = await powerloomDelegation.connect(addr1).getDelegationInfo(1);
      expect(delegationInfo.burnerWallet).to.equal(ethers.ZeroAddress);
      expect(delegationInfo.slotId).to.equal(0);
      expect(delegationInfo.active).to.be.false;
    })
  })

  describe("Multiple Slot Delegation", function () {
      it("Should create delegations for multiple slots", async function () {
          const numSlots = 5;
          const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
          const totalFee = DELEGATION_FEE * BigInt(numSlots);

          // Set node owners and snapshotters for each slot
          for (let i = 0; i < numSlots; i++) {
              await mockPowerloomNodes.setNodeOwner(i + 1, addr1.address);
              await mockPowerloomState.setSnapshotter(i + 1, burnerWallet.address);
          }

          const tx = await powerloomDelegation.connect(addr1).createDelegation(slotIds, { value: totalFee });
          const receipt = await tx.wait();
          const blockTime = await time.latest();

          // Check delegation info for each slot
          for (let i = 0; i < numSlots; i++) {
              let found = false;
               for (const log of receipt.logs) {
                  try {
                      const event = powerloomDelegation.interface.parseLog(log);
                      if (event && event.name === 'DelegationCreated' && event.args.delegator === addr1.address && event.args.slotId == i + 1) {
                          expect(event.args.burnerWallet).to.equal(burnerWallet.address);
                          expect(event.args.startTime).to.equal(blockTime);
                          expect(event.args.endTime).to.equal(blockTime + DELEGATION_PERIOD);
                          found = true;
                      }
                  } catch (error) {
                      //ignore
                  }

              }
              expect(found).to.be.true;
              const delegationInfo = await powerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
              expect(delegationInfo.burnerWallet).to.equal(burnerWallet.address);
              expect(delegationInfo.slotId).to.equal(i + 1);
              expect(delegationInfo.active).to.be.true;
          }
      });
      it("Should revert if incorrect fee is provided for multiple slots", async function () {
        const numSlots = 3;
        const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
        const incorrectFee = DELEGATION_FEE * BigInt(numSlots -1) ; // Providing incorrect fee

        // Set node owners and snapshotters for each slot
        for (let i = 0; i < numSlots; i++) {
          await mockPowerloomNodes.setNodeOwner(i + 1, addr1.address);
          await mockPowerloomState.setSnapshotter(i + 1, burnerWallet.address);
        }

        await expect(
          powerloomDelegation.connect(addr1).createDelegation(slotIds, { value: incorrectFee })
        ).to.be.revertedWith("Incorrect delegation fee");
      });
  });

  describe("Updating Fee and Period", function () {
      it("Should update the delegation fee and use it for new delegations", async function () {
          const newFee = ethers.parseEther("200");
          await powerloomDelegation.updateDelegationFee(newFee);
          expect(await powerloomDelegation.DELEGATION_FEE()).to.equal(newFee);

          //check if the event is emitted
          await expect(powerloomDelegation.updateDelegationFee(newFee)).to.emit(powerloomDelegation, "DelegationFeeUpdated");

          // Create a new delegation with the updated fee
          await mockPowerloomNodes.setNodeOwner(3, addr1.address);
          await mockPowerloomState.setSnapshotter(3, burnerWallet.address);
          await expect(powerloomDelegation.connect(addr1).createDelegation([3], {
            value: newFee
          })).to.not.be.reverted;
      });

      it("Should update the delegation period and use it for new delegations", async function () {
          const newPeriod = 60 * 60 * 24 * 15; // 15 days
          await powerloomDelegation.updateDelegationPeriod(newPeriod);
          expect(await powerloomDelegation.DELEGATION_PERIOD()).to.equal(newPeriod);

          //check if the event is emitted
          await expect(powerloomDelegation.updateDelegationPeriod(newPeriod)).to.emit(powerloomDelegation, "DelegationPeriodUpdated");

          // Create a new delegation with the updated period
          await mockPowerloomNodes.setNodeOwner(3, addr1.address);
          await mockPowerloomState.setSnapshotter(3, burnerWallet.address);

          await powerloomDelegation.connect(addr1).createDelegation([3], { value: DELEGATION_FEE });

          const delegationInfo = await powerloomDelegation.connect(addr1).getDelegationInfo(3);
          expect(delegationInfo.endTime - delegationInfo.startTime).to.equal(newPeriod);
      });

      it("Should update the delegation period for new delegations without affecting active delegations", async () => {
          // create a first delegation
          await mockPowerloomNodes.setNodeOwner(3, addr1.address);
          await mockPowerloomState.setSnapshotter(3, burnerWallet.address);
          await powerloomDelegation.connect(addr1).createDelegation([3], { value: DELEGATION_FEE });
          const delegationInfoBeforeUpdate = await powerloomDelegation.connect(addr1).getDelegationInfo(3);
          const previousEndTime = delegationInfoBeforeUpdate.endTime;
          
          const newPeriod = 60 * 60 * 24 * 15; // 15 days
          await powerloomDelegation.updateDelegationPeriod(newPeriod);
          
          //create another delegation
          await mockPowerloomNodes.setNodeOwner(4, addr1.address);
          await mockPowerloomState.setSnapshotter(4, burnerWallet.address);
          await powerloomDelegation.connect(addr1).createDelegation([4], { value: DELEGATION_FEE });
          const delegationInfoAfterUpdate = await powerloomDelegation.connect(addr1).getDelegationInfo(4);
          const newEndTime = delegationInfoAfterUpdate.endTime;

          expect(previousEndTime - delegationInfoBeforeUpdate.startTime).to.equal(DELEGATION_PERIOD); // The old one keeps the old period
          expect(newEndTime - delegationInfoAfterUpdate.startTime).to.equal(newPeriod); // the new one uses the new period
      });
  });

  describe("Withdraw more than once", function () {
      it("Should withdraw fees more than once and verify that there is no more fees to withdraw", async function () {
          // Create a delegation
          await mockPowerloomNodes.setNodeOwner(1, addr1.address);
          await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
          await powerloomDelegation.connect(addr1).createDelegation([1], {
              value: DELEGATION_FEE
          });

          // Withdraw the fees for the first time
          const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
          const firstWithdrawTx = await powerloomDelegation.withdrawFees();
          const balanceAfterFirstWithdraw = await ethers.provider.getBalance(owner.address);
          expect(balanceAfterFirstWithdraw).to.be.gt(initialOwnerBalance);
          
          //check that the event is emitted.
          await expect(firstWithdrawTx).to.emit(powerloomDelegation, "FeeEvent");

          // Check that there is no more fees to withdraw.
          await expect(powerloomDelegation.withdrawFees()).to.be.revertedWith("No fees to withdraw");
      });
  });
});