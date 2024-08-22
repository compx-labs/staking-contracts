import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 10000;

export class CompXStaking extends Contract {
  programVersion = 9;


  //Global State
  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  minLockUp = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  totalRewards = GlobalStateKey<uint64>();

  contractDuration = GlobalStateKey<uint64>();

  contractStartTimestamp = GlobalStateKey<uint64>();

  contractEndTimestamp = GlobalStateKey<uint64>();

  totalStakingWeight = GlobalStateKey<uint64>();

  remainingRewards = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  rewardsAvailablePerTick = GlobalStateKey<uint64>();

  //Local State
  staked = LocalStateKey<uint64>();

  unlockTime = LocalStateKey<uint64>();

  stakeDuration = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  userStakingWeight = LocalStateKey<uint64>();

  rewardRate = LocalStateKey<uint64>();

  accruedRewards = LocalStateKey<uint64>();

  lastUpdateTime = LocalStateKey<uint64>();

  totalRewardsPaid = LocalStateKey<uint64>();

  createApplication(
    stakedAsset: uint64,
    rewardAsset: uint64,
    minLockUp: uint64,
    contractDuration: uint64,
    startTimestamp: uint64,
    adminAddress: Address
  ): void {
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAsset;
    this.minLockUp.value = minLockUp;
    this.totalRewards.value = 0;
    this.totalStaked.value = 0;
    this.contractDuration.value = contractDuration;
    this.contractStartTimestamp.value = startTimestamp;
    this.contractEndTimestamp.value = startTimestamp + contractDuration;
    this.totalStakingWeight.value = 0;
    this.remainingRewards.value = 0;
    this.rewardsAvailablePerTick.value = 0;
    this.adminAddress.value = adminAddress;
  }

  optInToApplication(): void {
    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.rewardRate(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = 0;
  }

  optInToAsset(asset: AssetID): void {
    assert(this.txn.sender === this.app.creator);

    sendAssetTransfer({
      xferAsset: asset,
      assetAmount: 0,
      assetReceiver: this.app.address,
      sender: this.app.address,
    });
  }

  //ADMIN FUNCTIONS
  updateParams(minLockUp: uint64, contractDuration: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update params');

    this.minLockUp.value = minLockUp;
    this.contractDuration.value = contractDuration;
    this.contractEndTimestamp.value = this.contractStartTimestamp.value + contractDuration;
    if (this.totalRewards.value > 0) {
      this.rewardsAvailablePerTick.value = this.totalRewards.value / contractDuration;
    }
  }

  addRewards(rewardTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can add rewards');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.contractDuration.value !== 0, 'Contract duration not set');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.app.creator,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
      assetAmount: quantity,
    });
    this.totalRewards.value += quantity;
    this.remainingRewards.value += quantity;
    this.rewardsAvailablePerTick.value = this.totalRewards.value / this.contractDuration.value;
  }

  addRewardsAlgo(payTxn: PayTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can add rewards');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.contractDuration.value !== 0, 'Contract duration not set');

    verifyPayTxn(payTxn, {
      sender: this.app.creator,
      receiver: this.app.address,
      amount: quantity,
    });

    this.totalRewards.value += payTxn.amount;
    this.remainingRewards.value += payTxn.amount;
    this.rewardsAvailablePerTick.value = this.totalRewards.value / this.contractDuration.value;
  }

  removeRewards(quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can remove rewards');
    assert(this.remainingRewards.value >= quantity, 'Insufficient rewards');

    let rewardsToRemove = quantity;
    if (rewardsToRemove === 0) {
      rewardsToRemove = this.remainingRewards.value;
    }
    if (this.rewardAssetId.value === 0) {
      sendPayment({
        amount: rewardsToRemove,
        receiver: this.app.creator,
        sender: this.app.address,
        fee: 1_000,
      });
    } else {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.creator,
        assetAmount: rewardsToRemove,
        sender: this.app.address,
        fee: 1_000,
      });
    }
    if (rewardsToRemove === 0) {
      this.totalRewards.value = 0;
      this.remainingRewards.value = 0;
      this.rewardsAvailablePerTick.value = 0;
    } else {
      this.totalRewards.value -= rewardsToRemove;
      this.remainingRewards.value = this.totalRewards.value;
      this.rewardsAvailablePerTick.value = this.totalRewards.value / this.contractDuration.value;
    }
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    if (this.rewardAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.creator,
        assetAmount: 0,
        sender: this.app.address,
        assetCloseTo: this.app.creator,
        fee: 1_000,
      });
    }
    if (this.stakedAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
        assetReceiver: this.app.creator,
        assetAmount: 0,
        sender: this.app.address,
        assetCloseTo: this.app.creator,

      });
    }

    sendPayment({
      amount: (this.adminAddress.value.balance - this.adminAddress.value.minBalance),
      receiver: this.adminAddress.value,
      sender: this.app.address,
      fee: 1_000,
    });
  }


  stake(
    stakeTxn: AssetTransferTxn,
    quantity: uint64,
    lockPeriod: uint64,
    userStakingWeight: uint64,
    userRewardRate: uint64
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(lockPeriod >= this.minLockUp.value, 'Lock period too short');
    assert(currentTimeStamp + lockPeriod < this.contractEndTimestamp.value, 'Lock period too long');
    assert(currentTimeStamp <= this.contractEndTimestamp.value, 'Contract has ended');
    assert(this.staked(this.txn.sender).value === 0, 'User already staked');
    assert(quantity > 0, 'Invalid quantity');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: quantity,
    });
    this.staked(this.txn.sender).value = stakeTxn.assetAmount;
    this.stakeDuration(this.txn.sender).value = lockPeriod;
    this.userStakingWeight(this.txn.sender).value = userStakingWeight;
    this.totalStakingWeight.value += this.userStakingWeight(this.txn.sender).value;

    this.totalStaked.value += this.staked(this.txn.sender).value;
    this.rewardRate(this.txn.sender).value = userRewardRate;
    this.stakeStartTime(this.txn.sender).value = currentTimeStamp;
    this.userStakingWeight(this.txn.sender).value = userStakingWeight;
    this.unlockTime(this.txn.sender).value = currentTimeStamp + lockPeriod;
    this.lastUpdateTime(this.txn.sender).value = currentTimeStamp;
  }

  setRewardRate(userAddress: Address, userRewardRate: uint64, userStakingWeight: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can set reward rate');

    this.totalStakingWeight.value -= this.userStakingWeight(userAddress).value;
    this.rewardRate(userAddress).value = userRewardRate;
    this.userStakingWeight(userAddress).value = userStakingWeight;
    this.totalStakingWeight.value += this.userStakingWeight(userAddress).value;
  }

  accrueRewards(userAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can accrue rewards');
    assert(this.unlockTime(this.txn.sender).value > (globals.latestTimestamp), 'unlock time reached'); // add in this check

    this.accruedRewards(userAddress).value += (this.rewardRate(userAddress).value * (globals.latestTimestamp - this.lastUpdateTime(userAddress).value));
    this.lastUpdateTime(userAddress).value = globals.latestTimestamp;
  }

  unstake(): void {
    assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
    assert(this.unlockTime(this.txn.sender).value < (globals.latestTimestamp), 'unlock time not reached'); // add in this check

    if (this.staked(this.txn.sender).value > 0) {
      if (this.stakedAssetId.value === 0) {
        sendPayment({
          amount: this.staked(this.txn.sender).value,
          receiver: this.txn.sender,
          sender: this.app.address,
          fee: 1_000,
        });
      } else {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
          assetReceiver: this.txn.sender,
          sender: this.app.address,
          assetAmount: this.staked(this.txn.sender).value,
          fee: 1_000,
        });
      }
    }
    if (this.accruedRewards(this.txn.sender).value > 0) {
      if (this.rewardAssetId.value === 0) {
        sendPayment({
          amount: this.accruedRewards(this.txn.sender).value,
          receiver: this.txn.sender,
          sender: this.app.address,
          fee: 1_000,
        });
      } else {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
          assetReceiver: this.txn.sender,
          assetAmount: this.accruedRewards(this.txn.sender).value,
          sender: this.app.address,
          fee: 1_000,
        });
      }
    }

    // Update the total staking weight
    this.totalStakingWeight.value -= this.userStakingWeight(this.txn.sender).value;
    this.remainingRewards.value -= this.accruedRewards(this.txn.sender).value;
    this.totalStaked.value -= this.staked(this.txn.sender).value;

    this.staked(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = 0;
    this.rewardRate(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
    this.totalRewardsPaid(this.txn.sender).value += this.accruedRewards(this.txn.sender).value;
  }

  adminUnstake(userAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can unstake via this method');

    if (this.staked(userAddress).value > 0) {
      if (this.stakedAssetId.value === 0) {
        sendPayment({
          amount: this.staked(userAddress).value,
          receiver: userAddress,
          sender: this.app.address,
          fee: 1_000,
        });
      } else {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
          assetReceiver: userAddress,
          sender: this.app.address,
          assetAmount: this.staked(userAddress).value,
          fee: 1_000,
        });
      }
    }
    if (this.accruedRewards(userAddress).value > 0) {
      if (this.rewardAssetId.value === 0) {
        sendPayment({
          amount: this.accruedRewards(userAddress).value,
          receiver: userAddress,
          sender: this.app.address,
          fee: 1_000,
        });
      } else {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
          assetReceiver: userAddress,
          assetAmount: this.accruedRewards(userAddress).value,
          sender: this.app.address,
          fee: 1_000,
        });
      }
    }

    // Update the total staking weight
    this.totalStakingWeight.value -= this.userStakingWeight(userAddress).value;
    this.remainingRewards.value -= this.accruedRewards(userAddress).value;
    this.totalStaked.value -= this.staked(userAddress).value;

    this.staked(userAddress).value = 0;
    this.accruedRewards(userAddress).value = 0;
    this.rewardRate(userAddress).value = 0;
    this.unlockTime(userAddress).value = 0;
    this.userStakingWeight(userAddress).value = 0;
    this.stakeDuration(userAddress).value = 0;
    this.stakeStartTime(userAddress).value = 0;
    this.totalRewardsPaid(userAddress).value += this.accruedRewards(userAddress).value;
  }


}


