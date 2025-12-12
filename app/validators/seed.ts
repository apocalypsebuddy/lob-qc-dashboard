import vine from '@vinejs/vine'

const addressSchema = vine.object({
  toName: vine.string().maxLength(40).optional(),
  company: vine.string().maxLength(40).optional(),
  addressLine1: vine.string().minLength(1).maxLength(64),
  addressLine2: vine.string().maxLength(64).optional(),
  addressCity: vine.string().minLength(1).maxLength(200),
  addressState: vine.string().regex(/^[A-Z]{2}$/),
  addressZip: vine.string().regex(/^\d{5}(-\d{4})?$/),
  addressCountry: vine.string().optional(),
  phone: vine.string().maxLength(40).optional(),
  email: vine.string().email().maxLength(100).optional(),
  description: vine.string().maxLength(255).optional(),
})

export const createSeedValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1),
    front: vine.string().minLength(1).optional(),
    back: vine.string().minLength(1).optional(),
    cadence: vine.enum(['one_time', 'weekly', 'monthly']).optional(),
    addresses: vine.array(addressSchema).minLength(1),
  })
)

export const updateSeedValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1),
    front: vine.string().minLength(1).optional(),
    back: vine.string().minLength(1).optional(),
    cadence: vine.enum(['one_time', 'weekly', 'monthly']).optional(),
    status: vine.enum(['active', 'paused']).optional(),
    nextRunAt: vine.string().optional(),
    addresses: vine.array(addressSchema).minLength(1),
  })
)
