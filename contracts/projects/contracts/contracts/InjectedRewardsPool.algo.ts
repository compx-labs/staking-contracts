import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address
  stake: uint64
  stakeDuration: uint64
  stakeStartTime: uint64
  userStakingWeight: uint64
  lastRewardRate: uint64
  algoAccuredRewards: uint64
  lastUpdateTime: uint64
  userShare: uint64
  userSharePercentage: uint64
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

  numStakers = GlobalStateKey<uint64>();

  //Local State
  accruedRewards = LocalStateKey<StaticArray<uint64, 5>>({ key: 'accruedRewards' })


  createApplication(
    adminAddress: Address
  ): void {
    this.adminAddress.value = adminAddress;
  }

  initApplication(stakedAsset: uint64,
    rewardAssets: StaticArray<uint64, 5>,
    minStakePeriodForRewards: uint64,
    oracleAdmin: Address,): void {
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

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(stakedAsset),
      assetReceiver: this.app.address,
      assetAmount: 0,
    })

  }

  optInToApplication(): void {
    this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
  }

  //ADMIN FUNCTIONS
  updateMinStakePeriod(minStakePeriodForRewards: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update min stake period');
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
  }
  updateTotalStakingWeight(totalStakingWeight: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update total staking weight');
    this.totalStakingWeight.value = totalStakingWeight as uint128;
  }
  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }
  updateOracleAdminAddress(oracleAdminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update oracle admin address');
    this.oracleAdminAddress.value = oracleAdminAddress;
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

  addRewardAsset(rewardAssetId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can add reward asset');
    assert(rewardAssetId !== 0, 'Invalid reward asset');

    for (let i = 0; i < this.rewardAssets.value.length; i += 1) {
      if (this.rewardAssets.value[i] === 0) {
        this.rewardAssets.value[i] = rewardAssetId;
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(rewardAssetId),
          assetReceiver: this.app.address,
          assetAmount: 0,
        })
        return;
      }
    }
  }
  removeRewardAsset(rewardAssetId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can remove reward asset');
    assert(rewardAssetId !== 0, 'Invalid reward asset');

    for (let i = 0; i < this.rewardAssets.value.length; i += 1) {
      if (this.rewardAssets.value[i] === rewardAssetId) {
        this.rewardAssets.value[i] = 0;
        this.injectedRewards.value[i] = 0;
        this.rewardAssetPrices.value[i] = 0;
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(rewardAssetId),
          assetReceiver: this.app.address,
          assetAmount: this.app.address.assetBalance(rewardAssetId),
          assetCloseTo: this.adminAddress.value,
        })
        return;
      }
    }
  }

  /*
  * Inject rewards into the pool - one reward asset at a time
  */
  injectRewards(rewardTxn: AssetTransferTxn, quantity: uint64, rewardAssetId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');
    //assert(this.txn.numAssets > 1, 'Invalid number of assets');

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
    //assert(this.totalStaked.value === 0, 'Staked assets still exist');

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
  setPrices(stakeAssetPrice: uint64, rewardTokenPrices: StaticArray<uint64, 5>, algoPrice: uint64): void {
    assert(this.txn.sender === this.oracleAdminAddress.value, 'Only oracle admin can set prices');
    assert(stakeAssetPrice > 0, 'Invalid stake token price');
    assert(rewardTokenPrices.length === this.numRewards.value, 'Invalid number of reward token prices');

    this.stakeAssetPrice.value = stakeAssetPrice;
    this.rewardAssetPrices.value = rewardTokenPrices;
    this.algoPrice.value = algoPrice;
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

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])

      if (staker.account === this.txn.sender) {
        staker.stake += stakeTxn.assetAmount
        this.stakers.value[i] = staker
        actionComplete = true;

      } else if (staker.account === globals.zeroAddress) {

        this.totalStaked.value += stakeTxn.assetAmount;

        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: stakeTxn.assetAmount,
          stakeDuration: 0,
          stakeStartTime: currentTimeStamp,
          userStakingWeight: 0,
          lastRewardRate: 0,
          algoAccuredRewards: 0,
          lastUpdateTime: currentTimeStamp,
          userShare: 0,
          userSharePercentage: 0
        }

        this.numStakers.value = this.numStakers.value + 1;
        actionComplete = true;
      }
    }
    this.calculateRewardShares();
  }

  calculateShares(): void {
    this.calculateRewardShares();
  }

  private calculateRewardShares(): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])
      if (staker.account === globals.zeroAddress) continue;

      if (staker.userStakingWeight > 0) {
        this.totalStakingWeight.value = this.totalStakingWeight.value - (staker.userStakingWeight as uint128);
      }
      let userStakingWeight = 0;

      userStakingWeight = userStakingWeight + (wideRatio([staker.stake, this.stakeAssetPrice.value], [this.algoPrice.value]));
      for (var j = 0; j < this.rewardAssets.value.length; j += 1) {
        if (this.injectedRewards.value[j] === 0) continue;
        userStakingWeight = userStakingWeight + (wideRatio([staker.stake, this.stakeAssetPrice.value], [this.rewardAssetPrices.value[j]]));
      }

      staker.userStakingWeight = userStakingWeight;
      this.totalStakingWeight.value = this.totalStakingWeight.value + (userStakingWeight as uint128);

      staker.userShare = wideRatio([userStakingWeight, PRECISION], [this.totalStakingWeight.value as uint64]);
      staker.userSharePercentage = wideRatio([staker.userShare, 100], [PRECISION]);

/*       staker.algoRewardRate = wideRatio([this.algoInjectedRewards.value, staker.userSharePercentage], [100]);
      if (staker.algoRewardRate === 0) {
        staker.algoRewardRate = 1;
      } */

/*       for (var k = 0; k < this.rewardAssets.value.length; k += 1) {
        if (this.injectedRewards.value[k] === 0) continue;
        this.rewardRate(this.txn.sender).value[k] = wideRatio([this.injectedRewards.value[k], staker.userSharePercentage], [100]);
        if (this.rewardRate(this.txn.sender).value[k] === 0) {
          this.rewardRate(this.txn.sender).value[k] = 1;
        }
      } */

      this.stakers.value[i] = staker;
    }
  }


  accrueRewards(): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i])
      if (staker.account === globals.zeroAddress) continue;

      if (staker.stake > 0) {
        staker.stakeDuration = globals.latestTimestamp - staker.stakeStartTime;
        if (staker.stakeDuration < this.minStakePeriodForRewards.value) return;

        if (this.algoInjectedRewards.value > 0) {
          const algoRewardRate = wideRatio([this.algoInjectedRewards.value, staker.userSharePercentage], [100]);
          staker.algoAccuredRewards = staker.algoAccuredRewards + algoRewardRate;
          this.algoInjectedRewards.value = this.algoInjectedRewards.value - algoRewardRate;


          if (this.stakedAssetId.value === 0) {
            staker.stake = staker.stake + algoRewardRate;
            this.totalStaked.value = this.totalStaked.value + algoRewardRate;
          }
        }
        for (var j = 0; j < this.rewardAssets.value.length; j += 1) {
          if (this.injectedRewards.value[j] > 0) {
            const rewardRate = wideRatio([this.injectedRewards.value[j], staker.userSharePercentage], [100]);
            this.accruedRewards(this.txn.sender).value[j] = this.accruedRewards(this.txn.sender).value[j] + rewardRate;
            this.injectedRewards.value[j] = this.injectedRewards.value[j] - rewardRate;

            if (this.rewardAssets.value[j] === this.stakedAssetId.value) {
              //Compound rewards
              staker.stake = staker.stake + rewardRate;
              this.totalStaked.value = this.totalStaked.value + rewardRate;
            }
          }
          staker.lastUpdateTime = globals.latestTimestamp;
          this.stakers.value[i] = staker;
        }
      }
    }
  }

  private getStaker(address: Address): StakeInfo {
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (this.stakers.value[i].account === address) {
        return clone(this.stakers.value[i]);
      }
    }
    return {
      account: globals.zeroAddress,
      stake: 0,
      stakeDuration: 0,
      stakeStartTime: 0,
      userStakingWeight: 0,
      lastRewardRate: 0,
      lastUpdateTime: 0,
      algoAccuredRewards: 0,
      userShare: 0,
      userSharePercentage: 0
    }
  }
  private setStaker(staker: StakeInfo): void {
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (this.stakers.value[i].account === staker.account) {
        this.stakers.value[i] = staker;
        return;
      }
    }
  }

  claimRewards(): void {
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    const staker = this.getStaker(this.txn.sender);

    if (staker.algoAccuredRewards > 0) {
      sendPayment({
        amount: staker.algoAccuredRewards,
        receiver: this.txn.sender,
        sender: this.app.address,
        fee: 1_000,
      });
      staker.algoAccuredRewards = 0;
    }

    for (var j = 0; j < this.rewardAssets.value.length; j += 1) {
      if (this.accruedRewards(this.txn.sender).value[j] > 0) {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.rewardAssets.value[j]),
          assetReceiver: this.txn.sender,
          sender: this.app.address,
          assetAmount: this.accruedRewards(this.txn.sender).value[j],
          fee: 1_000,
        });
      }
      this.accruedRewards(this.txn.sender).value[j] = 0;

    }

    staker.lastUpdateTime = globals.latestTimestamp;
    this.setStaker(staker);

  }

  unstake(quantity: uint64): void {

    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }

    const staker = this.getStaker(this.txn.sender);

    assert(staker.account !== globals.zeroAddress, 'Invalid staker');
    assert(staker.stake > 0, 'No staked assets');

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
    if (staker.algoAccuredRewards > 0) {
      sendPayment({
        amount: staker.algoAccuredRewards,
        receiver: this.txn.sender,
        sender: this.app.address,
        fee: 1_000,
      });
      staker.algoAccuredRewards = 0;
    }
    //check other rewards
    for (let j = 0; j < this.rewardAssets.value.length; j += 1) {
      if (this.accruedRewards(this.txn.sender).value[j] > 0) {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.rewardAssets.value[j]),
          assetReceiver: this.txn.sender,
          sender: this.app.address,
          assetAmount: this.accruedRewards(this.txn.sender).value[j],
          fee: 1_000,
        });
        this.accruedRewards(this.txn.sender).value[j] = 0;
      }
    }

    // Update the total staking weight
    this.totalStakingWeight.value = this.totalStakingWeight.value - (staker.userStakingWeight as uint128);
    this.totalStaked.value = this.totalStaked.value - staker.stake;

    if (quantity === 0) {
      const removedStaker: StakeInfo = {
        account: globals.zeroAddress,
        stake: 0,
        stakeDuration: 0,
        stakeStartTime: 0,
        userStakingWeight: 0,
        lastRewardRate: 0,
        lastUpdateTime: 0,
        userShare: 0,
        userSharePercentage: 0,
        algoAccuredRewards: 0,
      }
      this.setStaker(removedStaker);
      this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
      this.numStakers.value = this.numStakers.value - 1;
    } else {
      staker.stake = staker.stake - quantity;
      this.accruedRewards(this.txn.sender).value = [0, 0, 0, 0, 0];
    }
    staker.lastUpdateTime = globals.latestTimestamp;
    this.setStaker(staker);
  }


  gas(): void { }
}



