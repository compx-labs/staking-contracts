/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingAddRewards
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call addRewards"
  typedClient={typedClient}
  rewardTxn={rewardTxn}
  quantity={quantity}
/>
*/
type CompXStakingAddRewardsArgs = CompXStaking['methods']['addRewards(axfer,uint64)void']['argsObj']

type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
  rewardTxn: CompXStakingAddRewardsArgs['rewardTxn']
  quantity: CompXStakingAddRewardsArgs['quantity']
}

const CompXStakingAddRewards = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling addRewards`)
    await props.typedClient.addRewards(
      {
        rewardTxn: props.rewardTxn,
        quantity: props.quantity,
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

export default CompXStakingAddRewards