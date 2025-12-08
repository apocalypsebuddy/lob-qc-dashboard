import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'proofs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('front_thumbnail_url').nullable()
      table.text('back_thumbnail_url').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('front_thumbnail_url')
      table.dropColumn('back_thumbnail_url')
    })
  }
}
