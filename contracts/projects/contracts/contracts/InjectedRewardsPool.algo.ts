import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address
  stake: uint64
}
export type mbrReturn = {
  mbrPayment: uint64;
}

const MAX_STAKERS_PER_POOL = 100;
const ASSET_HOLDING_FEE = 100000 // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000


export class InjectedRewardsPool extends Contract {
  programVersion = 9;


  //Global State 

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' })

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssets = BoxKey<StaticArray<uint64, 5>>({ key: 'rewardAssets' })

  minStakePeriodForRewards = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  algoInjectedRewards = GlobalStateKey<uint64>();

  injectedRewards = BoxKey<StaticArray<uint64, 5>>({ key: 'injectedRewards' })

  lastRewardInjectionTime = GlobalStateKey<uint64>();

  totalStakingWeight = GlobalStateKey<uint128>();

  stakeAssetPrice = GlobalStateKey<uint64>();

  algoPrice = GlobalStateKey<uint64>();

  rewardAssetPrices = BoxKey<StaticArray<uint64, 5>>({ key: 'rewardAssetPrices' })

  oracleAdminAddress = GlobalStateKey<Address>();

  adminAddress = GlobalStateKey<Address>();

  minimumBalance = GlobalStateKey<uint64>();

  numRewards = GlobalStateKey<uint64>();

  //Local state
  rewardRate = LocalStateKey<StaticArray<uint64, 5>>();

  accruedRewards = LocalStateKey<StaticArray<uint64, 5>>();

  stakeDuration = LocalStateKey<uint64>();

  stakeStartTime = LocalStateKey<uint64>();

  userStakingWeight = LocalStateKey<uint64>();

  lastRewardRate = LocalStateKey<uint64>();

  algoAccuredRewards = LocalStateKey<uint64>();

  lastUpdateTime = LocalStateKey<uint64>();

  algoRewardRate = LocalStateKey<uint64>();

  userShare = LocalStateKey<uint64>();


  createApplication(adminAddress: Address): void {
    this.adminAddress.value = adminAddress;
  }

  initApplication(stakedAsset: uint64,
    rewardAssets: StaticArray<uint64, 5>,
    minStakePeriodForRewards: uint64,
    oracleAdmin: Address,
  ): void {
    assert(this.adminAddress.value !== globals.zeroAddress, 'Admin address not set');
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');
    this.stakedAssetId.value = stakedAsset;
    this.rewardAssets.value = rewardAssets;
    this.numRewards.value = rewardAssets.length;
    this.totalStaked.value = 0;
    this.totalStakingWeight.value = 0 as uint128;
    this.oracleAdminAddress.value = oracleAdmin;
    this.stakeAssetPrice.value = 0;
    this.rewardAssetPrices.create();
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
    this.injectedRewards.create();
    this.lastRewardInjectionTime.value = 0;

  }

  optInToApplication(): void {
    this.stakeDuration(this.txn.sender).value = 0;
    this.stakeStartTime(this.txn.sender).value = globals.latestTimestamp;
    this.userStakingWeight(this.txn.sender).value = 0;
    this.lastRewardRate(this.txn.sender).value = 0;
    this.algoAccuredRewards(this.txn.sender).value = 0;
    this.lastUpdateTime(this.txn.sender).value = 0;
    this.algoRewardRate(this.txn.sender).value = 0;
    this.userShare(this.txn.sender).value = 0;
    this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
    this.rewardRate(this.txn.sender).value = [0, 0, 0, 0, 0];
  }

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

  getMBRForPoolCreation(): mbrReturn {
    let nonAlgoRewardMBR = 0;
    for (var i = 0; i < this.rewardAssets.value.length; i += 1) {
      if (this.rewardAssets.value[i] !== 0) {
        nonAlgoRewardMBR += ASSET_HOLDING_FEE;
      }
    }
    const mbr = ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15)

    return {
      mbrPayment: mbr
    }
  }

  initStorage(mbrPayment: PayTxn): void {
    assert(!this.stakers.exists, 'staking pool already initialized')
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init storage');

    let nonAlgoRewardMBR = 0;
    for (var i = 0; i < this.rewardAssets.value.length; i += 1) {
      if (this.rewardAssets.value[i] !== 0) {
        nonAlgoRewardMBR += ASSET_HOLDING_FEE;
      }
    }
    const poolMBR = ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15)

    // the pay transaction must exactly match our MBR requirement.
    verifyPayTxn(mbrPayment, { receiver: this.app.address, amount: poolMBR })
    this.stakers.create()
    this.minimumBalance.value = poolMBR;

    if (nonAlgoRewardMBR > 0) {
      // opt into additional reward tokens
      for (var i = 0; i < this.rewardAssets.value.length; i += 1) {
        if (this.rewardAssets.value[i] !== 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.rewardAssets.value[i]),
            assetReceiver: this.app.address,
            assetAmount: 0,
          })
        }
      }
    }
  }


  /*
  * Inject rewards into the pool - one reward asset at a time
  */
  injectRewards(rewardTxn: AssetTransferTxn, quantity: uint64, rewardAssetId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');
    assert(this.txn.numAssets > 1, 'Invalid number of assets');

    for (let i = 0; i < this.rewardAssets.value.length; i += 1) {
      if (this.rewardAssets.value[i] === rewardAssetId) {
        verifyAssetTransferTxn(rewardTxn, {
          sender: this.adminAddress.value,
          assetReceiver: this.app.address,
          xferAsset: AssetID.fromUint64(rewardAssetId),
          assetAmount: quantity,
        });
        this.injectedRewards.value[i] += quantity;
        this.lastRewardInjectionTime.value = globals.latestTimestamp;
      }
    }
  }

  injectAlgoRewards(payTxn: PayTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');

    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: quantity,
    });

    this.algoInjectedRewards.value += quantity;
    this.lastRewardInjectionTime.value = globals.latestTimestamp;
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

  /*
  * Set prices for the stake token and reward tokens
  */
  setPrices(stakeAssetPrice: uint64, rewardTokenPrices: StaticArray<uint64, 5>): void {
    assert(this.txn.sender === this.oracleAdminAddress.value, 'Only oracle admin can set prices');
    assert(stakeAssetPrice > 0, 'Invalid stake token price');
    assert(rewardTokenPrices.length === this.numRewards.value, 'Invalid number of reward token prices');

    this.stakeAssetPrice.value = stakeAssetPrice;
    this.rewardAssetPrices.value = rewardTokenPrices;

  }

  stake(
    stakeTxn: AssetTransferTxn,
    quantity: uint64,
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
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

     /*  if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      } */
      const staker = clone(this.stakers.value[i])
      if (staker.account === this.txn.sender) {
        staker.stake += stakeTxn.assetAmount
        this.stakers.value[i] = staker
        actionComplete = true;

      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        //create new staker
        this.totalStaked.value += stakeTxn.assetAmount;

        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: stakeTxn.assetAmount,
        }
        this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0]
        this.rewardRate(this.txn.sender).value = [0, 0, 0, 0, 0]
        actionComplete = true;
      }
    }
  }

  private calculateRewardRates(): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {

      /* if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      } */
      const staker = clone(this.stakers.value[i])
      if (staker.account === globals.zeroAddress) continue;

      if (this.userStakingWeight(staker.account).value > 0) {
        this.totalStakingWeight.value = this.totalStakingWeight.value - (this.userStakingWeight(staker.account).value as uint128);
      }
      let userStakingWeight = 0;

      userStakingWeight = userStakingWeight + (wideRatio([staker.stake, this.stakeAssetPrice.value], [this.algoPrice.value]));
      for (var j = 0; j < this.rewardAssets.value.length; j += 1) {
        if (this.injectedRewards.value[j] === 0) continue;
        userStakingWeight = userStakingWeight + (wideRatio([staker.stake, this.stakeAssetPrice.value], [this.rewardAssetPrices.value[j]]));
      }

      this.userStakingWeight(staker.account).value = userStakingWeight;
      this.totalStakingWeight.value = this.totalStakingWeight.value + (userStakingWeight as uint128);

      this.userShare(staker.account).value = wideRatio([userStakingWeight, PRECISION], [this.totalStakingWeight.value as uint64]);
      const userSharePercentage = wideRatio([this.userShare(staker.account).value, 100], [PRECISION]);

      for (var k = 0; k < this.rewardAssets.value.length; k += 1) {
        if (this.injectedRewards.value[k] === 0) continue;
        this.rewardRate(staker.account).value[k] = wideRatio([this.injectedRewards.value[k], userSharePercentage], [100]);
        if (this.rewardRate(staker.account).value[k] === 0) {
          this.rewardRate(staker.account).value[k] = 1;
        }
      }

      this.stakers.value[i] = staker;
    }
  }


  accrueRewards(): void {
    this.calculateRewardRates();
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      /* if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      } */
      const staker = clone(this.stakers.value[i])
      if (staker.account === globals.zeroAddress) continue;

      if (staker.stake > 0) {
        this.stakeDuration(staker.account).value = globals.latestTimestamp - this.stakeStartTime(staker.account).value;
        if (this.stakeDuration(staker.account).value < this.minStakePeriodForRewards.value) return;

        this.algoAccuredRewards(staker.account).value = this.algoAccuredRewards(staker.account).value + this.algoRewardRate(staker.account).value;
        this.algoInjectedRewards.value = this.algoInjectedRewards.value - this.algoRewardRate(staker.account).value;

        if (this.stakedAssetId.value === 0) {
          staker.stake = staker.stake + this.algoRewardRate(staker.account).value;
          this.totalStaked.value = this.totalStaked.value + this.algoRewardRate(staker.account).value;
        }

        for (var j = 0; j < this.rewardAssets.value.length; j += 1) {

          this.accruedRewards(staker.account).value[j] = this.accruedRewards(staker.account).value[j] + this.rewardRate(staker.account).value[j];
          this.injectedRewards.value[j] = this.injectedRewards.value[j] - this.rewardRate(staker.account).value[j];

          if (this.rewardAssets.value[j] === this.stakedAssetId.value) {
            //Compound rewards
            staker.stake = staker.stake + this.rewardRate(staker.account).value[j];
            this.totalStaked.value = this.totalStaked.value + this.rewardRate(staker.account).value[j];
          }
        }
        this.lastUpdateTime(staker.account).value = globals.latestTimestamp;
        this.stakers.value[i] = staker;
      }
    }
  }

  claimRewards(): void {

    for (let i = 0; i < this.stakers.value.length; i += 1) {
      /* if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      } */
      const staker = clone(this.stakers.value[i])

      if (staker.account === this.txn.sender) {
        if (this.algoAccuredRewards(staker.account).value > 0) {
          sendPayment({
            amount: this.algoAccuredRewards(staker.account).value,
            receiver: this.txn.sender,
            sender: this.app.address,
            fee: 1_000,
          });
          this.algoAccuredRewards(staker.account).value = 0;
        }

        for (var j = 0; j < this.rewardAssets.value.length; j += 1) {
          if (this.accruedRewards(staker.account).value[j] > 0) {
            sendAssetTransfer({
              xferAsset: AssetID.fromUint64(this.rewardAssets.value[j]),
              assetReceiver: this.txn.sender,
              sender: this.app.address,
              assetAmount: this.accruedRewards(staker.account).value[j],
              fee: 1_000,
            });
          }
          this.accruedRewards(staker.account).value[j] = 0;
          this.stakers.value[i] = staker;
        }
      }
      this.lastUpdateTime(staker.account).value = globals.latestTimestamp;
    }
  }

  unstake(quantity: uint64): void {
    /*     assert(this.staked(this.txn.sender).value > 0, 'No staked assets');
        assert(this.stakeStartTime(this.txn.sender).value > 0, 'User has not staked assets');
        assert(this.stakeDuration(this.txn.sender).value > 0, 'User has not staked assets'); */
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      /* if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      } */
      const staker = clone(this.stakers.value[i])

      //unstake - all rewards are claimed and unstaked, quantity only affects stake token.
      if (staker.stake === 0) continue;

      if (staker.stake > 0) {
        if (this.stakedAssetId.value === 0) {
          sendPayment({
            amount: quantity === 0 ? staker.stake : quantity,
            receiver: this.txn.sender,
            sender: this.app.address,
            fee: 1_000,
          });
        }
        else {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: quantity === 0 ? staker.stake : quantity,
            fee: 1_000,
          });
        }
      }

      //check for algo rewards
      if (this.algoAccuredRewards(staker.account).value > 0) {
        sendPayment({
          amount: this.algoAccuredRewards(staker.account).value,
          receiver: this.txn.sender,
          sender: this.app.address,
          fee: 1_000,
        });
        this.algoAccuredRewards(staker.account).value = 0;
      }
      //check other rewards
      for (let j = 0; j < this.rewardAssets.value.length; j += 1) {
        if (this.accruedRewards(staker.account).value[j] > 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.rewardAssets.value[j]),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: this.accruedRewards(staker.account).value[j],
            fee: 1_000,
          });
          this.accruedRewards(staker.account).value[j] = 0;
        }
      }

      // Update the total staking weight
      this.totalStakingWeight.value = this.totalStakingWeight.value - (this.userStakingWeight(staker.account).value as uint128);
      this.totalStaked.value = this.totalStaked.value - staker.stake;

      if (quantity === 0) {
        this.stakers.value[i] = {
          account: globals.zeroAddress,
          stake: 0,
        }
        this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
        this.rewardRate(this.txn.sender).value = [0, 0, 0, 0, 0];
        this.stakeDuration(this.txn.sender).value = 0;
        this.stakeStartTime(this.txn.sender).value = 0;
        this.userStakingWeight(this.txn.sender).value = 0;
        this.lastRewardRate(this.txn.sender).value = 0;
        this.algoAccuredRewards(this.txn.sender).value = 0;
        this.lastUpdateTime(this.txn.sender).value = 0;
        this.algoRewardRate(this.txn.sender).value = 0;
        this.userShare(this.txn.sender).value = 0;
        
      } else {
        staker.stake = staker.stake - quantity;
        this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
      }
      this.lastUpdateTime(this.txn.sender).value = globals.latestTimestamp;
      this.stakers.value[i] = staker;
    }
  }
}


