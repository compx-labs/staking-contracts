import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { Account } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts } from '../utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { deploy } from './deploy';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: Account;
let stakeAndRewardAssetId: bigint;
const BYTE_LENGTH_REWARD_ASSET = 8;
const MIN_FEE = AlgoAmount.MicroAlgos(250_000);

async function getMBRFromAppClient() {
  const result = await appClient
    .newGroup()
    .getMbrForPoolCreation({ args: [] })
    .simulate({ allowUnnamedResources: true });
  return result.returns![0];
}

describe('Injected Reward Pool setup/admin functions - no staking', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    const { generateAccount } = fixture.context;
    admin = await generateAccount({ initialFunds: algokit.microAlgo(6_000_000_000) });

    appClient = await deploy(admin);
    await algokit.ensureFunded(
      {
        accountToFund: admin,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod
    );

    const stakeAndRewardToken = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake Token',
    });
    stakeAndRewardAssetId = BigInt((await stakeAndRewardToken).confirmation.assetIndex!);

    const initialBalanceTxn = await fixture.algorand.createTransaction.payment({
      sender: admin.addr,
      receiver: appClient.appAddress,
      amount: algokit.microAlgos(400_000),
    });

    await appClient.send.initApplication({
      args: [stakeAndRewardAssetId, stakeAndRewardAssetId, initialBalanceTxn],
    });
  });

  test('confirm global state on initialisation', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    const globalState = await appClient.state.global.getAll();
    expect(globalState.stakedAssetId).toBe(stakeAndRewardAssetId);
    expect(globalState.rewardAssetId).toBe(stakeAndRewardAssetId);
    expect(globalState.lastRewardInjectionTime).toBe(0n);
  });

  test('init storage', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    const mbr = await getMBRFromAppClient();
    const mbrTxn = await appClient.algorand.createTransaction.payment({
      sender: admin.addr,
      receiver: appClient.appAddress,
      amount: algokit.microAlgos(Number(mbr?.mbrPayment)),
    });

    await appClient
      .newGroup()
      .gas({ args: [], note: '1' })
      .gas({ args: [], note: '2' })
      .gas({ args: [], note: '3' })
      .initStorage({
        args: [mbrTxn],
      })
      .send();

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
  });

  test('deleteApplication', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    await appClient
      .newGroup()
      .gas({ args: [], note: '1' })
      .gas({ args: [], note: '2' })
      .gas({ args: [], note: '3' })
      .gas({ args: [], note: '4' })
      .gas({ args: [], note: '5' })
      .delete.deleteApplication()
      .send();
  });
});
