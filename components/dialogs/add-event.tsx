"use client"

import { DialogForm, FormField } from "@/components/ui/dialog-form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"

interface AddEventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    name: string
    startDate: string
    endDate: string
    startTime: string
    endTime: string
    repeatDaily: boolean
    minNumber: number
    maxNumber: number
    excludedNumbers: string
  }) => void
}

export function AddEventDialog({ open, onOpenChange, onSubmit }: AddEventDialogProps) {
  return (
    <DialogForm
      open={open}
      onOpenChange={onOpenChange}
      title="Agregar Nuevo Evento"
      submitText="Agregar Evento"
      onSubmit={(e) => {
        const formData = new FormData(e.currentTarget)
        onSubmit({
          name: formData.get("name") as string,
          startDate: formData.get("startDate") as string,
          endDate: formData.get("endDate") as string,
          startTime: formData.get("startTime") as string,
          endTime: formData.get("endTime") as string,
          repeatDaily: formData.get("repeatDaily") === "on",
          minNumber: Number(formData.get("minNumber")) || 0,
          maxNumber: Number(formData.get("maxNumber")) || 0,
          excludedNumbers: formData.get("excludedNumbers") as string || ""
        })
      }}
    >
      <FormField label="Nombre">
        <Input
          name="name"
          placeholder="Nombre del evento"
          required
          className="h-12 bg-input border border-border text-foreground placeholder-muted-foreground"
        />
      </FormField>

      <FormField label="Fecha de inicio">
        <Input
          name="startDate"
          type="date"
          placeholder="mm/dd/aaaa"
          required
          className="h-12 bg-input border border-border text-foreground [color-scheme:light] dark:[color-scheme:dark]"
        />
      </FormField>

      <FormField label="Fecha de finalización">
        <Input
          name="endDate"
          type="date"
          placeholder="mm/dd/aaaa"
          required
          className="h-12 bg-input border border-border text-foreground [color-scheme:light] dark:[color-scheme:dark]"
        />
      </FormField>

      <FormField label="Hora de inicio">
        <Input
          name="startTime"
          type="time"
          placeholder="--:-- ----"
          required
          className="h-12 bg-input border border-border text-foreground [color-scheme:light] dark:[color-scheme:dark]"
        />
      </FormField>

      <FormField label="Hora de finalización">
        <Input
          name="endTime"
          type="time"
          placeholder="--:-- ----"
          required
          className="h-12 bg-input border border-border text-foreground [color-scheme:light] dark:[color-scheme:dark]"
        />
      </FormField>

      <div className="flex items-center space-x-2 pt-2">
        <Checkbox id="repeatDaily" name="repeatDaily" className="border-border" />
        <label htmlFor="repeatDaily" className="text-sm text-muted-foreground select-none cursor-pointer">
          Repetir diariamente
        </label>
      </div>
    </DialogForm>
  )
}

