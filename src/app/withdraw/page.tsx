"use client"

import React from "react"
import { type FieldValues, useForm } from "react-hook-form"

import Button from "@src/components/Button/Button"
import Form from "@src/components/Form"
import FieldComboInput from "@src/components/Form/FieldComboInput"
import FieldTextInput from "@src/components/Form/FieldTextInput"
import Paper from "@src/components/Paper"
import type { NetworkToken } from "@src/types/interfaces"

type FormValues = {
  tokenIn: string
  walletTo: string
}

export default function Withdraw() {
  const { handleSubmit, register } = useForm<FormValues>()

  const onSubmit = (values: FieldValues) => {
    console.log(values, "form submit")
  }

  const handleSetMax = () => {
    console.log("form set max")
  }
  return (
    <Paper title="Withdraw">
      <Form<FormValues>
        handleSubmit={handleSubmit(onSubmit)}
        register={register}
      >
        <FieldComboInput<FormValues>
          fieldName="tokenIn"
          label="You’re sending"
          price="58.95"
          balance="515.22"
          selected={{ name: "AURORA" } as NetworkToken}
        />
        <div className="h-[10px]" />
        <FieldTextInput
          fieldName="walletTo"
          label="To"
          placeholder="Enter wallet address"
        />
        <div className="h-[20px]" />
        <Button type="submit" size="lg" fullWidth disabled>
          Coming soon
        </Button>
      </Form>
    </Paper>
  )
}
