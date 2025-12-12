import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import router from '@adonisjs/core/services/router'
import { DateTime } from 'luxon'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import Seed from '#models/seed'
import Proof from '#models/proof'
import SeedService from '#services/seed_service'
import S3Service from '#services/s3_service'
import { createSeedValidator, updateSeedValidator } from '#validators/seed'

export default class SeedsController {
  async index({ view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()

    // Load proof counts for each seed
    const seedsWithProofs = await Seed.query()
      .where('user_id', user.id)
      .preload('proofs')
      .orderBy('created_at', 'desc')

    // Format seeds data for template
    const seedsData = seedsWithProofs.map((seed) => {
      // Format cadence for display
      let cadenceDisplay = 'Monthly'
      if (seed.cadence === 'one_time') {
        cadenceDisplay = 'One Time'
      } else if (seed.cadence === 'weekly') {
        cadenceDisplay = 'Weekly'
      }

      return {
        id: seed.id,
        name: seed.name,
        status: seed.status,
        cadence: cadenceDisplay,
        createdAt: seed.createdAt.toFormat('MMM dd, yyyy'),
        lastRunAt: seed.lastRunAt ? seed.lastRunAt.toFormat('MMM dd, yyyy HH:mm') : null,
        nextRunAt: seed.nextRunAt ? seed.nextRunAt.toFormat('MMM dd, yyyy HH:mm') : null,
        proofCount: seed.proofs.length,
        statusClass:
          seed.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800',
        showUrl: router.makeUrl('seeds.show', { publicId: seed.publicId }),
        editUrl: router.makeUrl('seeds.edit', { publicId: seed.publicId }),
        deleteUrl: router.makeUrl('seeds.destroy', { publicId: seed.publicId }),
      }
    })

    // Encode seeds data as base64 to avoid HTML escaping issues
    const seedsJson = JSON.stringify(seedsData)
    const seedsBase64 = Buffer.from(seedsJson, 'utf-8').toString('base64')

    const csrfToken = request.csrfToken

    return view.render('seeds/index', { seeds: seedsData, seedsBase64, csrfToken })
  }

  async create({ view, request }: HttpContext) {
    const csrfToken = request.csrfToken
    return view.render('seeds/create', { csrfToken })
  }

  async store({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Creating new seed', { userId: user.id, email: user.email })

      // Log raw request data
      const rawBody = request.body()
      logger.info('Raw request body', {
        userId: user.id,
        bodyKeys: Object.keys(rawBody),
        hasAddresses: 'addresses' in rawBody,
        addressesType: rawBody.addresses ? typeof rawBody.addresses : 'none',
        addressesLength: Array.isArray(rawBody.addresses) ? rawBody.addresses.length : 'not array',
        rawBody: JSON.stringify(rawBody),
      })

      const data = await request.validateUsing(createSeedValidator)

      // Handle file uploads for front and back
      let frontValue = data.front || ''
      let backValue = data.back || ''

      // Handle front file upload
      const frontFile = request.file('frontFile', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'pdf'],
      })

      if (frontFile && frontFile.isValid) {
        logger.info('Front file uploaded', {
          fileName: frontFile.fileName,
          size: frontFile.size,
          extname: frontFile.extname,
          userId: user.id,
        })

        // Save file to temp location
        const tempDir = tmpdir()
        await frontFile.move(tempDir, { overwrite: true })
        const tempPath = join(tempDir, frontFile.fileName!)

        try {
          // Upload to S3
          frontValue = await S3Service.uploadFile(tempPath, frontFile.fileName!, user.id)
          logger.info('Front file uploaded to S3', { url: frontValue, userId: user.id })

          // Clean up temp file
          await unlink(tempPath).catch(() => {})
        } catch (error: any) {
          logger.error('Error uploading front file to S3', {
            error: error.message,
            userId: user.id,
          })
          // Clean up temp file
          await unlink(tempPath).catch(() => {})
          throw error
        }
      }

      // Handle back file upload
      const backFile = request.file('backFile', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'pdf'],
      })

      if (backFile && backFile.isValid) {
        logger.info('Back file uploaded', {
          fileName: backFile.fileName,
          size: backFile.size,
          extname: backFile.extname,
          userId: user.id,
        })

        // Save file to temp location
        const tempDir = tmpdir()
        await backFile.move(tempDir, { overwrite: true })
        const tempPath = join(tempDir, backFile.fileName!)

        try {
          // Upload to S3
          backValue = await S3Service.uploadFile(tempPath, backFile.fileName!, user.id)
          logger.info('Back file uploaded to S3', { url: backValue, userId: user.id })

          // Clean up temp file
          await unlink(tempPath).catch(() => {})
        } catch (error: any) {
          logger.error('Error uploading back file to S3', {
            error: error.message,
            userId: user.id,
          })
          // Clean up temp file
          await unlink(tempPath).catch(() => {})
          throw error
        }
      }

      // Validate that at least front or back is provided
      if (!frontValue && !backValue) {
        throw new Error(
          'Either front or back must be provided (as template ID, URL, or file upload)'
        )
      }

      logger.info('Seed form validated', {
        seedName: data.name,
        userId: user.id,
        front: frontValue,
        back: backValue,
        cadence: data.cadence,
        addressesCount: data.addresses ? data.addresses.length : 0,
        addresses: JSON.stringify(data.addresses),
      })

      // Transform addresses array to match the model format
      const toAddresses = data.addresses.map((addr, index) => {
        const transformed = {
          name: addr.toName || undefined,
          company: addr.company || undefined,
          address_line1: addr.addressLine1,
          address_line2: addr.addressLine2 || undefined,
          address_city: addr.addressCity,
          address_state: addr.addressState,
          address_zip: addr.addressZip,
          address_country: addr.addressCountry || 'US',
          phone: addr.phone || undefined,
          email: addr.email || undefined,
          description: addr.description || undefined,
        }
        logger.info(`Transformed address ${index + 1}`, {
          userId: user.id,
          addressIndex: index,
          transformed: JSON.stringify(transformed),
        })
        return transformed
      })

      const cadence = data.cadence || 'one_time'

      // Set next_run_at based on cadence
      let nextRunAt: DateTime | null = null
      if (cadence !== 'one_time') {
        nextRunAt = DateTime.utc()
      }

      // Generate a unique 6-digit hexadecimal number for the seed public_id
      const seedHex = randomBytes(3).toString('hex').toUpperCase()

      logger.info('Creating seed record', {
        userId: user.id,
        name: data.name,
        front: frontValue,
        back: backValue,
        cadence: cadence,
        nextRunAt: nextRunAt?.toISO(),
        addressesCount: toAddresses.length,
        toAddresses: JSON.stringify(toAddresses),
        publicId: seedHex,
      })

      const seed = await Seed.create({
        userId: user.id,
        name: data.name,
        publicId: seedHex,
        front: frontValue,
        back: backValue,
        cadence: cadence,
        toAddress: toAddresses,
        status: 'active',
        nextRunAt: nextRunAt,
        meta: {},
      })

      logger.info('Seed created successfully', {
        seedId: seed.id,
        seedName: seed.name,
        userId: user.id,
        addressesCount: Array.isArray(seed.toAddress) ? seed.toAddress.length : 1,
      })

      return response.redirect().toRoute('seeds.show', { publicId: seed.publicId })
    } catch (error: any) {
      logger.error('Error creating seed', {
        userId: auth.user?.id,
        error: error.message,
        errorName: error.name,
        errorCode: error.code,
        stack: error.stack,
        // Log validation errors if available
        validationErrors: error.messages || error.cause?.messages || undefined,
        requestBody: JSON.stringify(request.body()),
      })
      throw error
    }
  }

  async show({ params, view, auth, request, session }: HttpContext) {
    const user = auth.getUserOrFail()
    const seed = await Seed.query()
      .where('public_id', params.publicId)
      .where('user_id', user.id)
      .preload('proofs', (query) => {
        query.orderBy('created_at', 'desc')
      })
      .firstOrFail()

    // Format seed and proofs data - match the structure from proofs index
    const proofsData = seed.proofs.map((proof) => ({
      id: proof.id,
      seedId: proof.seedId,
      seedName: proof.seedName || seed.name,
      seedShowUrl: router.makeUrl('seeds.show', { publicId: seed.publicId }),
      publicId: proof.publicId,
      status: proof.status,
      createdAt: proof.createdAt.toFormat('MMM dd, yyyy HH:mm'),
      mailedAt: proof.mailedAt ? proof.mailedAt.toFormat('MMM dd, yyyy') : null,
      deliveredAt: proof.deliveredAt ? proof.deliveredAt.toFormat('MMM dd, yyyy') : null,
      showUrl: router.makeUrl('proofs.show', { publicId: proof.publicId }),
      deleteUrl: router.makeUrl('proofs.destroy', { publicId: proof.publicId }),
    }))

    // Encode proofs data as base64 to avoid HTML escaping issues
    const proofsJson = JSON.stringify(proofsData)
    const proofsBase64 = Buffer.from(proofsJson, 'utf-8').toString('base64')

    // Format addresses - handle both array and single object for backward compatibility
    const addresses = Array.isArray(seed.toAddress) ? seed.toAddress : [seed.toAddress]
    const addressesData = addresses.map((addr, index) => ({
      index: index + 1,
      name: addr.name || 'N/A',
      company: addr.company || '',
      address_line1: addr.address_line1,
      address_line2: addr.address_line2 || '',
      address_city: addr.address_city,
      address_state: addr.address_state,
      address_zip: addr.address_zip,
      address_country: addr.address_country || 'US',
      phone: addr.phone || '',
      email: addr.email || '',
      description: addr.description || '',
      summary: `${addr.address_line1}, ${addr.address_city}, ${addr.address_state} ${addr.address_zip}`,
    }))

    const seedData = {
      id: seed.id,
      publicId: seed.publicId,
      name: seed.name,
      front: seed.front,
      back: seed.back,
      status: seed.status,
      cadence: seed.cadence,
      lastRunAt: seed.lastRunAt ? seed.lastRunAt.toFormat('MMM dd, yyyy HH:mm') : null,
      nextRunAt: seed.nextRunAt ? seed.nextRunAt.toFormat('MMM dd, yyyy HH:mm') : null,
      addresses: addressesData,
      statusClass:
        seed.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800',
      proofs: proofsData,
      proofsBase64,
      proofCount: seed.proofs.length,
      runUrl: router.makeUrl('seeds.run', { publicId: seed.publicId }),
      deleteUrl: router.makeUrl('seeds.destroy', { publicId: seed.publicId }),
    }

    // Get flash messages
    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Format error message as plain text
    let errorMessage = ''
    if (errors) {
      errorMessage = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
    }

    const successMessage = success
      ? typeof success === 'object'
        ? Object.values(success)[0] || ''
        : success
      : ''

    const csrfToken = request.csrfToken

    return view.render('seeds/show', { seed: seedData, csrfToken, errorMessage, successMessage })
  }

  async run({ params, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Running seed', { seedPublicId: params.publicId, userId: user.id })

      const seed = await Seed.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()
      logger.info('Seed found', { seedId: seed.id, seedName: seed.name })

      if (!user.lobApiKey) {
        logger.warn('Seed run attempted without Lob API key', {
          seedId: seed.id,
          userId: user.id,
        })
        return response.redirect().toRoute('settings.edit')
      }

      const result = await SeedService.runSeed(seed, user)

      if (result.errors.length > 0) {
        const successCount = result.proofs.length
        const errorCount = result.errors.length

        // Build detailed error message
        const errorMessages = result.errors
          .map((err) => {
            const addrSummary = err.address?.address_line1
              ? `${err.address.address_line1}, ${err.address.address_city}`
              : `Address ${err.addressIndex + 1}`
            return `${addrSummary}: ${err.error}`
          })
          .join('; ')

        logger.error('Seed run completed with errors', {
          seedId: seed.id,
          successCount,
          errorCount,
          errors: result.errors.map((err) => ({
            addressIndex: err.addressIndex,
            error: err.error,
          })),
        })

        if (successCount > 0) {
          session.flash(
            'success',
            `Seed run partially successful! ${successCount} postcard(s) created, ${errorCount} failed.`
          )
          session.flash('errors', {
            general: `Some postcards failed: ${errorMessages}`,
          })
        } else {
          session.flash('errors', {
            general: `Failed to create postcards. Errors: ${errorMessages}`,
          })
        }
      } else {
        session.flash(
          'success',
          `Seed run successfully! ${result.proofs.length} postcard(s) created.`
        )
      }
      return response.redirect().toRoute('seeds.show', { publicId: seed.publicId })
    } catch (error: any) {
      // Enhanced error logging
      const errorDetails: any = {
        seedPublicId: params.publicId,
        errorMessage: error.message,
        errorName: error.name,
        errorCode: error.code,
        stack: error.stack,
      }

      // Include response data if available (e.g., from API errors)
      if (error.response) {
        errorDetails.responseStatus = error.response.status
        errorDetails.responseStatusText = error.response.statusText
        errorDetails.responseData = error.response.data
      }

      // Include request details if available
      if (error.request) {
        errorDetails.requestUrl = error.request.url || error.request.path
        errorDetails.requestMethod = error.request.method
      }

      logger.error('Error running seed', errorDetails)

      // Create user-friendly error message
      let userMessage = 'Failed to run seed. Please try again.'
      if (error.message) {
        // Extract meaningful error message
        if (error.message.includes('API')) {
          userMessage = `API Error: ${error.message}`
        } else if (error.message.includes('validation') || error.message.includes('invalid')) {
          userMessage = `Validation Error: ${error.message}`
        } else if (error.message.includes('not found') || error.message.includes('404')) {
          userMessage = 'Template or resource not found. Please check your template IDs.'
        } else if (error.message.includes('unauthorized') || error.message.includes('401')) {
          userMessage = 'Authentication failed. Please check your Lob API key in settings.'
        } else if (error.message.includes('forbidden') || error.message.includes('403')) {
          userMessage = 'Access denied. Please check your Lob API key permissions.'
        } else {
          userMessage = error.message
        }
      }

      session.flash('errors', { general: userMessage })
      return response.redirect().back()
    }
  }

  async edit({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const seed = await Seed.query()
      .where('public_id', params.publicId)
      .where('user_id', user.id)
      .firstOrFail()

    // Format addresses - handle both array and single object for backward compatibility
    const addresses = Array.isArray(seed.toAddress) ? seed.toAddress : [seed.toAddress]
    const addressesData = addresses.map((addr) => ({
      toName: addr.name || '',
      company: addr.company || '',
      addressLine1: addr.address_line1,
      addressLine2: addr.address_line2 || '',
      addressCity: addr.address_city,
      addressState: addr.address_state,
      addressZip: addr.address_zip,
      addressCountry: addr.address_country || 'US',
      phone: addr.phone || '',
      email: addr.email || '',
      description: addr.description || '',
    }))

    // Format nextRunAt for datetime-local input (YYYY-MM-DDTHH:mm)
    const nextRunAtFormatted = seed.nextRunAt ? seed.nextRunAt.toFormat("yyyy-MM-dd'T'HH:mm") : ''

    const seedData = {
      id: seed.id,
      publicId: seed.publicId,
      name: seed.name,
      front: seed.front,
      back: seed.back,
      cadence: seed.cadence,
      status: seed.status,
      nextRunAt: nextRunAtFormatted,
      addresses: addressesData,
    }

    // Encode addresses data as base64 to avoid HTML escaping issues
    const addressesJson = JSON.stringify(addressesData)
    const addressesBase64 = Buffer.from(addressesJson, 'utf-8').toString('base64')

    const csrfToken = request.csrfToken

    return view.render('seeds/edit', { seed: seedData, addressesBase64, csrfToken })
  }

  async update({ params, request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Updating seed', { seedPublicId: params.publicId, userId: user.id })

      const seed = await Seed.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()

      const data = await request.validateUsing(updateSeedValidator)

      // Handle file uploads for front and back
      let frontValue = data.front || seed.front
      let backValue = data.back || seed.back

      // Handle front file upload
      const frontFile = request.file('frontFile', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'pdf'],
      })

      if (frontFile && frontFile.isValid) {
        logger.info('Front file uploaded for update', {
          fileName: frontFile.fileName,
          size: frontFile.size,
          extname: frontFile.extname,
          userId: user.id,
          seedId: seed.id,
        })

        // Save file to temp location
        const tempDir = tmpdir()
        await frontFile.move(tempDir, { overwrite: true })
        const tempPath = join(tempDir, frontFile.fileName!)

        try {
          // Upload to S3
          frontValue = await S3Service.uploadFile(tempPath, frontFile.fileName!, user.id)
          logger.info('Front file uploaded to S3', {
            url: frontValue,
            userId: user.id,
            seedId: seed.id,
          })

          // Clean up temp file
          await unlink(tempPath).catch(() => {})
        } catch (error: any) {
          logger.error('Error uploading front file to S3', {
            error: error.message,
            userId: user.id,
            seedId: seed.id,
          })
          // Clean up temp file
          await unlink(tempPath).catch(() => {})
          throw error
        }
      }

      // Handle back file upload
      const backFile = request.file('backFile', {
        size: '10mb',
        extnames: ['jpg', 'jpeg', 'pdf'],
      })

      if (backFile && backFile.isValid) {
        logger.info('Back file uploaded for update', {
          fileName: backFile.fileName,
          size: backFile.size,
          extname: backFile.extname,
          userId: user.id,
          seedId: seed.id,
        })

        // Save file to temp location
        const tempDir = tmpdir()
        await backFile.move(tempDir, { overwrite: true })
        const tempPath = join(tempDir, backFile.fileName!)

        try {
          // Upload to S3
          backValue = await S3Service.uploadFile(tempPath, backFile.fileName!, user.id)
          logger.info('Back file uploaded to S3', {
            url: backValue,
            userId: user.id,
            seedId: seed.id,
          })

          // Clean up temp file
          await unlink(tempPath).catch(() => {})
        } catch (error: any) {
          logger.error('Error uploading back file to S3', {
            error: error.message,
            userId: user.id,
            seedId: seed.id,
          })
          // Clean up temp file
          await unlink(tempPath).catch(() => {})
          throw error
        }
      }

      logger.info('Seed update form validated', {
        seedId: seed.id,
        seedName: data.name,
        userId: user.id,
        front: frontValue,
        back: backValue,
        cadence: data.cadence,
        status: data.status,
        addressesCount: data.addresses ? data.addresses.length : 0,
      })

      // Transform addresses array to match the model format
      const toAddresses = data.addresses.map((addr, index) => {
        const transformed = {
          name: addr.toName || undefined,
          company: addr.company || undefined,
          address_line1: addr.addressLine1,
          address_line2: addr.addressLine2 || undefined,
          address_city: addr.addressCity,
          address_state: addr.addressState,
          address_zip: addr.addressZip,
          address_country: addr.addressCountry || 'US',
          phone: addr.phone || undefined,
          email: addr.email || undefined,
          description: addr.description || undefined,
        }
        logger.info(`Transformed address ${index + 1}`, {
          userId: user.id,
          addressIndex: index,
          transformed: JSON.stringify(transformed),
        })
        return transformed
      })

      seed.name = data.name
      seed.front = frontValue
      seed.back = backValue
      seed.cadence = data.cadence || 'one_time'
      seed.toAddress = toAddresses
      if (data.status) {
        seed.status = data.status
      }

      // Handle nextRunAt - convert from datetime-local string to DateTime or null
      if (data.nextRunAt && data.nextRunAt.trim() !== '') {
        // Parse datetime-local format (YYYY-MM-DDTHH:mm) to DateTime
        const parsed = DateTime.fromISO(data.nextRunAt, { zone: 'utc' })
        if (parsed.isValid) {
          seed.nextRunAt = parsed
        } else {
          logger.warn('Invalid nextRunAt format', {
            seedId: seed.id,
            nextRunAt: data.nextRunAt,
          })
          // Keep existing value if parsing fails
        }
      } else {
        // Empty string means clear the next run date
        seed.nextRunAt = null
      }

      await seed.save()

      logger.info('Seed updated successfully', {
        seedId: seed.id,
        seedName: seed.name,
        userId: user.id,
      })

      session.flash('success', 'Seed updated successfully!')
      return response.redirect().toRoute('seeds.show', { publicId: seed.publicId })
    } catch (error: any) {
      logger.error('Error updating seed', {
        seedPublicId: params.publicId,
        userId: auth.user?.id,
        error: error.message,
        errorName: error.name,
        errorCode: error.code,
        stack: error.stack,
        validationErrors: error.messages || error.cause?.messages || undefined,
        requestBody: JSON.stringify(request.body()),
      })
      throw error
    }
  }

  async destroy({ params, request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const deleteProofs = request.input('delete_proofs') === 'true'
      logger.info('Deleting seed', {
        seedPublicId: params.publicId,
        userId: user.id,
        deleteProofs,
      })

      const seed = await Seed.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()

      // Load proofs to check if any exist
      await seed.load('proofs')
      const proofCount = seed.proofs.length

      if (proofCount > 0) {
        if (deleteProofs) {
          // Delete all associated proofs
          logger.info('Deleting associated proofs', {
            seedId: seed.id,
            proofCount,
          })
          for (const proof of seed.proofs) {
            await proof.delete()
          }
          logger.info('All proofs deleted', { seedId: seed.id, proofCount })
        } else {
          // Orphan the proofs by setting seedId to null and storing seed name
          logger.info('Orphaning proofs', {
            seedId: seed.id,
            proofCount,
            seedName: seed.name,
          })
          await Proof.query().where('seed_id', seed.id).where('user_id', user.id).update({
            seedId: null,
            seedName: seed.name,
          })
          logger.info('Proofs orphaned successfully', { seedId: seed.id, proofCount })
        }
      }

      await seed.delete()

      logger.info('Seed deleted successfully', {
        seedPublicId: params.publicId,
        userId: user.id,
        deletedProofs: deleteProofs,
        proofCount,
      })

      const message =
        proofCount > 0
          ? deleteProofs
            ? `Seed and ${proofCount} proof(s) deleted successfully!`
            : `Seed deleted successfully! ${proofCount} proof(s) have been orphaned.`
          : 'Seed deleted successfully!'

      session.flash('success', message)
      return response.redirect().toRoute('seeds.index')
    } catch (error: any) {
      logger.error('Error deleting seed', {
        seedPublicId: params.publicId,
        userId: auth.user?.id,
        error: error.message,
        stack: error.stack,
      })
      session.flash('errors', {
        general: 'Failed to delete seed. Please try again.',
      })
      return response.redirect().back()
    }
  }
}
