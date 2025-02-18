import { Contract } from '@algorandfoundation/tealscript';

const MINIMUM_ALGO_REWARD = 1000000;

export type MigrationParams = {
  lstBalance: uint64;
  totalStaked: uint64;
  circulatingLST: uint64;
  totalConsensusRewards: uint64;
  commisionAmount: uint64;
};

export const CONTRACT_VERSION = 1100;

export class InjectedRewardsPoolConsensus extends Contract {
  programVersion = 10;

  // Global State

  // Staking asset, will normally be ALGO (0), but contract can handle other assets
  stakedAssetId = GlobalStateKey<uint64>();

  // LST token ID which is sent to stakers
  lstTokenId = GlobalStateKey<uint64>();

  // Running total of total staked asset staked into the contract by users
  totalStaked = GlobalStateKey<uint64>();

  // admin address for carrying out admin functions
  adminAddress = GlobalStateKey<Address>();

  // Minimum contract balance for MBR
  minimumBalance = GlobalStateKey<uint64>();

  // Percentage of rewards to platform - can be updated
  commisionPercentage = GlobalStateKey<uint64>();

  // Running balance total of LST tokens
  lstBalance = GlobalStateKey<uint64>();

  // Running balance total of LST tokens paid out to stakers on stake
  circulatingLST = GlobalStateKey<uint64>();

  // Treasury address for commision payments
  treasuryAddress = GlobalStateKey<Address>();

  // Current commision to be paid out
  commisionAmount = GlobalStateKey<uint64>();

  // Running total of consensus rewards available for payout. Is increased as rewards come in and decreased as rewards go out
  totalConsensusRewards = GlobalStateKey<uint64>();

  // Max stake value of 70mm  - 1 as per node params - can be updated.
  maxStake = GlobalStateKey<uint64>();

  migrationAdmin = GlobalStateKey<Address>();

  paidCommision = GlobalStateKey<uint64>();

  contractVersion = GlobalStateKey<uint64>();

  //
  // Create the application with minimum information
  createApplication(adminAddress: Address, treasuryAddress: Address, migrationAdmin: Address): void {
    this.adminAddress.value = adminAddress;
    this.treasuryAddress.value = treasuryAddress;
    this.migrationAdmin.value = migrationAdmin;
  }

  //
  /*
    Initalises the application with the following parameters:
    stakedAsset: uint64 - the asset ID of the asset that will be staked into the contract
    rewardAssetId: uint64 - the asset ID of the asset that will be used to pay out rewards
    lstTokenId: uint64 - the asset ID of the asset that will be used to mint LST tokens
    commision: uint64 - the percentage of rewards that will be paid to the platform
    payTxn: PayTxn - the pay transaction that will be used to fund the contract
  */
  initApplication(lstTokenId: uint64, commision: uint64, payTxn: PayTxn): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');
    this.totalStaked.value = 0;
    this.lstTokenId.value = lstTokenId;
    this.lstBalance.value = 0;
    this.circulatingLST.value = 0;
    this.minimumBalance.value = payTxn.amount;
    this.commisionPercentage.value = commision;
    this.totalConsensusRewards.value = 0;
    this.commisionAmount.value = 0;
    this.maxStake.value = 69999999000000;
    this.stakedAssetId.value = 0;
    this.paidCommision.value = 0;
    this.contractVersion.value = CONTRACT_VERSION;

    if (this.lstTokenId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(this.lstTokenId.value),
        assetReceiver: this.app.address,
        assetAmount: 0,
      });
    }
  }

  //
  // Admin functions
  //
  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }

  updateMigrationAdmin(migrationAdmin: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update migration admin address');
    this.migrationAdmin.value = migrationAdmin;
  }

  updateMaxStake(maxStake: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update max stake');
    this.maxStake.value = maxStake;
  }

  updateTreasuryAddress(treasuryAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update treasury address');
    this.treasuryAddress.value = treasuryAddress;
  }

  updateCommision(commision: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update commision');
    this.commisionPercentage.value = commision;
  }

  updateCommisionAmount(commisionAmount: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update commision amount');
    this.commisionAmount.value = commisionAmount;
  }

  updateConsenusRewards(totalConsensusRewards: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update rewards');
    this.totalConsensusRewards.value = totalConsensusRewards;
  }

  updateMinimumBalance(minimumBalance: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update minimum balance');
    this.minimumBalance.value = minimumBalance;
  }

  updatePaidCommision(paidCommision: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update paid commision');
    this.paidCommision.value = paidCommision;
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
    });
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
      this.paidCommision.value = this.paidCommision.value + this.commisionAmount.value;
      this.commisionAmount.value = 0;
    }
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
    voteKeyDilution: uint64
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go online');

    const extraFee = this.getGoOnlineFee();
    verifyPayTxn(feePayment, {
      receiver: this.app.address,
      amount: extraFee,
    });
    sendOnlineKeyRegistration({
      votePK: votePK,
      selectionPK: selectionPK,
      stateProofPK: stateProofPK,
      voteFirst: voteFirst,
      voteLast: voteLast,
      voteKeyDilution: voteKeyDilution,
      fee: extraFee,
    });
  }

  goOffline(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go offline');
    sendOfflineKeyRegistration({});
  }

  linkToNFD(nfdAppId: uint64, nfdName: string, nfdRegistryAppId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can link to NFD');

    sendAppCall({
      applicationID: AppID.fromUint64(nfdRegistryAppId),
      applicationArgs: ['verify_nfd_addr', nfdName, itob(nfdAppId), rawBytes(this.app.address)],
      applications: [AppID.fromUint64(nfdAppId)],
    });
  }

  addLST(axferTxn: AssetTransferTxn, quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can send LST');
    const lstTokenId = this.lstTokenId.value;

    verifyAssetTransferTxn(axferTxn, {
      assetAmount: quantity,
      assetReceiver: this.app.address,
      sender: this.txn.sender,
      xferAsset: AssetID.fromUint64(lstTokenId),
    });
    this.lstBalance.value = this.lstBalance.value + quantity;
  }

  removeLST(quantity: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can remove LST');
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

  pickupAlgoRewards(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can pickup rewards');

    // total amount of newly paid in consensus rewards
    let amount =
      this.app.address.balance -
      this.minimumBalance.value -
      this.totalConsensusRewards.value -
      this.totalStaked.value -
      this.commisionAmount.value;
    // less commision
    if (amount > MINIMUM_ALGO_REWARD) {
      const newCommisionPayment = (amount / 100) * this.commisionPercentage.value;
      this.commisionAmount.value = this.commisionAmount.value + newCommisionPayment;
      amount = amount - newCommisionPayment;
      this.totalConsensusRewards.value = this.totalConsensusRewards.value + amount;
    }
  }

  private mintLST(stake: uint64, mintQuantity: uint64, payTxn: PayTxn, userAddress: Address): void {
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
    const minPayment = 1_000;
    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: minPayment + stake,
    });

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
      assetReceiver: userAddress,
      sender: this.app.address,
      assetAmount: mintQuantity,
      fee: 1_000,
    });
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }

    this.lstBalance.value = this.lstBalance.value - mintQuantity;
    this.circulatingLST.value = this.circulatingLST.value + mintQuantity;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    sendAssetTransfer({
      assetCloseTo: this.adminAddress.value,
      assetReceiver: this.adminAddress.value,
      sender: this.app.address,
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
      assetAmount: this.lstBalance.value,
    });
  }

  //
  // User functions
  //
  // Staking for users - requires a payment transaction of the amount to stake + 1000 microAlgo for fees for sending out the LST tokens
  // Uses private mintLST function to mint the LST tokens and send them to the user. This ensures that LSTs cannot be minted via any other method than staking
  stake(payTxn: PayTxn, quantity: uint64): void {
    assert(quantity > 0, 'Invalid quantity');
    assert(this.totalStaked.value + quantity <= this.maxStake.value, 'Max stake reached');
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget();
    }

    verifyPayTxn(payTxn, {
      sender: this.txn.sender,
      amount: quantity + 1000,
      receiver: this.app.address,
    });

    let lstRatio = 0;
    let lstDue = 0;
    const nodeAlgo = this.totalStaked.value + this.totalConsensusRewards.value;
    if (nodeAlgo === 0) {
      lstDue = quantity;
    } else {
      lstRatio = wideRatio([this.circulatingLST.value, 10000], [nodeAlgo]);
      lstDue = wideRatio([lstRatio, quantity], [10000]);
    }
    this.mintLST(quantity, lstDue, payTxn, this.txn.sender);

    this.totalStaked.value = this.totalStaked.value + quantity;
  }

  //
  // Unstaking for users - requires a payment transaction of 1000 microAlgo for fees for sending out the staked tokens
  // Requires the user sends the correct quantity of LST tokens to the contract
  burnLST(axferTxn: AssetTransferTxn, payTxn: PayTxn, quantity: uint64, userAddress: Address): void {
    verifyAssetTransferTxn(axferTxn, {
      assetAmount: quantity,
      assetReceiver: this.app.address,
      sender: userAddress,
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
    });
    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: 1_000,
    });

    assert(this.circulatingLST.value >= quantity, 'Invalid quantity');

    const nodeAlgo = this.totalStaked.value + this.totalConsensusRewards.value;
    const lstRatio = wideRatio([nodeAlgo, 10000], [this.circulatingLST.value]);
    const stakeTokenDue = wideRatio([lstRatio, quantity], [10000]);

    if (stakeTokenDue < this.app.address.balance) {
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
    if (this.circulatingLST.value < quantity) {
      this.circulatingLST.value = 0;
    } else {
      this.circulatingLST.value = this.circulatingLST.value - quantity;
    }
    if (this.totalStaked.value < quantity) {
      this.totalStaked.value = 0;
    } else {
      this.totalStaked.value = this.totalStaked.value - quantity;
    }
    if (this.totalConsensusRewards.value < stakeTokenDue - quantity) {
      this.totalConsensusRewards.value = 0;
    } else {
      this.totalConsensusRewards.value = this.totalConsensusRewards.value - (stakeTokenDue - quantity);
    }
  }

  // Migration functions

  acceptMigration(
    algoTransfer: PayTxn,
    lstTransfer: AssetTransferTxn,
    lstBalance: uint64,
    totalStaked: uint64,
    circulatingLST: uint64,
    totalConsensusRewards: uint64,
    commisionAmount: uint64
  ): void {
    verifyPayTxn(algoTransfer, {
      receiver: this.app.address,
      sender: this.migrationAdmin.value,
    });
    verifyAssetTransferTxn(lstTransfer, {
      assetReceiver: this.app.address,
      sender: this.migrationAdmin.value,
    });
    this.lstBalance.value = lstBalance;
    this.totalStaked.value = totalStaked;
    this.circulatingLST.value = circulatingLST;
    this.totalConsensusRewards.value = totalConsensusRewards;
    this.commisionAmount.value = commisionAmount;
  }

  // Sends balances to the admin account
  migrateContract(mbrTxn: PayTxn): MigrationParams {
    assert(this.txn.sender === this.migrationAdmin.value, 'Only admin can migrate contract');
    // ensure account is offline
    this.goOffline();

    verifyPayTxn(mbrTxn, {
      sender: this.migrationAdmin.value,
      amount: 1_000_000,
    });

    sendPayment({
      amount: this.totalStaked.value + this.totalConsensusRewards.value + this.commisionAmount.value,
      receiver: this.migrationAdmin.value,
      sender: this.app.address,
      fee: 1_000,
    });
    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(this.lstTokenId.value),
      assetReceiver: this.migrationAdmin.value,
      sender: this.app.address,
      assetAmount: this.lstBalance.value,
      fee: 1_000,
    });

    return {
      lstBalance: this.lstBalance.value,
      totalStaked: this.totalStaked.value,
      circulatingLST: this.circulatingLST.value,
      totalConsensusRewards: this.totalConsensusRewards.value,
      commisionAmount: this.commisionAmount.value,
    };
  }

  gas(): void {}
}
