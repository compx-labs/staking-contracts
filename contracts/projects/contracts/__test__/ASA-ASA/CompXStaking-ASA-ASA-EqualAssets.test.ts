import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../../contracts/clients/CompXStakingClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128 } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;
interface StakingAccount {
    account?: TransactionSignerAccount;
    stake: bigint;
    lockPeriod: bigint;
}
let stakingAccounts: StakingAccount[] = [
    {
        stake: 7_000_000_000n,
        lockPeriod: 2592000n,
    },
    {
        stake: 2_000_000_000n,
        lockPeriod: 2592000n,
    },
    {
        stake: 4_000_000_000n,
        lockPeriod: 2592000n,
    },
    {
        stake: 10_000_000_000n,
        lockPeriod: 2592000n,
    },
]


describe('CompXStaking ASA/ASA - Equal Assets', () => {
    beforeEach(fixture.beforeEach);

    beforeAll(async () => {
        await fixture.beforeEach();
        const { testAccount } = fixture.context;
        const { algorand } = fixture;
        admin = testAccount.addr;

        appClient = new CompXStakingClient(
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
                minSpendingBalance: algokit.algos(20),
            },
            algorand.client.algod,
        )


        const stakeAssetCreate = algorand.send.assetCreate({
            sender: admin,
            total: 999_999_999_000n,
            decimals: 6,
            assetName: 'Stake and Reward Token',
        });
        stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
        rewardAssetId = stakedAssetId;

        await appClient.create.createApplication({
            stakedAsset: stakedAssetId,
            rewardAsset: rewardAssetId,
            minLockUp: 10n,
            contractDuration: 86400n, //1 day
            startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
            oracleAdmin: admin,
            adminAddress: admin,
        });
    });

    test('confirm global state on initialisation', async () => {
        const globalState = await appClient.getGlobalState();
        expect(globalState.stakeTokenPrice!.asBigInt()).toBe(0n);
        expect(globalState.rewardTokenPrice!.asBigInt()).toBe(0n);
        expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
        expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
        expect(globalState.minLockUp!.asBigInt()).toBe(10n);
        expect(globalState.contractDuration!.asBigInt()).toBe(86400n);
        expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
        const tsw_ba = globalState.totalStakingWeight!.asByteArray();
        const tsw = byteArrayToUint128(tsw_ba);
        expect(tsw).toBe(0n);
        expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin);
    });

    test('opt app in', async () => {
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

    test('add rewards', async () => {
        const { algorand } = fixture;
        const { appAddress } = await appClient.appClient.getAppReference();
        const rewardsInUnits = 100_000n * 10n ** 6n;
        const axferTxn = await fixture.algorand.transactions.assetTransfer({
            sender: admin,
            receiver: appAddress,
            assetId: rewardAssetId,
            amount: rewardsInUnits,
        });

        await appClient.addRewards({ rewardTxn: axferTxn, quantity: rewardsInUnits }, { sendParams: { fee: algokit.algos(0.1) } });
        const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
        expect(rewardAssetBalance).toBe(rewardsInUnits);
        const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
        const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
        const contractDuration = (await appClient.getGlobalState()).contractDuration!.asBigInt();
        expect(totalRewards).toBe(BigInt(rewardsInUnits));
        console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //
    });

    test('set Prices', async () => {

        await appClient.setPrices({
            stakeTokenPrice: 150000n,
            rewardTokenPrice: 150000n,
        });
        const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
        const rewardTokenPrice = (await appClient.getGlobalState()).rewardTokenPrice!.asBigInt();
        expect(stakedTokenPrice).toBe(150000n);
        expect(rewardTokenPrice).toBe(150000n);
    });

    test('creating accounts and opting in, prep for staking', async () => {
        const { algorand } = fixture;
        for (var staker of stakingAccounts) {
            staker.account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
            await appClient.optIn.optInToApplication({}, { sender: staker.account });
            await algorand.send.assetTransfer({
                assetId: stakedAssetId,
                amount: 0n,
                sender: staker.account.addr,
                receiver: staker.account.addr,
            });
            await algorand.send.assetTransfer({
                assetId: stakedAssetId,
                amount: staker.stake,
                sender: admin,
                receiver: staker.account.addr,
            });
        }
    });

    async function accrueAll() {
        for (var staker of stakingAccounts) {
            await appClient.accrueRewards({ userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: algokit.algos(0.1) } });
            const userAccruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
            console.log('userAccruedRewards', userAccruedRewards);
        }
    }


    test('stake', async () => {
        const { algorand } = fixture;
        for (var staker of stakingAccounts) {

            const stakedAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
            const rewardAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
            const { appAddress } = await appClient.appClient.getAppReference();

            const stakeTxn = await algorand.transactions.assetTransfer({
                assetId: stakedAssetId,
                amount: staker.stake,
                sender: staker.account!.addr,
                receiver: appAddress,
            });
            await appClient.stake({ lockPeriod: 10n, quantity: staker.stake, stakeTxn }, { sender: staker.account, sendParams: { fee: algokit.algos(0.2) } });

            const stakedAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
            const rewardAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
            const rewardRate = (await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt();

            expect(stakedAssetBalanceBefore).toBe(staker.stake);
            expect(stakedAssetBalanceAfter).toBe(0n);
            expect(rewardAssetBalanceBefore).toBe(staker.stake);
            expect(rewardAssetBalanceAfter).toBe(0n);
        }
    });

    async function waitForDuration(duration: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, duration);
        });
    }
    test('accrue reward 1', async () => {
        await waitForDuration(5000);
        accrueAll();
        await waitForDuration(5000);
        accrueAll();
    });


    test('unstake', async () => {
        const { algorand } = fixture;
        let totalPaidOut = 0n;
        for (var staker of stakingAccounts) {
            const rewardBalancePrior = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
            const unlockTime = (await appClient.getLocalState(staker.account!.addr)).unlockTime!.asBigInt();
            const currentTime = BigInt(Math.floor(Date.now() / 1000));
            const stakeDuration = (await appClient.getLocalState(staker.account!.addr)).stakeDuration!.asBigInt();
            const stakeStart = (await appClient.getLocalState(staker.account!.addr)).stakeStartTime!.asBigInt();

            console.log('unlockTime', unlockTime);
            console.log('currentTime', currentTime);
            console.log('stakeDuration', stakeDuration);
            console.log('stakeStart', stakeStart);

            await appClient.unstake({}, { sender: staker.account, sendParams: { fee: algokit.algos(0.02) } });
            //get asset balances
            const stakedAssetBalance = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
            const rewardAssetBalance = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
            console.log('stakedAssetBalance', stakedAssetBalance);
            console.log('rewardAssetBalance', rewardAssetBalance);
            totalPaidOut += (rewardAssetBalance - rewardBalancePrior);

            const remainingRewards = (await appClient.getGlobalState()).remainingRewards!.asBigInt();
            const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
            console.log('remainingRewards', remainingRewards);
            console.log('totalRewards', totalRewards);
            console.log('rewards spent', totalRewards - remainingRewards);
            console.log('totalPaidOut', totalPaidOut);
        }
    });


    test('delete app', async () => {
        await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.02) } });
    });
});
