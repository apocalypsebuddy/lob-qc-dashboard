import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'seeds'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('name').notNullable()
      table.string('front_template_id').notNullable()
      table.string('back_template_id').notNullable()
      table.enum('cadence', ['one_time', 'weekly', 'monthly']).notNullable().defaultTo('one_time')
      table.jsonb('to_address').notNullable()
      table.enum('status', ['active', 'paused']).notNullable().defaultTo('active')
      table.jsonb('meta').defaultTo('{}')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
