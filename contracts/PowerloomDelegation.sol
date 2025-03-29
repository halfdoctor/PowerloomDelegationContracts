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
    // keccak256(abi.encodePacked(delegator, slotId)) => commitmentHash
    // ... state variables ...
    IPowerloomState public immutable powerloomState;
    IPowerloomNodes public immutable powerloomNodes;
    address public BURNER_WALLET;
    uint256 public totalActiveDelegations;
    uint256 public BASE_DELEGATION_FEE_PER_DAY = 1 ether;
    uint256 public constant MAX_SLOTS_PER_DELEGATION = 10;

    mapping(address => mapping(uint256 => DelegationInfo)) public delegations;
    mapping(address => uint256[]) private userSlotIds;
    mapping(address => mapping(uint256 => uint256)) private slotIdToIndex; // Maps slotId to its index in the array

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
    }

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
    event DelegationCheckFailed(
        uint256 indexed slotId,
        string reason
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

        
        uint256 totalFee = calculateDelegationFee(delegationPeriodInDays, totalSlots);
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

    /// @notice Checks and updates delegation expiry status
    /// @param slotId The ID of the slot to check
    function checkDelegationExpiry(uint256 slotId) external whenNotPaused {
        require(slotIdToIndex[msg.sender][slotId] < userSlotIds[msg.sender].length, "Slot ID not delegated to user");
        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.active, "Delegation not active");

        if (block.timestamp >= delegation.endTime) {
            delegation.active = false;
            if (totalActiveDelegations > 0) {
                totalActiveDelegations--;
            }
            
            // Don't remove completely, just mark as inactive
            // If you want to remove completely, uncomment the next line:
            // _removeUserSlotId(msg.sender, slotId);
            
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

        
        uint256 totalFee = calculateDelegationFee(delegationPeriodInDays, 1);
        require(msg.value >= totalFee, "Insufficient delegation fee");
        
        // Check if caller is still the owner of the slot
        address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
        require(slotOwner == msg.sender, "Caller is not the slot owner");

        uint256 excess = msg.value - totalFee;
        if (excess > 0) {
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            require(success, "ETH transfer failed");
        }
        
        // Increment totalActiveDelegations if delegation was inactive
        if (!delegation.active) {
            totalActiveDelegations++;
            delegation.active = true;
        }

        // Update delegation period
        // If delegation is active and not expired, extend from the current end time
        // Otherwise, start a new period from current block.timestamp
        if (delegation.active && delegation.endTime > block.timestamp) {
            // Extend from current end time for active delegations
            delegation.endTime = delegation.endTime + delegationPeriodInDays * 1 days;
        } else {
            // Start fresh for inactive or expired delegations
            delegation.startTime = block.timestamp;
            delegation.endTime = block.timestamp + delegationPeriodInDays * 1 days;
        }
        
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
        
        
        uint256 totalFee = calculateDelegationFee(delegationPeriodInDays, totalSlots);
        require(msg.value >= totalFee, "Incorrect delegation fee");
        
        uint256 excess = msg.value - totalFee;

        for (uint256 i = 0; i < totalSlots; i++) {
            uint256 slotId = slotIds[i];
            require(slotId < 10001, "Slot ID exceeds maximum limit");
            DelegationInfo storage delegation = delegations[msg.sender][slotId];
            
            // Check if caller is still the owner of the slot
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            require(slotOwner == msg.sender, "Caller is not the slot owner");

            // Increment totalActiveDelegations if delegation was inactive
            if (!delegation.active) {
                totalActiveDelegations++;
                delegation.active = true;
            }

            // Update delegation period
            // If delegation is active and not expired, extend from the current end time
            // Otherwise, start a new period from current block.timestamp
            if (delegation.active && delegation.endTime > block.timestamp) {
                // Extend from current end time for active delegations
                delegation.endTime = delegation.endTime + delegationPeriodInDays * 1 days;
            } else {
                // Start fresh for inactive or expired delegations
                delegation.startTime = block.timestamp;
                delegation.endTime = block.timestamp + delegationPeriodInDays * 1 days;
            }
            
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
        require(slotIdToIndex[msg.sender][slotId] < userSlotIds[msg.sender].length, "Slot ID not delegated to user");
        DelegationInfo storage delegation = delegations[msg.sender][slotId];
        require(delegation.active, "Delegation not active");

        // Check if caller is still the owner of the slot
        address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
        require(slotOwner == msg.sender, "Caller is not the slot owner");
        delegation.active = false;
        
        // Use the new _removeUserSlotId function instead
        _removeUserSlotId(msg.sender, slotId);
        
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
    /// @param delegator The address of the delegator
    function batchCheckDelegationExpiry(address delegator, uint256[] calldata slotIds) external whenNotPaused {
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            
            // Skip if slot is not delegated
            if (slotIdToIndex[delegator][slotId] >= userSlotIds[delegator].length) {
                continue;
            }
            
            DelegationInfo storage delegation = delegations[delegator][slotId];
            if (!delegation.active) {
                continue;
            }

            if (block.timestamp >= delegation.endTime) {
                delegation.active = false;
                // Ensure totalActiveDelegations is not zero before decrementing
                if (totalActiveDelegations > 0) {
                    totalActiveDelegations--;
                }
                
                // Don't remove completely, just mark as inactive
                // If you want to remove completely, uncomment the next line:
                // _removeUserSlotId(delegator, slotId);
                
                emit DelegationStateChanged(
                    delegator,
                    slotId,
                    false,
                    block.timestamp,
                    "expired"
                );
            }
        }
    }

    /// @notice Allows contract owner to check and update expired delegations for specific slot IDs
    /// @param slotIds Array of slot IDs to check regardless of delegator
    function ownerCheckSlotExpiry(uint256[] calldata slotIds) external onlyOwner {
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            
            // Get the owner of the slot directly from the PowerloomNodes contract
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            
            // Skip if no owner found
            if (slotOwner == address(0)) continue;
            
            // Skip if slot is not delegated by this owner
            if (slotIdToIndex[slotOwner][slotId] >= userSlotIds[slotOwner].length) {
                emit DelegationCheckFailed(slotId, "slotId not delegated");
                continue;
            }
            
            // Check this slot's delegation for the owner
            DelegationInfo storage delegation = delegations[slotOwner][slotId];

            if (!delegation.active) {
                emit DelegationCheckFailed(slotId, "Delegation not active");
                continue;
            }
            
            if (block.timestamp < delegation.endTime) {
                emit DelegationCheckFailed(slotId, "Delegation not expired");
                continue;
            }
            
            // Update the delegation
            delegation.active = false;
            if (totalActiveDelegations > 0) {
                totalActiveDelegations--;
            }
            
            // Don't remove completely, just mark as inactive
            // If you want to remove completely, uncomment the next line:
            // _removeUserSlotId(slotOwner, slotId);
            
            emit DelegationStateChanged(
                slotOwner,
                slotId,
                false,
                block.timestamp,
                "expired"
            );
        }
    }

    function calculateDelegationFee(uint256 delegationPeriodInDays, uint256 slotCount) public view returns (uint256) {
        require(delegationPeriodInDays > 0 && delegationPeriodInDays <= 365, "Invalid delegation period");
        
        uint256 multiplier = delegationPeriodInDays > 30 ? 100 : (150 - (delegationPeriodInDays - 1) * 50 / 29);
        return (BASE_DELEGATION_FEE_PER_DAY * delegationPeriodInDays * slotCount * multiplier) / 100;
    }

    /// @notice Adds a slot ID to user's delegation list
    /// @dev Internal function called during delegation creation
    function _addUserSlotId(address user, uint256 slotId) internal {
        // Initialize with an invalid index value (greater than any possible array length)
        if (slotIdToIndex[user][slotId] >= userSlotIds[user].length) {
            slotIdToIndex[user][slotId] = userSlotIds[user].length;
            userSlotIds[user].push(slotId);
        }
    }

    // Remove a slot ID when delegation is canceled or expires
    function _removeUserSlotId(address user, uint256 slotId) internal {
        uint256 index = slotIdToIndex[user][slotId];
        if (index < userSlotIds[user].length && userSlotIds[user][index] == slotId) {
            uint256 lastIndex = userSlotIds[user].length - 1;
            
            // If it's not the last element, move the last element to this position
            if (index != lastIndex) {
                uint256 lastSlotId = userSlotIds[user][lastIndex];
                userSlotIds[user][index] = lastSlotId;
                slotIdToIndex[user][lastSlotId] = index;
            }
            
            // Remove the last element
            userSlotIds[user].pop();
            
            // Set to an invalid index value
            slotIdToIndex[user][slotId] = userSlotIds[user].length + 1;
        }
    }

    /// @notice Gets the total number of delegations for a user
    /// @param user Address of the user to query
    /// @return Total number of delegations (active and inactive)
    function getTotalUserDelegations(address user) internal view returns (uint256) {
        return userSlotIds[user].length;
    }

    function _getDelegationStatuses(address user) internal view returns (DelegationStatus[] memory) {
        uint256[] memory slotIds = userSlotIds[user];
        uint256 totalDelegations = slotIds.length;
        DelegationStatus[] memory statuses = new DelegationStatus[](totalDelegations);

        for (uint256 i = 0; i < totalDelegations; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo memory delegation = delegations[user][slotId];
            uint256 timeRemaining = 0;
            if (delegation.active && block.timestamp < delegation.endTime) {
                timeRemaining = delegation.endTime - block.timestamp;
            }

            statuses[i] = DelegationStatus({
                slotId: slotId,
                isActive: delegation.active && block.timestamp < delegation.endTime,
                endTime: delegation.endTime,
                timeRemaining: timeRemaining
            });
        }

        return statuses;
    }

    /// @notice Gets all delegations for a specific user with their current status
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of delegation status information
    function getUserDelegations(address user) external view returns (DelegationStatus[] memory) {
        return _getDelegationStatuses(user);
    }

    /// @notice Gets all delegations for a specific user with their current status
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of delegation status information
    function _getUserDelegations(address user) internal view returns (DelegationStatus[] memory) {
        return _getDelegationStatuses(user);
    }

    /// @notice Gets active delegations for a specific user
    /// @param user Address of the user to query
    /// @return DelegationStatus[] Array of active delegation status information
    function getActiveDelegations(address user) external view returns (DelegationStatus[] memory) {
        uint256[] memory slotIds = userSlotIds[user];
        uint256 activeCount = 0;

        // First, count active delegations
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo memory delegation = delegations[user][slotId];
            if (delegation.active && block.timestamp < delegation.endTime) {
                activeCount++;
            }
        }

        // Create array with exact size needed
        DelegationStatus[] memory activeStatuses = new DelegationStatus[](activeCount);

        // Fill array with active delegations
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo memory delegation = delegations[user][slotId];
            if (delegation.active && block.timestamp < delegation.endTime) {
                activeStatuses[currentIndex] = DelegationStatus({
                    slotId: slotId,
                    isActive: true,
                    endTime: delegation.endTime,
                    timeRemaining: delegation.endTime - block.timestamp
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
        require(slotIdToIndex[msg.sender][slotId] < userSlotIds[msg.sender].length, "Slot ID not delegated to user");
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
        require(slotIdToIndex[msg.sender][slotId] < userSlotIds[msg.sender].length, "Slot ID not delegated to user");
        DelegationInfo memory delegation = delegations[msg.sender][slotId];
        if (!delegation.active || block.timestamp >= delegation.endTime) {
            return 0;
        }
        return delegation.endTime - block.timestamp;
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
    function withdrawFees() external onlyOwner nonReentrant whenNotPaused {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        // Effects: Clear the balance before transfer
        uint256 amount = balance;

        // Interactions: Transfer funds to the owner
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed.");

        // Emit event after the transfer
        emit FeeEvent(owner(), amount, "withdrawn", block.timestamp);
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
        uint256[] memory slotIds = userSlotIds[user];
        for (uint256 i = 0; i < slotIds.length; i++) {
            uint256 slotId = slotIds[i];
            DelegationInfo storage delegation = delegations[user][slotId];
            address slotOwner = powerloomNodes.nodeIdToOwner(slotId);
            if (delegation.active && block.timestamp >= delegation.endTime && slotOwner == user) {
                delegation.active = false;
                if (totalActiveDelegations > 0) {
                    totalActiveDelegations--;
                }
                // Note: We don't remove the slot ID from the array here since it's still considered a delegation,
                // just an inactive one. If you want to completely remove expired delegations, add _removeUserSlotId here.
                
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
}