import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Proof from './proof.js'

export default class Seed extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column({ columnName: 'user_id' })
  declare userId: string

  @column()
  declare name: string

  @column({ columnName: 'front_template_id' })
  declare frontTemplateId: string

  @column({ columnName: 'back_template_id' })
  declare backTemplateId: string

  @column()
  declare cadence: 'one_time' | 'weekly' | 'monthly'

  @column({
    columnName: 'to_address',
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare toAddress: Array<{
    name?: string
    company?: string
    address_line1: string
    address_line2?: string
    address_city: string
    address_state: string
    address_zip: string
    address_country?: string
    phone?: string
    email?: string
    description?: string
  }>

  @column()
  declare status: 'active' | 'paused'

  @column.dateTime({ columnName: 'last_run_at' })
  declare lastRunAt: DateTime | null

  @column.dateTime({ columnName: 'next_run_at' })
  declare nextRunAt: DateTime | null

  @column({
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare meta: Record<string, any>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => Proof)
  declare proofs: HasMany<typeof Proof>

  /**
   * Compute the next run based on the current cadence.
   * Returns null for one_time seeds.
   */
  public computeNextRun(from: DateTime = DateTime.utc()): DateTime | null {
    switch (this.cadence) {
      case 'one_time':
        return null
      case 'weekly':
        return from.plus({ weeks: 1 })
      case 'monthly':
        return from.plus({ months: 1 })
      default:
        return null
    }
  }
}
