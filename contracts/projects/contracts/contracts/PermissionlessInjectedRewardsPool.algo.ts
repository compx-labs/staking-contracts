import { Contract } from '@algorandfoundation/tealscript';

const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address;
  stake: uint64;
  accruedASARewards: uint64;
  accruedxUSDRewards: uint64;
};

export type mbrReturn = {
  mbrPayment: uint64;
};

const MAX_STAKERS_PER_POOL = 500;
const ASSET_HOLDING_FEE = 100000; // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000;
const VERSION = 1100;

export class PermissionlessInjectedRewardsPool extends Contract {
  programVersion = 11;

  // Global State

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' });

  stakedAssetId = GlobalStateKey<uint64>();

  rewardAssetId = GlobalStateKey<uint64>();

  xUSDAssetId = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  injectedASARewards = GlobalStateKey<uint64>();

  paidASARewards = GlobalStateKey<uint64>();

  injectedxUSDRewards = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  injectorAddress = GlobalStateKey<Address>();

  treasuryAddress = GlobalStateKey<Address>();

  xUSDFee = GlobalStateKey<uint64>();

  feeWaived = GlobalStateKey<boolean>();

  minimumBalance = GlobalStateKey<uint64>();

  numStakers = GlobalStateKey<uint64>();

  freeze = GlobalStateKey<boolean>();

  poolActive = GlobalStateKey<boolean>();

  poolEnding = GlobalStateKey<boolean>();

  rewardFrequency = GlobalStateKey<uint64>();

  rewardPerInjection = GlobalStateKey<uint64>();

  totalRewards = GlobalStateKey<uint64>();

  lastInjectionTime = GlobalStateKey<uint64>();

  contractVersion = GlobalStateKey<uint64>();

  // This param detemines is injection is standard or drip fed. 0 = standard, 1 = drip fed
  // If drip fed, the total rewards and rewards per injection will be set at 0
  // Reward frequency will still be used.
  injectionType = GlobalStateKey<uint64>();

  createApplication(adminAddress: Address, injectorAddress: Address, treasuryAddress: Address): void {
    this.adminAddress.value = adminAddress;
    this.injectorAddress.value = injectorAddress;
    this.treasuryAddress.value = treasuryAddress;
    this.contractVersion.value = VERSION;
  }

  initApplication(stakedAsset: uint64, rewardAssetId: uint64, xUSDFee: uint64, xUSDAssetID: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');

    this.stakedAssetId.value = stakedAsset;
    this.rewardAssetId.value = rewardAssetId;
    this.totalStaked.value = 0;
    this.freeze.value = false;
    this.injectedASARewards.value = 0;
    this.injectedxUSDRewards.value = 0;
    this.numStakers.value = 0;
    this.xUSDFee.value = xUSDFee;
    this.feeWaived.value = false;
    this.poolActive.value = false;
    this.poolEnding.value = false;
    this.xUSDAssetId.value = xUSDAssetID;
    this.totalRewards.value = 0;
    this.rewardFrequency.value = 0;
    this.rewardPerInjection.value = 0;
    this.injectionType.value = 0;
    this.lastInjectionTime.value = globals.latestTimestamp;
    this.paidASARewards.value = 0;

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(stakedAsset),
      assetReceiver: this.app.address,
      assetAmount: 0,
    });
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
      assetReceiver: this.app.address,
      assetAmount: 0,
    });
  }
  // USER ADMIN FUNCTIONS

  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }

  setPoolActive(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can set pool active');
    if (!this.feeWaived.value) {
      assert(this.app.address.assetBalance(this.xUSDAssetId.value) >= this.xUSDFee.value, 'Insufficient balance');
    }

    // Check reward params, if injectionType === 0, then there must be full rewards, and injection settings set. Plus the reward admin should have the rewards in it's account
    if (this.injectionType.value === 0) {
      assert(this.totalRewards.value > 0, 'Total rewards not set');
      assert(this.rewardPerInjection.value > 0, 'Reward per injection not set');
      assert(
        this.injectorAddress.value.assetBalance(this.rewardAssetId.value) >= this.totalRewards.value,
        'Insufficient rewards'
      );
    }

    assert(this.rewardFrequency.value > 0, 'Reward frequency not set');

    this.poolActive.value = true;
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
      assetReceiver: this.treasuryAddress.value,
      assetAmount: this.xUSDFee.value,
      sender: this.app.address,
    });
  }

  setRewardParams(
    totalRewards: uint64,
    rewardFrequency: uint64,
    rewardPerInjection: uint64,
    injectionType: uint64
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can set reward params');
    this.injectionType.value = injectionType;
    if (injectionType === 0) {
      this.totalRewards.value = totalRewards;
      this.rewardFrequency.value = rewardFrequency;
      this.rewardPerInjection.value = rewardPerInjection;
    } else {
      this.totalRewards.value = 0;
      this.rewardFrequency.value = rewardFrequency;
      this.rewardPerInjection.value = 0;
    }
  }

  // Platform admin function  - Injector == CompX

  updateInjectedASARewards(injectedASARewards: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update injected rewards');
    this.injectedASARewards.value = injectedASARewards;
  }

  updatePaidASARewards(paidASARewards: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update paid rewards');
    this.paidASARewards.value = paidASARewards;
  }

  updateInjectedxUSDRewards(injectedxUSDRewards: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update injected rewards');
    this.injectedxUSDRewards.value = injectedxUSDRewards;
  }

  updateTreasuryAddress(treasuryAddress: Address): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update treasury address');
    this.treasuryAddress.value = treasuryAddress;
  }

  updatexUSDFee(xUSDFee: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update xUSD fee');
    this.xUSDFee.value = xUSDFee;
  }

  updateInjectorAddress(injectorAddress: Address): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update injector address');
    this.injectorAddress.value = injectorAddress;
  }

  updateNumStakers(numStakers: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update num stakers');
    this.numStakers.value = numStakers;
  }

  updateFreeze(freeze: boolean): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update freeze');
    this.freeze.value = freeze;
  }

  updatePoolEnding(poolEnding: boolean): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admins can update pool ending');
    this.poolEnding.value = poolEnding;
  }

  setFeeWaived(): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can update fee waive');
    this.feeWaived.value = true;
    this.xUSDFee.value = 0;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500;
    const SCBOX_PERBYTE = 400;

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE;
  }

  getMBRForPoolCreation(): mbrReturn {
    let nonAlgoRewardMBR = ASSET_HOLDING_FEE;
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

    let nonAlgoRewardMBR = ASSET_HOLDING_FEE;
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

    if (this.rewardAssetId.value !== 0) {
      // opt into additional reward token
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.app.address,
        assetAmount: 0,
      });
    }
  }
  /*
   * Inject rewards into the pool
   */

  injectRewards(rewardTxn: AssetTransferTxn, quantity: uint64, rewardAssetId: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can inject rewards');

    verifyAssetTransferTxn(rewardTxn, {
      sender: this.injectorAddress.value,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(rewardAssetId),
      assetAmount: this.rewardPerInjection.value > 0 ? this.rewardPerInjection.value : quantity,
    });
    this.injectedASARewards.value = this.injectedASARewards.value + quantity;
    this.lastInjectionTime.value = globals.latestTimestamp;
  }

  pickupRewards(): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can pickup rewards');

    const appAssetBalance = this.app.address.assetBalance(this.rewardAssetId.value);
    let stakeTokenAmount = 0;
    if (this.rewardAssetId.value === this.stakedAssetId.value) {
      stakeTokenAmount = this.totalStaked.value;
    }

    const amount = appAssetBalance - this.paidASARewards.value - stakeTokenAmount - this.injectedASARewards.value;

    if (amount > this.numStakers.value) {
      this.injectedASARewards.value = this.injectedASARewards.value + amount;
    }
  }

  injectxUSD(xUSDTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can inject xUSD');
    verifyAssetTransferTxn(xUSDTxn, {
      sender: this.injectorAddress.value,
      assetReceiver: this.app.address,
      xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
      assetAmount: quantity,
    });
    this.injectedxUSDRewards.value = this.injectedxUSDRewards.value + quantity;
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    assert(this.totalStaked.value === 0, 'Staked assets still exist');

    this.stakers.delete();
    const paymentAmount = this.app.address.balance - this.app.address.minBalance - 2_000;

    sendPayment({
      amount: paymentAmount,
      receiver: this.adminAddress.value,
      sender: this.app.address,
      fee: 1_000,
    });
  }

  stake(stakeTxn: AssetTransferTxn, quantity: uint64): void {
    assert(quantity > 0, 'Invalid quantity');
    assert(this.poolActive.value, 'Pool not active');
    assert(!this.poolEnding.value, 'Pool ending');

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
        // adding to current stake

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }

        const staker = clone(this.stakers.value[i]);
        staker.stake += stakeTxn.assetAmount;

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.stakers.value[i] = staker;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.totalStaked.value += stakeTxn.assetAmount;
        actionComplete = true;
      } else if (this.stakers.value[i].account === globals.zeroAddress) {
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
          accruedxUSDRewards: 0,
        };
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        this.numStakers.value = this.numStakers.value + 1;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        actionComplete = true;
      }

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
    }
    assert(actionComplete, 'Stake  failed');
  }

  accrueRewards(): void {
    if (!this.freeze.value && !this.poolEnding.value && this.poolActive.value) {
      const additionalASARewards = this.injectedASARewards.value;
      const xUSDRewards = this.injectedxUSDRewards.value;

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }

      for (let i = 0; i < this.numStakers.value; i += 1) {
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }
        const stake = this.stakers.value[i].stake;

        if (stake > 0) {
          const staker = clone(this.stakers.value[i]);

          const stakerShare = wideRatio([stake, PRECISION], [this.totalStaked.value]);

          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget();
          }

          if (additionalASARewards > 0) {
            let rewardRate = wideRatio([additionalASARewards, stakerShare], [PRECISION]);
            if (rewardRate === 0) {
              rewardRate = 1;
            }

            this.injectedASARewards.value = this.injectedASARewards.value - rewardRate;
            this.paidASARewards.value = this.paidASARewards.value + rewardRate;
            if (this.rewardAssetId.value === this.stakedAssetId.value) {
              // Compound rewards

              staker.stake = staker.stake + rewardRate;
              this.totalStaked.value = this.totalStaked.value + rewardRate;
            } else {
              staker.accruedASARewards = staker.accruedASARewards + rewardRate;
            }
          }
          if (xUSDRewards > 0) {
            let rewardRate = wideRatio([xUSDRewards, stakerShare], [PRECISION]);
            if (rewardRate === 0) {
              rewardRate = 1;
            }

            this.injectedxUSDRewards.value = this.injectedxUSDRewards.value - rewardRate;
            if (this.xUSDAssetId.value === this.stakedAssetId.value) {
              // Compound rewards

              staker.stake = staker.stake + rewardRate;
              this.totalStaked.value = this.totalStaked.value + rewardRate;
            } else {
              staker.accruedxUSDRewards = staker.accruedxUSDRewards + rewardRate;
            }
          }
          this.stakers.value[i] = staker;
        }
      }
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      // send back remainder rewards back to injector to zero out

      /* if (this.injectedASARewards.value > 0) {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
          assetReceiver: this.injectorAddress.value,
          sender: this.app.address,
          assetAmount: this.injectedASARewards.value,
        });
      } */
      if (this.injectedxUSDRewards.value > 0) {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
          assetReceiver: this.injectorAddress.value,
          sender: this.app.address,
          assetAmount: this.injectedxUSDRewards.value,
        });
      }
      // this.injectedASARewards.value = 0;
      this.injectedxUSDRewards.value = 0;
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
      accruedxUSDRewards: 0,
    };
  }

  claimRewards(): void {
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
    const staker = this.getStaker(this.txn.sender);

    if (staker.accruedASARewards > 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
        assetReceiver: this.txn.sender,
        sender: this.app.address,
        assetAmount: staker.accruedASARewards,
      });
      staker.accruedASARewards = 0;
    }
    if (staker.accruedxUSDRewards > 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
        assetReceiver: this.txn.sender,
        sender: this.app.address,
        assetAmount: staker.accruedxUSDRewards,
      });
      staker.accruedxUSDRewards = 0;
    }

    this.setStaker(staker.account, staker);
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
  }

  unstake(quantity: uint64): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget();
      }
      const staker = clone(this.stakers.value[i]);
      if (staker.account === this.txn.sender) {
        if (staker.stake > 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: quantity === 0 ? staker.stake : quantity,
          });
        }
        // check ASA rewards

        if (staker.accruedASARewards > 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.rewardAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: staker.accruedASARewards,
          });
          staker.accruedASARewards = 0;
        }
        // Check for xUSD rewards

        if (staker.accruedxUSDRewards > 0) {
          sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.xUSDAssetId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: staker.accruedxUSDRewards,
          });
          staker.accruedxUSDRewards = 0;
        }

        // Update the total staking weight
        this.totalStaked.value = this.totalStaked.value - (quantity === 0 ? staker.stake : quantity);

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget();
        }

        if (quantity === 0) {
          const removedStaker: StakeInfo = {
            account: globals.zeroAddress,
            stake: 0,
            accruedxUSDRewards: 0,
            accruedASARewards: 0,
          };
          this.setStaker(staker.account, removedStaker);

          // copy last staker to the removed staker position

          const lastStaker = this.getStaker(this.stakers.value[this.numStakers.value - 1].account);
          const lastStakerIndex = this.getStakerIndex(this.stakers.value[this.numStakers.value - 1].account);
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget();
          }
          this.setStakerAtIndex(lastStaker, i);
          // remove old record of last staker

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
        // eslint-disable-next-line no-else-return
      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        this.stakers.value[i] = staker;
        return;
      }
    }
  }

  private setStakerAtIndex(staker: StakeInfo, index: uint64): void {
    this.stakers.value[index] = staker;
  }

  setFreeze(enabled: boolean): void {
    assert(this.txn.sender === this.injectorAddress.value, 'Only injector can freeze payouts');
    this.freeze.value = enabled;
  }

  gas(): void {}
}
