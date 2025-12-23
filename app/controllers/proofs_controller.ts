import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import router from '@adonisjs/core/services/router'
import Proof from '#models/proof'
import { updateProofValidator, updateProofStatusValidator } from '#validators/proof'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LobClient from '#services/lob_client'
import ImageResizeService, { MAX_UPLOAD_SIZE_BYTES } from '#services/image_resize_service'
import ScanEventsService from '#services/scan_events_service'
import { DateTime } from 'luxon'

export default class ProofsController {
  async index({ view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const statusFilter = request.qs().status as string | undefined

    const query = Proof.query().where('user_id', user.id).preload('seed')

    // Apply status filter if provided
    if (statusFilter && statusFilter !== 'all') {
      query.where('status', statusFilter)
    }

    const proofs = await query.orderBy('created_at', 'desc')

    // Fetch thumbnails from Lob API for proofs that don't have them
    const thumbnailPromises = proofs.map(async (proof) => {
      let frontThumbnailUrl = proof.frontThumbnailUrl || proof.thumbnailUrl || null

      // If no thumbnail, try to fetch from Lob API
      if (!frontThumbnailUrl && proof.resourceId) {
        try {
          const lobPostcard = await LobClient.getPostcard(user, proof.resourceId)
          if (lobPostcard.thumbnails && lobPostcard.thumbnails.length > 0) {
            const frontThumbnail = lobPostcard.thumbnails[0]
            frontThumbnailUrl =
              frontThumbnail.large || frontThumbnail.medium || frontThumbnail.small || null

            // Optionally save to database for future use
            if (frontThumbnailUrl && !proof.frontThumbnailUrl) {
              proof.frontThumbnailUrl = frontThumbnailUrl
              await proof.save()
            }
          }
        } catch (error: any) {
          logger.warn('Failed to fetch thumbnail from Lob API', {
            proofId: proof.id,
            resourceId: proof.resourceId,
            error: error.message,
          })
          // Continue without thumbnail
        }
      }

      return {
        proofId: proof.id,
        frontThumbnailUrl,
      }
    })

    const thumbnailResults = await Promise.all(thumbnailPromises)
    const thumbnailMap = new Map(
      thumbnailResults.map((result) => [result.proofId, result.frontThumbnailUrl])
    )

    const proofsData = proofs.map((proof) => ({
      id: proof.id,
      seedId: proof.seedId,
      seedName: proof.seedName || (proof.seed ? proof.seed.name : 'Unknown Seed'),
      seedShowUrl: proof.seed?.publicId
        ? router.makeUrl('seeds.show', { publicId: proof.seed.publicId })
        : null,
      publicId: proof.publicId,
      status: proof.status,
      frontThumbnailUrl:
        thumbnailMap.get(proof.id) || proof.frontThumbnailUrl || proof.thumbnailUrl || null,
      createdAt: proof.createdAt.toFormat('MMM dd, yyyy HH:mm'),
      mailedAt: proof.mailedAt ? proof.mailedAt.toFormat('MMM dd, yyyy') : null,
      deliveredAt: proof.deliveredAt ? proof.deliveredAt.toFormat('MMM dd, yyyy') : null,
      showUrl: router.makeUrl('proofs.show', { publicId: proof.publicId }),
      deleteUrl: router.makeUrl('proofs.destroy', { publicId: proof.publicId }),
    }))

    // Encode proofs data as base64 to avoid HTML escaping issues
    const proofsJson = JSON.stringify(proofsData)
    const proofsBase64 = Buffer.from(proofsJson, 'utf-8').toString('base64')

    const csrfToken = request.csrfToken

    return view.render('proofs/index', {
      proofs: proofsData,
      proofsBase64,
      csrfToken,
      statusFilter: statusFilter || 'all',
    })
  }

  async show({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const proof = await Proof.query()
      .where('public_id', params.publicId)
      .where('user_id', user.id)
      .preload('seed')
      .firstOrFail()

    // Handle orphaned proofs (seedId is null)
    const isOrphaned = proof.seedId === null
    const seedName = proof.seedName || (proof.seed ? proof.seed.name : 'Unknown Seed')
    const seedShowUrl = proof.seed?.publicId
      ? router.makeUrl('seeds.show', { publicId: proof.seed.publicId })
      : null

    // Fetch additional details from Lob API
    let lobDetails = null
    let frontThumbnailUrl = proof.frontThumbnailUrl
    let backThumbnailUrl = proof.backThumbnailUrl

    try {
      const lobPostcard = await LobClient.getPostcard(user, proof.resourceId)
      lobDetails = {
        size: lobPostcard.size || null,
        mailType: lobPostcard.mail_type || null,
        dateCreated: lobPostcard.date_created
          ? DateTime.fromISO(lobPostcard.date_created).toFormat('MMM dd, yyyy HH:mm')
          : null,
        sendDate: lobPostcard.send_date
          ? DateTime.fromISO(lobPostcard.send_date).toFormat('MMM dd, yyyy HH:mm')
          : null,
        expectedDeliveryDate: lobPostcard.expected_delivery_date || null,
        url: lobPostcard.url || null,
        rawUrl: lobPostcard.raw_url || null,
      }

      // Extract thumbnail URLs from API if not available in database
      if (!frontThumbnailUrl && lobPostcard.thumbnails && lobPostcard.thumbnails.length > 0) {
        const frontThumbnail = lobPostcard.thumbnails[0]
        frontThumbnailUrl =
          frontThumbnail.large || frontThumbnail.medium || frontThumbnail.small || null
        logger.info('Fetched front thumbnail from Lob API', {
          proofId: proof.id,
          frontThumbnailUrl,
        })
      }

      if (!backThumbnailUrl && lobPostcard.thumbnails && lobPostcard.thumbnails.length > 1) {
        const backThumbnail = lobPostcard.thumbnails[1]
        backThumbnailUrl =
          backThumbnail.large || backThumbnail.medium || backThumbnail.small || null
        logger.info('Fetched back thumbnail from Lob API', {
          proofId: proof.id,
          backThumbnailUrl,
        })
      }
    } catch (error: any) {
      logger.error('Failed to fetch Lob postcard details', {
        proofId: proof.id,
        resourceId: proof.resourceId,
        error: error.message,
        errorStack: error.stack,
      })
      // Continue without Lob details - they'll just be null
    }

    // Fetch scan events for live proofs
    let scanEvents = null
    if (proof.resourceId) {
      try {
        const scanEventsResponse = await ScanEventsService.getScanEventByResourceId(
          proof.resourceId
        )
        // Sort items by timestamp descending (most recent first)
        const sortedItems = [...(scanEventsResponse.items || [])].sort((a, b) => {
          const timestampA = new Date(a.timestamp || a.created_at || 0).getTime()
          const timestampB = new Date(b.timestamp || b.created_at || 0).getTime()
          return timestampB - timestampA
        })
        scanEvents = {
          items: sortedItems,
          count: scanEventsResponse.count || sortedItems.length,
          hasMore: scanEventsResponse.hasMore || false,
        }
        logger.info('Fetched scan events', {
          proofId: proof.id,
          resourceId: proof.resourceId,
          count: scanEvents.count,
        })
      } catch (error: any) {
        logger.warn('Failed to fetch scan events', {
          proofId: proof.id,
          resourceId: proof.resourceId,
          error: error.message,
        })
        // Continue without scan events - they'll just be null
      }
    }

    const proofData = {
      id: proof.id,
      seedId: proof.seedId,
      seedName,
      seedShowUrl,
      isOrphaned,
      publicId: proof.publicId,
      status: proof.status,
      resourceId: proof.resourceId,
      trackingNumber: proof.trackingNumber,
      createdAt: proof.createdAt.toFormat('MMM dd, yyyy HH:mm'),
      mailedAt: proof.mailedAt ? proof.mailedAt.toFormat('MMM dd, yyyy HH:mm') : null,
      deliveredAt: proof.deliveredAt ? proof.deliveredAt.toFormat('MMM dd, yyyy HH:mm') : null,
      thumbnailUrl: proof.thumbnailUrl,
      frontThumbnailUrl,
      backThumbnailUrl,
      liveProofUrl: proof.liveProofUrl,
      qualityRating: proof.qualityRating,
      printerVendor: proof.printerVendor,
      notes: proof.notes,
      uploadUrl: router.makeUrl('proofs.upload', { publicId: proof.publicId }),
      updateUrl: router.makeUrl('proofs.update', { publicId: proof.publicId }),
      updateStatusUrl: router.makeUrl('proofs.updateStatus', { publicId: proof.publicId }),
      lobDetails,
      scanEvents,
    }

    // Encode proof data as base64 to avoid HTML escaping issues
    const proofJson = JSON.stringify(proofData)
    const proofBase64 = Buffer.from(proofJson, 'utf-8').toString('base64')

    const csrfToken = request.csrfToken

    return view.render('proofs/show', { proof: proofData, proofBase64, csrfToken })
  }

  async update({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Updating proof review', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()

      const data = await request.validateUsing(updateProofValidator)
      logger.info('Proof review form validated', {
        proofId: proof.id,
        qualityRating: data.qualityRating,
        hasPrinterVendor: !!data.printerVendor,
        hasNotes: !!data.notes,
      })

      proof.qualityRating = data.qualityRating || null
      proof.printerVendor = data.printerVendor || null
      proof.notes = data.notes || null
      proof.status = 'completed'
      await proof.save()

      logger.info('Proof review updated successfully', {
        proofId: proof.id,
        qualityRating: proof.qualityRating,
        status: proof.status,
      })

      return response.redirect().back()
    } catch (error: any) {
      logger.error('Error updating proof review', {
        proofPublicId: params.publicId,
        error: error.message,
        stack: error.stack,
        code: error.code,
      })
      throw error
    }
  }

  async showUploadForm({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const proof = await Proof.query()
      .where('public_id', params.publicId)
      .where('user_id', user.id)
      .firstOrFail()

    const proofData = {
      id: proof.id,
      showUrl: router.makeUrl('proofs.show', { publicId: proof.publicId }),
      uploadUrl: router.makeUrl('proofs.uploadLiveProof', { publicId: proof.publicId }),
    }

    const csrfToken = request.csrfToken

    return view.render('proofs/upload', { proof: proofData, csrfToken })
  }

  async uploadLiveProof({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Uploading live proof', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()
      logger.info('Proof found for upload', {
        proofId: proof.id,
        resourceId: proof.resourceId,
      })

      // Log all files in the request for debugging
      const allFiles = request.allFiles()
      logger.info(
        {
          proofId: proof.id,
          fileKeys: Object.keys(allFiles),
          files: Object.entries(allFiles).map(([key, f]) => ({
            key,
            fileName: Array.isArray(f) ? f.map((x) => x.clientName) : (f as any)?.clientName,
            extname: Array.isArray(f) ? f.map((x) => x.extname) : (f as any)?.extname,
            type: Array.isArray(f) ? f.map((x) => x.type) : (f as any)?.type,
            subtype: Array.isArray(f) ? f.map((x) => x.subtype) : (f as any)?.subtype,
          })),
        },
        'All files in request'
      )

      const file = request.file('photo', {
        size: '50mb', // Allow larger files initially, will be resized to under 4MB
        extnames: [
          'jpg',
          'jpeg',
          'png',
          'heic',
          'heif',
          'webp',
          'JPG',
          'JPEG',
          'PNG',
          'HEIC',
          'HEIF',
          'WEBP',
        ],
      })

      if (!file) {
        logger.warn({ proofId: proof.id }, 'No file uploaded')
        return response.redirect().back()
      }

      // Log detailed file info for debugging
      logger.info(
        {
          proofId: proof.id,
          clientName: file.clientName,
          fileName: file.fileName,
          extname: file.extname,
          type: file.type,
          subtype: file.subtype,
          size: file.size,
          isValid: file.isValid,
          errors: file.errors,
        },
        'File details before validation'
      )

      if (!file.isValid) {
        logger.warn(
          {
            proofId: proof.id,
            errors: file.errors,
            clientName: file.clientName,
            fileName: file.fileName,
            extname: file.extname,
            type: file.type,
            subtype: file.subtype,
            size: file.size,
          },
          'Invalid file uploaded'
        )
        return response.redirect().back()
      }

      logger.info('File validated', {
        proofId: proof.id,
        fileName: file.fileName,
        size: file.size,
        extname: file.extname,
      })

      // Save file to temp location
      const tempDir = tmpdir()
      await file.move(tempDir, { overwrite: true })
      const tempPath = join(tempDir, file.fileName!)
      logger.info('File saved to temp location', { tempPath, proofId: proof.id })

      // Resize image if needed to ensure it's under 4MB
      const filePathToUpload = await ImageResizeService.resizeImageIfNeeded(
        tempPath,
        4 * 1024 * 1024
      )
      logger.info('Image resize check completed', {
        originalPath: tempPath,
        uploadPath: filePathToUpload,
        isResized: filePathToUpload !== tempPath,
        proofId: proof.id,
      })

      // Upload to live-proof service
      const liveProofServiceModule = await import('#services/live_proof_service')
      const LiveProofService = liveProofServiceModule.default

      logger.info('Uploading scan to live-proof service', {
        resourceId: proof.resourceId,
        filePath: filePathToUpload,
      })
      await LiveProofService.uploadScan(proof.resourceId, filePathToUpload)
      logger.info('Scan uploaded successfully', { resourceId: proof.resourceId })

      // Get the latest scan URL
      const scansResult = await LiveProofService.getScans(proof.resourceId)
      const latestScan = scansResult.items?.[0]
      logger.info('Retrieved scans', {
        resourceId: proof.resourceId,
        scanCount: scansResult.items?.length || 0,
        hasLatestScan: !!latestScan,
      })

      if (latestScan?.url) {
        proof.liveProofUrl = latestScan.url
        await proof.save()
        logger.info('Proof updated with live proof URL', {
          proofId: proof.id,
          liveProofUrl: latestScan.url,
        })
      } else {
        logger.warn('No scan URL found in response', {
          proofId: proof.id,
          resourceId: proof.resourceId,
        })
      }

      // Clean up temp files (both original and resized if different)
      try {
        await unlink(tempPath).catch(() => {})
        logger.info('Original temp file cleaned up', { tempPath })

        // If a resized file was created, clean it up too
        if (filePathToUpload !== tempPath) {
          await unlink(filePathToUpload).catch(() => {})
          logger.info('Resized temp file cleaned up', { resizedPath: filePathToUpload })
        }
      } catch (error: any) {
        logger.warn('Failed to clean up temp file(s)', {
          tempPath,
          resizedPath: filePathToUpload !== tempPath ? filePathToUpload : undefined,
          error: error.message,
        })
      }

      return response.redirect().toRoute('proofs.show', { publicId: proof.publicId })
    } catch (error: any) {
      logger.error(
        {
          proofPublicId: params.publicId,
          error: error.message,
          errorName: error.name,
          errorCode: error.code,
          stack: error.stack,
          cause: error.cause,
        },
        'Error uploading live proof'
      )
      return response.redirect().back()
    }
  }

  async updateStatus({ params, request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Updating proof status (dev)', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()

      const data = await request.validateUsing(updateProofStatusValidator)
      logger.info('Proof status update validated', {
        proofId: proof.id,
        oldStatus: proof.status,
        newStatus: data.status,
      })

      proof.status = data.status
      await proof.save()

      logger.info('Proof status updated successfully', {
        proofId: proof.id,
        status: proof.status,
      })

      session.flash('success', `Proof status updated to ${proof.status}`)
      return response.redirect().back()
    } catch (error: any) {
      logger.error('Error updating proof status', {
        proofPublicId: params.publicId,
        error: error.message,
        stack: error.stack,
        code: error.code,
      })
      session.flash('errors', {
        general: 'Failed to update proof status. Please try again.',
      })
      return response.redirect().back()
    }
  }

  async destroy({ params, request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Deleting proof', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('public_id', params.publicId)
        .where('user_id', user.id)
        .firstOrFail()

      const seedId = proof.seedId
      await proof.delete()

      logger.info('Proof deleted successfully', {
        proofPublicId: params.publicId,
        userId: user.id,
        seedId,
      })

      session.flash('success', 'Proof deleted successfully!')

      // Check referrer to determine redirect destination
      const referer = request.header('referer') || ''
      // If coming from a seed show page, redirect back to that seed page
      // Match /seeds/:publicId pattern (capture publicId before any query params or fragments)
      const seedShowMatch = referer.match(/\/seeds\/([^\/\?\#]+)/)
      if (seedShowMatch && seedShowMatch[1]) {
        const refererSeedPublicId = seedShowMatch[1]
        logger.info('Redirecting to seed show page based on referer', {
          refererSeedPublicId,
          referer,
          proofPublicId: params.publicId,
        })
        return response.redirect().toRoute('seeds.show', { publicId: refererSeedPublicId })
      }

      // Otherwise, redirect to proofs index
      logger.info('Redirecting to proofs index', {
        proofPublicId: params.publicId,
      })
      return response.redirect().toRoute('proofs.index')
    } catch (error: any) {
      logger.error('Error deleting proof', {
        proofPublicId: params.publicId,
        userId: auth.user?.id,
        error: error.message,
        stack: error.stack,
      })
      session.flash('errors', {
        general: 'Failed to delete proof. Please try again.',
      })
      return response.redirect().back()
    }
  }

  async indexOrphanProofs({ view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const csrfToken = request.csrfToken

    try {
      const scanEvents = await ScanEventsService.getScanEvents()
      const groups = scanEvents.groups || []
      logger.info(
        `Fetched scan events for orphan proofs - groups count: ${groups.length}, total resources: ${scanEvents.summary?.total_resources || 0}`
      )

      // Generate URLs for each group
      const groupsWithUrls = groups.map((group) => ({
        ...group,
        showUrl: router.makeUrl('proofs.showOrphanProof', { resourceId: group.resource_id }),
      }))

      logger.info(`Processed groups with URLs - count: ${groupsWithUrls.length}`)

      // Encode groups data as base64 to avoid HTML escaping issues
      const groupsJson = JSON.stringify(groupsWithUrls)
      const groupsBase64 = Buffer.from(groupsJson, 'utf-8').toString('base64')

      // Encode user email as base64 to avoid HTML escaping issues
      logger.info(`User email before encoding: "${user.email}" (length: ${user.email?.length})`)
      const userEmailBase64 = Buffer.from(user.email || '', 'utf-8').toString('base64')
      logger.info(`User email base64: ${userEmailBase64}`)

      return view.render('proofs/orphan-index', {
        groups: groupsWithUrls,
        groupsBase64,
        csrfToken,
        userEmail: user.email,
        userEmailBase64,
      })
    } catch (error: any) {
      logger.error('Error fetching orphan proofs', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      })
      // Encode user email as base64 to avoid HTML escaping issues
      logger.info(
        `User email before encoding (error case): "${user.email}" (length: ${user.email?.length})`
      )
      const userEmailBase64 = Buffer.from(user.email || '', 'utf-8').toString('base64')
      logger.info(`User email base64 (error case): ${userEmailBase64}`)

      return view.render('proofs/orphan-index', {
        groups: [],
        groupsBase64: Buffer.from(JSON.stringify([]), 'utf-8').toString('base64'),
        csrfToken,
        userEmail: user.email,
        userEmailBase64,
        error: `Failed to load orphan proofs: ${error.message}`,
      })
    }
  }

  async indexFactoryProofs({ view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const csrfToken = request.csrfToken

    try {
      const scanEvents = await ScanEventsService.getScanEvents()
      const groups = scanEvents.groups || []
      logger.info(
        `Fetched scan events for factory proofs - groups count: ${groups.length}, total resources: ${scanEvents.summary?.total_resources || 0}`
      )

      // Generate URLs for each group
      const groupsWithUrls = groups.map((group) => ({
        ...group,
        showUrl: router.makeUrl('proofs.showFactoryProof', { resourceId: group.resource_id }),
      }))

      logger.info(`Processed groups with URLs - count: ${groupsWithUrls.length}`)

      // Encode groups data as base64 to avoid HTML escaping issues
      const groupsJson = JSON.stringify(groupsWithUrls)
      const groupsBase64 = Buffer.from(groupsJson, 'utf-8').toString('base64')

      return view.render('proofs/factory-index', {
        groups: groupsWithUrls,
        groupsBase64,
        csrfToken,
      })
    } catch (error: any) {
      logger.error('Error fetching factory proofs', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      })
      return view.render('proofs/factory-index', {
        groups: [],
        groupsBase64: Buffer.from(JSON.stringify([]), 'utf-8').toString('base64'),
        csrfToken,
        error: `Failed to load factory proofs: ${error.message}`,
      })
    }
  }

  async showOrphanProof({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const csrfToken = request.csrfToken
    const resourceId = params.resourceId

    try {
      const scanEvent = await ScanEventsService.getScanEventByResourceId(resourceId)
      const items = scanEvent.items || []

      // Sort items by timestamp descending
      const sortedItems = [...items].sort((a, b) => {
        const timestampA = new Date(a.timestamp || a.created_at || 0).getTime()
        const timestampB = new Date(b.timestamp || b.created_at || 0).getTime()
        return timestampB - timestampA
      })

      // Encode data as base64
      const dataJson = JSON.stringify({ resourceId, items: sortedItems })
      const dataBase64 = Buffer.from(dataJson, 'utf-8').toString('base64')

      return view.render('proofs/orphan-show', {
        resourceId,
        items: sortedItems,
        dataBase64,
        csrfToken,
      })
    } catch (error: any) {
      logger.error('Error fetching orphan proof detail', {
        userId: user.id,
        resourceId,
        error: error.message,
        stack: error.stack,
      })
      return view.render('proofs/orphan-show', {
        resourceId,
        items: [],
        dataBase64: Buffer.from(JSON.stringify({ resourceId, items: [] }), 'utf-8').toString(
          'base64'
        ),
        csrfToken,
        error: 'Failed to load proof details. Please try again.',
      })
    }
  }

  async showFactoryProof({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const csrfToken = request.csrfToken
    const resourceId = params.resourceId

    try {
      const scanEvent = await ScanEventsService.getScanEventByResourceId(resourceId)
      const items = scanEvent.items || []

      // Sort items by timestamp descending
      const sortedItems = [...items].sort((a, b) => {
        const timestampA = new Date(a.timestamp || a.created_at || 0).getTime()
        const timestampB = new Date(b.timestamp || b.created_at || 0).getTime()
        return timestampB - timestampA
      })

      // Encode data as base64
      const dataJson = JSON.stringify({ resourceId, items: sortedItems })
      const dataBase64 = Buffer.from(dataJson, 'utf-8').toString('base64')

      return view.render('proofs/factory-show', {
        resourceId,
        items: sortedItems,
        dataBase64,
        csrfToken,
      })
    } catch (error: any) {
      logger.error('Error fetching factory proof detail', {
        userId: user.id,
        resourceId,
        error: error.message,
        stack: error.stack,
      })
      return view.render('proofs/factory-show', {
        resourceId,
        items: [],
        dataBase64: Buffer.from(JSON.stringify({ resourceId, items: [] }), 'utf-8').toString(
          'base64'
        ),
        csrfToken,
        error: 'Failed to load proof details. Please try again.',
      })
    }
  }

  async uploadOrphanProof({ request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Uploading orphan proof', { userId: user.id })

      const resourceId = request.input('resource_id') as string
      if (!resourceId) {
        session.flash('errors', { general: 'Resource ID is required' })
        return response.redirect().back()
      }

      const batchId = request.input('batch_id') as string | undefined

      // Collect all optional fields
      const optionalFields: Record<string, string> = {}
      const optionalFieldNames = [
        'created_by',
        'receive_date',
        'delivery_quality',
        'delivery_date',
        'mailpiece_count',
        'print_quality',
        'print_quality_tags',
        'product_size',
        'quality_ranking',
        'status',
        'comments',
      ]

      for (const fieldName of optionalFieldNames) {
        const value = request.input(fieldName) as string | undefined
        if (value !== null && value !== undefined && value !== '') {
          optionalFields[fieldName] = value
        }
      }

      const file = request.file('file', {
        size: '50mb', // Allow larger files initially, will be resized to under 2MB
        extnames: [
          'jpg',
          'jpeg',
          'png',
          'heic',
          'heif',
          'webp',
          'JPG',
          'JPEG',
          'PNG',
          'HEIC',
          'HEIF',
          'WEBP',
        ],
      })

      if (!file) {
        session.flash('errors', { general: 'No file uploaded' })
        return response.redirect().back()
      }

      if (!file.isValid) {
        logger.warn('Invalid file uploaded', {
          errors: file.errors,
          fileName: file.fileName,
          size: file.size,
        })
        session.flash('errors', { general: 'Invalid file. Please upload a JPG or PNG image.' })
        return response.redirect().back()
      }

      logger.info('File validated', {
        fileName: file.fileName,
        size: file.size,
        extname: file.extname,
        resourceId,
        batchId,
      })

      // Process main file
      const tempDir = tmpdir()
      await file.move(tempDir, { overwrite: true })
      const tempPath = join(tempDir, file.fileName!)
      logger.info('File saved to temp location', { tempPath, resourceId })

      const filePathToUpload = await ImageResizeService.resizeImageIfNeeded(
        tempPath,
        MAX_UPLOAD_SIZE_BYTES
      )
      logger.info('Image resize check completed', {
        originalPath: tempPath,
        uploadPath: filePathToUpload,
        isResized: filePathToUpload !== tempPath,
        resourceId,
      })

      // Upload main file to scan events service
      logger.info('Uploading scan to scan events service', {
        resourceId,
        filePath: filePathToUpload,
        batchId,
        optionalFields,
      })
      await ScanEventsService.uploadScan(resourceId, filePathToUpload, batchId, optionalFields)
      logger.info('Scan uploaded successfully', { resourceId })

      // Clean up main file temp files
      try {
        await unlink(tempPath).catch(() => {})
        if (filePathToUpload !== tempPath) {
          await unlink(filePathToUpload).catch(() => {})
        }
      } catch (error: any) {
        logger.warn('Failed to clean up temp file(s)', {
          tempPath,
          resizedPath: filePathToUpload !== tempPath ? filePathToUpload : undefined,
          error: error.message,
        })
      }

      // Process additional file if provided
      const additionalFile = request.file('additional_file', {
        size: '50mb',
        extnames: [
          'jpg',
          'jpeg',
          'png',
          'heic',
          'heif',
          'webp',
          'JPG',
          'JPEG',
          'PNG',
          'HEIC',
          'HEIF',
          'WEBP',
        ],
      })

      if (additionalFile && additionalFile.isValid) {
        logger.info('Processing additional file', {
          fileName: additionalFile.fileName,
          size: additionalFile.size,
          resourceId,
        })

        await additionalFile.move(tempDir, { overwrite: true })
        const additionalTempPath = join(tempDir, additionalFile.fileName!)

        const additionalFilePathToUpload = await ImageResizeService.resizeImageIfNeeded(
          additionalTempPath,
          MAX_UPLOAD_SIZE_BYTES
        )

        // Upload additional file to scan events service
        logger.info('Uploading additional scan to scan events service', {
          resourceId,
          filePath: additionalFilePathToUpload,
          batchId,
          optionalFields,
        })
        await ScanEventsService.uploadScan(
          resourceId,
          additionalFilePathToUpload,
          batchId,
          optionalFields
        )
        logger.info('Additional scan uploaded successfully', { resourceId })

        // Clean up additional file temp files
        try {
          await unlink(additionalTempPath).catch(() => {})
          if (additionalFilePathToUpload !== additionalTempPath) {
            await unlink(additionalFilePathToUpload).catch(() => {})
          }
        } catch (error: any) {
          logger.warn('Failed to clean up additional temp file(s)', {
            tempPath: additionalTempPath,
            resizedPath:
              additionalFilePathToUpload !== additionalTempPath
                ? additionalFilePathToUpload
                : undefined,
            error: error.message,
          })
        }
      }

      session.flash('success', 'Proof uploaded successfully!')
      return response.redirect().toRoute('proofs.indexOrphanProofs')
    } catch (error: any) {
      logger.error('Error uploading orphan proof', {
        userId: auth.user?.id,
        error: error.message,
        stack: error.stack,
      })
      session.flash('errors', {
        general: 'Failed to upload proof. Please try again.',
      })
      return response.redirect().back()
    }
  }

  async uploadFactoryProof({ request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Uploading factory proof(s)', { userId: user.id })

      const files = request.files('files', {
        size: '50mb', // Allow larger files initially, will be resized to under 2MB
        extnames: [
          'jpg',
          'jpeg',
          'png',
          'heic',
          'heif',
          'webp',
          'JPG',
          'JPEG',
          'PNG',
          'HEIC',
          'HEIF',
          'WEBP',
        ],
      })

      if (!files || files.length === 0) {
        session.flash('errors', { general: 'No files uploaded' })
        return response.redirect().back()
      }

      const tempDir = tmpdir()
      const uploadPromises: Promise<void>[] = []
      const tempPaths: string[] = []

      for (const file of files) {
        if (!file.isValid) {
          logger.warn('Invalid file in upload', {
            errors: file.errors,
            fileName: file.fileName,
            size: file.size,
          })
          continue
        }

        // Parse filename to extract resource_id
        // Format: resourceId_01.png, resourceId_02.jpg, etc.
        const fileName = file.fileName || ''
        const match = fileName.match(/^(.+?)_(\d+)(\.[^.]+)?$/)
        if (!match) {
          logger.warn('Filename does not match expected pattern', { fileName })
          continue
        }

        const resourceId = match[1]
        const sequence = match[2]

        logger.info('Processing file', {
          fileName,
          resourceId,
          sequence,
          size: file.size,
        })

        // Save file to temp location
        await file.move(tempDir, { overwrite: true })
        const tempPath = join(tempDir, file.fileName!)
        tempPaths.push(tempPath)

        // Resize image if needed
        const filePathToUpload = await ImageResizeService.resizeImageIfNeeded(
          tempPath,
          MAX_UPLOAD_SIZE_BYTES
        )

        // Upload to scan events service
        uploadPromises.push(
          ScanEventsService.uploadScan(resourceId, filePathToUpload)
            .then(() => {
              logger.info('Scan uploaded successfully', { resourceId, fileName })
            })
            .catch((error: any) => {
              logger.error('Failed to upload scan', {
                resourceId,
                fileName,
                error: error.message,
              })
              throw error
            })
            .finally(() => {
              // Clean up temp files
              unlink(tempPath).catch(() => {})
              if (filePathToUpload !== tempPath) {
                unlink(filePathToUpload).catch(() => {})
              }
            })
        )
      }

      await Promise.all(uploadPromises)

      session.flash('success', `Successfully uploaded ${uploadPromises.length} proof(s)!`)
      return response.redirect().toRoute('proofs.indexFactoryProofs')
    } catch (error: any) {
      logger.error('Error uploading factory proof', {
        userId: auth.user?.id,
        error: error.message,
        stack: error.stack,
      })
      session.flash('errors', {
        general: 'Failed to upload proof(s). Please try again.',
      })
      return response.redirect().back()
    }
  }

  async detectResourceId({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Detecting resource ID', { userId: user.id })

      const file = request.file('file', {
        size: '50mb',
        extnames: [
          'jpg',
          'jpeg',
          'png',
          'heic',
          'heif',
          'webp',
          'JPG',
          'JPEG',
          'PNG',
          'HEIC',
          'HEIF',
          'WEBP',
        ],
      })

      if (!file) {
        return response.status(400).json({ error: 'No file uploaded' })
      }

      if (!file.isValid) {
        return response.status(400).json({ error: 'Invalid file' })
      }

      // Save file to temp location
      const tempDir = tmpdir()
      await file.move(tempDir, { overwrite: true })
      const tempPath = join(tempDir, file.fileName!)

      try {
        // Call detection service (placeholder for now)
        const result = await ScanEventsService.detectResourceId(tempPath)
        return response.json(result)
      } catch (error: any) {
        logger.error('Error detecting resource ID', {
          error: error.message,
          stack: error.stack,
        })
        return response.status(500).json({
          error: 'Resource ID detection is not yet implemented',
        })
      } finally {
        // Clean up temp file
        await unlink(tempPath).catch(() => {})
      }
    } catch (error: any) {
      logger.error('Error in detectResourceId', {
        userId: auth.user?.id,
        error: error.message,
        stack: error.stack,
      })
      return response.status(500).json({ error: 'Failed to detect resource ID' })
    }
  }
}
