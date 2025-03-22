import { expect } from "chai";
import pkg from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = pkg;

describe("PowerloomDelegation Expiry Checks", function () {
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

    describe("Expiry Checks", function () {
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

        it("Should batch check delegation expiry correctly", async function () {
            // Create delegations for addr1
            await PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });

            // Increase time to after delegation period
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 + 1);

            // Check expiry for addr1
            await expect(PowerloomDelegation.batchCheckDelegationExpiry(addr1.address, slotIds))
                .to.not.be.reverted;

            // Verify delegations are now inactive
            for (let i = 0; i < numSlots; i++) {
                const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
                expect(delegationInfo.active).to.be.false;
            }
        });

        it("Should owner check slot expiry correctly", async function () {
            // Create delegations for addr1
            await PowerloomDelegation.connect(addr1).createDelegation(slotIds, delegationPeriodInDays, { value: totalFee });

            // Increase time to after delegation period
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 + 1);

            // Check expiry for slots 1, 2, and 3
            await expect(PowerloomDelegation.ownerCheckSlotExpiry(slotIds))
                .to.not.be.reverted;

            // Verify delegations are now inactive
            for (let i = 0; i < numSlots; i++) {
                const delegationInfo = await PowerloomDelegation.connect(addr1).getDelegationInfo(i + 1);
                expect(delegationInfo.active).to.be.false;
            }
        });

        it("Should not revert when batch checking expiry for non-existent delegations", async function () {
            const nonExistentSlots = [99, 100, 101];

            // Check expiry for non-existent slots, should not revert
            await expect(PowerloomDelegation.batchCheckDelegationExpiry(addr1.address, nonExistentSlots))
                .to.not.be.reverted;
        });

        it("Should not revert when owner checking expiry for non-existent delegations", async function () {
            const nonExistentSlots = [99, 100, 101];

            // Check expiry for non-existent slots, should not revert
            await expect(PowerloomDelegation.ownerCheckSlotExpiry(nonExistentSlots))
                .to.not.be.reverted;
        });

        it("Should only expire delegations owned by the slot owner in ownerCheckSlotExpiry", async function () {
            // Create delegations for addr1 on slots 1 and 2
            await PowerloomDelegation.connect(addr1).createDelegation([1, 2], delegationPeriodInDays, { value: totalFee * BigInt(2) / BigInt(numSlots) });
            // Create delegation for addr2 on slot 3
            await mockPowerloomNodes.setNodeOwner(3, addr2.address);
            await mockPowerloomState.setSnapshotter(3, burnerWallet.address);
            await PowerloomDelegation.connect(addr2).createDelegation([3], delegationPeriodInDays, { value: totalFee / BigInt(numSlots) });

            // Increase time to after delegation period
            await time.increase(delegationPeriodInDays * 24 * 60 * 60 + 1);

            // Check expiry for slots 1, 2, and 3
            await expect(PowerloomDelegation.ownerCheckSlotExpiry(slotIds))
                .to.not.be.reverted;

            // Verify delegations for addr1 are now inactive
            const delegationInfo1 = await PowerloomDelegation.connect(addr1).getDelegationInfo(1);
            expect(delegationInfo1.active).to.be.false;
            const delegationInfo2 = await PowerloomDelegation.connect(addr1).getDelegationInfo(2);
            expect(delegationInfo2.active).to.be.false;

            // Verify delegation for addr2 is now inactive
            const delegationInfo3 = await PowerloomDelegation.connect(addr2).getDelegationInfo(3);
            expect(delegationInfo3.active).to.be.false;
        });
    });
});