export function byteArrayToUint128(byteArray: Uint8Array): bigint {
    let result = BigInt(0);
  
    // Iterate over the byte array, treating it as big-endian
    for (let i = 0; i < byteArray.length; i++) {
      result = (result << BigInt(8)) + BigInt(byteArray[i]);
    }
  
    return result;
  }