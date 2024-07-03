/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingUnstake
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call unstake"
  typedClient={typedClient}
/>
*/
type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
}

const CompXStakingUnstake = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling unstake`)
    await props.typedClient.unstake(
      {},
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

export default CompXStakingUnstake