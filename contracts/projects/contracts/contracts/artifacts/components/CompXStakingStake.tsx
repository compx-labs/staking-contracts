/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingStake
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call stake"
  typedClient={typedClient}
  stakeTxn={stakeTxn}
  quantity={quantity}
  lockPeriod={lockPeriod}
/>
*/
type CompXStakingStakeArgs = CompXStaking['methods']['stake(axfer,uint64,uint64)void']['argsObj']

type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
  stakeTxn: CompXStakingStakeArgs['stakeTxn']
  quantity: CompXStakingStakeArgs['quantity']
  lockPeriod: CompXStakingStakeArgs['lockPeriod']
}

const CompXStakingStake = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling stake`)
    await props.typedClient.stake(
      {
        stakeTxn: props.stakeTxn,
        quantity: props.quantity,
        lockPeriod: props.lockPeriod,
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

export default CompXStakingStake