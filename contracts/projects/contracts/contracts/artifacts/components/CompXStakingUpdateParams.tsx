/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingUpdateParams
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call updateParams"
  typedClient={typedClient}
  minLockUp={minLockUp}
  maxLockUp={maxLockUp}
  oracleAppID={oracleAppID}
  contractDuration={contractDuration}
/>
*/
type CompXStakingUpdateParamsArgs = CompXStaking['methods']['updateParams(uint64,uint64,uint64,uint64)void']['argsObj']

type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
  minLockUp: CompXStakingUpdateParamsArgs['minLockUp']
  maxLockUp: CompXStakingUpdateParamsArgs['maxLockUp']
  oracleAppID: CompXStakingUpdateParamsArgs['oracleAppID']
  contractDuration: CompXStakingUpdateParamsArgs['contractDuration']
}

const CompXStakingUpdateParams = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling updateParams`)
    await props.typedClient.updateParams(
      {
        minLockUp: props.minLockUp,
        maxLockUp: props.maxLockUp,
        oracleAppID: props.oracleAppID,
        contractDuration: props.contractDuration,
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

export default CompXStakingUpdateParams