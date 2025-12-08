import vine from '@vinejs/vine'

export const updateProofValidator = vine.compile(
  vine.object({
    qualityRating: vine.number().range([1, 5]).optional(),
    printerVendor: vine.string().optional(),
    notes: vine.string().optional(),
  })
)

export const updateProofStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(['created', 'in_production', 'mailed', 'delivered', 'awaiting_review', 'completed']),
  })
)
