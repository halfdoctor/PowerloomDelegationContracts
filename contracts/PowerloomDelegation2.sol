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
contract PowerloomDelegation2 is Ownable, ReentrancyGuard, Pausable {
    // keccak256(abi.encodePacked(delegator, slotId)) => commitmentHash
    // ... state variables ...
    IPowerloomState public immutable powerloomState;
    IPowerloomNodes public immutable powerloomNodes;

    uint256 public BASE_DELEGATION_FEE_PER_DAY = 10 ether; // native currency units
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
    mapping(address => mapping(uint256 => bool)) private userSlotIdsMap; // Tracks if a user has a slot delegated

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
    /// @param delegationPeriodInDays The delegation period in days
    function createDelegation(uint256[] calldata slotIds, uint256 delegationPeriodInDays) external payable nonReentrant whenNotPaused {
        require(delegationPeriodInDays > 0, "Delegation period must be greater than zero");
        require(delegationPeriodInDays <= 365, "Delegation period must be less than or equal to 365 days");
        uint256 totalSlots = slotIds.length;
        require(totalSlots > 0, "No slots provided");
        require(totalSlots <= MAX_SLOTS_PER_DELEGATION, "Too many slots");

        uint256 multiplier;
        if (delegationPeriodInDays > 30) {
            multiplier = 100; // 1.00
        } else {
            multiplier = 150 - (delegationPeriodInDays - 1) * 50 / 29; // Linear interpolation between 1.50 and 1.00
        }
        uint256 totalFee = BASE_DELEGATION_FEE_PER_DAY * delegationPeriodInDays * totalSlots * multiplier;
        totalFee = totalFee / 100;
        require(msg.value >= totalFee, "Incorrect delegation fee");

        for (uint256 i = 0; i < totalSlots; i++) {
            uint256 slotId = slotIds[i];
            require(slotId < 10001, "Slot ID exceeds maximum limit");

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

            // Refund excess fee
            if (msg.value > totalFee) {
                (bool success, ) = payable(msg.sender).call{value: msg.value - totalFee}("");
                require(success, "Transfer failed.");
            }

            // Store delegation details
            delegations[msg.sender][slotId] = DelegationInfo({
                burnerWallet: BURNER_WALLET,
                slotId: slotId,
                startTime: block.timestamp,
                endTime: block.timestamp + delegationPeriodInDays * 1 days,
                active: true
            });

            _addUserSlotId(msg.sender, slotId);

            totalActiveDelegations++;
            emit DelegationCreated(
                msg.sender,
                slotId,
                BURNER_WALLET,
                block.timestamp,
                block.timestamp + delegationPeriodInDays * 1 days
            );

            _checkAndDecrementExpiredDelegations(msg.sender);
        }
    }

    /// @notice Adds a slot ID to user's delegation list
    /// @dev Internal function called during delegation creation
    function _addUserSlotId(address user, uint256 slotId) internal {
        // Add slot ID to the user's mapping
        userSlotIdsMap[user][slotId] = true;
    }

    /// @notice Gets the total number of delegations for a user
    /// @param user Address of the user to query
    /// @return Total number of delegations (active and inactive)
    function getTotalUserDelegations(address user) internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < MAX_SLOTS_PER_DELEGATION; i++) {
            if (userSlotIdsMap[user][i]) {
                count++;
            }
        }
        return count;
    }

    /// @notice Gets all delegations for a specific user with their current status
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of delegation status information
    function getUserDelegations(address user) external view returns (DelegationStatus[] memory) {
        uint256 totalDelegations = getTotalUserDelegations(user);
        DelegationStatus[] memory statuses = new DelegationStatus[](totalDelegations);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < MAX_SLOTS_PER_DELEGATION; i++) {
            if (userSlotIdsMap[user][i]) {
                DelegationInfo memory delegation = delegations[user][i];
                uint256 timeRemaining = 0;
                if (delegation.active && block.timestamp < delegation.endTime) {
                    timeRemaining = delegation.endTime - block.timestamp;
                }

                statuses[currentIndex] = DelegationStatus({
                    slotId: i,
                    isActive: delegation.active && block.timestamp < delegation.endTime,
                    endTime: delegation.endTime,
                    timeRemaining: timeRemaining,
                    burnerWallet: delegation.burnerWallet
                });
                currentIndex++;
            }
        }

        return statuses;
    }

    /// @notice Gets all delegations for a specific user with their current status
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of delegation status information
    function _getUserDelegations(address user) internal view returns (DelegationStatus[] memory) {
        uint256 totalDelegations = getTotalUserDelegations(user);
        DelegationStatus[] memory statuses = new DelegationStatus[](totalDelegations);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < MAX_SLOTS_PER_DELEGATION; i++) {
            if (userSlotIdsMap[user][i]) {
                DelegationInfo memory delegation = delegations[user][i];
                uint256 timeRemaining = 0;
                if (delegation.active && block.timestamp < delegation.endTime) {
                    timeRemaining = delegation.endTime - block.timestamp;
                }

                statuses[currentIndex] = DelegationStatus({
                    slotId: i,
                    isActive: delegation.active && block.timestamp < delegation.endTime,
                    endTime: delegation.endTime,
                    timeRemaining: timeRemaining,
                    burnerWallet: delegation.burnerWallet
                });
                currentIndex++;
            }
        }

        return statuses;
    }

    /// @notice Gets active delegations for a specific user
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of active delegation status information
    function getActiveDelegations(address user) external view returns (DelegationStatus[] memory) {
        // uint256 totalDelegations = getTotalUserDelegations(user);
        uint256 activeCount = 0;

        // First, count active delegations
        for (uint256 i = 0; i < MAX_SLOTS_PER_DELEGATION; i++) {
            if (userSlotIdsMap[user][i]) {
                DelegationInfo memory delegation = delegations[user][i];
                if (delegation.active && block.timestamp < delegation.endTime) {
                    activeCount++;
                }
            }
        }

        // Create array with exact size needed
        DelegationStatus[] memory activeStatuses = new DelegationStatus[](activeCount);

        // Fill array with active delegations
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < MAX_SLOTS_PER_DELEGATION; i++) {
            if (userSlotIdsMap[user][i]) {
                DelegationInfo memory delegation = delegations[user][i];
                if (delegation.active && block.timestamp < delegation.endTime) {
                    activeStatuses[currentIndex] = DelegationStatus({
                        slotId: i,
                        isActive: true,
                        endTime: delegation.endTime,
                        timeRemaining: delegation.endTime - block.timestamp,
                        burnerWallet: delegation.burnerWallet
                    });
                    currentIndex++;
                }
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

    /// @notice Retrieves delegation information for a specific slot and account address
    /// @param slotId The ID of the slot to query
    /// @return DelegationInfo struct containing delegation details
    function getDelegationInfoByAccount(address account, uint256 slotId) external view returns (DelegationInfo memory) {
        return delegations[account][slotId];
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
    function renewDelegation(uint256 slotId, uint256 delegationPeriodInDays) external payable nonReentrant whenNotPaused {
        require(delegationPeriodInDays > 0, "Delegation period must be greater than zero");
        require(delegationPeriodInDays <= 365, "Delegation period must be less than or equal to 365 days");

        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.active, "Delegation not active");
        require(slotId < 10001, "Slot ID exceeds maximum limit");

        uint256 multiplier;
        if (delegationPeriodInDays > 30) {
            multiplier = 100; // 1.00
        } else {
            multiplier = 150 - (delegationPeriodInDays - 1) * 50 / 29; // Linear interpolation between 1.50 and 1.00
        }
        uint256 totalFee = BASE_DELEGATION_FEE_PER_DAY * delegationPeriodInDays * multiplier;
        totalFee = totalFee / 100;
        require(msg.value >= totalFee, "Insufficient delegation fee");
        
        // Check if caller is still the owner of the slot
        address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
        require(slotOwner == msg.sender, "Caller is not the slot owner");

        uint256 excess = msg.value - totalFee;
        if (excess > 0) {
            payable(msg.sender).transfer(excess);
        }

        totalActiveDelegations ++;
        
        // Update delegation period
        delegation.startTime = block.timestamp;
        delegation.endTime = block.timestamp + delegationPeriodInDays * 1 days;
        delegation.active = true; // Ensure it's reactivated
        
        emit DelegationStateChanged(
            msg.sender,
            slotId,
            true,
            block.timestamp,
            "renewed"
        );

        _checkAndDecrementExpiredDelegations(msg.sender);
    }

    /// @notice Renews multiple delegations at once
    /// @param slotIds Array of slot IDs to renew
    function batchRenewDelegations(uint256[] calldata slotIds, uint256 delegationPeriodInDays) external payable nonReentrant whenNotPaused {
        require(delegationPeriodInDays > 0, "Delegation period must be greater than zero");
        require(delegationPeriodInDays <= 365, "Delegation period must be less than or equal to 365 days");

        uint256 totalSlots = slotIds.length;
        require(totalSlots > 0, "No slots provided");
        require(totalSlots <= MAX_SLOTS_PER_DELEGATION, "Too many slots");
        
        uint256 multiplier;
        if (delegationPeriodInDays > 30) {
            multiplier = 100; // 1.00
        } else {
            multiplier = 150 - (delegationPeriodInDays - 1) * 50 / 29; // Linear interpolation between 1.50 and 1.00
        }
        uint256 totalFee = BASE_DELEGATION_FEE_PER_DAY * delegationPeriodInDays * totalSlots * multiplier;
        totalFee = totalFee / 100;
        require(msg.value >= totalFee, "Incorrect delegation fee");
        
        uint256 excess = msg.value - totalFee;

        for (uint256 i = 0; i < totalSlots; i++) {
            uint256 slotId = slotIds[i];
            require(slotId < 10001, "Slot ID exceeds maximum limit");
            DelegationInfo storage delegation = delegations[msg.sender][slotId];
            
            //require(delegation.slotId == slotId, "Delegation does not exist");
            
            // Check if caller is still the owner of the slot
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            require(slotOwner == msg.sender, "Caller is not the slot owner");

            totalActiveDelegations ++;
            
            // Update delegation period
            delegation.startTime = block.timestamp;
            delegation.endTime = block.timestamp + delegationPeriodInDays * 1 days;
            delegation.active = true;
            
            emit DelegationStateChanged(
                msg.sender,
                slotId,
                true,
                block.timestamp,
                "renewed"
            );
        }

        if (excess > 0) {
            payable(msg.sender).transfer(excess);
        }

        _checkAndDecrementExpiredDelegations(msg.sender);
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
        userSlotIdsMap[msg.sender][slotId] = false;
        if (totalActiveDelegations > 0) {
            totalActiveDelegations = totalActiveDelegations - 1;
        }
        
        emit DelegationStateChanged(
            msg.sender,
            slotId,
            false,
            block.timestamp,
            "cancelled"
        );

        _checkAndDecrementExpiredDelegations(msg.sender);
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
        require(tokenAddress != address(this), "Cannot withdraw ETH from the contract itself");
        require(amount > 0, "Cannot withdraw zero amount");
        IERC20 token = IERC20(tokenAddress);
        require(token.transfer(owner(), amount), "Transfer failed");
    }

    /// @notice Withdraws accumulated fees to owner
    /// @dev Can only be called by contract owner
    function withdrawFees() external onlyOwner whenNotPaused {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        payable(owner()).transfer(balance);

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
        uint256 oldFee = BASE_DELEGATION_FEE_PER_DAY;
        BASE_DELEGATION_FEE_PER_DAY = newFee;
        emit DelegationFeeUpdated(oldFee, newFee);
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

    /// @notice Internal function to check and decrement expired delegations
    /// @param user Address of the user to check delegations for
    function _checkAndDecrementExpiredDelegations(address user) private {
        DelegationStatus[] memory userDelegations = _getUserDelegations(user);
        for (uint256 i = 0; i < userDelegations.length; i++) {
            uint256 slotId = userDelegations[i].slotId;
            DelegationInfo storage delegation = delegations[user][slotId];
            if (delegation.active && block.timestamp >= delegation.endTime) {
                delegation.active = false;
                userSlotIdsMap[user][slotId] = false;
                if (totalActiveDelegations > 0) {
                    totalActiveDelegations--;
                }
                emit DelegationStateChanged(
                    user,
                    slotId,
                    false,
                    block.timestamp,
                    "expired"
                );
            }
        }
    }
}