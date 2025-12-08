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

      const data = await request.validateUsing(createSeedValidator)
      logger.info('Seed form validated', { seedName: data.name, userId: user.id })

      const seed = await Seed.create({
        userId: user.id,
        name: data.name,
        frontTemplateId: data.frontTemplateId,
        backTemplateId: data.backTemplateId,
        cadence: data.cadence || 'one_time',
        toAddress: {
          name: data.toName || undefined,
          company: data.company || undefined,
          address_line1: data.addressLine1,
          address_line2: data.addressLine2 || undefined,
          address_city: data.addressCity,
          address_state: data.addressState,
          address_zip: data.addressZip,
          address_country: data.addressCountry || 'US',
          phone: data.phone || undefined,
          email: data.email || undefined,
          description: data.description || undefined,
        },
        status: 'active',
        meta: {},
      })

      logger.info('Seed created successfully', {
        seedId: seed.id,
        seedName: seed.name,
        userId: user.id,
      })

      return response.redirect().toRoute('seeds.show', { id: seed.id })
    } catch (error: any) {
      logger.error('Error creating seed', {
        error: error.message,
        stack: error.stack,
        code: error.code,
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

    const seedData = {
      id: seed.id,
      name: seed.name,
      frontTemplateId: seed.frontTemplateId,
      backTemplateId: seed.backTemplateId,
      status: seed.status,
      cadence: seed.cadence,
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

      logger.info('Creating postcard via Lob API', {
        seedId: seed.id,
        frontTemplateId: seed.frontTemplateId,
        backTemplateId: seed.backTemplateId,
        toAddress: seed.toAddress,
      })

      const result = await LobClient.createPostcard(user, {
        toAddress: seed.toAddress,
        frontTemplateId: seed.frontTemplateId,
        backTemplateId: seed.backTemplateId,
      })

      logger.info('Postcard created successfully', {
        resourceId: result.id,
        lobUrl: result.url,
        thumbnailUrl: result.thumbnail_url,
        thumbnailUrlLength: result.thumbnail_url?.length || 0,
        seedId: seed.id,
      })

      logger.info('Creating proof record', {
        userId: user.id,
        seedId: seed.id,
        resourceId: result.id,
        lobUrl: result.url,
        thumbnailUrl: result.thumbnail_url,
        thumbnailUrlLength: result.thumbnail_url?.length || 0,
        status: 'created',
      })

      const proof = await Proof.create({
        userId: user.id,
        seedId: seed.id,
        resourceId: result.id,
        lobUrl: result.url,
        thumbnailUrl: result.thumbnail_url,
        status: 'created',
      })

      logger.info('Proof created successfully', {
        proofId: proof.id,
        resourceId: result.id,
        seedId: seed.id,
      })

      session.flash('success', 'Seed run successfully! Postcard created.')
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
