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
let injectionTimestamp: bigint = 0n;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;
let MBR_PAYMENT = 0n;

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
    MBR_PAYMENT += 20_000_000n;

    await appClient.initApplication({
      stakedAsset: stakedAssetId,
      rewardAssets: [rewardAssetOneId, 0n, 0n, 0n, 0n],
      oracleAdmin: admin.addr,
      minStakePeriodForRewards: ONE_DAY,
    }, { sendParams: { fee: algokit.algos(0.2) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeAssetPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
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
    MBR_PAYMENT += mbrPayment;

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
    expect(boxNames.length).toBe(3);
  });

  test('inject rewards algo', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(10),
    });
    const globalStateAfter = await appClient.getGlobalState();
    const algoBalance = BigInt(((await algorand.account.getInformation(appAddress)).amount));
    expect(algoBalance).toBe(BigInt(algokit.algos(10).microAlgos) + MBR_PAYMENT);
  });

  test('inject rewards ASA 1', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.send.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: rewardAssetOneId,
      amount: 10n * 10n ** 6n,
    });

    const assetBalance = (await algorand.account.getAssetInformation(appAddress, rewardAssetOneId)).balance;
    expect(assetBalance).toBe(10n * 10n ** 6n);
  });


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
    await appClient.addRewardAsset({ rewardAssetId: rewardAssetTwoId }, { sendParams: { fee: algokit.algos(0.1) } });
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

    const axferTxn = await algorand.send.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: rewardAssetTwoId,
      amount: 10n * 10n ** 6n,
    });

    const assetBalance = (await algorand.account.getAssetInformation(appAddress, rewardAssetTwoId)).balance;
    expect(assetBalance).toBe(10n * 10n ** 6n);
  });

  test('Remove reward that already has balance', async () => {
    const rewards = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsBefore: bigint[] = getByteArrayValuesAsBigInts(rewards, BYTE_LENGTH_REWARD_ASSET);

    console.log('rewardsBefore', rewardsBefore);
    expect(rewardsBefore[0]).toBe(rewardAssetOneId);
    expect(rewardsBefore[1]).toBe(rewardAssetTwoId);
    expect(rewardsBefore[2]).toBe(0n);
    expect(rewardsBefore[3]).toBe(0n);
    expect(rewardsBefore[4]).toBe(0n);

    //Add new reward asset
    await appClient.removeRewardAsset({ rewardAssetId: rewardAssetTwoId }, { sendParams: { fee: algokit.algos(0.11) } });
    const globalStateAfter = await appClient.getGlobalState();
    const rewardsAfter = await appClient.appClient.getBoxValue('rewardAssets');
    const rewardsAfterValues: bigint[] = getByteArrayValuesAsBigInts(rewardsAfter, BYTE_LENGTH_REWARD_ASSET);
    console.log('rewardsAfter', rewardsAfterValues);
    expect(rewardsAfterValues[0]).toBe(rewardAssetOneId);
    expect(rewardsAfterValues[1]).toBe(0n);
    expect(rewardsAfterValues[2]).toBe(0n);
    expect(rewardsAfterValues[3]).toBe(0n);
    expect(rewardsAfterValues[4]).toBe(0n);
    const adminRewardTwoBalance = (await fixture.algorand.account.getAssetInformation(admin.addr, rewardAssetTwoId)).balance;
    expect(adminRewardTwoBalance).toBe(999_999_999_000n);

  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

