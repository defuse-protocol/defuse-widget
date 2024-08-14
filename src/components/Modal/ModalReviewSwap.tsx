"use client"

import { Blockquote, Text } from "@radix-ui/themes"
import Image from "next/image"
import React, { useEffect, useState } from "react"
import { formatUnits, parseUnits } from "viem"

import ModalDialog from "@src/components/Modal/ModalDialog"
import {
  NetworkToken,
  TokenNativeEnum,
  TokenNetworkEnum,
} from "@src/types/interfaces"
import { useModalStore } from "@src/providers/ModalStoreProvider"
import Button from "@src/components/Button/Button"
import CardSwap from "@src/components/Card/CardSwap"
import { ModalType } from "@src/stores/modalStore"
import { useTimer } from "@src/hooks/useTimer"
import { useTimeFormatMinutes } from "@src/hooks/useTimeFormat"
import useSwapEstimateBot from "@src/hooks/useSwapEstimateBot"
import { smallBalanceToFormat } from "@src/utils/token"
import { useAccountBalance } from "@src/hooks/useAccountBalance"

export type ModalReviewSwapPayload = {
  tokenIn: string
  tokenOut: string
  selectedTokenIn: NetworkToken
  selectedTokenOut: NetworkToken
  isNativeInSwap: boolean
  accountFrom?: string
  accountTo?: string
  solverId?: string
}

const RECALCULATE_ESTIMATION_TIME_SECS = 15

const ModalReviewSwap = () => {
  const { onCloseModal, setModalType, payload } = useModalStore(
    (state) => state
  )
  const { getAccountBalance } = useAccountBalance()
  const { getSwapEstimateBot, isFetching } = useSwapEstimateBot()

  const [convertPayload, setConvertPayload] = useState<ModalReviewSwapPayload>(
    payload as ModalReviewSwapPayload
  )
  const [isWNearConjunctionRequired, setIsWNearConjunctionRequired] =
    useState(false)

  const recalculateEstimation = async () => {
    const pair = [
      convertPayload.selectedTokenIn.address as string,
      convertPayload.selectedTokenOut.address as string,
    ]
    // Not needed recalculation if ratio is 1:1
    if (pair.includes("native") && pair.includes("wrap.near")) return

    handleCheckNativeBalance()

    const unitsTokenIn = parseUnits(
      convertPayload.tokenIn,
      convertPayload.selectedTokenIn.decimals as number
    ).toString()

    const { bestEstimate } = await getSwapEstimateBot({
      tokenIn: convertPayload.selectedTokenIn.defuse_asset_id,
      tokenOut: convertPayload.selectedTokenOut.defuse_asset_id,
      amountIn: unitsTokenIn,
    })
    if (bestEstimate === null) return
    const formattedOut =
      bestEstimate !== null
        ? formatUnits(
            BigInt(bestEstimate.amount_out),
            convertPayload.selectedTokenOut.decimals!
          )
        : "0"
    setConvertPayload({ ...convertPayload, tokenOut: formattedOut })
  }

  const { timeLeft } = useTimer(
    RECALCULATE_ESTIMATION_TIME_SECS,
    recalculateEstimation
  )
  const { formatTwoNumbers } = useTimeFormatMinutes()

  const handleCheckNativeBalance = async (): Promise<void> => {
    const [network, chain, token] =
      convertPayload.selectedTokenIn.defuse_asset_id.split(":")
    if (network !== TokenNetworkEnum.Near || token !== TokenNativeEnum.Native) {
      return
    }
    const { balance } = await getAccountBalance()
    const formattedAmountOut = formatUnits(
      BigInt(balance),
      convertPayload.selectedTokenIn?.decimals ?? 0
    )
    const isLackOfBalance = convertPayload.tokenIn > formattedAmountOut
    setIsWNearConjunctionRequired(isLackOfBalance)
  }

  const handleConfirmSwap = async () => {
    setModalType(ModalType.MODAL_CONFIRM_SWAP, payload)
  }

  useEffect(() => {
    void handleCheckNativeBalance()
  }, [])

  return (
    <ModalDialog>
      <div className="flex flex-col min-h-[256px] max-h-[680px] h-full p-5">
        <div className="flex justify-between items-center mb-[44px]">
          <div className="relative w-full shrink text-center text-black-400">
            <Text size="4" weight="bold" className="dark:text-gray-500">
              Review swap
            </Text>
            <div className="absolute top-[30px] left-[50%] -translate-x-2/4 text-gray-600">
              <Text size="2" weight="medium">
                00:{formatTwoNumbers(timeLeft)}
              </Text>
            </div>
          </div>
          <button className="shrink-0" onClick={onCloseModal}>
            <Image
              src="/static/icons/close.svg"
              alt="Close Icon"
              width={14}
              height={14}
            />
          </button>
        </div>
        <CardSwap
          amountIn={smallBalanceToFormat(convertPayload.tokenIn, 7)}
          amountOut={smallBalanceToFormat(convertPayload.tokenOut, 7)}
          amountOutToUsd="~"
          amountInToUsd="~"
          selectTokenIn={convertPayload.selectedTokenIn}
          selectTokenOut={convertPayload.selectedTokenOut}
        />
        <div className="flex flex-col w-full mb-6 gap-3">
          <div className="flex justify-between items-center">
            <Text size="2" weight="medium" className="text-gray-600">
              Fee
            </Text>
            <div className="px-2.5 py-1 rounded-full bg-green-100">
              <Text size="2" weight="medium" className="text-green">
                Free
              </Text>
            </div>
          </div>
          <div className="flex justify-between items-center gap-3">
            <Text size="2" weight="medium" className="text-gray-600">
              Estimated time
            </Text>
            <Text size="2" weight="medium">
              ~ 2 min
            </Text>
          </div>
          <div className="flex justify-between items-center gap-3">
            <Text size="2" weight="medium" className="text-gray-600">
              Rate
            </Text>
            <div className="flex justify-center items-center gap-2">
              <Text size="2" weight="medium">
                1
              </Text>
              <Text size="2" weight="medium">
                {convertPayload.selectedTokenIn.symbol}
              </Text>
              =
              <Text size="2" weight="medium">
                {(
                  Number(convertPayload.tokenOut) /
                  Number(convertPayload.tokenIn)
                ).toFixed(4)}
              </Text>
              <Text size="2" weight="medium">
                {convertPayload.selectedTokenOut.symbol}
              </Text>
            </div>
          </div>
        </div>
        {isWNearConjunctionRequired && (
          <div className="flex flex-col w-full mb-6 gap-3">
            <Blockquote color="cyan">
              Wrapped Near will be used in conjunction with Near to boost your
              current swap experience.
            </Blockquote>
          </div>
        )}
        <Button
          size="lg"
          fullWidth
          onClick={handleConfirmSwap}
          isLoading={isFetching}
        >
          Confirm swap
        </Button>
      </div>
    </ModalDialog>
  )
}

export default ModalReviewSwap
