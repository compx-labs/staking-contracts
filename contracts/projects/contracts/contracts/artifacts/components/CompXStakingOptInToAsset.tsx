/* eslint-disable no-console */
import { ReactNode, useState } from 'react'
import { CompXStaking, CompXStakingClient } from '../contracts/CompXStakingClient'
import { useWallet } from '@txnlab/use-wallet'

/* Example usage
<CompXStakingOptInToAsset
  buttonClass="btn m-2"
  buttonLoadingNode={<span className="loading loading-spinner" />}
  buttonNode="Call optInToAsset"
  typedClient={typedClient}
  mbrTxn={mbrTxn}
/>
*/
type CompXStakingOptInToAssetArgs = CompXStaking['methods']['optInToAsset(pay)void']['argsObj']

type Props = {
  buttonClass: string
  buttonLoadingNode?: ReactNode
  buttonNode: ReactNode
  typedClient: CompXStakingClient
  mbrTxn: CompXStakingOptInToAssetArgs['mbrTxn']
}

const CompXStakingOptInToAsset = (props: Props) => {
  const [loading, setLoading] = useState<boolean>(false)
  const { activeAddress, signer } = useWallet()
  const sender = { signer, addr: activeAddress! }

  const callMethod = async () => {
    setLoading(true)
    console.log(`Calling optInToAsset`)
    await props.typedClient.optInToAsset(
      {
        mbrTxn: props.mbrTxn,
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

export default CompXStakingOptInToAsset