import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address
  stake: uint64
  stakeDuration: uint64
  stakeStartTime: uint64
  userStakingWeight: uint64
  lastRewardRate: uint64
  accruedRewards: uint64
  lastUpdateTime: uint64
  rewardRate: uint64
  userShare: uint64
  userSharePercentage: uint64
}

const MAX_STAKERS_PER_POOL = 100000;
const ASSET_HOLDING_FEE = 100000 // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000

export class InjectedRewardsPool extends Contract {
  programVersion = 9;


  //Global State

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' })

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  minStakePeriodForRewards = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  injectedRewards = GlobalStateKey<uint64>();

  lastRewardInjectionTime = GlobalStateKey<uint64>();

  lastInjectedRewards = GlobalStateKey<uint64>();

  totalRewardsInjected = GlobalStateKey<uint64>();

  totalStakingWeight = GlobalStateKey<uint128>();

  stakeTokenPrice = GlobalStateKey<uint64>();

  rewardTokenPrice = GlobalStateKey<uint64>();

  oracleAdminAddress = GlobalStateKey<Address>();

  adminAddress = GlobalStateKey<Address>();

  /*  //Local State
   staked = LocalStateKey<uint64>();
 
   stakeDuration = LocalStateKey<uint64>();
 
   stakeStartTime = LocalStateKey<uint64>();
 
   userStakingWeight = LocalStateKey<uint64>();
 
   lastRewardRate = LocalStateKey<uint64>();
 
   accruedRewards = LocalStateKey<uint64>();
 
   lastUpdateTime = LocalStateKey<uint64>();
 
   rewardRate = LocalStateKey<uint64>();
 
   useShare = LocalStateKey<uint64>();
 
   userSharePercentage = LocalStateKey<uint64>(); */

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
    this.totalStakingWeight.value = 0 as uint128;
    this.oracleAdminAddress.value = oracleAdmin;
    this.stakeTokenPrice.value = 0;
    this.rewardTokenPrice.value = 0;
    this.adminAddress.value = adminAddress;
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
    this.injectedRewards.value = 0;
    this.lastRewardInjectionTime.value = 0;

  }

  /*   optInToApplication(): void {
      this.staked(this.txn.sender).value = 0;
      this.stakeStartTime(this.txn.sender).value = 0;
      this.stakeDuration(this.txn.sender).value = 0;
      this.userStakingWeight(this.txn.sender).value = 0;
      this.accruedRewards(this.txn.sender).value = 0;
      this.lastUpdateTime(this.txn.sender).value = 0;
      this.rewardRate(this.txn.sender).value = 0;
      this.useShare(this.txn.sender).value = 0;
      this.userSharePercentage(this.txn.sender).value = 0;
    } */

  //ADMIN FUNCTIONS
  updateParams(minStakePeriodForRewards: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update params');
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500
    const SCBOX_PERBYTE = 400

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE
  }

  initStorage(mbrPayment: PayTxn): void {
    assert(!this.stakers.exists, 'staking pool already initialized')
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init storage');

    const isTokenEligible = this.rewardAssetId.value !== 0
    const extraMBR = ASSET_HOLDING_FEE;
    const PoolInitMbr =
      ALGORAND_ACCOUNT_MIN_BALANCE +
      extraMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL)

    // the pay transaction must exactly match our MBR requirement.
    verifyPayTxn(mbrPayment, { receiver: this.app.address, amount: PoolInitMbr })
    this.stakers.create()

    if (isTokenEligible) {
      // opt ourselves in to the reward token if we're pool 1
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.address,
        assetAmount: 0,
      })
    }
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
    this.lastInjectedRewards.value = quantity;
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
    assert(quantity > 0, 'Invalid quantity');

    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: quantity,
    });
    let actionComplete: boolean = false;
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (actionComplete) break;

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])
      if (staker.account === this.txn.sender) {
        staker.stake += stakeTxn.assetAmount
        this.stakers.value[i] = staker
        actionComplete = true;

      } else if (this.stakers.value[i].account === globals.zeroAddress) {

        this.totalStaked.value += stakeTxn.assetAmount;

        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: stakeTxn.assetAmount,
          stakeDuration: 0,
          stakeStartTime: currentTimeStamp,
          userStakingWeight: 0,
          lastRewardRate: 0,
          accruedRewards: 0,
          lastUpdateTime: currentTimeStamp,
          rewardRate: 0,
          userShare: 0,
          userSharePercentage: 0
        }
        actionComplete = true;
      }
    }
    this.calculateRewardRates();
  }

  private calculateRewardRates(): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])
      if (staker.userStakingWeight > 0) {
        this.totalStakingWeight.value = this.totalStakingWeight.value - (staker.userStakingWeight as uint128);
      }
      const userStakingWeight = (wideRatio([staker.stake, this.stakeTokenPrice.value], [this.rewardTokenPrice.value]));
      staker.userStakingWeight = userStakingWeight;
      this.totalStakingWeight.value = this.totalStakingWeight.value + (userStakingWeight as uint128);

      staker.userShare = wideRatio([userStakingWeight, PRECISION], [this.totalStakingWeight.value as uint64]);
      staker.userSharePercentage = wideRatio([staker.userShare, 100], [PRECISION]);

      const availableRewards = this.injectedRewards.value > 0 ? this.injectedRewards.value : this.lastInjectedRewards.value;

      staker.rewardRate = wideRatio([availableRewards, staker.userSharePercentage], [100]);

      if (staker.rewardRate === 0) {
        staker.rewardRate = 1;
      }
      this.stakers.value[i] = staker;
    }
  }


  accrueRewards(): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])
      if (staker.stake > 0) {
        staker.stakeDuration = globals.latestTimestamp - staker.stakeStartTime;
        if (staker.stakeDuration < this.minStakePeriodForRewards.value) return;

        staker.accruedRewards = staker.accruedRewards + staker.rewardRate;
        this.injectedRewards.value - this.injectedRewards.value - staker.rewardRate;
        staker.lastUpdateTime = globals.latestTimestamp;

        if (this.rewardAssetId.value === this.stakedAssetId.value) {
          //Compound rewards
          staker.stake += staker.rewardRate;
          this.totalStaked.value = this.totalStaked.value + staker.rewardRate;
        }
        this.stakers.value[i] = staker;
      }
    }
  }

  claimRewards(): void {

    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])

      if (staker.account === this.txn.sender) {
        if (staker.accruedRewards > 0) {

          if (this.rewardAssetId.value === 0) {
            sendPayment({
              amount: staker.accruedRewards,
              receiver: this.txn.sender,
              sender: this.app.address,
              fee: 1_000,
            });
          } else {
            sendAssetTransfer({
              xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
              assetReceiver: this.txn.sender,
              assetAmount: staker.accruedRewards,
              sender: this.app.address,
              fee: 1_000,
            });
          }
        }
        staker.accruedRewards = 0;
        staker.lastUpdateTime = globals.latestTimestamp;
        this.stakers.value[i] = staker;
      }
    }
  }

  unstake(quantity: uint64): void {
    /*     assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
        assert(this.stakeStartTime(this.txn.sender).value > 0, 'User has not staked assets');
        assert(this.stakeDuration(this.txn.sender).value > 0, 'User has not staked assets'); */
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])

      if (this.stakedAssetId.value === this.rewardAssetId.value) {

        if (this.stakedAssetId.value === 0) {
          sendPayment({
            amount: quantity === 0 ? staker.stake : quantity,
            receiver: this.txn.sender,
            sender: this.app.address,
            fee: 1_000,
          });
        } else {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: quantity === 0 ? staker.stake : quantity,
            fee: 1_000,
          });
        }
      } else {

        if (this.stakedAssetId.value === 0) {

          sendPayment({
            amount: quantity === 0 ? staker.stake : quantity,
            receiver: this.txn.sender,
            sender: this.app.address,
            fee: 1_000,
          });
        } else {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: quantity === 0 ? staker.stake : quantity,
            fee: 1_000,
          });
        }
        if (staker.accruedRewards > 0) {
          if (this.rewardAssetId.value === 0) {
            sendPayment({
              amount: staker.accruedRewards,
              receiver: this.txn.sender,
              sender: this.app.address,
              fee: 1_000,
            });
          } else {
            sendAssetTransfer({
              xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
              assetReceiver: this.txn.sender,
              assetAmount: staker.accruedRewards,
              sender: this.app.address,
              fee: 1_000,
            });
          }
        }
      }

      // Update the total staking weight
      this.totalStakingWeight.value = this.totalStakingWeight.value - (staker.userStakingWeight as uint128);
      this.totalStaked.value = this.totalStaked.value - staker.stake;

      if (quantity === 0) {
        this.stakers.value[i] = {
          account: globals.zeroAddress,
          stake: 0,
          stakeDuration: 0,
          stakeStartTime: 0,
          userStakingWeight: 0,
          lastRewardRate: 0,
          accruedRewards: 0,
          lastUpdateTime: 0,
          rewardRate: 0,
          userShare: 0,
          userSharePercentage: 0
        }
      } else {
        staker.stake = staker.stake - quantity;
        staker.accruedRewards = 0;
        staker.lastUpdateTime = globals.latestTimestamp;
        this.stakers.value[i] = staker;
      }
    }
  }
}


