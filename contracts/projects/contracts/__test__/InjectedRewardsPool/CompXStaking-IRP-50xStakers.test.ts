import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts, getStakingAccount, StakingAccount } from '../utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let rewardAssetTwoId: bigint;
let injectionTimestamp: bigint = 0n;
let ASAInjectionAmount = 10n * 10n ** 6n;
let AlgoInjectionAmount = 10n * 10n ** 6n;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;
const BYTE_LENGTH_STAKER = 88;
const numStakers = 250;
let stakingAccounts: StakingAccount[] = [];
const rewardTokens: bigint[] = [];

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

describe('Injected Reward Pool - 50x stakers test', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    admin = testAccount;

    appClient = new InjectedRewardsPoolClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algorand.client.algod
    );
    await algokit.ensureFunded(
      {
        accountToFund: admin,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod,
    )

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake Token',
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);

    const rewardAssetOneCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token one',
    });
    rewardAssetOneId = BigInt((await rewardAssetOneCreate).confirmation.assetIndex!);
    rewardTokens.push(rewardAssetOneId);

    await appClient.create.createApplication({
      adminAddress: admin.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    await fixture.algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(20),
    });

    await appClient.initApplication({
      stakedAsset: stakedAssetId,
      rewardAssetId: rewardAssetOneId,
      oracleAdmin: admin.addr,
      minStakePeriodForRewards: 0n,
    }, { sendParams: { fee: algokit.algos(0.1) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(0n);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
    expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin.addr);
  });

  test('init storage', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const [mbrPayment] = await getMBRFromAppClient();
    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.microAlgos(Number(mbrPayment)),
    });

    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .gas({}, { note: '4' })
      .initStorage({
        mbrPayment: {
          transaction: payTxn,
          signer: { signer: admin.signer, addr: admin.addr } as TransactionSignerAccount
        },
      },
        {
          sendParams: {
            fee: algokit.algos(0.2),
          },
        },)
      .execute({ populateAppCallResources: true })

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
    console.log('mbrPayment:', mbrPayment);
    console.log('mbrPayment in algo:', mbrPayment / 10n ** 6n);
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    for (var x = 0; x < numStakers; x++) {

      const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10), suppressLog: true });
      const staker = {
        account: account,
        stake: 10n * 10n ** 6n,
      };

      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      }, {suppressLog: true});
      for (var i = 0; i < rewardTokens.length; i++) {
        await algorand.send.assetTransfer({
          assetId: rewardTokens[i],
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        }, {suppressLog: true});
      }
      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: admin.addr,
        receiver: staker.account.addr,
      }, {suppressLog: true});
      stakingAccounts.push(staker);
      //console.log('new staker created number ', x)
    }
  }, 600000);

  async function accreRewards() {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const globalStateAfter = await appClient.getGlobalState();
    console.log('injectedASARewards:', globalStateAfter.injectedASARewards!.asBigInt());


    let accrueRewardsFees = AlgoAmount.MicroAlgos(240_000);
    const accrueSimulateResult = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true })
    accrueRewardsFees = AlgoAmount.MicroAlgos(
      2000 +
      1000 *
      Math.floor(((accrueSimulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`accrueRewards fees:${accrueRewardsFees.toString()}`)
    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .execute({ populateAppCallResources: true })

    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
    const staker2 = getStakingAccount(stakerBox.slice(BYTE_LENGTH_STAKER, BYTE_LENGTH_STAKER * 2), 8);
    console.log('staker1', staker1);
    console.log('staker2', staker2);
  }

  async function injectAlgo(quantity: number) {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.microAlgos(quantity),
    });
    await appClient.injectAlgoRewards({ payTxn: payTxn, quantity: algokit.microAlgos(quantity).microAlgos });
  }

  test('staking', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    for (var staker of stakingAccounts) {
      const stakerBalance = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      expect(stakerBalance).toBeGreaterThan(0n);

      const stakeTxn = await algorand.transactions.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: staker.account!.addr,
        receiver: appAddress,
      });
      let fees = AlgoAmount.MicroAlgos(240_000);
      const simulateResults = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, stakeTxn: stakeTxn },
          { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      stakeTxn.group = undefined;
      fees = AlgoAmount.MicroAlgos(
        2000 +
        1000 *
        Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
      )
      consoleLogger.info(`addStake fees:${fees.toString()}`)
      const results = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, stakeTxn: stakeTxn },
          { sender: staker.account, sendParams: { fee: fees } })

        .execute({ populateAppCallResources: true, suppressLog: true })

    }
  });

  test('inject rewards algo', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    await injectAlgo(Number(AlgoInjectionAmount));

    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.lastRewardInjectionTime!.asBigInt()).toBeGreaterThan(0n);
    injectionTimestamp = globalStateAfter.lastRewardInjectionTime!.asBigInt();
    expect(globalStateAfter.algoInjectedRewards!.asBigInt()).toBe(BigInt(algokit.algos(10).microAlgos));

  });



  test('inject rewards ASA ', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: rewardAssetOneId,
      amount: ASAInjectionAmount
    });

    await appClient.injectRewards({ rewardTxn: axferTxn, quantity: ASAInjectionAmount, rewardAssetId: rewardAssetOneId },
      { assets: [Number(rewardAssetOneId)], sendParams: { populateAppCallResources: true } });

    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.injectedASARewards!.asBigInt()).toBe(ASAInjectionAmount);
    console.log('injectedASARewards:', globalStateAfter.injectedASARewards!.asBigInt());
  });

  test('accreRewards', async () => {
    await accreRewards();
  });

  test('claim rewards', async () => {
    const { algorand } = fixture;
    let index = 0;
    for (var staker of stakingAccounts) {

      const stakerBoxBefore = await appClient.appClient.getBoxValue('stakers');
      const stakerBefore = getStakingAccount(stakerBoxBefore.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      console.log('staker info before claim', stakerBefore);
      expect(stakerBefore.algoAccuredRewards).toBe(AlgoInjectionAmount / BigInt(numStakers));
      expect(stakerBefore.accruedASARewards).toBe(ASAInjectionAmount / BigInt(numStakers));

      let stakerRewardBalanceBefore = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId)).balance;
      console.log('stakerRewardBalanceBefore:', stakerRewardBalanceBefore);
      expect(stakerRewardBalanceBefore).toBe(0n);

      //check accrued rewards
      let fees = AlgoAmount.MicroAlgos(240_000);
      const response = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .claimRewards({}, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      fees = AlgoAmount.MicroAlgos(
        2000 +
        1000 *
        Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),)
      consoleLogger.info(`claimRewards fees:${fees.toString()}`)

      const claimResponse = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .claimRewards({}, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: true })

      let stakerRewardBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId)).balance;
      console.log('stakerRewardBalanceAfter:', stakerRewardBalanceAfter);
      expect(stakerRewardBalanceAfter).toBe(ASAInjectionAmount / BigInt(numStakers));

      const stakerBoxAfter = await appClient.appClient.getBoxValue('stakers');
      const stakerAfter = getStakingAccount(stakerBoxBefore.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      console.log('staker info aftger claim', stakerAfter);
      expect(stakerAfter.algoAccuredRewards).toBeGreaterThan(0n);
      expect(stakerAfter.accruedASARewards).toBeGreaterThan(0n);

      index += BYTE_LENGTH_STAKER;

    }
  });

  test('unstake all', async () => {
    for (var staker of stakingAccounts) {
      let fees = AlgoAmount.MicroAlgos(240_000);
      const response = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .unstake({ quantity: 0 }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      fees = AlgoAmount.MicroAlgos(
        2000 +
        1000 *
        Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),)
      consoleLogger.info(`unstake fees:${fees.toString()}`)
      const response2 = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .unstake({ quantity: 0 }, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: true })
    }
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

