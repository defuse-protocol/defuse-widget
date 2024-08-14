"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { FieldValues, useForm } from "react-hook-form"
import { formatUnits, parseUnits } from "viem"

import Paper from "@src/components/Paper"
import Form from "@src/components/Form"
import FieldComboInput from "@src/components/Form/FieldComboInput"
import Button from "@src/components/Button/Button"
import ButtonSwitch from "@src/components/Button/ButtonSwitch"
import { CONFIRM_SWAP_LOCAL_KEY } from "@src/constants/contracts"
import { useModalStore } from "@src/providers/ModalStoreProvider"
import { ModalType } from "@src/stores/modalStore"
import { NetworkToken, NetworkTokenWithSwapRoute } from "@src/types/interfaces"
import { ModalSelectAssetsPayload } from "@src/components/Modal/ModalSelectAssets"
import useSwapEstimateBot from "@src/hooks/useSwapEstimateBot"
import { debounce } from "@src/utils/debounce"
import { useModalSearchParams } from "@src/hooks/useModalSearchParams"
import { useCalculateTokenToUsd } from "@src/hooks/useCalculateTokenToUsd"
import { useTokensStore } from "@src/providers/TokensStoreProvider"
import { ModalConfirmSwapPayload } from "@src/components/Modal/ModalConfirmSwap"
import { useEvaluateSwapEstimation } from "@src/hooks/useEvaluateSwapEstimation"
import BlockEvaluatePrice from "@src/components/Block/BlockEvaluatePrice"
import { useConnectWallet } from "@src/hooks/useConnectWallet"
import { useWalletSelector } from "@src/providers/WalletSelectorProvider"
import { useSwapGuard } from "@src/hooks/useSwapGuard"

type FormValues = {
  tokenIn: string
  tokenOut: string
}

type SelectToken = NetworkToken | undefined

type EstimateSwap = {
  tokenIn: string
  tokenOut: string
  name: string
  selectTokenIn: SelectToken
  selectTokenOut: SelectToken
}

const ESTIMATE_BOT_AWAIT_MS = 500

export default function Swap() {
  const [selectTokenIn, setSelectTokenIn] = useState<SelectToken>()
  const [selectTokenOut, setSelectTokenOut] = useState<SelectToken>()
  const [errorSelectTokenIn, setErrorSelectTokenIn] = useState("")
  const [errorSelectTokenOut, setErrorSelectTokenOut] = useState("")
  const { accountId } = useWalletSelector()
  const {
    priceToUsd: priceToUsdTokenIn,
    calculateTokenToUsd: calculateTokenToUsdTokenIn,
  } = useCalculateTokenToUsd()
  const {
    priceToUsd: priceToUsdTokenOut,
    calculateTokenToUsd: calculateTokenToUsdTokenOut,
  } = useCalculateTokenToUsd()
  const { data, isFetched, isLoading } = useTokensStore((state) => state)
  const { data: evaluateSwapEstimation, getEvaluateSwapEstimate } =
    useEvaluateSwapEstimation()
  const { handleSignIn } = useConnectWallet()

  const {
    handleSubmit,
    register,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<FormValues>()
  const { setModalType, payload, onCloseModal } = useModalStore(
    (state) => state
  )
  const { bestEstimate, allEstimates, getSwapEstimateBot, isFetching } =
    useSwapEstimateBot()
  const isProgrammaticUpdate = useRef(false)
  useModalSearchParams()
  const { handleValidateInputs, errorMsg } = useSwapGuard()

  const handleResetToken = (
    token: NetworkToken,
    checkToken: NetworkToken,
    setSelectToken: (value?: NetworkToken) => void
  ): boolean => {
    if (token.defuse_asset_id === checkToken?.defuse_asset_id) {
      setSelectToken(undefined)
      return true
    }
    return false
  }

  const handleValidateSelectTokens = (): boolean => {
    let isValid = true
    if (!selectTokenIn) {
      isValid = false
      setErrorSelectTokenIn("Select token is required")
    }
    if (!selectTokenOut) {
      isValid = false
      setErrorSelectTokenOut("Select token is required")
    }
    return isValid
  }

  const onSubmit = async (values: FieldValues) => {
    if (errorMsg) {
      return
    }
    if (!accountId) {
      return handleSignIn()
    }
    if (!handleValidateSelectTokens()) return
    const isForeignChainInSwap = [
      selectTokenIn?.defuse_asset_id ?? "",
      selectTokenOut?.defuse_asset_id ?? "",
    ].some((defuseAssetId) => {
      const keys = defuseAssetId.split(":")
      if (keys.length) {
        const [chain] = keys
        return chain !== "near"
      }
      return false
    })
    setModalType(
      isForeignChainInSwap
        ? ModalType.MODAL_CONNECT_NETWORKS
        : ModalType.MODAL_REVIEW_SWAP,
      {
        tokenIn: values.tokenIn,
        tokenOut: values.tokenOut,
        selectedTokenIn: selectTokenIn,
        selectedTokenOut: selectTokenOut,
        solverId: bestEstimate?.solver_id || "",
      }
    )
  }

  const handleSwitch = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (isFetching) {
      return
    }
    const tempTokenInCopy = Object.assign({}, selectTokenIn)
    setSelectTokenIn(selectTokenOut)
    setSelectTokenOut(tempTokenInCopy)

    // Use isProgrammaticUpdate as true to prevent unnecessary estimate
    const valueTokenIn = getValues("tokenIn")
    const valueTokenOut = getValues("tokenOut")
    isProgrammaticUpdate.current = true
    setValue("tokenIn", valueTokenOut)
    isProgrammaticUpdate.current = true
    setValue("tokenOut", valueTokenIn)
  }

  const handleSelect = (fieldName: string, selectToken: SelectToken) => {
    setModalType(ModalType.MODAL_SELECT_ASSETS, { fieldName, selectToken })
  }

  const debouncedGetSwapEstimateBot = useCallback(
    debounce(
      async (
        tokenIn: NetworkToken,
        tokenOut: NetworkToken,
        amountIn: string
      ) => {
        const data = {
          tokenIn: tokenIn.defuse_asset_id,
          tokenOut: tokenOut.defuse_asset_id,
          amountIn: parseUnits(amountIn, tokenIn?.decimals ?? 0).toString(),
        }
        const { bestEstimate } = await getSwapEstimateBot(data)

        handleValidateInputs({
          tokenIn: amountIn as string,
          tokenOut: (bestEstimate?.amount_out as string) ?? "0",
          selectTokenIn: tokenIn as NetworkTokenWithSwapRoute,
          selectTokenOut: tokenOut as NetworkTokenWithSwapRoute,
        })

        if (bestEstimate === null) {
          isProgrammaticUpdate.current = true
          setValue("tokenOut", "")
          return
        }
        getEvaluateSwapEstimate(
          tokenIn,
          tokenOut,
          amountIn,
          bestEstimate.amount_out
        )
        isProgrammaticUpdate.current = true
        const formattedOut =
          bestEstimate.amount_out !== null
            ? formatUnits(BigInt(bestEstimate.amount_out), tokenOut.decimals!)
            : "0"
        setValue("tokenOut", formattedOut)
        trigger("tokenOut")
      },
      ESTIMATE_BOT_AWAIT_MS
    ),
    []
  )

  const handleEstimateSwap = ({
    tokenIn,
    tokenOut,
    name,
    selectTokenIn,
    selectTokenOut,
  }: EstimateSwap) => {
    if (
      (name === "tokenIn" && !parseFloat(tokenIn)) ||
      !selectTokenIn ||
      !selectTokenOut
    ) {
      return
    }

    // Do not use any estimation of swap between Native and Token if ratio is 1:1
    const pair = [selectTokenIn.address, selectTokenOut.address]
    if (pair.includes("native") && pair.includes("wrap.near")) {
      isProgrammaticUpdate.current = true
      return setValue(
        name === "tokenIn" ? "tokenOut" : "tokenIn",
        name === "tokenIn" ? tokenIn : tokenOut
      )
    }

    debouncedGetSwapEstimateBot(selectTokenIn, selectTokenOut, tokenIn)
  }

  useEffect(() => {
    if (!selectTokenIn && !selectTokenOut) {
      const getConfirmSwapFromLocal = localStorage.getItem(
        CONFIRM_SWAP_LOCAL_KEY
      )
      if (getConfirmSwapFromLocal) {
        const parsedData: { data: ModalConfirmSwapPayload } = JSON.parse(
          getConfirmSwapFromLocal
        )
        const cleanBalance = {
          balance: 0,
          balanceToUsd: 0,
          convertedLast: 0,
        }
        setSelectTokenIn(
          Object.assign(parsedData.data.selectedTokenIn, cleanBalance)
        )
        setSelectTokenOut(
          Object.assign(parsedData.data.selectedTokenOut, cleanBalance)
        )
        return
      }
      if (data.size) {
        data.forEach((token) => {
          if (token.address === "near") {
            setSelectTokenIn(token)
          }
          if (token.address === "usdt") {
            setSelectTokenOut(token)
          }
        })
        return
      }
    }
    // Do evaluate usd select tokens prices
    if (data.size && !isLoading) {
      data.forEach((token) => {
        if (selectTokenIn?.defuse_asset_id === token.defuse_asset_id) {
          setSelectTokenIn(token)
        }
        if (selectTokenOut?.defuse_asset_id === token.defuse_asset_id) {
          setSelectTokenOut(token)
        }
      })
    }
  }, [data, isFetched, isLoading])

  useEffect(() => {
    const subscription = watch((value, { name }) => {
      if (isProgrammaticUpdate.current) {
        isProgrammaticUpdate.current = false
        return
      }
      calculateTokenToUsdTokenIn(value.tokenIn as string, selectTokenIn)
      calculateTokenToUsdTokenOut(value.tokenOut as string, selectTokenOut)
      handleEstimateSwap({
        tokenIn: String(value.tokenIn),
        tokenOut: String(value.tokenOut),
        name: name as string,
        selectTokenIn,
        selectTokenOut,
      })
    })
    return () => subscription.unsubscribe()
  }, [watch, selectTokenIn, selectTokenOut, getSwapEstimateBot, setValue])

  useEffect(() => {
    // Use to calculate when selectTokenIn or selectTokenOut is changed
    const valueTokenIn = getValues("tokenIn")
    const valueTokenOut = getValues("tokenOut")
    calculateTokenToUsdTokenIn(valueTokenIn, selectTokenIn)
    calculateTokenToUsdTokenOut(valueTokenOut, selectTokenOut)

    // Use watch to calculate when input is changed
    const subscription = watch((value) => {
      calculateTokenToUsdTokenIn(value.tokenIn as string, selectTokenIn)
      calculateTokenToUsdTokenOut(value.tokenOut as string, selectTokenOut)
    })
    return () => subscription.unsubscribe()
  }, [watch, selectTokenIn, selectTokenOut])

  useEffect(() => {
    if (
      (payload as ModalSelectAssetsPayload)?.modalType !==
      ModalType.MODAL_SELECT_ASSETS
    ) {
      return
    }
    const { modalType, fieldName, token } = payload as ModalSelectAssetsPayload
    if (modalType === ModalType.MODAL_SELECT_ASSETS && fieldName && token) {
      switch (fieldName) {
        case "tokenIn":
          setSelectTokenIn(token)
          const isSelectTokenOutReset = handleResetToken(
            token,
            selectTokenOut as NetworkToken,
            setSelectTokenOut
          )
          isSelectTokenOutReset && setValue("tokenOut", "")
          !isSelectTokenOutReset &&
            handleEstimateSwap({
              tokenIn: getValues("tokenIn"),
              tokenOut: "",
              name: "tokenIn",
              selectTokenIn: token,
              selectTokenOut,
            })
          isProgrammaticUpdate.current = false
          setErrorSelectTokenIn("")
          break
        case "tokenOut":
          setSelectTokenOut(token)
          const isSelectTokenInReset = handleResetToken(
            token,
            selectTokenIn as NetworkToken,
            setSelectTokenIn
          )
          isSelectTokenInReset && setValue("tokenIn", "")
          !isSelectTokenInReset &&
            handleEstimateSwap({
              tokenIn: getValues("tokenIn"),
              tokenOut: "",
              name: "tokenIn",
              selectTokenIn,
              selectTokenOut: token,
            })
          isProgrammaticUpdate.current = false
          setErrorSelectTokenOut("")
          break
      }
      onCloseModal(undefined)
    }
  }, [payload, selectTokenIn, selectTokenOut])

  return (
    <Paper
      title="Swap"
      description="Cross-chain swap across any network, any token."
    >
      <Form<FormValues>
        handleSubmit={handleSubmit(onSubmit)}
        register={register}
      >
        <FieldComboInput<FormValues>
          fieldName="tokenIn"
          price={priceToUsdTokenIn}
          balance={selectTokenIn?.balance?.toString()}
          selected={selectTokenIn as NetworkToken}
          handleSelect={() => handleSelect("tokenIn", selectTokenOut)}
          className="border rounded-t-xl md:max-w-[472px]"
          required="This field is required"
          errors={errors}
          errorSelect={errorSelectTokenIn}
        />
        <div className="relative w-full">
          <ButtonSwitch onClick={handleSwitch} />
        </div>
        <FieldComboInput<FormValues>
          fieldName="tokenOut"
          price={Number(getValues("tokenOut")) > 0 ? priceToUsdTokenOut : "0"}
          label={
            <BlockEvaluatePrice
              priceEvaluation={evaluateSwapEstimation?.priceEvaluation}
              priceResults={allEstimates}
              tokenOut={selectTokenOut}
            />
          }
          balance={selectTokenOut?.balance?.toString()}
          selected={selectTokenOut as NetworkToken}
          handleSelect={() => handleSelect("tokenOut", selectTokenIn)}
          className="border rounded-b-xl mb-5 md:max-w-[472px]"
          required="This field is required"
          errors={errors}
          errorSelect={errorSelectTokenOut}
          disabled={true}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isFetching}
          disabled={Boolean(errorMsg)}
        >
          {isFetching ? "" : errorMsg ? errorMsg : "Swap"}
        </Button>
      </Form>
    </Paper>
  )
}
