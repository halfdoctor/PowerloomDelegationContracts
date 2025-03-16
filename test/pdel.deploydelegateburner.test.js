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

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await powerloomDelegation.owner()).to.equal(owner.address);
        });

        it("Should set the correct burner wallet", async function () {
            expect(await powerloomDelegation.BURNER_WALLET()).to.equal(burnerWallet.address);
        });

        it("Should set the correct delegation fee", async function () {
            expect(await powerloomDelegation.DELEGATION_FEE()).to.equal(DELEGATION_FEE);
        });
    });

    describe("Delegation Creation - Edge Cases", function () {
        beforeEach(async function () {
            // Setup mock responses
            await mockPowerloomNodes.setNodeOwner(1, addr1.address);
            await mockPowerloomState.setSnapshotter(1, burnerWallet.address);
        });

        it("Should create delegation with correct fee", async function () {
            await expect(powerloomDelegation.connect(addr1).createDelegation([1], {
                value: DELEGATION_FEE
            }))
                .to.emit(powerloomDelegation, "DelegationCreated")
                .withArgs(addr1.address, 1, burnerWallet.address, await time.latest(), (await time.latest()) + DELEGATION_PERIOD);
        });

      it("Should fail with duplicate slot IDs", async function () {
            await expect(
                powerloomDelegation.connect(addr1).createDelegation([1, 1], {
                    value: DELEGATION_FEE * 2n // Use BigInt for multiplication
                })
            ).to.be.revertedWith("Duplicate slot ID detected");
        });

        it("Should fail with no slotIds provided", async function () {
          await expect(
            powerloomDelegation.connect(addr1).createDelegation([], {
                value: DELEGATION_FEE * 2n
            })
        ).to.be.revertedWith("No slots provided");
        });

        it("Should fail with too many slotIds provided", async function () {
          const slots = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => i + 1);
          await expect(
              powerloomDelegation.connect(addr1).createDelegation(slots, {
                  value: DELEGATION_FEE * BigInt(MAX_SLOTS + 1)
              })
          ).to.be.revertedWith("Too many slots");
        });

        it("Should fail if slot is already delegated", async function () {
          await powerloomDelegation.connect(addr1).createDelegation([1], {
              value: DELEGATION_FEE
          });

          await expect(
              powerloomDelegation.connect(addr1).createDelegation([1], {
                  value: DELEGATION_FEE
              })
          ).to.be.revertedWith("Slot already delegated");
        });

        it("Should fail with incorrect fee", async function () {
            await expect(
                powerloomDelegation.connect(addr1).createDelegation([1], {
                    value: ethers.parseEther("3")
                })
            ).to.be.revertedWith("Incorrect delegation fee");
        });

        it("Should fail if not slot owner", async function () {
            await expect(
                powerloomDelegation.connect(addr2).createDelegation([1], {
                    value: DELEGATION_FEE
                })
            ).to.be.revertedWith("Caller is not the slot owner");
        });
    });

    describe("Burner Wallet Management", function () {
      it("Should fail if the burner wallet is zero address", async function () {
        await expect(powerloomDelegation.updateBurnerWallet(ethers.ZeroAddress)).to.be.revertedWith(
          "Invalid burner wallet address"
        );
      });

      it("Should update burner wallet correctly", async function () {
        await powerloomDelegation.updateBurnerWallet(addr2.address);
        expect(await powerloomDelegation.BURNER_WALLET()).to.equal(addr2.address);
      });

      it("Should emit BurnerWalletUpdated event", async function () {
        await expect(powerloomDelegation.updateBurnerWallet(addr2.address)).to.emit(
          powerloomDelegation,
          "BurnerWalletUpdated"
        );
      });
    });
    
    describe("Fee and Period Management", function () {
      it("Should fail if new fee is zero", async function () {
        await expect(powerloomDelegation.updateDelegationFee(0)).to.be.revertedWith(
          "Fee cannot be zero"
        );
      });

      it("Should fail if new period is zero", async function () {
        await expect(powerloomDelegation.updateDelegationPeriod(0)).to.be.revertedWith(
          "Period cannot be zero"
        );
      });
    });
});