import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import router from '@adonisjs/core/services/router'
import Seed from '#models/seed'
import { createSeedValidator } from '#validators/seed'

export default class SeedsController {
  async index({ view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const seeds = await Seed.query().where('user_id', user.id).orderBy('created_at', 'desc')

    // Format seeds data for template
    const seedsData = seeds.map((seed) => ({
      id: seed.id,
      name: seed.name,
      status: seed.status,
      createdAt: seed.createdAt.toFormat('MMM dd, yyyy'),
      statusClass:
        seed.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800',
      showUrl: router.makeUrl('seeds.show', { id: seed.id }),
    }))

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
      logger.info('Seed form validated', {
        seedName: data.name,
        userId: user.id,
        frontTemplateId: data.frontTemplateId,
        backTemplateId: data.backTemplateId,
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

      logger.info('Creating seed record', {
        userId: user.id,
        name: data.name,
        frontTemplateId: data.frontTemplateId,
        backTemplateId: data.backTemplateId,
        cadence: data.cadence || 'one_time',
        addressesCount: toAddresses.length,
        toAddresses: JSON.stringify(toAddresses),
      })

      const seed = await Seed.create({
        userId: user.id,
        name: data.name,
        frontTemplateId: data.frontTemplateId,
        backTemplateId: data.backTemplateId,
        cadence: data.cadence || 'one_time',
        toAddress: toAddresses,
        status: 'active',
        meta: {},
      })

      logger.info('Seed created successfully', {
        seedId: seed.id,
        seedName: seed.name,
        userId: user.id,
        addressesCount: Array.isArray(seed.toAddress) ? seed.toAddress.length : 1,
      })

      return response.redirect().toRoute('seeds.show', { id: seed.id })
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
      .where('id', params.id)
      .where('user_id', user.id)
      .preload('proofs', (query) => {
        query.orderBy('created_at', 'desc')
      })
      .firstOrFail()

    // Format seed and proofs data
    const proofsData = seed.proofs.map((proof) => ({
      id: proof.id,
      status: proof.status,
      createdAt: proof.createdAt.toFormat('MMM dd, yyyy HH:mm'),
      showUrl: router.makeUrl('proofs.show', { id: proof.id }),
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
      name: seed.name,
      frontTemplateId: seed.frontTemplateId,
      backTemplateId: seed.backTemplateId,
      status: seed.status,
      cadence: seed.cadence,
      addresses: addressesData,
      statusClass:
        seed.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800',
      proofs: proofsData,
      proofsBase64,
      runUrl: router.makeUrl('seeds.run', { id: seed.id }),
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
      logger.info('Running seed', { seedId: params.id, userId: user.id })

      const seed = await Seed.query().where('id', params.id).where('user_id', user.id).firstOrFail()
      logger.info('Seed found', { seedId: seed.id, seedName: seed.name })

      if (!user.lobApiKey) {
        logger.warn('Seed run attempted without Lob API key', {
          seedId: seed.id,
          userId: user.id,
        })
        return response.redirect().toRoute('settings.edit')
      }

      const lobClientModule = await import('#services/lob_client')
      const LobClient = lobClientModule.default
      const proofModule = await import('#models/proof')
      const Proof = proofModule.default

      // Ensure toAddress is an array
      const addresses = Array.isArray(seed.toAddress) ? seed.toAddress : [seed.toAddress]

      logger.info('Creating postcards via Lob API', {
        seedId: seed.id,
        frontTemplateId: seed.frontTemplateId,
        backTemplateId: seed.backTemplateId,
        addressCount: addresses.length,
      })

      const createdProofs = []
      const errors = []

      // Create a postcard for each address
      for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i]
        try {
          logger.info(`Creating postcard ${i + 1} of ${addresses.length}`, {
            seedId: seed.id,
            addressIndex: i,
            toAddress: address,
          })

          const result = await LobClient.createPostcard(user, {
            toAddress: address,
            frontTemplateId: seed.frontTemplateId,
            backTemplateId: seed.backTemplateId,
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
          logger.error(`Error creating postcard for address ${i + 1}`, {
            seedId: seed.id,
            addressIndex: i,
            error: error.message,
            stack: error.stack,
          })
          errors.push({ addressIndex: i, error: error.message })
        }
      }

      if (errors.length > 0) {
        const successCount = createdProofs.length
        const errorCount = errors.length
        if (successCount > 0) {
          session.flash(
            'success',
            `Seed run partially successful! ${successCount} postcard(s) created, ${errorCount} failed.`
          )
        } else {
          session.flash('errors', {
            general: `Failed to create postcards. ${errorCount} error(s) occurred.`,
          })
        }
      } else {
        session.flash(
          'success',
          `Seed run successfully! ${createdProofs.length} postcard(s) created.`
        )
      }
      return response.redirect().toRoute('seeds.show', { id: seed.id })
    } catch (error: any) {
      // Enhanced error logging
      const errorDetails: any = {
        seedId: params.id,
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
}
