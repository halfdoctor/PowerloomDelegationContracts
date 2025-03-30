// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IWPOWER.sol";

contract WPOWER is IWPOWER, ERC20, ReentrancyGuard {
    error ZeroAmount();
    error TransferFailed();
    error ZeroAddress();

    // Remove the event declarations since they're already in the interface

    constructor() ERC20("Wrapped POWER", "WPOWER") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable override returns (uint256) {
        if (msg.value == 0) revert ZeroAmount();
        
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.sender, msg.value);
        return msg.value;
    }

    function depositTo(address recipient) external payable override returns (uint256) {
        if (msg.value == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        
        _mint(recipient, msg.value);
        emit Deposit(msg.sender, recipient, msg.value);
        return msg.value;
    }

    function withdraw(uint256 amount) public override nonReentrant returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        
        _burn(msg.sender, amount);
        
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawal(msg.sender, msg.sender, amount);
        return amount;
    }

    function withdrawTo(address recipient, uint256 amount) external override nonReentrant returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        
        _burn(msg.sender, amount);
        
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawal(msg.sender, recipient, amount);
        return amount;
    }
}