import { BaseCommand } from '@adonisjs/core/ace'
import { DateTime } from 'luxon'
import Seed from '#models/seed'
import User from '#models/user'
import SeedService from '#services/seed_service'

export default class RunDueSeeds extends BaseCommand {
  public static commandName = 'seeds:run-due'
  public static description = 'Run all seeds that are due based on next_run_at'

  static options = {
    startApp: true,
  }

  public async run() {
    const now = DateTime.utc()

    this.logger.info(`Checking for due seeds at ${now.toISO()}`)

    const seeds = await Seed.query()
      .where('status', 'active')
      .whereNotNull('next_run_at')
      .where('next_run_at', '<=', now.toISO())

    this.logger.info(`Found ${seeds.length} due seeds`)

    if (seeds.length === 0) {
      this.logger.info('No due seeds found')
      return
    }

    for (const seed of seeds) {
      try {
        const user = await User.findOrFail(seed.userId)

        if (!user.lobApiKey) {
          console.warn(`Skipping seed ${seed.id} - user ${user.id} does not have Lob API key`)
          continue
        }

        this.logger.info(`Running seed ${seed.id} for user ${user.id}`)

        const result = await SeedService.runSeed(seed, user)

        if (result.errors.length > 0) {
          console.warn(
            `Seed ${seed.id} completed with ${result.proofs.length} successful and ${result.errors.length} errors`
          )
        } else {
          this.logger.info(
            `Seed ${seed.id} completed successfully - ${result.proofs.length} proof(s) created`
          )
        }
      } catch (error: any) {
        this.logger.error(`Error running seed ${seed.id}: ${error.message ?? error}`)
      }
    }

    this.logger.info('Finished processing due seeds')
  }
}
