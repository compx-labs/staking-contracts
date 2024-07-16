import { Contract } from '@algorandfoundation/tealscript';

export class CompXStaking extends Contract {
  programVersion = 9;

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  minLockUp = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  totalRewards = GlobalStateKey<uint64>();

  oracleAppID = GlobalStateKey<uint64>();

  contractDuration = GlobalStateKey<uint64>();

  contractStartTimestamp = GlobalStateKey<uint64>();

  contractEndTimestamp = GlobalStateKey<uint64>();

  totalStakingWeight = GlobalStateKey<uint64>();

  remainingRewards = GlobalStateKey<uint64>();

  calculatedReward = LocalStateKey<uint64>();

  staked = LocalStateKey<uint64>();

  unlockTime = LocalStateKey<uint64>();

  stakeDuration = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  userStakingWeight = LocalStateKey<uint64>();

  userShare = LocalStateKey<uint64>();

  createApplication(
    stakedAsset: uint64,
    rewardAsset: uint64,
    minLockUp: uint64,
    contractDuration: uint64,
    oracleAppID: uint64,
    startTimestamp: uint64
  ): void {
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAsset;
    this.minLockUp.value = minLockUp;
    this.totalRewards.value = 0;
    this.totalStaked.value = 0;
    this.contractDuration.value = contractDuration;
    this.contractStartTimestamp.value = startTimestamp;
    this.contractEndTimestamp.value = startTimestamp + contractDuration;
    this.oracleAppID.value = oracleAppID;
    this.totalStakingWeight.value = 0;
    this.remainingRewards.value = 0;
  }

  optInToApplication(): void {
    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
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

  updateParams(minLockUp: uint64, oracleAppID: uint64, contractDuration: uint64): void {
    assert(this.txn.sender === this.app.creator);

    this.minLockUp.value = minLockUp;
    this.oracleAppID.value = oracleAppID;
    this.contractDuration.value = contractDuration;
  }

  addRewards(rewardTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.app.creator);
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
  }

  addRewardsAlgo(payTxn: PayTxn, quantity: uint64): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.contractDuration.value !== 0, 'Contract duration not set');

    verifyPayTxn(payTxn, {
      sender: this.app.creator,
      receiver: this.app.address,
    });

    this.totalRewards.value += quantity;
  }

  removeRewards(quantity: uint64): void {
    assert(this.txn.sender === this.app.creator);
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
  }

  stake(
    stakeTxn: AssetTransferTxn,
    quantity: uint64,
    lockPeriod: uint64,
    stakeTokenPrice: uint64,
    rewardTokenPrice: uint64
  ): void {
    assert(lockPeriod >= this.minLockUp.value, 'Lock period too short');
    assert(globals.latestTimestamp + lockPeriod < this.contractEndTimestamp.value, 'Lock period too long');
    assert(globals.latestTimestamp <= this.contractEndTimestamp.value, 'Contract has ended');
    assert(globals.latestTimestamp >= this.contractStartTimestamp.value, 'Contract has not started');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
    });
    const normalisedAmount = (quantity * stakeTokenPrice) / rewardTokenPrice;
    const userStakingWeight = normalisedAmount * lockPeriod;

    this.totalStaked.value += quantity;
    this.totalStakingWeight.value += userStakingWeight;

    this.staked(this.txn.sender).value += quantity;
    this.stakeStartTime(this.txn.sender).value = globals.latestTimestamp;
    this.stakeDuration(this.txn.sender).value = lockPeriod;
    this.userStakingWeight(this.txn.sender).value = userStakingWeight;
    this.unlockTime(this.txn.sender).value = globals.latestTimestamp + lockPeriod;
  }

  unstake(): void {
    const quantity = this.staked(this.txn.sender).value;
    assert(quantity > 0, 'No staked assets');
    // assert(this.unlockTime(this.txn.sender).value < globals.latestTimestamp, 'unlock time not reached'); // add in this check

    const userShare = this.userStakingWeight(this.txn.sender).value / this.totalStakingWeight.value;
    this.userShare(this.txn.sender).value = userShare;

    // Calculate the user's total rewards from the remaining rewards pool
    const userTotalRewards = userShare * this.remainingRewards.value;

    assert(userTotalRewards > 0, 'No rewards to claim');
    assert(userTotalRewards <= this.remainingRewards.value, 'Insufficient rewards');

    // Update the total staking weight
    this.totalStakingWeight.value -= this.userStakingWeight(this.txn.sender).value;

    // Update the remaining rewards pool
    this.remainingRewards.value -= userTotalRewards;

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
    if (this.rewardAssetId.value === 0) {
      sendPayment({
        amount: userTotalRewards,
        receiver: this.txn.sender,
        sender: this.app.address,
        fee: 1_000,
      });
    } else {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.txn.sender,
        assetAmount: userTotalRewards,
        sender: this.app.address,
        fee: 1_000,
      });
    }

    this.totalStaked.value -= quantity;

    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    if(this.rewardAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.creator,
        assetAmount: 0,
        sender: this.app.address,
        assetCloseTo: this.app.creator,
      
      });
    }
    if(this.stakedAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
        assetReceiver: this.app.creator,
        assetAmount: 0,
        sender: this.app.address,
        assetCloseTo: this.app.creator,
      
      });
    }

    sendPayment({
      amount: this.app.address.balance,
      receiver: this.app.creator,
      closeRemainderTo: this.app.creator,
      fee: 1000,
    });
  }
}
