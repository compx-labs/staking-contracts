import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let rewardAssetTwoId: bigint;
let rewardAssetThreeId: bigint;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

describe('Injected Reward Pool setup/admin functions - no staking', () => {
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

    const rewardAssetThreeCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token three',
    });
    rewardAssetThreeId = BigInt((await rewardAssetThreeCreate).confirmation.assetIndex!);

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
      minStakePeriodForRewards: ONE_DAY,
    })
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeAssetPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(ONE_DAY);
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

  test('update min staking period', async () => {
    await appClient.updateMinStakePeriod({ minStakePeriodForRewards: 2n * ONE_DAY });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.minStakePeriodForRewards!.asBigInt()).toBe(2n * ONE_DAY);
  });

  test('update min staking period by non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateMinStakePeriod(
        { minStakePeriodForRewards: 2n * ONE_DAY },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()
  });

  test('update updateTotalStakingWeight', async () => {
    await appClient.updateTotalStakingWeight({ totalStakingWeight: 100n });
    const globalStateAfter = await appClient.getGlobalState();
    const tsw_ba = globalStateAfter.totalStakingWeight!.asByteArray();
    const tsw = byteArrayToUint128(tsw_ba);
    expect(tsw).toBe(100n);
  });

  test('update updateTotalStakingWeight by non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateTotalStakingWeight(
        { totalStakingWeight: 100n },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()
  });

  test('Add Reward asset', async () => {
    const globalStateBefore = await appClient.getGlobalState();
    const rewards = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);
    
    console.log('rewardsBefore', rewardsBefore);
    expect (rewardsBefore[0]).toBe(rewardAssetOneId);
    expect (rewardsBefore[1]).toBe(0n);
    expect (rewardsBefore[2]).toBe(0n);
    expect (rewardsBefore[3]).toBe(0n);
    expect (rewardsBefore[4]).toBe(0n);

    //Add new reward asset
    await appClient.addRewardAsset({ rewardAssetId: rewardAssetTwoId });
    const globalStateAfter = await appClient.getGlobalState();
    const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsAfter', rewardsAfterValues);
    expect (rewardsAfterValues[0]).toBe(rewardAssetOneId);
    expect (rewardsAfterValues[1]).toBe(rewardAssetTwoId);
    expect (rewardsAfterValues[2]).toBe(0n);
    expect (rewardsAfterValues[3]).toBe(0n);
    expect (rewardsAfterValues[4]).toBe(0n);


  });

  test('Add reward Asset by non-admin', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    const rewards = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsBefore', rewardsBefore);
    expect (rewardsBefore[0]).toBe(rewardAssetOneId);
    expect (rewardsBefore[1]).toBe(rewardAssetTwoId);
    expect (rewardsBefore[2]).toBe(0n);
    expect (rewardsBefore[3]).toBe(0n);
    expect (rewardsBefore[4]).toBe(0n);

    await expect(
      appClient.addRewardAsset(
        { rewardAssetId: rewardAssetThreeId },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()

    const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsAfter', rewardsAfterValues);
    expect (rewardsAfterValues[0]).toBe(rewardAssetOneId);
    expect (rewardsAfterValues[1]).toBe(rewardAssetTwoId);
    expect (rewardsAfterValues[2]).toBe(0n);
    expect (rewardsAfterValues[3]).toBe(0n);
    expect (rewardsAfterValues[4]).toBe(0n);
  });

  test('Remove Reward asset non admin', async () => {
    const globalStateBefore = await appClient.getGlobalState();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    const rewards = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);
    
    console.log('rewardsBefore', rewardsBefore);
    expect (rewardsBefore[0]).toBe(rewardAssetOneId);
    expect (rewardsBefore[1]).toBe(rewardAssetTwoId);
    expect (rewardsBefore[2]).toBe(0n);
    expect (rewardsBefore[3]).toBe(0n);
    expect (rewardsBefore[4]).toBe(0n);

    //Add new reward asset
    await expect(
      appClient.removeRewardAsset(
        { rewardAssetId: rewardAssetTwoId },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError();

    const globalStateAfter = await appClient.getGlobalState();
    const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsAfter', rewardsAfterValues);
    expect (rewardsAfterValues[0]).toBe(rewardAssetOneId);
    expect (rewardsAfterValues[1]).toBe(rewardAssetTwoId);
    expect (rewardsAfterValues[2]).toBe(0n);
    expect (rewardsAfterValues[3]).toBe(0n);
    expect (rewardsAfterValues[4]).toBe(0n);
    
  });

  test('Remove Reward asset', async () => {
    const globalStateBefore = await appClient.getGlobalState();
    const rewards = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);
    
    console.log('rewardsBefore', rewardsBefore);
    expect (rewardsBefore[0]).toBe(rewardAssetOneId);
    expect (rewardsBefore[1]).toBe(rewardAssetTwoId);
    expect (rewardsBefore[2]).toBe(0n);
    expect (rewardsBefore[3]).toBe(0n);
    expect (rewardsBefore[4]).toBe(0n);

    //Add new reward asset
    await appClient.removeRewardAsset({ rewardAssetId: rewardAssetTwoId });
    const globalStateAfter = await appClient.getGlobalState();
    const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsAfter', rewardsAfterValues);
    expect (rewardsAfterValues[0]).toBe(rewardAssetOneId);
    expect (rewardsAfterValues[1]).toBe(0n);
    expect (rewardsAfterValues[2]).toBe(0n);
    expect (rewardsAfterValues[3]).toBe(0n);
    expect (rewardsAfterValues[4]).toBe(0n);
    
  });

  test('set Prices', async () => {
    await appClient.setPrices({
      rewardTokenPrices: [140000n, 0n, 0n, 0n, 0n],
      stakeAssetPrice: 1000000n,
    });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.stakeAssetPrice!.asBigInt()).toBe(1000000n);
    const rewardsPricesAfter = await appClient.appClient.getBoxValue('rewardAssetPrices');
    const rewardsPricesAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsPricesAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsPricesAfter', rewardsPricesAfterValues);
    expect (rewardsPricesAfterValues[0]).toBe(140000n);
    expect (rewardsPricesAfterValues[1]).toBe(0n);
    expect (rewardsPricesAfterValues[2]).toBe(0n);
    expect (rewardsPricesAfterValues[3]).toBe(0n);
    expect (rewardsPricesAfterValues[4]).toBe(0n);
  });

  test('set prices, non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.setPrices(
        {
          rewardTokenPrices: [140000n, 0n, 0n, 0n, 0n],
          stakeAssetPrice: 1000000n,
        },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError();
  });

  /*  test('inject rewards non admin', async () => {
     const { algorand } = fixture;
     const { appAddress } = await appClient.appClient.getAppReference();
     const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
   
     const rewardsInUnits = 100_000n * 10n ** 6n;
     const axferTxn = await fixture.algorand.transactions.assetTransfer({
       sender: admin,
       receiver: appAddress,
       assetId: rewardAssetId,
       amount: rewardsInUnits,
     });
   
     await expect(
       appClient.injectRewards(
         { rewardTxn: axferTxn, quantity: rewardsInUnits },
         { sender: nonAdminAccount },
       ),
     ).rejects.toThrowError()
   
     const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
     expect(rewardAssetBalance).toBe(0n);
     expect((await appClient.getGlobalState()).injectedRewards?.asBigInt()).toBe(0n);
     expect((await appClient.getGlobalState()).lastRewardInjectionTime?.asBigInt()).toBe(0n);
   }); */

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

