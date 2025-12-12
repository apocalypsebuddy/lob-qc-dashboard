import { DateTime } from 'luxon'
import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import Seed from '#models/seed'
import User from '#models/user'
import Proof from '#models/proof'
import LobClient from '#services/lob_client'
import S3Service from '#services/s3_service'

interface RunSeedResult {
  proofs: Proof[]
  errors: Array<{
    addressIndex: number
    address: any
    error: string
    fullError: string
  }>
}

export default class SeedService {
  /**
   * Run a seed: create postcards for all addresses and update recurrence metadata
   */
  public static async runSeed(seed: Seed, user: User): Promise<RunSeedResult> {
    if (!user.lobApiKey) {
      throw new Error('User does not have a Lob API key configured')
    }

    // Refresh seed from database to ensure we have the latest data including public_id
    await seed.refresh()

    // Ensure toAddress is an array
    const addresses = Array.isArray(seed.toAddress) ? seed.toAddress : [seed.toAddress]

    logger.info('Creating postcards via Lob API', {
      seedId: seed.id,
      front: seed.front,
      back: seed.back,
      addressCount: addresses.length,
    })

    const createdProofs: Proof[] = []
    const errors: Array<{
      addressIndex: number
      address: any
      error: string
      fullError: string
    }> = []

    // Create a postcard for each address
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i]
      // Generate a unique 6-digit hexadecimal number for the proof company field
      const proofHex = randomBytes(3).toString('hex').toUpperCase()
      const proofCompany = `Proof ${proofHex}`

      try {
        // Create a copy of the address and add the company field
        const addressWithCompany = {
          ...address,
          company: proofCompany,
        }

        logger.info(`Creating postcard ${i + 1} of ${addresses.length}`, {
          seedId: seed.id,
          addressIndex: i,
          toAddress: addressWithCompany,
          proofCompany,
        })

        // Convert S3 URLs to presigned URLs if needed
        let frontValue = seed.front || ''
        let backValue = seed.back || ''

        if (frontValue && S3Service.isS3Url(frontValue)) {
          logger.info('Converting front S3 URL to presigned URL', {
            seedId: seed.id,
            originalUrl: frontValue,
          })
          frontValue = await S3Service.getPresignedUrl(frontValue)
          logger.info('Front presigned URL generated', {
            seedId: seed.id,
            presignedUrlLength: frontValue.length,
          })
        }

        if (backValue && S3Service.isS3Url(backValue)) {
          logger.info('Converting back S3 URL to presigned URL', {
            seedId: seed.id,
            originalUrl: backValue,
          })
          backValue = await S3Service.getPresignedUrl(backValue)
          logger.info('Back presigned URL generated', {
            seedId: seed.id,
            presignedUrlLength: backValue.length,
          })
        }

        const result = await LobClient.createPostcard(user, {
          toAddress: addressWithCompany,
          front: frontValue,
          back: backValue,
          seedPublicId: seed.publicId || undefined,
        })

        logger.info('Postcard created successfully', {
          resourceId: result.id,
          lobUrl: result.url,
          thumbnailUrl: result.thumbnail_url,
          thumbnailUrlLength: result.thumbnail_url?.length || 0,
          frontThumbnailUrl: result.front_thumbnail_url,
          backThumbnailUrl: result.back_thumbnail_url,
          seedId: seed.id,
          addressIndex: i,
        })

        logger.info('Creating proof record', {
          userId: user.id,
          seedId: seed.id,
          resourceId: result.id,
          lobUrl: result.url,
          thumbnailUrl: result.thumbnail_url,
          thumbnailUrlLength: result.thumbnail_url?.length || 0,
          frontThumbnailUrl: result.front_thumbnail_url,
          backThumbnailUrl: result.back_thumbnail_url,
          status: 'created',
          addressIndex: i,
        })

        const proof = await Proof.create({
          userId: user.id,
          seedId: seed.id,
          publicId: proofHex,
          resourceId: result.id,
          lobUrl: result.url,
          thumbnailUrl: result.thumbnail_url,
          frontThumbnailUrl: result.front_thumbnail_url,
          backThumbnailUrl: result.back_thumbnail_url,
          status: 'created',
        })

        logger.info('Proof created successfully', {
          proofId: proof.id,
          resourceId: result.id,
          seedId: seed.id,
          addressIndex: i,
        })

        createdProofs.push(proof)
      } catch (error: any) {
        // Enhanced error logging
        const errorMessage = error.message || 'Unknown error occurred'
        const errorDetails = {
          seedId: seed.id,
          addressIndex: i,
          address: address,
          proofCompany: proofCompany,
          errorMessage: errorMessage,
          errorName: error.name,
          errorCode: error.code,
          errorStack: error.stack,
          errorString: String(error),
          errorKeys: error ? Object.keys(error) : [],
        }

        logger.error(`Error creating postcard for address ${i + 1}`, errorDetails)

        // Try to extract more detailed error message
        let displayError = errorMessage
        if (error.response?.body) {
          try {
            const errorBody =
              typeof error.response.body === 'string'
                ? JSON.parse(error.response.body)
                : error.response.body
            if (errorBody.error?.message) {
              displayError = errorBody.error.message
            } else if (errorBody.message) {
              displayError = errorBody.message
            }
          } catch {
            // Ignore parsing errors
          }
        }

        errors.push({
          addressIndex: i,
          address: address,
          error: displayError,
          fullError: errorMessage,
        })
      }
    }

    // Update recurrence metadata
    const now = DateTime.utc()
    seed.lastRunAt = now
    seed.nextRunAt = seed.computeNextRun(now)

    if (seed.cadence === 'one_time') {
      seed.status = 'paused'
    }

    await seed.save()

    logger.info('Seed recurrence metadata updated', {
      seedId: seed.id,
      lastRunAt: seed.lastRunAt?.toISO(),
      nextRunAt: seed.nextRunAt?.toISO(),
      status: seed.status,
    })

    return {
      proofs: createdProofs,
      errors: errors,
    }
  }
}
