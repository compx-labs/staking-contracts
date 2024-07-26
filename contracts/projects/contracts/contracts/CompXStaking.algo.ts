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
    this.totalStakingWeight.value = 0;
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
  }

  setPrices(stakeTokenPrice: uint64, rewardTokenPrice: uint64): void {
    assert(this.txn.sender === this.oracleAdminAddress.value, 'Only oracle admin can set prices');
    assert(stakeTokenPrice > 0, 'Invalid stake token price');
    assert(rewardTokenPrice > 0, 'Invalid reward token price');

    this.stakeTokenPrice.value = stakeTokenPrice;
    this.rewardTokenPrice.value = rewardTokenPrice;
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

    const normalisedAmount = ((this.staked(this.txn.sender).value * this.stakeTokenPrice.value * PRECISION) / this.rewardTokenPrice.value) / PRECISION;
    const userStakingWeight = (normalisedAmount * this.stakeDuration(this.txn.sender).value);
    this.totalStakingWeight.value += userStakingWeight;

    // getUser Staking weight as a share of the total weight
    const userShare = (userStakingWeight * PRECISION) / this.totalStakingWeight.value; // scale numerator
    const userSharePercentage = (userShare * 100) / PRECISION; // convert to percentage
    let numerator = (userSharePercentage * PRECISION);
    let denominator = PRECISION;

    var a = numerator;
    var b = denominator;
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    const gcdValue = a;

    numerator = numerator / gcdValue;
    denominator = denominator / gcdValue;
    const userRewardRate = (this.rewardsAvailablePerTick.value * numerator) / denominator;

    this.totalStaked.value += this.staked(this.txn.sender).value;
    this.rewardRate(this.txn.sender).value = userRewardRate;
    this.stakeStartTime(this.txn.sender).value = currentTimeStamp;
    this.userStakingWeight(this.txn.sender).value = userStakingWeight;
    this.unlockTime(this.txn.sender).value = currentTimeStamp + lockPeriod;
  }

  getRewardRate(): void {
    this.totalStakingWeight.value -= this.userStakingWeight(this.txn.sender).value;
    const normalisedAmount = ((this.staked(this.txn.sender).value * this.stakeTokenPrice.value * PRECISION) / this.rewardTokenPrice.value) / PRECISION;
    const userStakingWeight = (normalisedAmount * this.stakeDuration(this.txn.sender).value);
    this.totalStakingWeight.value += userStakingWeight;

    // getUser Staking weight as a share of the total weight
    const userShare = (userStakingWeight * PRECISION) / this.totalStakingWeight.value; // scale numerator
    const userSharePercentage = (userShare * 100) / PRECISION; // convert to percentage
    let numerator = (userSharePercentage * PRECISION);
    let denominator = PRECISION;

    var a = numerator;
    var b = denominator;
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    const gcdValue = a;

    numerator = numerator / gcdValue;
    denominator = denominator / gcdValue;
    const userRewardRate = (this.rewardsAvailablePerTick.value * numerator) / denominator;

    this.rewardRate(this.txn.sender).value = userRewardRate;
  }

  getRewardRate_Dev(
    i_TotalStakingWeight: uint64,
    i_StakeTokenPrice: uint64,
    i_RewardTokenPrice: uint64,
    i_StakeDuration: uint64,
    i_StakeAmount: uint64,
    i_RewardsAvailablePerTick: uint64
  ): void {

    const normalisedAmount = ((i_StakeAmount * i_StakeTokenPrice * PRECISION) / i_RewardTokenPrice) / PRECISION;
    const userStakingWeight = (normalisedAmount * i_StakeDuration);
    i_TotalStakingWeight += userStakingWeight;

    // getUser Staking weight as a share of the total weight
    const userShare = (userStakingWeight * PRECISION) / i_TotalStakingWeight; // scale numerator
    const userSharePercentage = (userShare * 100) / PRECISION; // convert to percentage


    //Convert decimal to fraction
    let numerator = (userSharePercentage * PRECISION);
    let denominator = PRECISION;

    var a = numerator;
    var b = denominator;
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    const gcdValue = a;

    numerator = numerator / gcdValue;
    denominator = denominator / gcdValue;
    const userRewardRate = (i_RewardsAvailablePerTick * numerator) / denominator;

    this.rewardRate(this.txn.sender).value = userRewardRate;
  }

  accrueRewards(userAddress: Address): void {
    assert(this.staked(userAddress).value > 0, 'User has no staked assets');
    assert(this.stakeStartTime(userAddress).value > 0, 'User has not staked assets');
    assert(this.stakeDuration(userAddress).value > 0, 'User has not staked assets');
    this.totalStakingWeight.value -= this.userStakingWeight(userAddress).value;
    const normalisedAmount = ((this.staked(userAddress).value * this.stakeTokenPrice.value * PRECISION) / this.rewardTokenPrice.value) / PRECISION;
    const userStakingWeight = (normalisedAmount * this.stakeDuration(userAddress).value);
    this.totalStakingWeight.value += userStakingWeight;

    // getUser Staking weight as a share of the total weight
    const userShare = (userStakingWeight * PRECISION) / this.totalStakingWeight.value; // scale numerator
    const userSharePercentage = (userShare * 100) / PRECISION; // convert to percentage
    let numerator = (userSharePercentage * PRECISION);
    let denominator = PRECISION;

    var a = numerator;
    var b = denominator;
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    const gcdValue = a;

    numerator = numerator / gcdValue;
    denominator = denominator / gcdValue;
    this.rewardRate(userAddress).value = (this.rewardsAvailablePerTick.value * numerator) / denominator;

    this.accruedRewards(userAddress).value = (this.rewardRate(userAddress).value * ((globals.latestTimestamp) - this.stakeStartTime(userAddress).value));

  }

  unstake(): void {
    assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
    assert(this.unlockTime(this.txn.sender).value < (globals.latestTimestamp), 'unlock time not reached'); // add in this check
    assert(this.stakeStartTime(this.txn.sender).value > 0, 'User has not staked assets');
    assert(this.stakeDuration(this.txn.sender).value > 0, 'User has not staked assets');
    assert(this.accruedRewards(this.txn.sender).value > 0, 'User has no accrued rewards');
    this.totalStakingWeight.value -= this.userStakingWeight(this.txn.sender).value;
    const normalisedAmount = ((this.staked(this.txn.sender).value * this.stakeTokenPrice.value * PRECISION) / this.rewardTokenPrice.value) / PRECISION;
    const userStakingWeight = (normalisedAmount * this.stakeDuration(this.txn.sender).value);
    this.totalStakingWeight.value += userStakingWeight;

    // getUser Staking weight as a share of the total weight
    const userShare = (userStakingWeight * PRECISION) / this.totalStakingWeight.value; // scale numerator
    const userSharePercentage = (userShare * 100) / PRECISION; // convert to percentage
    let numerator = (userSharePercentage * PRECISION);
    let denominator = PRECISION;

    var a = numerator;
    var b = denominator;
    while (b !== 0) {
      let temp = b;
      b = a % b;
      a = temp;
    }
    const gcdValue = a;

    numerator = numerator / gcdValue;
    denominator = denominator / gcdValue;
    this.rewardRate(this.txn.sender).value = (this.rewardsAvailablePerTick.value * numerator) / denominator;
    this.accruedRewards(this.txn.sender).value = (this.rewardRate(this.txn.sender).value * ((globals.latestTimestamp) - this.stakeStartTime(this.txn.sender).value));



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
  }


}


