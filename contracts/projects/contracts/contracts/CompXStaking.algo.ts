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

  calculatedReward = LocalStateKey<uint64>();

  staked = LocalStateKey<uint64>();

  unlockTime = LocalStateKey<uint64>();

  stakeDuration = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  createApplication(
    stakedAsset: uint64,
    rewardAsset: uint64,
    minLockUp: uint64,
    contractDuration: uint64,
    oracleAppID: uint64
  ): void {
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAsset;
    this.minLockUp.value = minLockUp;
    this.totalRewards.value = 0;
    this.totalStaked.value = 0;
    this.contractDuration.value = contractDuration;
    this.oracleAppID.value = oracleAppID;
  }

  optInToApplication(): void {
    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
  }

  optInToAsset(mbrTxn: PayTxn): void {
    assert(this.txn.sender === this.app.creator);
    let mod = 1;
    if (this.stakedAssetId.value !== this.rewardAssetId.value) {
      mod = 2;
    }
    verifyPayTxn(mbrTxn, {
      receiver: this.app.address,
      amount: 2_000_000,
    });
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: 0,
      assetReceiver: this.app.address,
      fee: 1_000,
    });
    if (mod === 2) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetAmount: 0,
        assetReceiver: this.app.address,
        fee: 1_000,
      });
    }
  }

  updateParams(minLockUp: uint64, oracleAppID: uint64, contractDuration: uint64): void {
    assert(this.txn.sender === this.app.creator);

    this.minLockUp.value = minLockUp;
    this.oracleAppID.value = oracleAppID;
    this.contractDuration.value = contractDuration;
  }

  addRewards(rewardTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.stakedAssetId.value !== 0, 'Staked AssetID not set');
    assert(this.rewardAssetId.value !== 0, 'Reward AssetID not set');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.contractDuration.value !== 0, 'Contract duration not set');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.app.creator,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
      assetAmount: quantity,
    });
    this.totalRewards.value += quantity;
  }

  stake(stakeTxn: AssetTransferTxn, quantity: uint64, lockPeriod: uint64): void {
    assert(this.stakedAssetId.value !== 0, 'Staked AssetID not set');
    assert(this.rewardAssetId.value !== 0, 'Reward AssetID not set');
    assert(this.totalRewards.value !== 0, 'No rewards to claim');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.contractDuration.value !== 0, 'Contract duration not set');
    assert(lockPeriod >= this.minLockUp.value, 'Lock period too short');
    assert(lockPeriod <= this.contractDuration.value, 'Lock period too long');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: quantity,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
    });

    this.totalStaked.value += quantity;
    this.staked(this.txn.sender).value += quantity;
    this.stakeStartTime(this.txn.sender).value = globals.latestTimestamp;
    this.stakeDuration(this.txn.sender).value = lockPeriod;

    this.unlockTime(this.txn.sender).value = globals.latestTimestamp + lockPeriod;
  }

  calculateRewards(): void {
    const quantity = this.staked(this.txn.sender).value;
    assert(quantity > 0, 'No staked assets');

    assert(this.unlockTime(this.txn.sender).value < globals.latestTimestamp, 'unlock time not reached'); // add in this check

    const stakingDuration = this.stakeDuration(this.txn.sender).value;
    const stakeAmount = this.staked(this.txn.sender).value;

    // eslint-disable-next-line prettier/prettier
    const stakeTokenPriceEncoded = AppID.fromUint64(this.oracleAppID.value).globalState(itob(this.stakedAssetId.value)) as bytes;
    const stakeTokenPrice = extractUint64(stakeTokenPriceEncoded, 0);

    // eslint-disable-next-line prettier/prettier
    const rewardTokenPriceEncoded = AppID.fromUint64(this.oracleAppID.value).globalState(itob(this.rewardAssetId.value)) as bytes;
    const rewardTokenPrice = extractUint64(rewardTokenPriceEncoded, 0);

    const stakedAmountlowerPrecision = stakeAmount / 10 ** 4;
    const stakeTokenPriceLowerPrecision = stakeTokenPrice / 10 ** 4;
    const rewardTokenPriceLowerPrecision = rewardTokenPrice / 10 ** 4;
    const totalRewardsLowerPrecision = this.totalRewards.value / 10 ** 4;
    const totalStakedLowerPrecision = this.totalStaked.value / 10 ** 4;

    const normalisedAmount =
      (stakedAmountlowerPrecision * stakeTokenPriceLowerPrecision) / rewardTokenPriceLowerPrecision;
    const rewardNom = normalisedAmount * stakingDuration * totalRewardsLowerPrecision;
    const rewardDom =
      (totalStakedLowerPrecision * stakeTokenPriceLowerPrecision * this.contractDuration.value) /
      rewardTokenPriceLowerPrecision;
    this.calculatedReward(this.txn.sender).value = (rewardNom / rewardDom) * 10 ** 4;
  }

  unstake(): void {
    const quantity = this.staked(this.txn.sender).value;
    assert(quantity > 0, 'No staked assets');
    // assert(this.unlockTime(this.txn.sender).value < globals.latestTimestamp, 'unlock time not reached'); // add in this check

    const stakingDuration = this.stakeDuration(this.txn.sender).value;
    const stakeAmount = this.staked(this.txn.sender).value;

    // eslint-disable-next-line prettier/prettier
    const stakeTokenPriceEncoded = AppID.fromUint64(this.oracleAppID.value).globalState(itob(this.stakedAssetId.value)) as bytes;
    const stakeTokenPrice = extractUint64(stakeTokenPriceEncoded, 0);

    // eslint-disable-next-line prettier/prettier
    const rewardTokenPriceEncoded = AppID.fromUint64(this.oracleAppID.value).globalState(itob(this.rewardAssetId.value)) as bytes;
    const rewardTokenPrice = extractUint64(rewardTokenPriceEncoded, 0);

    // lower precision for calculation
    const stakedAmountlowerPrecision = stakeAmount / 10 ** 4;
    const stakeTokenPriceLowerPrecision = stakeTokenPrice / 10 ** 4;
    const rewardTokenPriceLowerPrecision = rewardTokenPrice / 10 ** 4;
    const totalRewardsLowerPrecision = this.totalRewards.value / 10 ** 4;
    const totalStakedLowerPrecision = this.totalStaked.value / 10 ** 4;

    /* const normalisedAmount = (stakeAmount * stakeTokenPrice) / rewardTokenPrice;
    const reward =
      (normalisedAmount * stakingDuration * this.totalRewards.value) /
      ((this.totalStaked.value * stakeTokenPrice * this.contractDuration.value) / rewardTokenPrice); */
    // 100 * 5 * 1234 / 100 * 1 * 75 / 1
    // 617,000 / (7500) / 1
    const normalisedAmount =
      (stakedAmountlowerPrecision * stakeTokenPriceLowerPrecision) / rewardTokenPriceLowerPrecision;
    const rewardNom = normalisedAmount * stakingDuration * totalRewardsLowerPrecision;
    const rewardDom =
      (totalStakedLowerPrecision * stakeTokenPriceLowerPrecision * this.contractDuration.value) /
      rewardTokenPriceLowerPrecision;
    const reward = (rewardNom / rewardDom) * 10 ** 4;

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetReceiver: this.txn.sender,
      assetAmount: quantity,
    });
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
      assetReceiver: this.txn.sender,
      assetAmount: reward,
    });

    this.totalStaked.value -= quantity;
    this.totalRewards.value -= reward;
    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetReceiver: this.app.creator,
      assetAmount: this.app.address.assetBalance(this.stakedAssetId.value),
      assetCloseTo: this.app.creator,
    });
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
      assetReceiver: this.app.creator,
      assetAmount: this.app.address.assetBalance(this.rewardAssetId.value),
      assetCloseTo: this.app.creator,
    });
    sendPayment({
      amount: this.app.address.balance,
      receiver: this.app.creator,
      closeRemainderTo: this.app.creator,
    });
  }
}
