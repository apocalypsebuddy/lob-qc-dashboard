import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'proofs'

  async up() {
    // Drop existing foreign key
    await this.db.rawQuery('ALTER TABLE proofs DROP CONSTRAINT IF EXISTS proofs_seed_id_foreign')

    // Make seed_id nullable
    await this.db.rawQuery('ALTER TABLE proofs ALTER COLUMN seed_id DROP NOT NULL')

    // Re-add foreign key with SET NULL on delete
    await this.db.rawQuery(
      'ALTER TABLE proofs ADD CONSTRAINT proofs_seed_id_foreign FOREIGN KEY (seed_id) REFERENCES seeds(id) ON DELETE SET NULL'
    )

    // Add seed_name column
    await this.db.rawQuery('ALTER TABLE proofs ADD COLUMN seed_name VARCHAR(255)')
  }

  async down() {
    // Drop foreign key
    await this.db.rawQuery('ALTER TABLE proofs DROP CONSTRAINT IF EXISTS proofs_seed_id_foreign')

    // Drop seed_name column
    await this.db.rawQuery('ALTER TABLE proofs DROP COLUMN IF EXISTS seed_name')

    // Make seed_id NOT NULL again (this will fail if there are null values)
    await this.db.rawQuery('ALTER TABLE proofs ALTER COLUMN seed_id SET NOT NULL')

    // Re-add foreign key with CASCADE on delete
    await this.db.rawQuery(
      'ALTER TABLE proofs ADD CONSTRAINT proofs_seed_id_foreign FOREIGN KEY (seed_id) REFERENCES seeds(id) ON DELETE CASCADE'
    )
  }
}
