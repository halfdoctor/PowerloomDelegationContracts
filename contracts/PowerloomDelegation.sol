// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPowerloomNodes {
    function nodeIdToOwner(uint256 nodeId) external view returns (address);
}

interface IPowerloomState {
    function slotSnapshotterMapping(uint256 slotId) external view returns (address);
}

/// @title PowerLoomDelegation
/// @notice Contract for managing delegations in the PowerLoom protocol
/// @dev Implements delegation functionality with fee management and time-based expiry
contract PowerloomDelegation is Ownable, ReentrancyGuard, Pausable {
    // ... state variables ...
    IPowerloomState public immutable powerloomState;
    IPowerloomNodes public immutable powerloomNodes;

    uint256 public DELEGATION_FEE = 300 ether; // native currency units
    uint256 public DELEGATION_PERIOD = 30 days;
    address public BURNER_WALLET; 
    uint256 public constant MAX_SLOTS_PER_DELEGATION = 10; 
    uint256 public totalActiveDelegations;

    struct DelegationInfo {
        address burnerWallet;
        uint256 slotId;
        uint256 startTime;
        uint256 endTime;
        bool active;
    }

    // Add this struct to return delegation status information
    struct DelegationStatus {
        uint256 slotId;
        bool isActive;
        uint256 endTime;
        uint256 timeRemaining;
        address burnerWallet;
    }

    mapping(address => mapping(uint256 => DelegationInfo)) public delegations; // delegator => slotId => DelegationInfo
    mapping(address => uint256[]) private userSlotIds; // Tracks all slots delegated by a user

    event DelegationCreated(
        address indexed delegator,
        uint256 indexed slotId,
        address burnerWallet,
        uint256 startTime,
        uint256 endTime
    );
    event BurnerWalletUpdated(address oldBurnerWallet, address newBurnerWallet);
    event DelegationFeeUpdated(uint256 oldFee, uint256 newFee);
    event DelegationPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event DelegationStateChanged(
        address indexed delegator,
        uint256 indexed slotId,
        bool active,
        uint256 timestamp,
        string reason // "expired" or "manual"
    );
    event FeeEvent(
        address indexed from,
        uint256 amount,
        string eventType,
        uint256 timestamp
    );

    /// @notice Constructor initializes the contract with required addresses
    /// @param _powerloomState Address of the PowerLoom state contract
    /// @param _powerloomNodes Address of the PowerLoom nodes contract
    /// @param initialBurnerWallet Address of the initial burner wallet
    constructor(
        address _powerloomState, 
        address _powerloomNodes, 
        address initialBurnerWallet
    ) Ownable(msg.sender) {
        require(_powerloomState != address(0), "Invalid state contract");
        require(_powerloomNodes != address(0), "Invalid nodes contract");
        require(initialBurnerWallet != address(0), "Invalid burner wallet");
        
        powerloomState = IPowerloomState(_powerloomState);
        powerloomNodes = IPowerloomNodes(_powerloomNodes);
        BURNER_WALLET = initialBurnerWallet;
    }

    /// @notice Pauses all contract operations
    /// @dev Can only be called by the contract owner
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses all contract operations
    /// @dev Can only be called by the contract owner
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Creates new delegations for multiple slot IDs
    /// @dev Requires payment of delegation fee per slot
    /// @param slotIds Array of slot IDs to delegate
    function createDelegation(uint256[] calldata slotIds) external payable nonReentrant whenNotPaused {
        uint256 totalSlots = slotIds.length;
        require(totalSlots > 0, "No slots provided");
        require(totalSlots <= MAX_SLOTS_PER_DELEGATION, "Too many slots");

        uint256 totalFee = DELEGATION_FEE * totalSlots;
        require(msg.value == totalFee, "Incorrect delegation fee");

        for (uint256 i = 0; i < totalSlots; i++) {
            uint256 slotId = slotIds[i];

            // Ensure no duplicate slotId within the same function call
            for (uint256 j = i + 1; j < totalSlots; j++) {
                require(slotId != slotIds[j], "Duplicate slot ID detected");
            }

            // Fetch slot owner
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            require(slotOwner == msg.sender, "Caller is not the slot owner");

            // Ensure the slot is not already delegated
            require(!delegations[msg.sender][slotId].active, "Slot already delegated");

            // Verify burner wallet mapping
            address snapshotterAddress = powerloomState.slotSnapshotterMapping(slotId);
            require(snapshotterAddress != address(0), "Invalid snapshotter address");
            require(snapshotterAddress == BURNER_WALLET, "Burner wallet not set correctly");

            // Store delegation details
            delegations[msg.sender][slotId] = DelegationInfo({
                burnerWallet: BURNER_WALLET,
                slotId: slotId,
                startTime: block.timestamp,
                endTime: block.timestamp + DELEGATION_PERIOD,
                active: true
            });

            _addUserSlotId(msg.sender, slotId);

            totalActiveDelegations++;

            emit DelegationCreated(
                msg.sender,
                slotId,
                BURNER_WALLET,
                block.timestamp,
                block.timestamp + DELEGATION_PERIOD
            );
        }
    }

    /// @notice Adds a slot ID to user's delegation list
    /// @dev Internal function called during delegation creation
    function _addUserSlotId(address user, uint256 slotId) internal {
        // Check if slot ID already exists in the user's array
        uint256[] storage userSlots = userSlotIds[user];
        for (uint256 i = 0; i < userSlots.length; i++) {
            if (userSlots[i] == slotId) {
                return; // Slot ID already exists, do nothing
            }
        }
        
        // Add slot ID if it doesn't exist
        userSlots.push(slotId);
    }

    /// @notice Gets the total number of delegations for a user
    /// @param user Address of the user to query
    /// @return Total number of delegations (active and inactive)
    function getTotalUserDelegations(address user) external view returns (uint256) {
        return userSlotIds[user].length;
    }

    /// @notice Gets all delegations for a specific user with their current status
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of delegation status information
    function getUserDelegations(address user) external view returns (DelegationStatus[] memory) {
        uint256[] memory slots = userSlotIds[user];
        DelegationStatus[] memory statuses = new DelegationStatus[](slots.length);
        
        for (uint256 i = 0; i < slots.length; i++) {
            uint256 slotId = slots[i];
            DelegationInfo memory delegation = delegations[user][slotId];
            
            uint256 timeRemaining = 0;
            if (delegation.active && block.timestamp < delegation.endTime) {
                timeRemaining = delegation.endTime - block.timestamp;
            }
            
            statuses[i] = DelegationStatus({
                slotId: slotId,
                isActive: delegation.active && block.timestamp < delegation.endTime,
                endTime: delegation.endTime,
                timeRemaining: timeRemaining,
                burnerWallet: delegation.burnerWallet
            });
        }
        
        return statuses;
    }

    /// @notice Gets active delegations for a specific user
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of active delegation status information
    function getActiveDelegations(address user) external view returns (DelegationStatus[] memory) {
        uint256[] memory slots = userSlotIds[user];
        
        // First, count active delegations
        uint256 activeCount = 0;
        for (uint256 i = 0; i < slots.length; i++) {
            DelegationInfo memory delegation = delegations[user][slots[i]];
            if (delegation.active && block.timestamp < delegation.endTime) {
                activeCount++;
            }
        }
        
        // Create array with exact size needed
        DelegationStatus[] memory activeStatuses = new DelegationStatus[](activeCount);
        
        // Fill array with active delegations
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < slots.length; i++) {
            uint256 slotId = slots[i];
            DelegationInfo memory delegation = delegations[user][slotId];
            
            if (delegation.active && block.timestamp < delegation.endTime) {
                activeStatuses[currentIndex] = DelegationStatus({
                    slotId: slotId,
                    isActive: true,
                    endTime: delegation.endTime,
                    timeRemaining: delegation.endTime - block.timestamp,
                    burnerWallet: delegation.burnerWallet
                });
                currentIndex++;
            }
        }
        
        return activeStatuses;
    }
    /// @notice Retrieves delegation information for a specific slot
    /// @param slotId The ID of the slot to query
    /// @return DelegationInfo struct containing delegation details
    function getDelegationInfo(uint256 slotId) external view returns (DelegationInfo memory) {
        return delegations[msg.sender][slotId];
    }

    /// @notice Gets remaining time for a delegation
    /// @param slotId The ID of the slot to check
    /// @return Remaining time in seconds, 0 if expired or inactive
    function getDelegationTimeRemaining(uint256 slotId) external view returns (uint256) {
        DelegationInfo memory delegation = delegations[msg.sender][slotId];
        if (!delegation.active || block.timestamp >= delegation.endTime) {
            return 0;
        }
        return delegation.endTime - block.timestamp;
    }

    /// @notice Checks and updates delegation expiry status
    /// @param slotId The ID of the slot to check
    function checkDelegationExpiry(uint256 slotId) external whenNotPaused {
        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.active, "Delegation not active");

        if (block.timestamp >= delegation.endTime) {
            delegation.active = false;
            if (totalActiveDelegations > 0) {
                totalActiveDelegations--;
            }
            emit DelegationStateChanged(
                msg.sender,
                slotId,
                false,
                block.timestamp,
                "expired"
            );
        }
    }

    /// @notice Renews an existing delegation for another period
    /// @param slotId The ID of the slot to renew
    function renewDelegation(uint256 slotId) external payable nonReentrant whenNotPaused {
        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.slotId == slotId, "Delegation does not exist"); // Check if delegation exists
        require(msg.value >= DELEGATION_FEE, "Insufficient delegation fee");
        
        // Check if caller is still the owner of the slot
        address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
        require(slotOwner == msg.sender, "Caller is not the slot owner");
        
        uint256 excess = msg.value - DELEGATION_FEE;
        if (excess > 0) {
            payable(msg.sender).transfer(excess);
        }
        
        // Update delegation period
        delegation.startTime = block.timestamp;
        delegation.endTime = block.timestamp + DELEGATION_PERIOD;
        delegation.active = true; // Ensure it's reactivated
        
        emit DelegationStateChanged(
            msg.sender,
            slotId,
            true,
            block.timestamp,
            "renewed"
        );
    }       

    /// @notice Renews multiple delegations at once
    /// @param slotIds Array of slot IDs to renew
    function batchRenewDelegations(uint256[] calldata slotIds) external payable nonReentrant whenNotPaused {
        uint256 totalSlots = slotIds.length;
        require(totalSlots > 0, "No slots provided");
        require(totalSlots <= MAX_SLOTS_PER_DELEGATION, "Too many slots");
        
        uint256 totalFee = DELEGATION_FEE * totalSlots;
        require(msg.value == totalFee, "Incorrect delegation fee");
        
        for (uint256 i = 0; i < totalSlots; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo storage delegation = delegations[msg.sender][slotId];
            
            require(delegation.slotId == slotId, "Delegation does not exist");
            
            // Check if caller is still the owner of the slot
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            require(slotOwner == msg.sender, "Caller is not the slot owner");
            
            // Update delegation period
            delegation.startTime = block.timestamp;
            delegation.endTime = block.timestamp + DELEGATION_PERIOD;
            delegation.active = true;
            
            emit DelegationStateChanged(
                msg.sender,
                slotId,
                true,
                block.timestamp,
                "renewed"
            );
        }
    }

    /// @notice Allows a user to manually cancel a delegation
    /// @param slotId The ID of the slot to cancel delegation for
    function cancelDelegation(uint256 slotId) external nonReentrant whenNotPaused {
        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.active, "Delegation not active");
        
        // Check if caller is still the owner of the slot
        address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
        require(slotOwner == msg.sender, "Caller is not the slot owner");
        
        delegation.active = false;
        totalActiveDelegations--;
        
        emit DelegationStateChanged(
            msg.sender,
            slotId,
            false,
            block.timestamp,
            "cancelled"
        );
    }

    /// @notice Checks and updates expiry status for multiple delegations
    /// @notice Checks and updates expiry status for multiple delegations
    /// @param slotIds Array of slot IDs to check
    function batchCheckDelegationExpiry(uint256[] calldata slotIds) external whenNotPaused {
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo storage delegation = delegations[msg.sender][slotId];

            require(delegation.active, "Delegation not active");

            if (block.timestamp >= delegation.endTime) {
                delegation.active = false;
                // Ensure totalActiveDelegations is not zero before decrementing
                if (totalActiveDelegations > 0) {
                    totalActiveDelegations--;
                }
                emit DelegationStateChanged(
                    msg.sender,
                    slotId,
                    false,
                    block.timestamp,
                    "expired"
                );
            }
        }
    }

    /// @notice Emergency function to withdraw any ERC20 tokens accidentally sent to the contract
    /// @param tokenAddress Address of the token to withdraw
    function emergencyWithdrawToken(address tokenAddress, uint256 amount) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        require(token.transfer(owner(), amount), "Transfer failed");
    }

    /// @notice Withdraws accumulated fees to owner
    /// @dev Can only be called by contract owner
    function withdrawFees() external onlyOwner whenNotPaused {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdraw failed");

        emit FeeEvent(owner(), balance, "withdrawn", block.timestamp);
    }

    /// @notice Updates the burner wallet address
    /// @param newBurnerWallet Address of the new burner wallet
    /// @dev Can only be called by contract owner
    function updateBurnerWallet(address newBurnerWallet) external onlyOwner whenNotPaused {
        require(newBurnerWallet != address(0), "Invalid burner wallet address");
        address oldBurnerWallet = BURNER_WALLET;
        BURNER_WALLET = newBurnerWallet;
        emit BurnerWalletUpdated(oldBurnerWallet, newBurnerWallet);
    }

    /// @notice Updates the delegation fee amount
    /// @param newFee New fee amount in wei
    /// @dev Can only be called by contract owner
    function updateDelegationFee(uint256 newFee) external onlyOwner whenNotPaused {
        require(newFee > 0, "Fee cannot be zero");
        uint256 oldFee = DELEGATION_FEE;
        DELEGATION_FEE = newFee;
        emit DelegationFeeUpdated(oldFee, newFee);
    }

    /// @notice Updates the delegation period duration
    /// @param newPeriod New period duration in seconds
    /// @dev Can only be called by contract owner
    function updateDelegationPeriod(uint256 newPeriod) external onlyOwner whenNotPaused {
        require(newPeriod > 0, "Period cannot be zero");
        uint256 oldPeriod = DELEGATION_PERIOD;
        DELEGATION_PERIOD = newPeriod;
        emit DelegationPeriodUpdated(oldPeriod, newPeriod);
    }

    /// @notice Handles direct ETH transfers to the contract
    /// @dev Emits FeeReceived event
    receive() external payable {
        emit FeeEvent(msg.sender, msg.value, "received", block.timestamp);
    }

    /// @notice Fallback function for handling unknown calls
    /// @dev Emits FeeReceived event for any ETH received
    fallback() external payable {
        emit FeeEvent(msg.sender, msg.value, "received", block.timestamp);
    }
}