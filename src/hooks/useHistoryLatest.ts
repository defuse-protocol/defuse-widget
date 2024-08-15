"use client"

import { useState } from "react"
import * as borsh from "borsh"

import { HistoryData, HistoryStatus } from "@src/stores/historyStore"
import { useHistoryStore } from "@src/providers/HistoryStoreProvider"
import { intentStatus } from "@src/utils/near"
import { CONFIRM_SWAP_LOCAL_KEY } from "@src/constants/contracts"
import {
  NearIntent1CreateCrossChain,
  NearIntent1CreateSingleChain,
  NearIntentCreate,
  NearIntentStatus,
  NearTX,
  RecoverDetails,
  Result,
} from "@src/types/interfaces"
import { getNearTransactionDetails } from "@src/api/transaction"
import { useWalletSelector } from "@src/providers/WalletSelectorProvider"
import { useTransactionScan } from "@src/hooks/useTransactionScan"
import { swapSchema } from "@src/utils/schema"
import { ModalConfirmSwapPayload } from "@src/components/Modal/ModalConfirmSwap"
import { adapterIntent0, adapterIntent1 } from "@src/libs/de-sdk/utils/adapters"

const SCHEDULER_30_SEC = 30000
const SCHEDULER_5_SEC = 5000

function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch (e) {
    return false
  }
}

async function getIntent(
  receiverId: string,
  intentId: string
): Promise<HistoryStatus | null> {
  const getIntentStatus = (await intentStatus(
    receiverId,
    intentId
  )) as NearIntentStatus | null

  if (!getIntentStatus?.status) {
    return null
  }

  return getIntentStatus?.status === HistoryStatus.INTENT_1_AVAILABLE
    ? HistoryStatus.AVAILABLE
    : (getIntentStatus!.status as HistoryStatus)
}

export const useHistoryLatest = () => {
  const { accountId } = useWalletSelector()
  const { updateHistory, data } = useHistoryStore((state) => state)
  const [isHistoryWorkerSleeping, setIsHistoryWorkerSleeping] = useState(true)
  const { getTransactionScan } = useTransactionScan()
  const [isMonitoringComplete, setIsMonitoringComplete] = useState({
    cycle: 0,
    done: false,
  })

  const applyDataFromCreateIntent = (
    clientId: string
  ): Partial<HistoryData["details"]> => {
    const details: Partial<HistoryData["details"]> = {}
    if (data.size) {
      data.forEach((history) => {
        const method =
          history.details?.transaction?.actions[0].FunctionCall.method_name
        if (
          history.clientId === clientId &&
          (method === "ft_transfer_call" || method === "native_on_transfer")
        ) {
          Object.assign(details, {
            tokenIn: history.details?.tokenIn,
            tokenOut: history.details?.tokenOut,
            selectedTokenIn: history.details?.selectedTokenIn,
            selectedTokenOut: history.details?.selectedTokenOut,
          })
        }
      })
    }
    return details
  }

  const runHistoryMonitoring = async (data: HistoryData[]): Promise<void> => {
    const validHistoryStatuses: string[] = [
      ...adapterIntent0.completedStatuses,
      ...adapterIntent1.completedStatuses,
      HistoryStatus.FAILED,
      HistoryStatus.WITHDRAW,
      HistoryStatus.DEPOSIT,
      HistoryStatus.STORAGE_DEPOSIT,
    ]

    const historyCompletion: boolean[] = []
    const result: HistoryData[] = await Promise.all(
      data.map(async (historyData) => {
        if (
          (historyData?.status &&
            validHistoryStatuses.includes(historyData!.status ?? "")) ||
          historyData.errorMessage ||
          historyData.isClosed
        ) {
          historyCompletion.push(true)
          return historyData
        }

        if (!historyData.details?.receipts_outcome) {
          const { result } = (await getNearTransactionDetails(
            historyData.hash as string,
            accountId as string
          )) as Result<NearTX>
          if (result) {
            Object.assign(historyData, {
              details: {
                ...historyData.details,
                receipts_outcome: result.receipts_outcome,
                transaction: result.transaction,
              },
            })
          }
        }

        // Try to recover clientId and "Swap" data in case it was lost
        const getMethodName =
          historyData.details?.transaction?.actions.length &&
          historyData.details?.transaction?.actions[0].FunctionCall.method_name
        if (getMethodName && historyData.details?.transaction) {
          let getHashedArgs = ""
          let argsJson = ""
          let args: unknown
          let msgBase64 = ""
          let msgBuffer: Buffer
          let getIntentStatus: HistoryStatus | null
          let recoverData: unknown
          switch (getMethodName) {
            case "ft_transfer_call":
              getHashedArgs =
                historyData.details.transaction.actions[0].FunctionCall.args
              argsJson = Buffer.from(getHashedArgs ?? "", "base64").toString(
                "utf-8"
              )
              args = JSON.parse(argsJson)
              msgBase64 = (args as { msg: string }).msg

              if (isValidJSON(msgBase64)) {
                recoverData = JSON.parse(msgBase64)
              }
              if (recoverData === undefined) {
                msgBuffer = Buffer.from(msgBase64, "base64")
                const msgBorshDeserialize = borsh.deserialize(
                  swapSchema as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                  msgBuffer
                )
                recoverData = msgBorshDeserialize
              }

              const clientId =
                (recoverData as NearIntentCreate)?.CreateIntent?.id ||
                (recoverData as NearIntent1CreateCrossChain)?.id
              const recoverDetails =
                (recoverData as NearIntentCreate).CreateIntent ||
                (recoverData as NearIntent1CreateCrossChain)
              const sendAmount =
                (
                  recoverDetails as NearIntentCreate["CreateIntent"]
                )?.IntentStruct?.send?.amount.toString() ||
                (args as { amount: string })?.amount
              const receiveAmount =
                (
                  recoverDetails as unknown as NearIntentCreate["CreateIntent"]
                )?.IntentStruct?.receive?.amount.toString() ||
                (recoverDetails as unknown as NearIntent1CreateCrossChain)
                  ?.asset_out?.amount
              const expiration = {
                Block:
                  (
                    recoverDetails as unknown as NearIntentCreate["CreateIntent"]
                  )?.IntentStruct?.expiration?.Block.toString() ||
                  (
                    recoverDetails as unknown as NearIntent1CreateCrossChain
                  )?.expiration?.block_number.toString(),
              }

              Object.assign(historyData, {
                clientId,
                details: {
                  ...historyData.details,
                  recoverDetails: {
                    ...recoverDetails,
                    send: {
                      ...(recoverDetails as unknown as RecoverDetails).send,
                      amount: sendAmount,
                    },
                    receive: {
                      ...(recoverDetails as unknown as RecoverDetails).receive,
                      amount: receiveAmount,
                    },
                    expiration,
                    receiverId: (args as { receiver_id: string })?.receiver_id,
                  },
                },
              })

              getIntentStatus = await getIntent(
                (args as { receiver_id: string }).receiver_id,
                historyData.clientId
              )
              if (getIntentStatus) {
                Object.assign(historyData, {
                  status: getIntentStatus,
                })
              }
              break

            case "rollback_intent":
              getHashedArgs =
                historyData.details.transaction.actions[0].FunctionCall.args
              argsJson = Buffer.from(getHashedArgs ?? "", "base64").toString(
                "utf-8"
              )
              args = JSON.parse(argsJson)
              Object.assign(historyData, {
                details: {
                  ...historyData.details,
                  ...applyDataFromCreateIntent((args as { id: string }).id),
                },
                clientId: (args as { id: string }).id,
                status: HistoryStatus.ROLLED_BACK,
              })
              break

            case "near_deposit":
              getHashedArgs =
                historyData.details.transaction.actions[0].FunctionCall.args
              argsJson = Buffer.from(getHashedArgs ?? "", "base64").toString(
                "utf-8"
              )
              const logMsg = historyData.details?.receipts_outcome
                ? historyData.details?.receipts_outcome[0]!.outcome!.logs[0]
                : undefined
              Object.assign(historyData, {
                status: HistoryStatus.DEPOSIT,
                details: {
                  ...historyData.details,
                  recoverDetails: {
                    msg: logMsg,
                  },
                },
              })
              break

            case "near_withdraw":
              getHashedArgs =
                historyData.details.transaction.actions[0].FunctionCall.args
              argsJson = Buffer.from(getHashedArgs ?? "", "base64").toString(
                "utf-8"
              )
              args = JSON.parse(argsJson)
              Object.assign(historyData, {
                status: HistoryStatus.WITHDRAW,
                details: {
                  ...historyData.details,
                  recoverDetails: {
                    amount: (args as { amount: string }).amount,
                  },
                },
              })
              break

            case "storage_deposit":
              Object.assign(historyData, {
                status: HistoryStatus.STORAGE_DEPOSIT,
              })
              break

            case "native_on_transfer":
              getHashedArgs =
                historyData.details.transaction.actions[0].FunctionCall.args
              argsJson = Buffer.from(getHashedArgs ?? "", "base64").toString(
                "utf-8"
              )
              args = JSON.parse(argsJson)
              msgBase64 = (args as { msg: string }).msg
              recoverData = JSON.parse(msgBase64)
              Object.assign(historyData, {
                clientId: (recoverData as NearIntent1CreateSingleChain)?.id,
                details: {
                  ...historyData.details,
                  recoverDetails: {
                    ...(recoverData as NearIntent1CreateSingleChain),
                    receive: {
                      amount: (recoverData as NearIntent1CreateSingleChain)
                        ?.asset_out?.amount,
                    },
                    expiration: (recoverData as NearIntent1CreateSingleChain)
                      .expiration.block_number,
                    receiverId: historyData.details.transaction.receiver_id,
                  },
                },
              })

              getIntentStatus = await getIntent(
                historyData.details.transaction.receiver_id,
                historyData.clientId
              )
              if (getIntentStatus) {
                Object.assign(historyData, {
                  status: getIntentStatus,
                })
              }
              break
          }
        }

        // Extract data from local
        if (
          !historyData.details?.selectedTokenIn ||
          !historyData.details?.selectedTokenOut ||
          !historyData.details?.tokenIn ||
          !historyData.details?.tokenOut
        ) {
          const getConfirmSwapFromLocal = localStorage.getItem(
            CONFIRM_SWAP_LOCAL_KEY
          )
          if (getConfirmSwapFromLocal) {
            const parsedData: { data: ModalConfirmSwapPayload } = JSON.parse(
              getConfirmSwapFromLocal
            )
            if (parsedData.data.clientId === historyData.clientId) {
              Object.assign(historyData, {
                details: {
                  ...historyData.details,
                  tokenIn: parsedData.data.tokenIn,
                  tokenOut: parsedData.data.tokenOut,
                  selectedTokenIn: parsedData.data.selectedTokenIn,
                  selectedTokenOut: parsedData.data.selectedTokenOut,
                },
              })
            }
          }
        }

        const { isFailure } = await getTransactionScan(
          historyData!.details as NearTX
        )
        if (isFailure) {
          historyCompletion.push(true)
          Object.assign(historyData, { status: HistoryStatus.FAILED })
          return historyData
        }

        historyCompletion.push(false)
        return historyData
      })
    )

    updateHistory(result)

    if (!historyCompletion.includes(false)) {
      setIsHistoryWorkerSleeping(true)
      setIsMonitoringComplete({
        ...isMonitoringComplete,
        done: true,
      })
      return
    }

    setTimeout(() => {
      console.log("useHistoryLatest next run: ", isMonitoringComplete.cycle)
      setIsMonitoringComplete({
        ...isMonitoringComplete,
        cycle: isMonitoringComplete.cycle++,
      })
      runHistoryMonitoring(result)
    }, SCHEDULER_5_SEC)
  }

  const runHistoryUpdate = (data: HistoryData[]): void => {
    setIsHistoryWorkerSleeping(false)
    void runHistoryMonitoring(data)
  }

  return {
    runHistoryUpdate,
    isHistoryWorkerSleeping,
    isMonitoringComplete,
  }
}
