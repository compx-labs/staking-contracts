import { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { AlgorandFixture } from "@algorandfoundation/algokit-utils/types/testing";
import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from "algosdk";

export interface StakingAccount {
  account?: TransactionSignerAccount;
  stake: bigint;
}

export type StakeInfo = {
  account: string
  stake: bigint
  stakeDuration: bigint
  stakeStartTime: bigint
  userStakingWeight: bigint
  lastRewardRate: bigint
  accruedRewards: StaticArray<bigint, 5>
  algoAccuredRewards: bigint
  lastUpdateTime: bigint
  rewardRate: StaticArray<bigint, 5>
  algoRewardRate: bigint
  userShare: bigint
  userSharePercentage: bigint
}


export function byteArrayToUint128(byteArray: Uint8Array): bigint {
  let result = BigInt(0);

  // Iterate over the byte array, treating it as big-endian
  for (let i = 0; i < byteArray.length; i++) {
    result = (result << BigInt(8)) + BigInt(byteArray[i]);
  }

  return result;
}

export function getByteArrayValuesAsBigInts(byteArray: Uint8Array, byteLength: number): bigint[] {
  const values: bigint[] = [];
  for (let i = 0; i < byteArray.length; i += byteLength) {
    values.push(byteArrayToUint128(byteArray.slice(i, i + byteLength)));
  }
  return values;
}

export function getStakingAccount(byteArray: Uint8Array, byteLength: number): StakeInfo {
  let index = 0;
  const account = algosdk.encodeAddress(byteArray.slice(index, 32));
  index += 32;
  const stake = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const stakeDuration = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const stakeStartTime = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const userStakingWeight = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const lastRewardRate = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;

  const accruedRewards = getByteArrayValuesAsBigInts(byteArray.slice(index, 5 * byteLength), byteLength);
  index += 5 * byteLength;

  const algoAccuredRewards = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const lastUpdateTime = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const rewardRate: bigint[] = getByteArrayValuesAsBigInts(byteArray.slice(index, 5 * byteLength), byteLength);
  index += 5 * byteLength;

  const algoRewardRate = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const userShare = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const userSharePercentage = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const staker: StakeInfo = {
    account,
    stake,
    stakeDuration,
    stakeStartTime,
    userStakingWeight,
    lastRewardRate,
    accruedRewards,
    algoAccuredRewards,
    lastUpdateTime,
    rewardRate,
    algoRewardRate,
    userShare,
    userSharePercentage,
  };
  return staker;
}