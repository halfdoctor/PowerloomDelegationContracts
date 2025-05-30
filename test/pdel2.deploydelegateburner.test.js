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
    let addr3;
    let addr4;
    let burnerWallet;

    const BASE_DELEGATION_FEE_PER_DAY = ethers.parseEther("1");
    const MAX_SLOTS = 10;

    beforeEach(async function () {
        // Get signers
        [owner, addr1, addr2, addr3, addr4, burnerWallet] = await ethers.getSigners();
    
        // Fund accounts with smaller amounts (100 ETH instead of 1000)
        await owner.sendTransaction({
            to: addr1.address,
            value: ethers.parseEther("100"),
        }); 
        
        await addr3.sendTransaction({
            to: owner.address,
            value: ethers.parseEther("100"),
        });
    
        await addr4.sendTransaction({
            to: addr2.address,
            value: ethers.parseEther("100"),
        });
    
        try {
            // Mock PowerloomNodes contract with explicit gasLimit
            const MockPowerloomNodes = await ethers.getContractFactory("MockPowerloomNodes");
            mockPowerloomNodes = await MockPowerloomNodes.deploy();
            await mockPowerloomNodes.waitForDeployment();
        } catch (error) {
            console.error("Error deploying MockPowerloomNodes:", error);
            throw error;
        }
    
        MockPowerloomState = await ethers.getContractFactory("MockPowerloomState");
        mockPowerloomState = await MockPowerloomState.deploy();
    
        // Deploy PowerloomDelegation with explicit gasLimit
        PowerloomDelegation = await ethers.getContractFactory("PowerloomDelegation");
        PowerloomDelegation = await PowerloomDelegation.deploy(
            await mockPowerloomState.getAddress(),
            await mockPowerloomNodes.getAddress(),
            burnerWallet.address
        );
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await PowerloomDelegation.owner()).to.equal(owner.address);
        });

        it("Should set the correct burner wallet", async function () {
            expect(await PowerloomDelegation.BURNER_WALLET()).to.equal(burnerWallet.address);
        });

        it("Should set the correct base delegation fee per day", async function () {
            expect(await PowerloomDelegation.BASE_DELEGATION_FEE_PER_DAY()).to.equal(BASE_DELEGATION_FEE_PER_DAY);
        });
    });

    describe("Delegation Creation - Edge Cases", function () {
        beforeEach(async function () {
            // Setup mock responses
            await mockPowerloomNodes.setNodeOwner(1, addr1.address);
            await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
        });

        it("Should create delegation with correct fee", async function () {
            const delegationPeriodInDays = 30;
            const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
            const tx = await PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                value: totalFee
            });
        
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment.name === 'DelegationCreated');
        
            const expectedStartTime = await time.latest();
            const expectedEndTime = expectedStartTime + delegationPeriodInDays * 24 * 60 * 60;
        
            expect(event.args[0]).to.equal(addr1.address);
            expect(event.args[1]).to.equal(1);
            expect(event.args[2]).to.equal(burnerWallet.address);
            expect(event.args[3]).to.be.closeTo(expectedStartTime, 1);
            expect(event.args[4]).to.be.closeTo(expectedEndTime, 1);
        });

      it("Should fail with duplicate slot IDs", async function () {
            const delegationPeriodInDays = 30;
            const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays) * 2n;
            await expect(
                PowerloomDelegation.connect(addr1).createDelegation([1, 1], delegationPeriodInDays, {
                    value: totalFee // Use BigInt for multiplication
                })
            ).to.be.revertedWith("Duplicate slot ID detected");
        });

        it("Should fail with no slotIds provided", async function () {
            const delegationPeriodInDays = 30;
          await expect(
            PowerloomDelegation.connect(addr1).createDelegation([], delegationPeriodInDays, {
                value: BASE_DELEGATION_FEE_PER_DAY * 2n
            })
        ).to.be.revertedWith("No slots provided");
        });

        it("Should fail with too many slotIds provided", async function () {
          const delegationPeriodInDays = 30;
          const slots = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => i + 1);
          const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays) * BigInt(MAX_SLOTS + 1);
          await expect(
              PowerloomDelegation.connect(addr1).createDelegation(slots, delegationPeriodInDays, {
                  value: totalFee
              })
          ).to.be.revertedWith("Too many slots");
        });

        it("Should fail if slot is already delegated", async function () {
            const delegationPeriodInDays = 30;
            const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
          await PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
              value: totalFee
          });

          await expect(
              PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                  value: totalFee
              })
          ).to.be.revertedWith("Slot already delegated");
        });

        it("Should fail with incorrect fee", async function () {
            const delegationPeriodInDays = 30;
            await expect(
                PowerloomDelegation.connect(addr1).createDelegation([1], delegationPeriodInDays, {
                    value: ethers.parseEther("3")
                })
            ).to.be.revertedWith("Incorrect delegation fee");
        });

        it("Should fail if not slot owner", async function () {
            const delegationPeriodInDays = 30;
            const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
            await expect(
                PowerloomDelegation.connect(addr2).createDelegation([1], delegationPeriodInDays, {
                    value: totalFee
                })
            ).to.be.revertedWith("Caller is not the slot owner");
        });

        it("Should fail if delegation period is zero", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).createDelegation([1], 0, {
                    value: BASE_DELEGATION_FEE_PER_DAY * 1n,
                    gasLimit: 1000000
                })
            ).to.be.revertedWith("Delegation period must be greater than zero");
        });

        it("Should fail if delegation period is greater than 365", async function () {
            await expect(
                PowerloomDelegation.connect(addr1).createDelegation([1], 366, {
                    value: ethers.parseEther("300")
                })
            ).to.be.revertedWith("Delegation period must be less than or equal to 365 days");
        });

        it("Should fail if slot ID exceeds maximum limit", async function () {
            const delegationPeriodInDays = 30;
            await mockPowerloomNodes.setNodeOwner(10001, addr1.address);
            await mockPowerloomState.setSnapshotter(10001, burnerWallet.address);
            const totalFee = BASE_DELEGATION_FEE_PER_DAY * BigInt(delegationPeriodInDays);
            await expect(
                PowerloomDelegation.connect(addr1).createDelegation([10001], delegationPeriodInDays, {
                    value: totalFee
                })
            ).to.be.revertedWith("Slot ID exceeds maximum limit");
        });
    });

    describe("Burner Wallet Management", function () {
      it("Should fail if the burner wallet is zero address", async function () {
        await expect(PowerloomDelegation.updateBurnerWallet(ethers.ZeroAddress)).to.be.revertedWith(
          "Invalid burner wallet address"
        );
      });

      it("Should update burner wallet correctly", async function () {
        await PowerloomDelegation.updateBurnerWallet(addr2.address);
        expect(await PowerloomDelegation.BURNER_WALLET()).to.equal(addr2.address);
      });

      it("Should emit BurnerWalletUpdated event", async function () {
        await expect(PowerloomDelegation.updateBurnerWallet(addr2.address)).to.emit(
          PowerloomDelegation,
          "BurnerWalletUpdated"
        );
      });
    });
    
    describe("Fee Management", function () {
      it("Should fail if new fee is zero", async function () {
        await expect(PowerloomDelegation.updateDelegationFee(0)).to.be.revertedWith(
          "Fee cannot be zero"
        );
      });
    });
});