import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import algosdk, { Account } from 'algosdk';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { PermissionlessInjectedRewardsPoolFactory } from '../../contracts/clients/PermissionlessInjectedRewardsPoolClient';

export const deploy = async (admin: Account, treasury: Account, injector: Account, deployer: Account) => {
  const localnet = algorandFixture();
  await localnet.newScope(); // Ensure context is initialized before accessing it
  localnet.algorand.setSignerFromAccount(deployer);

  const factory = localnet.algorand.client.getTypedAppFactory(PermissionlessInjectedRewardsPoolFactory, {
    defaultSender: deployer.addr,
  });

  const adminString = algosdk.encodeAddress(admin.addr.publicKey);
  const treasuryString = algosdk.encodeAddress(treasury.addr.publicKey);
  const injectorString = algosdk.encodeAddress(injector.addr.publicKey);

  const { appClient } = await factory.send.create.createApplication({
    args: [adminString, treasuryString, injectorString],
    sender: deployer.addr,
    accountReferences: [deployer.addr, admin.addr, treasury.addr, injector.addr],
  });
  appClient.algorand.setSignerFromAccount(deployer);
  consoleLogger.info('app Created, address', algosdk.encodeAddress(appClient.appAddress.publicKey));
  return appClient;
};
