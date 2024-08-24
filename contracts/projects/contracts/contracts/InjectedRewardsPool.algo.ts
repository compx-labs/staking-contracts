import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export class InjectedRewardsPool extends Contract {
  programVersion = 9;


  //Global State
  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  minStakePeriodForRewards = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  injectedRewards = GlobalStateKey<uint64>();

  lastRewardInjectionTime = GlobalStateKey<uint64>();

  totalRewardsInjected = GlobalStateKey<uint64>();

  totalStakingWeight = GlobalStateKey<uint64>();

  stakeTokenPrice = GlobalStateKey<uint64>();

  rewardTokenPrice = GlobalStateKey<uint64>();

  oracleAdminAddress = GlobalStateKey<Address>();

  adminAddress = GlobalStateKey<Address>();

  //Local State
  staked = LocalStateKey<uint64>();

  stakeDuration = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  userStakingWeight = LocalStateKey<uint64>();

  lastRewardRate = LocalStateKey<uint64>();

  accruedRewards = LocalStateKey<uint64>();

  lastUpdateTime = LocalStateKey<uint64>();

  rewardRate = LocalStateKey<uint64>();

  useShare = LocalStateKey<uint64>();

  userSharePercentage = LocalStateKey<uint64>();

  createApplication(
    stakedAsset: uint64,
    rewardAsset: uint64,
    minStakePeriodForRewards: uint64,
    oracleAdmin: Address,
    adminAddress: Address
  ): void {
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAsset;
    this.totalStaked.value = 0;
    this.totalStakingWeight.value = 0;
    this.oracleAdminAddress.value = oracleAdmin;
    this.stakeTokenPrice.value = 0;
    this.rewardTokenPrice.value = 0;
    this.adminAddress.value = adminAddress;
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
    this.injectedRewards.value = 0;
    this.lastRewardInjectionTime.value = 0;

  }

  optInToApplication(): void {
    this.staked(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = 0;
    this.lastUpdateTime(this.txn.sender).value = 0;
    this.rewardRate(this.txn.sender).value = 0;
    this.useShare(this.txn.sender).value = 0;
    this.userSharePercentage(this.txn.sender).value = 0;
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
  updateParams(minStakePeriodForRewards: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update params');
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
  }


  injectRewards(rewardTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.app.creator,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
      assetAmount: quantity,
    });
    this.injectedRewards.value += quantity;
    this.lastRewardInjectionTime.value = globals.latestTimestamp;
    this.totalRewardsInjected.value += quantity;
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    /* sendPayment({
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

  stake(
    stakeTxn: AssetTransferTxn,
    quantity: uint64,
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(this.stakeTokenPrice.value > 0, 'Stake token price not set');
    assert(this.rewardTokenPrice.value > 0, 'Reward token price not set');
    assert(this.staked(this.txn.sender).value === 0, 'User already staked, use Restake method instead');
    assert(quantity > 0, 'Invalid quantity');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: quantity,
    });
    this.staked(this.txn.sender).value = stakeTxn.assetAmount;

    this.calculateRewardRate(this.txn.sender);
    this.totalStaked.value += this.staked(this.txn.sender).value;
    this.stakeStartTime(this.txn.sender).value = currentTimeStamp;
    this.lastUpdateTime(this.txn.sender).value = currentTimeStamp;
    this.accruedRewards(this.txn.sender).value = 0;
  }

  //called after any user stake, unstake or restake
  updateRewardRate(userAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update rewards rates');

    this.stakeDuration(userAddress).value = globals.latestTimestamp - this.stakeStartTime(userAddress).value;
    assert(this.stakeDuration(userAddress).value >= this.minStakePeriodForRewards.value, 'User has not staked for minimum period');
    this.calculateRewardRate(userAddress);
  }

  private calculateRewardRate(userAddress: Address): void {
    if (this.userStakingWeight(userAddress).value > 0) {
      this.totalStakingWeight.value -= this.userStakingWeight(userAddress).value;
    }
    const userStakingWeight = wideRatio([this.staked(userAddress).value, this.stakeTokenPrice.value], [this.rewardTokenPrice.value]);
    this.totalStakingWeight.value += userStakingWeight
    this.userStakingWeight(userAddress).value = userStakingWeight;

    const userShare = wideRatio([userStakingWeight, PRECISION], [this.totalStakingWeight.value]);
    this.useShare(userAddress).value = userShare;
    const userSharePercentage = wideRatio([userShare, 100], [PRECISION]);
    this.userSharePercentage(userAddress).value = userSharePercentage;

    this.rewardRate(userAddress).value = wideRatio([this.injectedRewards.value, userSharePercentage], [100]);
    if (this.rewardRate(userAddress).value === 0) {
      this.rewardRate(userAddress).value = 10;
    }
  }


  accrueRewards(userAddress: Address): void {
    assert(this.staked(userAddress).value > 0, 'User has no staked assets');
    assert(this.stakeStartTime(userAddress).value > 0, 'User has not staked assets');
    this.stakeDuration(userAddress).value = globals.latestTimestamp - this.stakeStartTime(userAddress).value;
    assert(this.stakeDuration(userAddress).value >= this.minStakePeriodForRewards.value, 'User has not staked for minimum period');

    this.accruedRewards(userAddress).value += this.rewardRate(userAddress).value;
    this.injectedRewards.value -= this.rewardRate(userAddress).value;
    this.lastUpdateTime(userAddress).value = globals.latestTimestamp;

    if (this.rewardAssetId.value === this.stakedAssetId.value) {
      //Compound rewards
      this.staked(userAddress).value += this.rewardRate(userAddress).value;
      this.totalStaked.value += this.rewardRate(userAddress).value;
    }

  }

  restake(stakeTxn: AssetTransferTxn, quantity: uint64): void {
    assert(quantity > 0, 'Invalid quantity');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: quantity,
    });
    this.staked(this.txn.sender).value += stakeTxn.assetAmount;
    this.totalStaked.value += stakeTxn.assetAmount;
    //reset start time
    this.stakeStartTime(this.txn.sender).value = globals.latestTimestamp;
    this.stakeDuration(this.txn.sender).value = 0;

    //calculate new reward rate
    this.calculateRewardRate(this.txn.sender);
  }

  unstake(): void {
    assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
    assert(this.stakeStartTime(this.txn.sender).value > 0, 'User has not staked assets');
    assert(this.stakeDuration(this.txn.sender).value > 0, 'User has not staked assets');

    if (this.stakedAssetId.value === this.rewardAssetId.value) {
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
    } else {

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
    }

    // Update the total staking weight
    this.totalStakingWeight.value -= this.userStakingWeight(this.txn.sender).value;
    this.totalStaked.value -= this.staked(this.txn.sender).value;

    this.staked(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = 0;
    this.rewardRate(this.txn.sender).value = 0;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.stakeDuration(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = 0;
  }

}


