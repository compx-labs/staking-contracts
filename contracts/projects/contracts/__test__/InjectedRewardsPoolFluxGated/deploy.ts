import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { InjectedRewardsPoolFluxGatedClient, InjectedRewardsPoolFluxGatedFactory } from '../../contracts/clients/InjectedRewardsPoolFluxGatedClient';
import algosdk, { Address, Account } from 'algosdk';
import { FluxGateClient, FluxGateFactory } from './flux-gateClient';

export const deploy = async (adminAccount: Account) => {
  const localnet = algorandFixture();
  await localnet.newScope(); // Ensure context is initialized before accessing it
  localnet.algorand.setSignerFromAccount(adminAccount);

  const factory = localnet.algorand.client.getTypedAppFactory(InjectedRewardsPoolFluxGatedFactory, {
    defaultSender: adminAccount.addr,
  });
  factory.algorand.setSignerFromAccount(adminAccount);
  const { appClient } = await factory.send.create.createApplication({
    args: [
      adminAccount.addr.toString(), // manager address
    ],
    sender: adminAccount.addr,
  });
  appClient.algorand.setSignerFromAccount(adminAccount);
  console.log('app Created, address', algosdk.encodeAddress(appClient.appAddress.publicKey));
  return appClient;
};

export const deployFluxOracle = async (adminAccount: Account): Promise<FluxGateClient> => {
  const localnet = algorandFixture();
  await localnet.newScope(); // Ensure context is initialized before accessing it
  localnet.algorand.setSignerFromAccount(adminAccount);

  const factory = localnet.algorand.client.getTypedAppFactory(FluxGateFactory, {
    defaultSender: adminAccount.addr,
  });
  factory.algorand.setSignerFromAccount(adminAccount);
  const { appClient } = await factory.send.create.createApplication({
    args: [
      adminAccount.addr.toString(), // manager address
    ],
    sender: adminAccount.addr,
  });
  appClient.algorand.setSignerFromAccount(adminAccount);
  console.log('app Created, address', algosdk.encodeAddress(appClient.appAddress.publicKey));
  return appClient;
};

export const getFluxGateClient = (fluxOracleAppId: bigint): FluxGateClient => {
{
    const algorand = algorandFixture().algorand;

    const appClient = new FluxGateClient({
      algorand, // your AlgorandClient instance
      appId: BigInt(fluxOracleAppId), // the application ID
    });

    return appClient;
  }
};
