import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts } from '../utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';

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
      minStakePeriodForRewards: ONE_DAY,
    }, { sendParams: { fee: algokit.algos(0.2) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(ONE_DAY);
  });

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

  }

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
    expect(boxNames.length).toBe(1);
  });

  test('inject rewards algo', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(10),
    });
    await accreRewards();
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.algoInjectedRewards!.asBigInt()).toBe(BigInt(algokit.algos(10).microAlgos));
  });
  test('inject rewards algo', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(10),
    });
    await accreRewards();
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.algoInjectedRewards!.asBigInt()).toBe(BigInt(algokit.algos(20).microAlgos));
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
    await accreRewards();
    const rewardsInjected = await appClient.getGlobalState().then((globalState) => globalState.injectedASARewards!.asBigInt());
    expect(rewardsInjected).toBe(10n * 10n ** 6n);
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
    await accreRewards();
    const rewardsInjected = await appClient.getGlobalState().then((globalState) => globalState.injectedASARewards!.asBigInt());
    expect(rewardsInjected).toBe(20n * 10n ** 6n);
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

