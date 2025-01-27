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
  accruedASARewards: bigint
  accruedxUSDRewards: bigint
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

  const accruedASARewards = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const accruedxUSDRewards = byteArrayToUint128(byteArray.slice(index, index + byteLength));
  index += byteLength;
  const staker: StakeInfo = {
    account,
    stake,
    accruedASARewards,
    accruedxUSDRewards
  };
  return staker;
}

