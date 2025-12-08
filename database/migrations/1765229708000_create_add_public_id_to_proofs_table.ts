import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'proofs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('public_id', 20).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('public_id')
    })
  }
}
