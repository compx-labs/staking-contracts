import { getAppBoxValue, getBoxReference } from '@algorandfoundation/algokit-utils';
import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

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

  stakedAssetId = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  minimumBalance = GlobalStateKey<uint64>();

  freeze = GlobalStateKey<boolean>();

  lstTokenId = GlobalStateKey<uint64>();

  commisionPercentage = GlobalStateKey<uint64>();

  oracleAdminAddress = GlobalStateKey<Address>();

  lstBalance = GlobalStateKey<uint64>();

  circulatingLST = GlobalStateKey<uint64>();

  treasuryAddress = GlobalStateKey<Address>();

  commisionAmount = GlobalStateKey<uint64>();

  totalConsensusRewards = GlobalStateKey<uint64>();

  nodeAlgo = GlobalStateKey<uint64>();

  lstRatio = GlobalStateKey<uint64>();

  stakeAmountDue = GlobalStateKey<uint64>();

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
    lstTokenId: uint64,
    commision: uint64,
    payTxn: PayTxn
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');
    this.stakedAssetId.value = stakedAsset;
    this.totalStaked.value = 0;
    this.freeze.value = false;
    this.lstTokenId.value = lstTokenId;
    this.lstBalance.value = 0;
    this.circulatingLST.value = 0;
    this.minimumBalance.value = payTxn.amount;
    this.commisionPercentage.value = commision;
    this.nodeAlgo.value = 0;
    this.lstRatio.value = 0;
    this.stakeAmountDue.value = 0;
    this.totalConsensusRewards.value = 0;
    this.commisionAmount.value = 0;

    if (this.stakedAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(stakedAsset),
        assetReceiver: this.app.address,
        assetAmount: 0,
      })
    }
    if (rewardAssetId !== 0) {
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
    this.commisionPercentage.value = commision;
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
    assert(quantity > 0, 'Invalid quantity');
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    verifyPayTxn(payTxn, {
      sender: this.txn.sender,
      amount: quantity + 1000,
      receiver: this.app.address,
    });
    this.mintLST(quantity, payTxn, this.txn.sender);

    this.totalStaked.value = this.totalStaked.value + quantity;

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

  payCommision(payTxn: PayTxn): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can pay commision');
    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: 1000,
    });
    if (this.commisionAmount.value > 0) {
      sendPayment({
        amount: this.commisionAmount.value,
        receiver: this.treasuryAddress.value,
        sender: this.app.address,
        fee: 1_000,
      });
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

  private mintLST(quantity: uint64, payTxn: PayTxn, userAddress: Address): void {
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    const minPayment = 1_000;
    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: minPayment + quantity,
    });

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
      assetReceiver: userAddress,
      sender: this.app.address,
      assetAmount: quantity,
      fee: 1_000,
    });
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }

    this.lstBalance.value = this.lstBalance.value - quantity;
    this.circulatingLST.value = this.circulatingLST.value + quantity;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
  }

  pickupAlgoRewards(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can pickup rewards');

    //total amount of newly paid in consensus rewards
    let amount = this.app.address.balance - this.minimumBalance.value - this.totalConsensusRewards.value - this.totalStaked.value - this.commisionAmount.value;
    //less commision
    if (amount > MINIMUM_ALGO_REWARD) {
      const newCommisionPayment = this.commisionAmount.value + (amount / 100 * this.commisionPercentage.value);
      amount = amount - newCommisionPayment;
      this.commisionAmount.value = this.commisionAmount.value + newCommisionPayment;
      this.totalConsensusRewards.value += amount;
    }
  }



  burnLST(axferTxn: AssetTransferTxn, payTxn: PayTxn, quantity: uint64, userAddress: Address): void {
    verifyAssetTransferTxn(axferTxn, {
      assetAmount: quantity,
      assetReceiver: this.app.address,
      sender: userAddress,
      xferAsset: AssetID.fromUint64(this.lstTokenId.value)
    });
    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: 1_000,
    });

    assert(this.circulatingLST.value >= quantity, 'Invalid quantity');

    const nodeAlgo = this.totalStaked.value + this.totalConsensusRewards.value;
    const lstRatio = wideRatio([nodeAlgo, 10000], [this.circulatingLST.value]);
    const stakeTokenDue = wideRatio([lstRatio, quantity], [10000]);

    this.nodeAlgo.value = nodeAlgo;
    this.lstRatio.value = lstRatio;
    this.stakeAmountDue.value = stakeTokenDue;

    if (this.stakeAmountDue.value < this.app.address.balance) {

      if (this.stakedAssetId.value === 0) {
        sendPayment({
          amount: stakeTokenDue,
          receiver: userAddress,
          sender: this.app.address,
          fee: 1_000,
        });
      } else {
        sendAssetTransfer({
          xferAsset: AssetID.fromUint64(this.stakedAssetId.value),
          assetReceiver: userAddress,
          sender: this.app.address,
          assetAmount: stakeTokenDue,
          fee: 1_000,
        });
      }
    }
    this.lstBalance.value = this.lstBalance.value + quantity;
    this.circulatingLST.value = this.circulatingLST.value - quantity;
    this.totalStaked.value = this.totalStaked.value - quantity;
    this.totalConsensusRewards.value = this.totalConsensusRewards.value - (stakeTokenDue - quantity);
  }


  gas(): void { }
}



