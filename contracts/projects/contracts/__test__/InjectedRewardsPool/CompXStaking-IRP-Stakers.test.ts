import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts, getStakingAccount, StakingAccount } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let rewardAssetTwoId: bigint;
let injectionTimestamp: bigint = 0n;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;
const BYTE_LENGTH_STAKER = 104;
const numStakers = 2;
let stakingAccounts: StakingAccount[] = [
  {
    stake: 6_000_000_000n,
  },
  {
    stake: 2_000_000_000n,
  },
]

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

describe('Injected Reward Pool injection test - no staking', () => {
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

    const rewardAssetTwoCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token two',
    });
    rewardAssetTwoId = BigInt((await rewardAssetTwoCreate).confirmation.assetIndex!);

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
      rewardAssets: [rewardAssetOneId, 0n, 0n, 0n, 0n],
      oracleAdmin: admin.addr,
      minStakePeriodForRewards: 1n,
    }, { sendParams: { fee: algokit.algos(0.1) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeAssetPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(1n);
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
    expect(boxNames.length).toBe(4);
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    for (var staker of stakingAccounts) {
      staker.account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
      await appClient.optIn.optInToApplication({}, { sender: staker.account, sendParams: { fee: algokit.algos(0.2) } });

      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      });
      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: admin.addr,
        receiver: staker.account.addr,
      });
    }
  });



  test('set Prices', async () => {
    await appClient.setPrices({
      rewardTokenPrices: [140000n, 0n, 0n, 0n, 0n],
      stakeAssetPrice: 1000000n,
      algoPrice: 1909872n,
    });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.stakeAssetPrice!.asBigInt()).toBe(1000000n);
    const rewardsPricesAfter = await appClient.appClient.getBoxValue('rewardAssetPrices');
    const rewardsPricesAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsPricesAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsPricesAfter', rewardsPricesAfterValues);
    expect(rewardsPricesAfterValues[0]).toBe(140000n);
    expect(rewardsPricesAfterValues[1]).toBe(0n);
    expect(rewardsPricesAfterValues[2]).toBe(0n);
    expect(rewardsPricesAfterValues[3]).toBe(0n);
    expect(rewardsPricesAfterValues[4]).toBe(0n);
  });

  async function accreRewards() {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .calculateShares({}, { sendParams: { fee: algokit.algos(0.1) } })
      .execute({ populateAppCallResources: true })

    const response2 = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .accrueRewards({}, { sendParams: { fee: algokit.algos(0.1) } })
      .execute({ populateAppCallResources: true })

    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
    const staker2 = getStakingAccount(stakerBox.slice(BYTE_LENGTH_STAKER, BYTE_LENGTH_STAKER * 2), 8);
    console.log('staker1', staker1);
    console.log('staker2', staker2);
  }

  test('staking', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    console.log('stakers', stakingAccounts);

    for (var staker of stakingAccounts) {
      const stakerBalance = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      expect(stakerBalance).toBeGreaterThan(0n);


      const stakeTxn = await algorand.transactions.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: staker.account!.addr,
        receiver: appAddress,
      });

      const response = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, stakeTxn: stakeTxn }, { sender: staker.account, sendParams: { fee: algokit.algos(0.1) } })
        .execute({ populateAppCallResources: true })

    }
    //Check staker box array 
    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const stakerBoxValues: bigint[] = getByteArrayValuesAsBigInts(stakerBox, BYTE_LENGTH_STAKER);
    expect(stakerBoxValues[0]).toBeGreaterThan(0n);
    expect(stakerBoxValues[1]).toBeGreaterThan(0n);
    expect(stakerBoxValues[2]).toBe(0n);
    /*     const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
        console.log('staker1', staker1); */
    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .calculateShares({}, { sendParams: { fee: algokit.algos(0.1) } })
      .execute({ populateAppCallResources: true })

  });

  test('inject rewards algo', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(10),
    });
    await appClient.injectAlgoRewards({ payTxn: payTxn, quantity: algokit.algos(10).microAlgos });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.lastRewardInjectionTime!.asBigInt()).toBeGreaterThan(0n);
    injectionTimestamp = globalStateAfter.lastRewardInjectionTime!.asBigInt();
    expect(globalStateAfter.algoInjectedRewards!.asBigInt()).toBe(BigInt(algokit.algos(10).microAlgos));

    await accreRewards();
  });

  test('inject rewards ASA 1', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: rewardAssetOneId,
      amount: 10n * 10n ** 6n,
    });

    await appClient.injectRewards({ rewardTxn: axferTxn, quantity: 10n * 10n ** 6n, rewardAssetId: rewardAssetOneId },
      { assets: [Number(rewardAssetOneId)], sendParams: { populateAppCallResources: true } });


    const globalStateAfter = await appClient.getGlobalState();
    const rewardsInjected = await appClient.appClient.getBoxValue('injectedRewards');
    const rewardsInjectedValues: bigint[] = getByteArrayValuesAsBigInts(rewardsInjected, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsInjected', rewardsInjectedValues);
    expect(rewardsInjectedValues[0]).toBe(10n * 10n ** 6n);

    await accreRewards();

    //check staker rewards
    for (var staker of stakingAccounts) {
      const localState = await appClient.getLocalState(staker.account!.addr);
      const accruedRewards = localState.accruedRewards!.asByteArray();
      const accruedRewardsValues: bigint[] = getByteArrayValuesAsBigInts(accruedRewards, BYTE_LENGTH_REWARD_ASSET);
      console.log('accruedRewards', staker.account?.addr, accruedRewardsValues);
    }
  });

  /*
    test('Add Reward asset', async () => {
      const globalStateBefore = await appClient.getGlobalState();
      const rewards = await appClient.appClient.getBoxValue('rewardAssets');
      const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);
  
      console.log('rewardsBefore', rewardsBefore);
      expect(rewardsBefore[0]).toBe(rewardAssetOneId);
      expect(rewardsBefore[1]).toBe(0n);
      expect(rewardsBefore[2]).toBe(0n);
      expect(rewardsBefore[3]).toBe(0n);
      expect(rewardsBefore[4]).toBe(0n);
  
      //Add new reward asset
      await appClient.addRewardAsset({ rewardAssetId: rewardAssetTwoId }, {sendParams: {fee: algokit.algos(0.1)}});
      const globalStateAfter = await appClient.getGlobalState();
      const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
      const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
      console.log('rewardsAfter', rewardsAfterValues);
      expect(rewardsAfterValues[0]).toBe(rewardAssetOneId);
      expect(rewardsAfterValues[1]).toBe(rewardAssetTwoId);
      expect(rewardsAfterValues[2]).toBe(0n);
      expect(rewardsAfterValues[3]).toBe(0n);
      expect(rewardsAfterValues[4]).toBe(0n);
  
  
    });
  
    test('inject rewards ASA 2', async () => {
      const { algorand } = fixture;
      const { appAddress } = await appClient.appClient.getAppReference();
  
      const axferTxn = await algorand.transactions.assetTransfer({
        sender: admin.addr,
        receiver: appAddress,
        assetId: rewardAssetTwoId,
        amount: 10n * 10n ** 6n,
      });
  
      await appClient.injectRewards({ rewardTxn: axferTxn, quantity: 10n * 10n ** 6n, rewardAssetId: rewardAssetTwoId },
        { assets: [Number(rewardAssetTwoId)], sendParams: { populateAppCallResources: true } });
  
  
      const globalStateAfter = await appClient.getGlobalState();
      expect(globalStateAfter.lastRewardInjectionTime!.asBigInt()).toBeGreaterThan(injectionTimestamp);
      const rewardsInjected = await appClient.appClient.getBoxValue('injectedRewards');
      const rewardsInjectedValues: bigint[] = getByteArrayValuesAsBigInts(rewardsInjected, BYTE_LENGTH_REWARD_ASSET);
      console.log('rewardsInjected', rewardsInjectedValues);
      expect(rewardsInjectedValues[1]).toBe(10n * 10n ** 6n);
    }); */

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

