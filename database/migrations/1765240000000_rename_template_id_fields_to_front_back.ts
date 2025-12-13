import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'seeds'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('front_template_id', 'front')
      table.renameColumn('back_template_id', 'back')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('front', 'front_template_id')
      table.renameColumn('back', 'back_template_id')
    })
  }
}
