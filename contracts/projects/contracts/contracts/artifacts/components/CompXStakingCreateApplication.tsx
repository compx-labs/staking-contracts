/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingCreateApplication
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call createApplication"
  typedClient={typedClient}
  stakedAsset={stakedAsset}
  rewardAsset={rewardAsset}
  minLockUp={minLockUp}
  maxLockUp={maxLockUp}
  contractDuration={contractDuration}
  oracleAppID={oracleAppID}
/>
*/
type CompXStakingCreateApplicationArgs = CompXStaking['methods']['createApplication(uint64,uint64,uint64,uint64,uint64,uint64)void']['argsObj']

type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
  stakedAsset: CompXStakingCreateApplicationArgs['stakedAsset']
  rewardAsset: CompXStakingCreateApplicationArgs['rewardAsset']
  minLockUp: CompXStakingCreateApplicationArgs['minLockUp']
  maxLockUp: CompXStakingCreateApplicationArgs['maxLockUp']
  contractDuration: CompXStakingCreateApplicationArgs['contractDuration']
  oracleAppID: CompXStakingCreateApplicationArgs['oracleAppID']
}

const CompXStakingCreateApplication = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling createApplication`)
    await props.typedClient.create.createApplication(
      {
        stakedAsset: props.stakedAsset,
        rewardAsset: props.rewardAsset,
        minLockUp: props.minLockUp,
        maxLockUp: props.maxLockUp,
        contractDuration: props.contractDuration,
        oracleAppID: props.oracleAppID,
      },
      { sender },
    )
    setLoading(false)
  }

  return (
    <button className={props.buttonClass} onClick={callMethod}>
      {loading ? props.buttonLoadingNode || props.buttonNode : props.buttonNode}
    </button>
  )
}

export default CompXStakingCreateApplication