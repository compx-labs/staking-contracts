import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address;
  stake: uint64;
  accruedASARewards: uint64;
};

// storage cost total bytes: 32+8+8 = 48

export type mbrReturn = {
  mbrPayment: uint64;
};

const MAX_STAKERS_PER_POOL = 650;
const ASSET_HOLDING_FEE = 100000; // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000;
const VERSION = 2001;
const INITIAL_PAY_AMOUNT = 400_000;
const STANDARD_TXN_FEE: uint64 = 1_000;

export class InjectedRewardsPool extends Contract {
  programVersion = 11;

  //Global State

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  injectedASARewards = GlobalStateKey<uint64>();

  lastRewardInjectionTime = GlobalStateKey<uint64>();

  lastAccrualTime = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  minimumBalance = GlobalStateKey<uint64>();

  numStakers = GlobalStateKey<uint64>();

  contractVersion = GlobalStateKey<uint64>();

  createApplication(adminAddress: Address): void {
    this.adminAddress.value = adminAddress;
    this.contractVersion.value = VERSION;
  }
  /**
   * Initializes the staking pool application with the specified staked asset and reward asset.
   *
   * Sets up global state variables, verifies the initial funding payment, and opts the contract into the staked asset
   * and reward asset if necesary.
   * Only the admin address can call this function.
   *
   * @param stakedAssetId - The asset ID of the token to be staked in the pool.
   * @param rewardAssetId - The asset ID of the token to be distributed as rewards.
   * @param initialBalanceTxn - The payment transaction providing the initial minimum balance for the contract.
   */
  initApplication(stakedAssetId: uint64, rewardAssetId: uint64, initialBalanceTxn: PayTxn): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');

    this.stakedAssetId.value = stakedAssetId;
    this.rewardAssetId.value = rewardAssetId;
    this.totalStaked.value = 0;
    this.lastRewardInjectionTime.value = 0;
    this.injectedASARewards.value = 0;
    this.numStakers.value = 0;

    verifyPayTxn(initialBalanceTxn, {
      receiver: this.app.address,
      amount: INITIAL_PAY_AMOUNT,
    });

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(stakedAssetId),
      assetReceiver: this.app.address,
      assetAmount: 0,
      fee: STANDARD_TXN_FEE,
    });
    if (rewardAssetId !== stakedAssetId) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(rewardAssetId),
        assetReceiver: this.app.address,
        assetAmount: 0,
        fee: STANDARD_TXN_FEE,
      });
    }
  }
  //ADMIN FUNCTIONS

  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500;
    const SCBOX_PERBYTE = 400;

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE;
  }

  getMBRForPoolCreation(): mbrReturn {
    let nonAlgoRewardMBR = 0;
    if (this.rewardAssetId.value !== 0) {
      nonAlgoRewardMBR += ASSET_HOLDING_FEE;
    }
    const mbr =
      ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15);

    return {
      mbrPayment: mbr,
    };
  }

  initStorage(mbrPayment: PayTxn): void {
    assert(!this.stakers.exists, 'staking pool already initialized');
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init storage');

    let nonAlgoRewardMBR = 0;
    if (this.rewardAssetId.value !== 0) {
      nonAlgoRewardMBR += ASSET_HOLDING_FEE;
    }
    const poolMBR =
      ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15);

    // the pay transaction must exactly match our MBR requirement.
    verifyPayTxn(mbrPayment, { receiver: this.app.address, amount: poolMBR });
    this.stakers.create();
    this.minimumBalance.value = poolMBR;


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

  // need to udpate this
  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    this.stakers.delete();

    // opt out of tokens
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetCloseTo: globals.zeroAddress,
      assetAmount: 0,
      assetReceiver: this.app.address,
      fee: STANDARD_TXN_FEE,
    });
    // opt out of reward token
    if (this.stakedAssetId.value !== this.rewardAssetId.value) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetCloseTo: globals.zeroAddress,
        assetAmount: 0,
        assetReceiver: this.app.address,
        fee: STANDARD_TXN_FEE,
      });
    }

    /* sendPayment({
      amount: this.app.address.balance - globals.minBalance - 2000,
      receiver: this.adminAddress.value,
      sender: this.app.address,
      fee: STANDARD_TXN_FEE,
    }); */
  }

  stake(stakeTxn: AssetTransferTxn, quantity: uint64): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(quantity > 0, 'Invalid quantity');
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
    verifyAssetTransferTxn(stakeTxn, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
      assetAmount: quantity,
    });
    let actionComplete: boolean = false;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (actionComplete) break;

      if (this.stakers.value[i].account === this.txn.sender) {
        //adding to current stake
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }

        const staker = clone(this.stakers.value[i]);
        staker.stake += stakeTxn.assetAmount;

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.stakers.value[i] = staker;
        this.totalStaked.value += stakeTxn.assetAmount;
        actionComplete = true;
      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        // New staker
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.totalStaked.value = this.totalStaked.value + stakeTxn.assetAmount;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: stakeTxn.assetAmount,
          accruedASARewards: 0,
        };
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.numStakers.value = this.numStakers.value + 1;
        actionComplete = true;
      } else {
        // pool is full return assert
        assert(this.numStakers.value < MAX_STAKERS_PER_POOL, 'Max stakers limit reached');
      }

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
    }
    assert(actionComplete, 'Stake  failed');
  }

  accrueRewards(): void {
    if (this.injectedASARewards.value * 2 > this.numStakers.value) {
      const additionalASARewards = this.injectedASARewards.value;

      for (let i = 0; i < this.numStakers.value; i += 1) {
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }

        if (this.stakers.value[i].stake > 0) {
          const staker = clone(this.stakers.value[i]);

          let stakerShare = wideRatio([staker.stake, PRECISION], [this.totalStaked.value]);

          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget();
          }

          if (additionalASARewards > 0) {
            let rewardRate = wideRatio([additionalASARewards, stakerShare], [PRECISION]);
            if (rewardRate === 0) {
              rewardRate = 1;
            }

            if (this.injectedASARewards.value >= rewardRate) {
              this.injectedASARewards.value = this.injectedASARewards.value - rewardRate;

              if (this.rewardAssetId.value === this.stakedAssetId.value) {
                //Compound rewards
                staker.stake = staker.stake + rewardRate;
                this.totalStaked.value = this.totalStaked.value + rewardRate;
              } else {
                staker.accruedASARewards = staker.accruedASARewards + rewardRate;
              }
            } else {
              // For the edge case where the reward rate is > remaining rewards. We accrue the remainder to the user
              if (this.rewardAssetId.value === this.stakedAssetId.value) {
                //Compound rewards
                staker.stake = staker.stake + (rewardRate - this.injectedASARewards.value);
                this.totalStaked.value = this.totalStaked.value + (rewardRate - this.injectedASARewards.value);
              } else {
                staker.accruedASARewards = staker.accruedASARewards + rewardRate;
              }
              this.injectedASARewards.value = 0;
            }

            this.stakers.value[i] = staker;
          }
        }
      }
      this.lastAccrualTime.value = globals.latestTimestamp;
    }
  }

  private getStaker(address: Address): StakeInfo {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      if (this.stakers.value[i].account === address) {
        return clone(this.stakers.value[i]);
      }
    }
    return {
      account: globals.zeroAddress,
      stake: 0,
      accruedASARewards: 0,
    };
  }

  claimRewards(): void {
    const staker = this.getStaker(this.txn.sender);

    if (staker.accruedASARewards > 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.txn.sender,
        sender: this.app.address,
        assetAmount: staker.accruedASARewards,
        fee: STANDARD_TXN_FEE,
      });
      staker.accruedASARewards = 0;
    }
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
    this.setStaker(staker.account, staker);
  }

  unstake(quantity: uint64): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      const staker = clone(this.stakers.value[i]);
      if (staker.account === this.txn.sender) {
        if (staker.stake > 0) {
          assert(staker.stake >= quantity);
          if (this.stakedAssetId.value === 0) {
            sendPayment({
              amount: quantity === 0 ? staker.stake : quantity,
              receiver: this.txn.sender,
              sender: this.app.address,
              fee: 0,
            });
          } else {
            sendAssetTransfer({
              xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
              assetReceiver: this.txn.sender,
              sender: this.app.address,
              assetAmount: quantity === 0 ? staker.stake : quantity,
              fee: STANDARD_TXN_FEE,
            });
          }
        }
        //check other rewards
        if (staker.accruedASARewards > 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: staker.accruedASARewards,
            fee: STANDARD_TXN_FEE,
          });
          staker.accruedASARewards = 0;
        }

        // Update the total staked value
        this.totalStaked.value = this.totalStaked.value - (quantity === 0 ? staker.stake : quantity);

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }

        if (quantity === 0) {
          const removedStaker: StakeInfo = {
            account: globals.zeroAddress,
            stake: 0,
            accruedASARewards: 0,
          };
          this.setStaker(staker.account, removedStaker);
          //copy last staker to the removed staker position
          const lastStaker = this.getStaker(this.stakers.value[this.numStakers.value - 1].account);
          const lastStakerIndex = this.getStakerIndex(this.stakers.value[this.numStakers.value - 1].account);
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget();
          }
          this.setStakerAtIndex(lastStaker, i);
          //remove old record of last staker
          this.setStakerAtIndex(removedStaker, lastStakerIndex);
          this.numStakers.value = this.numStakers.value - 1;
        } else {
          staker.stake = staker.stake - quantity;
          staker.accruedASARewards = 0;
        }
        this.setStaker(staker.account, staker);
      }
    }
  }

  private getStakerIndex(address: Address): uint64 {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      if (this.stakers.value[i].account === address) {
        return i;
      }
    }
    return 0;
  }

  private setStaker(stakerAccount: Address, staker: StakeInfo): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      if (this.stakers.value[i].account === stakerAccount) {
        this.stakers.value[i] = staker;
        return;
      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        this.stakers.value[i] = staker;
        return;
      }
    }
  }
  private setStakerAtIndex(staker: StakeInfo, index: uint64): void {
    this.stakers.value[index] = staker;
  }

  gas(): void {}
}
