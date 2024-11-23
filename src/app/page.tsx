'use client'

import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage, useWriteContract } from 'wagmi'
import { uniq } from "lodash"
import abi from "./abi.json"

function App() {
  const account = useAccount()
  const { connectors, connect, status, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()

  const [itemIds, setItemIds] = useState<string[]>([])
  const [signature, setSignature] = useState<string | null>(null)
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  
  const [totalLeft, setTotalLeft] = useState<Number>()

  const isFetchingEthscriptions = useRef(false) // Track operation state

  function nB(e: string[]) {
    const r = e.join(", ")
    const i = new Date()
    const o = (Math.floor(i.getTime() / 6e5) + 2) * 6e5
    const a = new Date(o).toISOString()
    const s = `

Signing this message does not cost gas. 

This signature expires at: ${a}`
    return `I would like to withdraw the following item${e.length > 1 ? "s" : ""}: ${r} ${s}`
  }

  const getEthscriptions = useCallback(async (address: `0x${string}`, continuation?: string, ethscriptions: any[] = []) => {
    let url = `https://api.ordex.io/v0.1/items/byOwner?owner=ETHEREUM:${address}`
    if (continuation) {
      url += `&continuation=${continuation}`
    }

    const res = await axios.get(url)

    if (res.data.continuation && res.data.total === 50) {
      return getEthscriptions(address, res.data.continuation, [...ethscriptions, ...res.data.items])
    }

    return [...ethscriptions, ...res.data.items]
  }, [])
  
  const getStillEscrowedIds = useCallback(async (escrowedIds: string[]) => {
    if (escrowedIds.length) {
      const chunkSize = 100; // Number of IDs per request
      const chunks = [];

      // Split the escrowedIds into chunks of size 100
      for (let i = 0; i < escrowedIds.length; i += chunkSize) {
        chunks.push(escrowedIds.slice(i, i + chunkSize));
      }

      let stillEscrowedIds: string[] = [];

      // Make requests for each chunk and accumulate totals
      for (const chunk of chunks) {
        const response = await axios.get(`https://api.ethscriptions.com/api/ethscriptions/filtered`, {
          params: {
            transaction_hash: JSON.stringify(chunk),
            current_owner: "0xc33f8610941be56fb0d84e25894c0d928cc97dde",
            page: 1
          }
        });
        
        stillEscrowedIds = [...stillEscrowedIds, ...response.data.ethscriptions.map((ethscription: any) => ethscription.transaction_hash)]
      }

      setTotalLeft(stillEscrowedIds.length);
      
      return stillEscrowedIds;
    }
    return []
  }, [])

  useEffect(() => {
    if (account.address && !isFetchingEthscriptions.current) {
      isFetchingEthscriptions.current = true; // Set flag to true
      setIsLoading(true);
        
      (async () => {
        try {
          if (account.address) {
            const ethscriptions = await getEthscriptions(account.address);
            const escrowed = ethscriptions.filter(ethscription => ethscription.extension.escrowState !== "EMPTY");
            const escrowedIds = escrowed.map(ethscription => ethscription.id.split(":")[1]);
      
            if (escrowedIds.length) {
              await getStillEscrowedIds(escrowedIds)
            } else {
              setTotalLeft(0);
            }
      
            setItemIds(escrowedIds);
            setIsLoading(false);
          }
        } catch (err) {
          console.error("Error fetching ethscriptions:", err);
        } finally {
          isFetchingEthscriptions.current = false; // Reset flag
        }
      })();      
    }
  }, [account.address, getEthscriptions, getStillEscrowedIds])

  const handleSignMessage = async () => {
    setSignature(null)

    try {
      const stillEscrowedIds = await getStillEscrowedIds(itemIds)
      
      const message = nB(stillEscrowedIds)
      setGeneratedMessage(message)

      const signedMessage = await signMessageAsync({ message })
      setSignature(signedMessage)

      const res = await axios.post("https://api-next.ordex.io/signer/s/wc", {
        client: account.address,
        itemIds: stillEscrowedIds,
        clientSignature: signedMessage,
      })

      const { confirmation, sig } = res.data
      const { from, to, ids } = confirmation
      const { expiryTimestamp, v, r, s } = sig

      const confirmation_obj = { from, to, ids }
      const signature = { expiryTimestamp: parseInt(expiryTimestamp), v, r, s }

      const txn = await writeContractAsync({
        abi: abi,
        address: "0xC33F8610941bE56fB0d84E25894C0d928CC97ddE",
        functionName: "bulkWithdrawItems",
        args: [confirmation_obj, signature],
      })

      console.log(txn)
    } catch (err: any) {
      console.error(err?.response?.data)
    }
  }

  return (
    <>
      <div>
        <h2>Account</h2>
        <div>
          status: {account.status}
          <br />
          addresses: {JSON.stringify(account.addresses)}
          <br />
          chainId: {account.chainId}
        </div>
        {account.status === 'connected' && (
          <button type="button" onClick={() => disconnect()}>
            Disconnect
          </button>
        )}
      </div>
      <div>
        <h2>Connect</h2>
        {connectors.map(connector => (
          <button key={connector.uid} onClick={() => connect({ connector })} type="button">
            {connector.name}
          </button>
        ))}
        <div>{status}</div>
        <div>{error?.message}</div>
      </div>
      {account.isConnected && isLoading && (
        <div style={{ marginTop: '20px' }}>
          Aggregating your escrowed Ethscriptions...
        </div>
      )}
      {totalLeft !== undefined && <h2>{`${totalLeft}`} remaining</h2>}
      {account.isConnected && !isLoading && !!totalLeft && (
        <div style={{ marginTop: '20px' }}>
          <h2>Sign Message</h2>
          <button onClick={handleSignMessage} style={{ marginBottom: '10px' }}>
            Create Signature
          </button>
          {generatedMessage && (
            <div>
              <h3>Generated Message:</h3>
              <pre>{generatedMessage}</pre>
            </div>
          )}
          {signature && (
            <div>
              <h3>Signature:</h3>
              <pre>{signature}</pre>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default App
