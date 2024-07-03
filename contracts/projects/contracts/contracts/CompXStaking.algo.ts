import { Contract } from '@algorandfoundation/tealscript';

export class CompXStaking extends Contract {
  stakedAssetId = GlobalStateKey<AssetID>();

  rewardAssetId = GlobalStateKey<AssetID>();

  minLockUp = GlobalStateKey<uint64>();

  maxLockUp = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  totalRewards = GlobalStateKey<uint64>();

  oracleAppID = GlobalStateKey<AppID>();

  contractDuration = GlobalStateKey<uint64>();

  staked = LocalStateKey<uint64>();

  unlockTime = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  createApplication(
    stakedAsset: AssetID,
    rewardAsset: AssetID,
    minLockUp: uint64,
    maxLockUp: uint64,
    contractDuration: uint64,
    oracleAppID: AppID
  ): void {
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAsset;
    this.minLockUp.value = minLockUp;
    this.maxLockUp.value = maxLockUp;
    this.totalRewards.value = 0;
    this.totalStaked.value = 0;
    this.contractDuration.value = contractDuration;
    this.oracleAppID.value = oracleAppID;
  }

  optInToApplication(): void {
    this.staked(this.txn.sender).value = 0;
    this.unlockTime(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
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
      xferAsset: this.stakedAssetId.value,
      assetAmount: 0,
      assetReceiver: this.app.address,
      fee: 1_000,
    });
    if (mod === 2) {
      sendAssetTransfer({
        xferAsset: this.rewardAssetId.value,
        assetAmount: 0,
        assetReceiver: this.app.address,
        fee: 1_000,
      });
    }
  }

  updateParams(minLockUp: uint64, maxLockUp: uint64, oracleAppID: AppID, contractDuration: uint64): void {
    assert(this.txn.sender === this.app.creator);

    this.minLockUp.value = minLockUp;
    this.maxLockUp.value = maxLockUp;
    this.oracleAppID.value = oracleAppID;
    this.contractDuration.value = contractDuration;
  }

  addRewards(rewardTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.stakedAssetId.value.id !== 0, 'Staked AssetID not set');
    assert(this.rewardAssetId.value.id !== 0, 'Reward AssetID not set');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.maxLockUp.value !== 0, 'Maximum lockup not set');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.app.creator,
      assetReceiver: this.app.address,
      xferAsset: this.rewardAssetId.value,
      assetAmount: quantity,
    });
    this.totalRewards.value += quantity;
  }

  stake(stakeTxn: AssetTransferTxn, quantity: uint64, lockPeriod: uint64): void {
    assert(this.stakedAssetId.value.id !== 0, 'Staked AssetID not set');
    assert(this.rewardAssetId.value.id !== 0, 'Reward AssetID not set');
    assert(this.totalRewards.value !== 0, 'No rewards to claim');
    assert(this.minLockUp.value !== 0, 'Minimum lockup not set');
    assert(this.maxLockUp.value !== 0, 'Maximum lockup not set');
    assert(lockPeriod >= this.minLockUp.value, 'Lock period too short');
    assert(lockPeriod <= this.maxLockUp.value, 'Lock period too long');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: quantity,
      xferAsset: this.stakedAssetId.value,
    });

    this.totalStaked.value += quantity;
    this.staked(this.txn.sender).value += quantity;
    this.stakeStartTime(this.txn.sender).value = globals.latestTimestamp;

    this.unlockTime(this.txn.sender).value = globals.latestTimestamp + lockPeriod * 86400;
  }

  unstake(): void {
    const quantity = this.staked(this.txn.sender).value;
    assert(quantity > 0, 'No staked assets');
    assert(this.unlockTime(this.txn.sender).value < globals.latestTimestamp, 'unlock time not reached'); // add in this check

    const stakingDuration = globals.latestTimestamp - this.stakeStartTime(this.txn.sender).value;
    const stakeAmount = this.staked(this.txn.sender).value;
    const reward =
      (stakeAmount * stakingDuration * this.totalRewards.value) /
      (this.totalStaked.value * this.contractDuration.value);

    sendAssetTransfer({
      xferAsset: this.stakedAssetId.value,
      assetReceiver: this.txn.sender,
      assetAmount: quantity,
      assetCloseTo: this.txn.sender,
    });
    sendAssetTransfer({
      xferAsset: this.rewardAssetId.value,
      assetReceiver: this.txn.sender,
      assetAmount: reward,
      assetCloseTo: this.txn.sender,
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
      xferAsset: this.stakedAssetId.value,
      assetReceiver: this.app.creator,
      assetAmount: this.app.address.assetBalance(this.stakedAssetId.value),
      assetCloseTo: this.app.creator,
    });
    sendAssetTransfer({
      xferAsset: this.rewardAssetId.value,
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
