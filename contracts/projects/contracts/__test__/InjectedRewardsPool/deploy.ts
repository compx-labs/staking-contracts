import { algorandFixture } from "@algorandfoundation/algokit-utils/testing"
import { InjectedRewardsPoolFactory } from "../../contracts/clients/InjectedRewardsPoolClient"
import algosdk, { Address, Account } from 'algosdk'

export const deploy = async (adminAccount: Account) => {
  const localnet = algorandFixture()
  await localnet.newScope() // Ensure context is initialized before accessing it
  localnet.algorand.setSignerFromAccount(adminAccount);

  const factory = localnet.algorand.client.getTypedAppFactory(InjectedRewardsPoolFactory, {
    defaultSender: adminAccount.addr,
  })
  factory.algorand.setSignerFromAccount(adminAccount)
  const { appClient } = await factory.send.create.createApplication({
    args: [
      adminAccount.addr.toString(), // manager address
    ],
    sender: adminAccount.addr,
  })
  appClient.algorand.setSignerFromAccount(adminAccount)
  console.log('app Created, address', algosdk.encodeAddress(appClient.appAddress.publicKey))
  return appClient;
}
