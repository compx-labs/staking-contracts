import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetId: bigint;
const ONE_DAY = 86400n;

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
    const rewardAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token',
    });
    rewardAssetId = BigInt((await rewardAssetCreate).confirmation.assetIndex!);

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
      rewardAssets: [rewardAssetId, 0n, 0n, 0n, 0n],
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

      console.log(response)

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(4);
  });

  /* test.skip('updateParams', async () => {
    await appClient.updateParams({ minStakePeriodForRewards: 2n * ONE_DAY });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.minStakePeriodForRewards!.asBigInt()).toBe(2n * ONE_DAY);
  });
  
  test.skip('update params by non-admin', async () => {
    //create new account
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateParams(
        { minStakePeriodForRewards: 2n * ONE_DAY },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()
  }); */

  /* test.skip('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
  
    await algorand.send.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(10),
    });
  
    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
    await appClient.optInToAsset({ asset: rewardAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
  
    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(0n);
  });
  
  test('inject rewards non admin', async () => {
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
  });
  
  test('inject rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const rewardsInUnits = 100n * 10n ** 6n;
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
      sender: admin,
      receiver: appAddress,
      assetId: rewardAssetId,
      amount: rewardsInUnits,
    });
  
    await appClient.injectRewards({ rewardTxn: axferTxn, quantity: rewardsInUnits }, { sendParams: { fee: algokit.algos(0.1) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(rewardsInUnits);
    const lastRewardInjectionAmount = (await appClient.getGlobalState()).injectedRewards!.asBigInt();
    expect(lastRewardInjectionAmount).toBe(BigInt(rewardsInUnits));
  });
  
  test('set Prices', async () => {
    await appClient.setPrices({
      stakeTokenPrice: 1000000n,
      rewardTokenPrice: 150000n,
    });
    const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
    const rewardTokenPrice = (await appClient.getGlobalState()).rewardTokenPrice!.asBigInt();
    expect(stakedTokenPrice).toBe(1000000n);
    expect(rewardTokenPrice).toBe(150000n);
  });
  
  test('set Prices, non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.setPrices(
        {
          stakeTokenPrice: 1000000n,
          rewardTokenPrice: 150000n,
        },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError();
  }); */

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

