import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Seed from './seed.js'

export default class Proof extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column({ columnName: 'user_id' })
  declare userId: string

  @column({ columnName: 'seed_id' })
  declare seedId: string | null

  @column({ columnName: 'seed_name' })
  declare seedName: string | null

  @column({ columnName: 'resource_id' })
  declare resourceId: string

  @column({ columnName: 'lob_url' })
  declare lobUrl: string

  @column({ columnName: 'thumbnail_url' })
  declare thumbnailUrl: string

  @column({ columnName: 'front_thumbnail_url' })
  declare frontThumbnailUrl: string | null

  @column({ columnName: 'back_thumbnail_url' })
  declare backThumbnailUrl: string | null

  @column()
  declare status:
    | 'created'
    | 'in_production'
    | 'mailed'
    | 'delivered'
    | 'awaiting_review'
    | 'completed'

  @column({ columnName: 'tracking_number' })
  declare trackingNumber: string | null

  @column.dateTime({ columnName: 'mailed_at' })
  declare mailedAt: DateTime | null

  @column.dateTime({ columnName: 'delivered_at' })
  declare deliveredAt: DateTime | null

  @column({ columnName: 'quality_rating' })
  declare qualityRating: number | null

  @column({ columnName: 'printer_vendor' })
  declare printerVendor: string | null

  @column()
  declare notes: string | null

  @column({ columnName: 'live_proof_url' })
  declare liveProofUrl: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Seed)
  declare seed: BelongsTo<typeof Seed>
}
