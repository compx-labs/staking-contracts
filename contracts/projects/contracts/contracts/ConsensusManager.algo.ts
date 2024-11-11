import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type PoolInfo = {
    appId: uint64;
    numStakers: uint64;
    totalStaked: uint64;
}
export type mbrReturn = {
    mbrPayment: uint64;
}
export type GetPoolReturn = {
    staker: PoolInfo;
    index: uint64;
}

const MAX_POOLS = 1000;
const MAX_STAKERS_PER_POOL = 300;
const ASSET_HOLDING_FEE = 100000 // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000
const MINIMUM_ALGO_REWARD = 1000000


export class InjectedRewardsPoolConsensus extends Contract {
    programVersion = 10;

    //Global State

    pools = BoxKey<StaticArray<PoolInfo, typeof MAX_POOLS>>({ key: 'pools' })

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

    lstPrice = GlobalStateKey<uint64>();

    stakeTokenPrice = GlobalStateKey<uint64>();

    oracleAdminAddress = GlobalStateKey<Address>();

    lstBalance = GlobalStateKey<uint64>();

    treasuryAddress = GlobalStateKey<Address>();

    totalCommision = GlobalStateKey<uint64>();

    lastUnstake = GlobalStateKey<uint64>();

    //Local Storage
    poolAppId = LocalStateKey<uint64>();

    createApplication(
        adminAddress: Address,
        oracleAdminAddress: Address,
        treasuryAddress: Address
    ): void {
        this.adminAddress.value = adminAddress;
        this.oracleAdminAddress.value = oracleAdminAddress;
        this.treasuryAddress.value = treasuryAddress;
    }

    initApplication(
        stakedAsset: uint64,
        rewardAssetId: uint64,
        minStakePeriodForRewards: uint64,
        lstTokenId: uint64,
        commision: uint64,
        payTxn: PayTxn
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
        this.lstPrice.value = 0;
        this.stakeTokenPrice.value = 0;
        this.lstBalance.value = 0;
        this.minimumBalance.value = payTxn.amount;
        this.totalCommision.value = 0;

        if (this.stakedAssetId.value !== 0) {
            sendAssetTransfer({
                xferAsset: AssetID.fromUint64(stakedAsset),
                assetReceiver: this.app.address,
                assetAmount: 0,
            })
        }
        if (this.rewardAssetId.value !== 0) {
            sendAssetTransfer({
                xferAsset: AssetID.fromUint64(rewardAssetId),
                assetReceiver: this.app.address,
                assetAmount: 0,
            })
        }
        if (this.lstTokenId.value !== 0) {
            sendAssetTransfer({
                xferAsset: AssetID.fromUint64(this.lstTokenId.value),
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
    updateOracleAdminAddress(oracleAdminAddress: Address): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can update oracle admin address');
        this.oracleAdminAddress.value = oracleAdminAddress;
    }
    updateTreasuryAddress(treasuryAddress: Address): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can update treasury address');
        this.treasuryAddress.value = treasuryAddress;
    }
    updateCommision(commision: uint64): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can update commision');
        this.commision.value = commision;
    }
    setPrices(stakeTokenPrice: uint64, lstPrice: uint64): void {
        assert(this.txn.sender === this.oracleAdminAddress.value, 'Only oracle admin can set prices');
        assert(stakeTokenPrice > 0, 'Invalid stake token price');
        assert(lstPrice > 0, 'Invalid reward token price');

        this.stakeTokenPrice.value = stakeTokenPrice;
        this.lstPrice.value = lstPrice;
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
            this.costForBoxStorage(7 + len<PoolInfo>() * MAX_POOLS) +
            this.costForBoxStorage(7 + len<uint64>() * 15)

        return {
            mbrPayment: mbr
        }
    }

    initStorage(mbrPayment: PayTxn): void {
        assert(!this.pools.exists, ' pool array already initialized')
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can init storage');

        let nonAlgoRewardMBR = 0;
        if (this.rewardAssetId.value !== 0) {
            nonAlgoRewardMBR += ASSET_HOLDING_FEE;
        }
        const poolMBR = ALGORAND_ACCOUNT_MIN_BALANCE +
            nonAlgoRewardMBR +
            this.costForBoxStorage(7 + len<PoolInfo>() * MAX_POOLS) +
            this.costForBoxStorage(7 + len<uint64>() * 15)

        // the pay transaction must exactly match our MBR requirement.
        verifyPayTxn(mbrPayment, { receiver: this.app.address, amount: poolMBR })
        this.pools.create()
        this.minimumBalance.value = this.minimumBalance.value + poolMBR;

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

        //total amount of newly paid in consensus rewards
        let amount = this.app.address.balance - this.minimumBalance.value - this.totalConsensusRewards.value - this.algoInjectedRewards.value - this.totalStaked.value;
        //less commision
        const newCommisionPayment = this.totalCommision.value + (amount / 100 * this.commision.value);
        amount = amount - newCommisionPayment;
        this.totalCommision.value = this.totalCommision.value + newCommisionPayment;
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
            amount: quantity,
            receiver: this.app.address,
        });
        let actionComplete: boolean = false;
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        //find pool available and send txn of stake and pay to pool
        for (let i = 0; i < MAX_POOLS; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget()
            }
            if (this.pools.value[i].appId !== 0) {
                const pool = clone(this.pools.value[i]);
                if (globals.opcodeBudget < 300) {
                    increaseOpcodeBudget()
                }
                if (pool.numStakers < MAX_STAKERS_PER_POOL) {
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                    sendPayment({
                        amount: quantity,
                        receiver: this.app.address,
                        sender: this.txn.sender,
                        fee: 1_000,
                    });
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                    sendAppCall({
                        applicationID: AppID.fromUint64(pool.appId),
                        applicationArgs: ['stake', itob(quantity)],
                        accounts: [this.txn.sender],
                    });
                    actionComplete = true;
                    break;
                }
            }
        }
    }

    optInToToken(payTxn: PayTxn, tokenId: uint64): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can opt in to token');

        verifyPayTxn(payTxn, {
            receiver: this.app.address,
            amount: 110000,
        });

        sendAssetTransfer({
            xferAsset: AssetID.fromUint64(tokenId),
            assetReceiver: this.app.address,
            assetAmount: 0,
        })
    }

    registerPool(poolAppId: uint64): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can register pool');
        let poolInfo: PoolInfo = {
            appId: poolAppId,
            numStakers: 0,
            totalStaked: 0
        }
        for (let i = 0; i < MAX_POOLS; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget()
            }
            if (this.pools.value[i].appId === 0) {
                this.pools.value[i] = poolInfo;
                break;
            }
        }

    }

    removePool(poolAppId: uint64): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can remove pool');
        for (let i = 0; i < MAX_POOLS; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget()
            }
            if (this.pools.value[i].appId === poolAppId) {
                this.pools.value[i] = {
                    appId: 0,
                    numStakers: 0,
                    totalStaked: 0
                }
                break;
            }
        }
    }


/*     accrueRewards(): void {
        const algoRewards = this.algoInjectedRewards.value;

        const additionalASARewards = this.injectedASARewards.value;
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        const totalViableStake = this.totalStaked.value;

        for (let i = 0; i < this.numStakers.value; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget()
            }
            const stake = this.stakers.value[i].stake;

            if (stake > 0) {
                const staker = clone(this.stakers.value[i])


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
    } */

    payCommision(): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can pay commision');
        sendPayment({
            amount: this.totalCommision.value,
            receiver: this.treasuryAddress.value,
            sender: this.app.address,
            fee: 1_000,
        });
    }


    unstake(axferTxn: AssetTransferTxn, percentageQuantity: uint64): void {

        for (let i = 0; i < MAX_POOLS; i += 1) {
            if (globals.opcodeBudget < 300) {
                increaseOpcodeBudget()
            }

            
            if (staker.account === this.txn.sender) {
                assert(staker.stake > 0, 'No stake to unstake');
                //quantity as a percentage of total mintedLST
                const burnQuantity = wideRatio([staker.lstMinted, percentageQuantity], [100]);
                const unstakeQuantity = wideRatio([staker.stake, percentageQuantity], [100]);
                assert(unstakeQuantity > 0, 'Invalid quantity');
                this.lastUnstake.value = unstakeQuantity;

                if (globals.opcodeBudget < 300) {
                    increaseOpcodeBudget()
                }
                verifyAssetTransferTxn(axferTxn, {
                    assetAmount: burnQuantity,
                    assetReceiver: this.app.address,
                    sender: this.txn.sender,
                    xferAsset: AssetID.fromUint64(this.lstTokenId.value)
                });
                this.lstBalance.value = this.lstBalance.value - burnQuantity;
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

                sendPayment({
                    amount: unstakeQuantity,
                    receiver: this.txn.sender,
                    sender: this.app.address,
                    fee: 1_000,
                });

                // Update the total staking value
                this.totalStaked.value = this.totalStaked.value - unstakeQuantity;

                if (globals.opcodeBudget < 300) {
                    increaseOpcodeBudget()
                }

                if (percentageQuantity === 100) {
                    const removedStaker: StakeInfo = {
                        account: globals.zeroAddress,
                        stake: 0,
                        lastUpdateTime: 0,
                        algoAccuredRewards: 0,
                        accruedASARewards: 0,
                        userSharePercentage: 0,
                        lstMinted: 0
                    }
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                    this.setStaker(staker.account, removedStaker);
                    //copy last staker to the removed staker position
                    const lastStaker = this.getStaker(this.stakers.value[this.numStakers.value - 1].account);
                    const lastStakerIndex = this.getStakerIndex(this.stakers.value[this.numStakers.value - 1].account);
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                    this.setStakerAtIndex(lastStaker, i);
                    //remove old record of last staker
                    this.setStakerAtIndex(removedStaker, lastStakerIndex);
                    this.numStakers.value = this.numStakers.value - 1;
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                } else {
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                    staker.stake = staker.stake - unstakeQuantity;
                    staker.lstMinted = staker.lstMinted - burnQuantity;
                    staker.accruedASARewards = 0;
                    staker.lastUpdateTime = globals.latestTimestamp;
                    this.setStaker(staker.account, staker);
                    if (globals.opcodeBudget < 300) {
                        increaseOpcodeBudget()
                    }
                }
                break;
            }

        }
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
        return 2_000_000;
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
        verifyPayTxn(feePayment, {
            receiver: this.app.address, amount: extraFee
        })
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
            sender: this.txn.sender,
            xferAsset: AssetID.fromUint64(lstTokenId)
        });
        this.lstBalance.value = this.lstBalance.value + quantity;
    }
    removeLST(quantity: uint64): void {
        assert(this.txn.sender === this.adminAddress.value, 'Only admin can remove LST')
        assert(this.lstBalance.value >= quantity, 'Invalid quantity');
        let amountToRemove = quantity;
        if (amountToRemove === 0) {
            amountToRemove = this.lstBalance.value;
        }
        sendAssetTransfer({
            assetAmount: amountToRemove,
            assetReceiver: this.adminAddress.value,
            sender: this.app.address,
            xferAsset: AssetID.fromUint64(this.lstTokenId.value),
        });
        this.lstBalance.value = this.lstBalance.value - amountToRemove;
    }

    mintLST(quantity: uint64, payTxn: PayTxn): void {
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        const minPayment = 1_000;
        verifyPayTxn(payTxn, {
            receiver: this.app.address,
            amount: minPayment,
        });
        const staker = this.getStaker(this.txn.sender);
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        assert(staker.account !== globals.zeroAddress, 'Invalid staker');
        assert(staker.stake > 0, 'No staked assets');
        assert(quantity > 0, 'Invalid quantity');

        const lstMintRemaining = staker.stake - staker.lstMinted;
        assert(quantity <= lstMintRemaining, 'Invalid quantity');
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        sendAssetTransfer({
            xferAsset: AssetID.fromUint64(this.lstTokenId.value),
            assetReceiver: this.txn.sender,
            sender: this.app.address,
            assetAmount: quantity,
            fee: 1_000,
        });
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        staker.lstMinted = staker.lstMinted + quantity;
        staker.lastUpdateTime = globals.latestTimestamp;
        this.lstBalance.value = this.lstBalance.value - quantity;
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
        this.setStaker(staker.account, staker);
        if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
        }
    }


    burnLST(axferTxn: AssetTransferTxn, quantity: uint64): void {
        verifyAssetTransferTxn(axferTxn, {
            assetAmount: quantity,
            assetReceiver: this.app.address,
            sender: this.txn.sender,
            xferAsset: AssetID.fromUint64(this.lstTokenId.value)
        });

        const lstAmount = axferTxn.assetAmount;
        const stakeTokenDue = wideRatio([lstAmount, this.lstPrice.value], [this.stakeTokenPrice.value]);
        assert(stakeTokenDue > 0, 'Invalid quantity');
        assert(stakeTokenDue <= this.totalStaked.value, 'Invalid quantity');
        assert(this.lstPrice.value > 0, 'Invalid price');
        assert(this.stakeTokenPrice.value > 0, 'Invalid price');

        if (this.stakedAssetId.value === 0) {
            sendPayment({
                amount: stakeTokenDue,
                receiver: this.txn.sender,
                sender: this.app.address,
                fee: 1_000,
            });
        } else {
            sendAssetTransfer({
                xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
                assetReceiver: this.txn.sender,
                sender: this.app.address,
                assetAmount: stakeTokenDue,
                fee: 1_000,
            });
        }
        this.lstBalance.value = this.lstBalance.value + lstAmount;
    }


    gas(): void { }
}



