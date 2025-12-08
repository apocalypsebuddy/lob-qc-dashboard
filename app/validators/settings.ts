import vine from '@vinejs/vine'

export const updateSettingsValidator = vine.compile(
  vine.object({
    lobApiKey: vine.string().optional(),
  })
)
