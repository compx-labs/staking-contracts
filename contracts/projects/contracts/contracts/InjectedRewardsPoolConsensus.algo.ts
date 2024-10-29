import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address
  stake: uint64
  stakeDuration: uint64
  stakeStartTime: uint64
  algoAccuredRewards: uint64
  lastUpdateTime: uint64
  accruedASARewards: uint64
  userSharePercentage: uint64
  lstMinted: uint64
}
export type mbrReturn = {
  mbrPayment: uint64;
}

const MAX_STAKERS_PER_POOL = 250;
const ASSET_HOLDING_FEE = 100000 // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000
const MINIMUM_ALGO_REWARD = 1000000


export class InjectedRewardsPoolConsensus extends Contract {
  programVersion = 10;


  //Global State

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' })

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  minStakePeriodForRewards = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  algoInjectedRewards = GlobalStateKey<uint64>();

  injectedASARewards = GlobalStateKey<uint64>();

  lastRewardInjectionTime = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  minimumBalance = GlobalStateKey<uint64>();

  numStakers = GlobalStateKey<uint64>();

  freeze = GlobalStateKey<boolean>();

  totalConsensusRewards = GlobalStateKey<uint64>();

  lstTokenId = GlobalStateKey<uint64>();

  commision = GlobalStateKey<uint64>();


  createApplication(
    adminAddress: Address
  ): void {
    this.adminAddress.value = adminAddress;
  }

  initApplication(
    stakedAsset: uint64,
    rewardAssetId: uint64,
    minStakePeriodForRewards: uint64,
    lstTokenId: uint64,
    commision: uint64
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');

    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAssetId;
    this.totalStaked.value = 0;
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
    this.lastRewardInjectionTime.value = 0;
    this.freeze.value = false;
    this.injectedASARewards.value = 0;
    this.numStakers.value = 0;
    this.algoInjectedRewards.value = 0;
    this.totalConsensusRewards.value = 0;
    this.lstTokenId.value = lstTokenId;
    this.commision.value = commision;

    if (this.stakedAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(stakedAsset),
        assetReceiver: this.app.address,
        assetAmount: 0,
      })
    }
  }
  //ADMIN FUNCTIONS
  updateMinStakePeriod(minStakePeriodForRewards: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update min stake period');
    this.minStakePeriodForRewards.value = minStakePeriodForRewards;
  }
  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }
  updateCommision(commision: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update commision');
    this.commision.value = commision;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500
    const SCBOX_PERBYTE = 400

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE
  }

  getMBRForPoolCreation(): mbrReturn {
    let nonAlgoRewardMBR = 0;
    if (this.rewardAssetId.value !== 0) {
      nonAlgoRewardMBR += ASSET_HOLDING_FEE;
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
    if (this.rewardAssetId.value !== 0) {
      nonAlgoRewardMBR += ASSET_HOLDING_FEE;
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
      // opt into additional reward token
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.address,
        assetAmount: 0,
      })
    }
  }
  /*
  * Inject rewards into the pool
  */
  injectRewards(rewardTxn: AssetTransferTxn, quantity: uint64, rewardAssetId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.adminAddress.value,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(rewardAssetId),
      assetAmount: quantity,
    });
    this.injectedASARewards.value += quantity;
    this.lastRewardInjectionTime.value = globals.latestTimestamp;
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

  //only userd for consensus rewards
  pickupAlgoRewards(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');

    const amount = this.app.address.balance - this.minimumBalance.value - this.totalConsensusRewards.value - this.algoInjectedRewards.value - this.totalStaked.value;
    if (amount > MINIMUM_ALGO_REWARD) {
      this.algoInjectedRewards.value += amount;
      this.lastRewardInjectionTime.value = globals.latestTimestamp;
      this.totalConsensusRewards.value += amount;
    }
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

  stake(
    payTxn: PayTxn,
    quantity: uint64,
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(quantity > 0, 'Invalid quantity');
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    verifyPayTxn(payTxn, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: quantity,
    });
    let actionComplete: boolean = false;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (actionComplete) break;

      if (this.stakers.value[i].account === this.txn.sender) {

        //adding to current stake
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }

        const staker = clone(this.stakers.value[i])
        staker.stake += payTxn.amount

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        staker.stakeDuration = 0;
        staker.stakeStartTime = currentTimeStamp;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.stakers.value[i] = staker
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.totalStaked.value += payTxn.amount;
        actionComplete = true;

      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.totalStaked.value = this.totalStaked.value + payTxn.amount;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: payTxn.amount,
          stakeDuration: 0,
          stakeStartTime: currentTimeStamp,
          algoAccuredRewards: 0,
          lastUpdateTime: currentTimeStamp,
          accruedASARewards: 0,
          userSharePercentage: 0,
          lstMinted: 0
        }
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.numStakers.value = this.numStakers.value + 1;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        actionComplete = true;
      }

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
    }
    assert(actionComplete, 'Stake  failed');
  }



  accrueRewards(): void {
    const algoRewards = (this.algoInjectedRewards.value / 100 * (100 - this.commision.value));

    const additionalASARewards = this.injectedASARewards.value;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    let totalViableStake = 0;
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (this.stakers.value[i].stake > 0) {
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.stakers.value[i].stakeDuration = globals.latestTimestamp - this.stakers.value[i].stakeStartTime;

        if (this.stakers.value[i].stakeDuration >= this.minStakePeriodForRewards.value) {
          totalViableStake += this.stakers.value[i].stake;
        }
      }
    }

    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const stake = this.stakers.value[i].stake;

      if (stake > 0) {
        const staker = clone(this.stakers.value[i])

        if (staker.stakeDuration > this.minStakePeriodForRewards.value) {

          let stakerShare = wideRatio([stake, PRECISION], [totalViableStake]);
          staker.userSharePercentage = stakerShare;

          if (algoRewards > 0) {
            let algoRewardRate = wideRatio([algoRewards, stakerShare], [PRECISION]);
            if (algoRewardRate === 0) {
              algoRewardRate = 1;
            }
            staker.algoAccuredRewards = staker.algoAccuredRewards + algoRewardRate;
            this.algoInjectedRewards.value = this.algoInjectedRewards.value - algoRewardRate;

            if (this.stakedAssetId.value === 0) {
              staker.stake = staker.stake + algoRewardRate;
              this.totalStaked.value = this.totalStaked.value + algoRewardRate;
            }
          }

          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }

          if (additionalASARewards > 0) {
            let rewardRate = wideRatio([additionalASARewards, stakerShare], [PRECISION]);
            if (rewardRate === 0) {
              rewardRate = 1;
            }


            this.injectedASARewards.value = this.injectedASARewards.value - rewardRate;
            if (this.rewardAssetId.value === this.stakedAssetId.value) {
              //Compound rewards
              staker.stake = staker.stake + rewardRate;
              this.totalStaked.value = this.totalStaked.value + rewardRate;
            } else {
              staker.accruedASARewards = staker.accruedASARewards + rewardRate;
            }
          }
        }
        staker.lastUpdateTime = globals.latestTimestamp;
        this.stakers.value[i] = staker;
      }
    }
  }

  private getStaker(address: Address): StakeInfo {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      if (this.stakers.value[i].account === address) {
        return clone(this.stakers.value[i]);
      }
    }
    return {
      account: globals.zeroAddress,
      stake: 0,
      stakeDuration: 0,
      stakeStartTime: 0,
      lastUpdateTime: 0,
      algoAccuredRewards: 0,
      accruedASARewards: 0,
      userSharePercentage: 0,
      lstMinted: 0
    }
  }
  private setStaker(stakerAccount: Address, staker: StakeInfo): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      if (this.stakers.value[i].account === stakerAccount) {
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


    if (staker.accruedASARewards > 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.txn.sender,
        sender: this.app.address,
        assetAmount: staker.accruedASARewards,
        fee: 1_000,
      });
      staker.accruedASARewards = 0;
    }


    staker.lastUpdateTime = globals.latestTimestamp;
    this.setStaker(staker.account, staker);
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
  }

  unstake(quantity: uint64): void {
    const staker = this.getStaker(this.txn.sender);

    /*  assert(staker.account !== globals.zeroAddress, 'Invalid staker');
     assert(staker.stake > 0, 'No staked assets'); */

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

    if (staker.accruedASARewards > 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.txn.sender,
        sender: this.app.address,
        assetAmount: staker.accruedASARewards,
        fee: 1_000,
      });
      staker.accruedASARewards = 0;
    }

    // Update the total staking weight
    this.totalStaked.value = this.totalStaked.value - (quantity === 0 ? staker.stake : quantity);

    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }

    if (quantity === 0) {
      const removedStaker: StakeInfo = {
        account: globals.zeroAddress,
        stake: 0,
        stakeDuration: 0,
        stakeStartTime: 0,
        lastUpdateTime: 0,
        algoAccuredRewards: 0,
        accruedASARewards: 0,
        userSharePercentage: 0,
        lstMinted: 0
      }
      this.setStaker(staker.account, removedStaker);
      //move last staker to the removed staker position
      const lastStaker = this.getStaker(this.stakers.value[this.numStakers.value].account);
      this.setStaker(staker.account, lastStaker);

      this.numStakers.value = this.numStakers.value - 1;


    } else {
      staker.stake = staker.stake - quantity;
      staker.accruedASARewards = 0;
    }
    staker.lastUpdateTime = globals.latestTimestamp;
    this.setStaker(staker.account, staker);
  }

  setFreeze(enabled: boolean): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can freeze payouts');
    this.freeze.value = enabled;
  }

  private getGoOnlineFee(): uint64 {
    // this will be needed to determine if our pool is currently NOT eligible and we thus need to pay the fee.
    /*  if (!this.app.address.incentiveEligible) {
       return globals.payoutsGoOnlineFee
     } */
    return 2000;
  }

  goOnline(
    feePayment: PayTxn,
    votePK: bytes,
    selectionPK: bytes,
    stateProofPK: bytes,
    voteFirst: uint64,
    voteLast: uint64,
    voteKeyDilution: uint64,
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go online')

    const extraFee = this.getGoOnlineFee()
    verifyPayTxn(feePayment, { receiver: this.app.address, amount: extraFee })
    sendOnlineKeyRegistration({
      votePK: votePK,
      selectionPK: selectionPK,
      stateProofPK: stateProofPK,
      voteFirst: voteFirst,
      voteLast: voteLast,
      voteKeyDilution: voteKeyDilution,
      fee: extraFee,
    })
  }


  goOffline(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go offline')
    sendOfflineKeyRegistration({})
  }

  linkToNFD(nfdAppId: uint64, nfdName: string, nfdRegistryAppId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can link to NFD')

    sendAppCall({
      applicationID: AppID.fromUint64(nfdRegistryAppId),
      applicationArgs: ['verify_nfd_addr', nfdName, itob(nfdAppId), rawBytes(this.app.address)],
      applications: [AppID.fromUint64(nfdAppId)],
    })
  }

  addLST(axferTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can send LST')
    const lstTokenId = this.lstTokenId.value;

    verifyAssetTransferTxn(axferTxn, {
      assetAmount: quantity,
      assetReceiver: this.app.address,
      assetSender: this.txn.sender,
      xferAsset: AssetID.fromUint64(lstTokenId)
    });

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(lstTokenId),
      assetReceiver: this.app.address,
      sender: this.app.address,
      assetAmount: 0,
    });
  }

  mintLST(quantity: uint64): void {
    const staker = this.getStaker(this.txn.sender);
    assert(staker.account !== globals.zeroAddress, 'Invalid staker');
    assert(staker.stake > 0, 'No staked assets');
    assert(staker.stake < staker.lstMinted, 'Already minted max LST');
    assert(quantity > 0, 'Invalid quantity');

    const lstMintRemaining = staker.stake - staker.lstMinted;
    assert(quantity <= lstMintRemaining, 'Invalid quantity');

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
      assetReceiver: this.txn.sender,
      sender: this.app.address,
      assetAmount: quantity,
    });
    staker.lstMinted = staker.lstMinted + quantity;
    this.setStaker(staker.account, staker);
  }


  gas(): void { }
}



