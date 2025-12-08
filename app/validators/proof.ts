import vine from '@vinejs/vine'

export const updateProofValidator = vine.compile(
  vine.object({
    qualityRating: vine.number().range([1, 5]).optional(),
    printerVendor: vine.string().optional(),
    notes: vine.string().optional(),
  })
)
