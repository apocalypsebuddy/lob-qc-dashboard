import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'proofs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.uuid('seed_id').notNullable().references('id').inTable('seeds').onDelete('CASCADE')
      table.string('resource_id').notNullable()
      table.text('lob_url').notNullable()
      table.text('thumbnail_url').notNullable()
      table
        .enum('status', [
          'created',
          'in_production',
          'mailed',
          'delivered',
          'awaiting_review',
          'completed',
        ])
        .notNullable()
        .defaultTo('created')
      table.string('tracking_number').nullable()
      table.timestamp('delivered_at').nullable()
      table.integer('quality_rating').nullable()
      table.string('printer_vendor').nullable()
      table.text('notes').nullable()
      table.text('live_proof_url').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index('resource_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
