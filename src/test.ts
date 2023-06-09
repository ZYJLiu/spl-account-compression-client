import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import { getOrCreateKeypair, airdropSolIfNeeded } from "./utils"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  ValidDepthSizePair,
  createAllocTreeIx,
  SPL_NOOP_PROGRAM_ID,
  ConcurrentMerkleTreeAccount,
  deserializeChangeLogEventV1,
  createInitEmptyMerkleTreeIx,
  createAppendIx,
} from "@solana/spl-account-compression"
import base58 from "bs58"
import crypto from "crypto"

describe("Test Wallets", () => {
  // Helius devnet RPC URL
  const rpcUrl = process.env.RPC_URL

  // Connection to the devnet cluster
  // const connection = new Connection(rpcUrl, "confirmed")
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed")

  // New keypair that will be used to create the tree account
  const treeKeypair = Keypair.generate()

  // Declare wallet variable names
  let payer: Keypair
  let wallet_2: Keypair

  before(async () => {
    // Use existing keypairs or generate new ones if they don't exist
    payer = await getOrCreateKeypair("wallet_1")
    wallet_2 = await getOrCreateKeypair("wallet_2")

    // Request an airdrop of SOL to wallet_1 if its balance is less than 1 SOL
    await airdropSolIfNeeded(payer.publicKey)

    console.log(`\n`)
  })

  it("Create Tree", async () => {
    const maxDepthSizePair: ValidDepthSizePair = {
      maxDepth: 3, // 2^maxDepth = maximum number of nodes in the tree
      maxBufferSize: 8, // determines maximum number of concurrent updates that can be applied to the tree in a single slot
    }

    const canopyDepth = 0

    const allocTreeIx = await createAllocTreeIx(
      connection,
      treeKeypair.publicKey, // The address of the tree account to create
      payer.publicKey, // The account that will pay for the transaction
      maxDepthSizePair, // The tree size parameters
      canopyDepth // The amount of proof stored on chain
    )

    const initTreeIx = await createInitEmptyMerkleTreeIx(
      treeKeypair.publicKey, // The address of the tree account to initialize
      payer.publicKey, // authority of the tree account
      maxDepthSizePair // The tree size parameters
    )

    try {
      // Create new transaction and add the instructions
      const tx = new Transaction().add(allocTreeIx, initTreeIx)

      // Set the fee payer for the transaction
      tx.feePayer = payer.publicKey

      // Send the transaction
      const txSignature = await sendAndConfirmTransaction(
        connection,
        tx,
        [treeKeypair, payer], // treeKeypair must be included as a signer because the publickey is used as the address of the tree account being created
        {
          commitment: "confirmed",
          skipPreflight: true,
        }
      )

      console.log(
        `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
      )
    } catch (err: any) {
      console.error("\nFailed to create merkle tree:", err)

      throw err
    }
  })

  it("Append Leaf", async () => {
    const leafData = "hello world"

    // Convert the leafData string to a buffer
    const serializedLeafData = Buffer.from(leafData)

    // Hash the leaf data
    const hashedLeafData = crypto
      .createHash("sha3-256")
      .update(serializedLeafData)
      .digest()

    // Create a no-op instruction to log the original leaf data
    const noopIx = new TransactionInstruction({
      keys: [],
      programId: SPL_NOOP_PROGRAM_ID,
      data: serializedLeafData,
    })

    // Create an instruction to append the hashed leaf data to the tree
    const appendIx = await createAppendIx(
      treeKeypair.publicKey, // The address of the tree account to append to
      payer.publicKey, // authority of the tree account
      hashedLeafData
    )

    try {
      // Create new transaction and add the instructions
      const tx = new Transaction().add(noopIx, appendIx)

      // Send the transaction
      const txSignature = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer],
        {
          commitment: "confirmed",
          skipPreflight: true,
        }
      )

      console.log(
        `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
      )

      // get the transaction info using the tx signature
      const txInfo = await connection.getTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
      })

      const noopLog = txInfo.transaction.message.compiledInstructions[0].data
      console.log("leaf data:", noopLog.toString())

      // Try to decode and deserialize the instruction
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(
          base58.decode(txInfo.meta.innerInstructions?.[0].instructions[0].data)
        )
      )

      console.log("index: ", changeLogEvent.index)
    } catch (err: any) {
      console.error("\n", err)

      throw err
    }
  })
})
