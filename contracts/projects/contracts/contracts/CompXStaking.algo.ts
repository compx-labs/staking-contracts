import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

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

  totalStakingWeight = GlobalStateKey<uint128>();

  remainingRewards = GlobalStateKey<uint64>();

  stakeTokenPrice = GlobalStateKey<uint64>();

  rewardTokenPrice = GlobalStateKey<uint64>();

  oracleAdminAddress = GlobalStateKey<Address>();

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

  createApplication(
    stakedAsset: uint64,
    rewardAsset: uint64,
    minLockUp: uint64,
    contractDuration: uint64,
    startTimestamp: uint64,
    oracleAdmin: Address,
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
    this.totalStakingWeight.value = 0 as uint128;
    this.remainingRewards.value = 0;
    this.oracleAdminAddress.value = oracleAdmin;
    this.stakeTokenPrice.value = 0;
    this.rewardTokenPrice.value = 0;
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
    this.totalRewards.value += rewardTxn.assetAmount;
    this.remainingRewards.value += rewardTxn.assetAmount;
    const maxRewardsPerTick = wideRatio([quantity, PRECISION], [this.contractDuration.value, PRECISION]);
    this.rewardsAvailablePerTick.value = ((maxRewardsPerTick / 100) * 98);
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
    const maxRewardsPerTick = wideRatio([this.totalRewards.value, PRECISION], [this.contractDuration.value, PRECISION]);
    this.rewardsAvailablePerTick.value = ((maxRewardsPerTick / 100) * 98);
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
      const maxRewardsPerTick = wideRatio([this.totalRewards.value, PRECISION], [this.contractDuration.value]);
      this.rewardsAvailablePerTick.value = ((maxRewardsPerTick / 100) * 98) / PRECISION;
    }
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

   /*  if (this.rewardAssetId.value !== 0) {
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
        fee: 1_000,
      });
    }

    sendPayment({
      amount: (this.adminAddress.value.balance - this.adminAddress.value.minBalance),
      receiver: this.adminAddress.value,
      sender: this.app.address,
      fee: 1_000,
    }); */
  }

  setPrices(stakeTokenPrice: uint64, rewardTokenPrice: uint64): void {
    assert(this.txn.sender === this.oracleAdminAddress.value, 'Only oracle admin can set prices');
    assert(stakeTokenPrice > 0, 'Invalid stake token price');
    assert(rewardTokenPrice > 0, 'Invalid reward token price');

    this.stakeTokenPrice.value = stakeTokenPrice;
    this.rewardTokenPrice.value = rewardTokenPrice;
  }

  private calculateRewardRateAndGetUserStakingWeight(userAddress: Address): void {

    if (this.userStakingWeight(userAddress).value > 0) {
      this.totalStakingWeight.value = this.totalStakingWeight.value - (this.userStakingWeight(userAddress).value as uint128);
    }
    const normalisedAmount = wideRatio([this.staked(userAddress).value, this.stakeTokenPrice.value], [this.rewardTokenPrice.value]);
    const userStakingWeight = wideRatio([normalisedAmount, this.stakeDuration(userAddress).value], [1]);
    this.userStakingWeight(userAddress).value = userStakingWeight;
    this.totalStakingWeight.value = this.totalStakingWeight.value + (userStakingWeight as uint128);

    const userShare = wideRatio([userStakingWeight, PRECISION], [this.totalStakingWeight.value as uint64]);
    
    const userSharePercentage = wideRatio([userShare, 100], [PRECISION]);
    let numerator = wideRatio([userSharePercentage * PRECISION], [1]);
    let denominator = PRECISION;

    this.rewardRate(userAddress).value = (wideRatio([this.rewardsAvailablePerTick.value, numerator], [denominator]) / 100);
    if (this.rewardRate(userAddress).value === 0) {
      this.rewardRate(userAddress).value = 10;
    }
  }

  stake(
    stakeTxn: AssetTransferTxn,
    quantity: uint64,
    lockPeriod: uint64,
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(lockPeriod >= this.minLockUp.value, 'Lock period too short');
    assert(currentTimeStamp + lockPeriod < this.contractEndTimestamp.value, 'Lock period too long');
    assert(currentTimeStamp <= this.contractEndTimestamp.value, 'Contract has ended');
    assert(this.stakeTokenPrice.value > 0, 'Stake token price not set');
    assert(this.rewardTokenPrice.value > 0, 'Reward token price not set');
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

    this.calculateRewardRateAndGetUserStakingWeight(this.txn.sender);

    this.totalStaked.value += this.staked(this.txn.sender).value;
    this.stakeStartTime(this.txn.sender).value = currentTimeStamp;
    this.unlockTime(this.txn.sender).value = currentTimeStamp + lockPeriod;
    this.lastUpdateTime(this.txn.sender).value = currentTimeStamp;
  }

  accrueRewards(userAddress: Address): void {
    assert(this.staked(userAddress).value > 0, 'User has no staked assets');
    assert(this.stakeStartTime(userAddress).value > 0, 'User has not staked assets');
    assert(this.stakeDuration(userAddress).value > 0, 'User has not staked assets');

    if (this.unlockTime(userAddress).value > globals.latestTimestamp) {
      this.calculateRewardRateAndGetUserStakingWeight(userAddress);
      this.accruedRewards(userAddress).value += (this.rewardRate(userAddress).value * ((globals.latestTimestamp) - this.lastUpdateTime(userAddress).value));
      this.lastUpdateTime(userAddress).value = globals.latestTimestamp;

    }
    else if (this.lastUpdateTime(userAddress).value !== this.unlockTime(userAddress).value) {
      this.calculateRewardRateAndGetUserStakingWeight(userAddress);
      this.accruedRewards(userAddress).value += (this.rewardRate(userAddress).value * (this.unlockTime(userAddress).value - this.lastUpdateTime(userAddress).value));
      this.lastUpdateTime(userAddress).value = this.unlockTime(userAddress).value;
    }

  }

  unstake(): void {
    assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
    //assert(this.unlockTime(this.txn.sender).value < (globals.latestTimestamp), 'unlock time not reached'); // add in this check
    assert(this.stakeStartTime(this.txn.sender).value > 0, 'User has not staked assets');
    assert(this.stakeDuration(this.txn.sender).value > 0, 'User has not staked assets');

    if (this.unlockTime(this.txn.sender).value > globals.latestTimestamp) {

      this.calculateRewardRateAndGetUserStakingWeight(this.txn.sender);
      this.accruedRewards(this.txn.sender).value += (this.rewardRate(this.txn.sender).value * ((globals.latestTimestamp) - this.lastUpdateTime(this.txn.sender).value));
      this.lastUpdateTime(this.txn.sender).value = globals.latestTimestamp;
    }
    else if (this.lastUpdateTime(this.txn.sender).value !== this.unlockTime(this.txn.sender).value) {

      this.calculateRewardRateAndGetUserStakingWeight(this.txn.sender);
      this.accruedRewards(this.txn.sender).value += (this.rewardRate(this.txn.sender).value * (this.unlockTime(this.txn.sender).value - this.lastUpdateTime(this.txn.sender).value));
      this.lastUpdateTime(this.txn.sender).value = this.unlockTime(this.txn.sender).value;
    }

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
    this.totalStakingWeight.value = this.totalStakingWeight.value - (this.userStakingWeight(this.txn.sender).value as uint128);
    this.remainingRewards.value -= this.accruedRewards(this.txn.sender).value;
    this.totalStaked.value -= this.staked(this.txn.sender).value;

    this.staked(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = 0;
    this.rewardRate(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
  }

  adminUnstake(userAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can unstake via this method');

    if (this.unlockTime(userAddress).value > globals.latestTimestamp) {
      this.calculateRewardRateAndGetUserStakingWeight(userAddress);
      this.accruedRewards(userAddress).value += (this.rewardRate(userAddress).value * ((globals.latestTimestamp) - this.lastUpdateTime(userAddress).value));
      this.lastUpdateTime(userAddress).value = globals.latestTimestamp;

    }
    else if (this.lastUpdateTime(userAddress).value !== this.unlockTime(userAddress).value) {
      this.calculateRewardRateAndGetUserStakingWeight(userAddress);
      this.accruedRewards(userAddress).value += (this.rewardRate(userAddress).value * (this.unlockTime(userAddress).value - this.lastUpdateTime(userAddress).value));
      this.lastUpdateTime(userAddress).value = this.unlockTime(userAddress).value;
    }

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

    // Update the total staking weight
    this.totalStakingWeight.value -= this.userStakingWeight(userAddress).value as uint128;
    this.remainingRewards.value -= this.accruedRewards(userAddress).value;
    this.totalStaked.value -= this.staked(userAddress).value;

    this.staked(userAddress).value = 0;
    this.accruedRewards(userAddress).value = 0;
    this.rewardRate(userAddress).value = 0;
    this.unlockTime(userAddress).value = 0;
    this.userStakingWeight(userAddress).value = 0;
    this.stakeDuration(userAddress).value = 0;
    this.stakeStartTime(userAddress).value = 0;
  }


}


