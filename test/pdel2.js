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

    describe("Delegation Management", function () {
      let numSlots = 3;
      let slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
      const delegationPeriodInDays = 30;
      let totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(numSlots) * BigInt(delegationPeriodInDays);

      beforeEach(async function () {
          // Setup mock responses
          for (let i = 0; i < numSlots; i++) {
              await mockPowerloomNodes.setNodeOwner(i + 1, addr1.address);
              await mockPowerloomState.setSnapshotter(i + 1, burnerWallet.address);
          }
      });
  
      it("Should return correct delegation info", async function () {
          await PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, { value: totalFee / BigInt(numSlots) });
          const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(1);
          expect(delegationInfo.slotId).to.equal(1);
          expect(delegationInfo.active).to.be.true;
      });
  
      it("Should return correct delegation time remaining", async function () {
          await PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, { value: totalFee / BigInt(numSlots) });
          const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(1);
          const timeRemaining = await PowerloomDelegation.connect(addr1).getDelegationTimeRemaining(1);
          
          // Ensure delegation is active and time remaining is correct
          expect(delegationInfo.active).to.be.true;
          expect(timeRemaining).to.be.gt(0);
          expect(timeRemaining).to.be.lte(delegationPeriodInDays * 24 * 60 * 60);
      });
  
      it("Should check delegation expiry correctly", async function () {
          // First create a delegation with a new slot ID
          await mockPowerloomNodes.setNodeOwner(4, addr1.address); // Using slot ID 4 instead of 1
          await mockPowerloomState.setSnapshotter(4, burnerWallet.address);
          
          // Create delegation with addr1 and slot 4
          await PowerloomDelegation.connect(addr1).createDelegation([4], delegationPeriodInDays, {
              value: totalFee / BigInt(numSlots)
          });
      
          // Increase time to after delegation period
          await time.increase(delegationPeriodInDays * 24 * 60 * 60 + 1);
      
          // Check expiry
          await expect(PowerloomDelegation.connect(addr1).checkDelegationExpiry(4))
              .to.not.be.reverted;
  
          // Verify delegation is now inactive
          const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(4);
          expect(delegationInfo.active).to.be.false;
      });

      it("Should fail to renew a non-existent delegation", async function () {
          await expect(PowerloomDelegation.connect(addr1).renewDelegation(99, delegationPeriodInDays, { value: totalFee / BigInt(numSlots) }))
              .to.be.revertedWith("Delegation not active");
      });

      it("Should renew delegation correctly and emit DelegationStateChanged event", async function () {
            // First create a delegation
            await PowerloomDelegation.connect(addr1).createDelegation([2], delegationPeriodInDays, { value: totalFee / BigInt(numSlots) });
            
            // Get initial delegation info
            const initialDelegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(2);
            const initialEndTime = initialDelegationInfo.endTime;
        
            // Increase time to near the end of delegation period
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 - 1000); // Leave some buffer
        
            // Renew the delegation
            const renewTx = await PowerloomDelegation.connect(addr1).renewDelegation(2, delegationPeriodInDays, { value: totalFee / BigInt(numSlots) });
            
            // Get the transaction receipt
            const receipt = await renewTx.wait();
            
            // Verify the event was emitted
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "DelegationStateChanged"
            );
            expect(event).to.not.be.undefined;
            
            // Verify delegation was renewed correctly
            const newDelegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(2);
            expect(newDelegationInfo.active).to.be.true;
            expect(newDelegationInfo.endTime).to.be.gt(initialEndTime);
        });
        
        it("Should batch renew delegations correctly and emit DelegationStateChanged event", async function () {
            const numSlots = 3;
            const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
            const delegationPeriodInDays = 30;
            let totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(numSlots) * BigInt(delegationPeriodInDays);
        
            // First create the delegations
            await PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });
        
            // Increase time to near the end of delegation period
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 - 1000); // Leave some buffer
        
            // Renew the delegations
            const renewTx = await PowerloomDelegation.connect(addr1).batchRenewDelegations(slotIds, delegationPeriodInDays, { value: totalFee });
            
            // Get the transaction receipt
            const receipt = await renewTx.wait();
            
            // Verify events were emitted
            const events = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "DelegationStateChanged"
            );
            expect(events.length).to.be.gt(0);
        
            // Check each delegation was renewed properly
            for (let i = 0; i < numSlots; i++) {
                const newDelegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
                expect(newDelegationInfo.active).to.be.true;
                expect(newDelegationInfo.endTime).to.be.gt(await time.latest());
            }
        });
        
        it("Should correctly update totalActiveDelegations when renewing delegations, incrementing only if previously inactive", async function () {
            const numSlots = 3;
            const slotIds = Array.from({ length: numSlots }, (_, i) => i + 1);
            const delegationPeriodInDays = 30;
            let totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(numSlots) * BigInt(delegationPeriodInDays);

            // First create the delegations
            await PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });

            // Check initial totalActiveDelegations
            expect(await PowerloomDelegation.totalActiveDelegations()).to.equal(numSlots);

            // Increase time to after delegation period for slot 1
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 + 1);

            // Expire delegation for slot 1
            await PowerloomDelegation.connect(addr1).checkDelegationExpiry(1);

            // Check totalActiveDelegations after expiry
            expect(await PowerloomDelegation.totalActiveDelegations()).to.equal(numSlots - 1);

            // Increase time to near the end of delegation period for remaining slots
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 - 1000);

            // Renew the delegations
            const renewTx = await PowerloomDelegation.connect(addr1).batchRenewDelegations(slotIds, delegationPeriodInDays, { value: totalFee });
            await renewTx.wait();

            // Check totalActiveDelegations after renewal
            expect(await PowerloomDelegation.totalActiveDelegations()).to.equal(numSlots);

            // Check each delegation was renewed properly
            for (let i = 0; i < numSlots; i++) {
                const newDelegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
                expect(newDelegationInfo.active).to.be.true;
                expect(newDelegationInfo.endTime).to.be.gt(await time.latest());
            }
        });

        it("Should revert with 'Invalid slot ID' when calling getDelegationInfo with an invalid slot ID", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).getDelegationInfo(999)
            ).to.be.revertedWith("Slot ID not delegated to user");
        });

        it("Should revert with 'Invalid slot ID' when calling getDelegationTimeRemaining with an invalid slot ID", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).getDelegationTimeRemaining(999)
            ).to.be.revertedWith("Slot ID not delegated to user");
        });

        it("Should revert with 'Invalid slot ID' when calling checkDelegationExpiry with an invalid slot ID", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).checkDelegationExpiry(999)
            ).to.be.revertedWith("Slot ID not delegated to user");
        });

        it("Should revert with 'Invalid slot ID' when calling cancelDelegation with an invalid slot ID", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).cancelDelegation(999)
            ).to.be.revertedWith("Slot ID not delegated to user");
        });
    });
});