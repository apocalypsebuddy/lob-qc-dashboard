import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import router from '@adonisjs/core/services/router'
import Proof from '#models/proof'
import { updateProofValidator, updateProofStatusValidator } from '#validators/proof'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LobClient from '#services/lob_client'
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

    const proofsData = proofs.map((proof) => ({
      id: proof.id,
      seedId: proof.seedId,
      seedName: proof.seedName || (proof.seed ? proof.seed.name : 'Unknown Seed'),
      seedShowUrl: proof.seedId ? router.makeUrl('seeds.show', { id: proof.seedId }) : null,
      status: proof.status,
      createdAt: proof.createdAt.toFormat('MMM dd, yyyy'),
      mailedAt: proof.mailedAt ? proof.mailedAt.toFormat('MMM dd, yyyy') : null,
      deliveredAt: proof.deliveredAt ? proof.deliveredAt.toFormat('MMM dd, yyyy') : null,
      showUrl: router.makeUrl('proofs.show', { id: proof.id }),
      deleteUrl: router.makeUrl('proofs.destroy', { id: proof.id }),
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
      .where('id', params.id)
      .where('user_id', user.id)
      .preload('seed')
      .firstOrFail()

    // Handle orphaned proofs (seedId is null)
    const isOrphaned = proof.seedId === null
    const seedName = proof.seedName || (proof.seed ? proof.seed.name : 'Unknown Seed')
    const seedShowUrl = proof.seedId ? router.makeUrl('seeds.show', { id: proof.seedId }) : null

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

    const proofData = {
      id: proof.id,
      seedId: proof.seedId,
      seedName,
      seedShowUrl,
      isOrphaned,
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
      uploadUrl: router.makeUrl('proofs.upload', { id: proof.id }),
      updateUrl: router.makeUrl('proofs.update', { id: proof.id }),
      updateStatusUrl: router.makeUrl('proofs.updateStatus', { id: proof.id }),
      lobDetails,
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
        .where('id', params.id)
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
        proofId: params.id,
        error: error.message,
        stack: error.stack,
        code: error.code,
      })
      throw error
    }
  }

  async showUploadForm({ params, view, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const proof = await Proof.query().where('id', params.id).where('user_id', user.id).firstOrFail()

    const proofData = {
      id: proof.id,
      showUrl: router.makeUrl('proofs.show', { id: proof.id }),
      uploadUrl: router.makeUrl('proofs.uploadLiveProof', { id: proof.id }),
    }

    const csrfToken = request.csrfToken

    return view.render('proofs/upload', { proof: proofData, csrfToken })
  }

  async uploadLiveProof({ params, request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Uploading live proof', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()
      logger.info('Proof found for upload', {
        proofId: proof.id,
        resourceId: proof.resourceId,
      })

      const file = request.file('photo', {
        size: '4mb',
        extnames: ['jpg', 'jpeg', 'png'],
      })

      if (!file) {
        logger.warn('No file uploaded', { proofId: proof.id })
        return response.redirect().back()
      }

      if (!file.isValid) {
        logger.warn('Invalid file uploaded', {
          proofId: proof.id,
          errors: file.errors,
          fileName: file.fileName,
          size: file.size,
        })
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

      // Upload to live-proof service
      const liveProofServiceModule = await import('#services/live_proof_service')
      const LiveProofService = liveProofServiceModule.default

      logger.info('Uploading scan to live-proof service', {
        resourceId: proof.resourceId,
        tempPath,
      })
      await LiveProofService.uploadScan(proof.resourceId, tempPath)
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

      // Clean up temp file
      try {
        await unlink(tempPath).catch(() => {})
        logger.info('Temp file cleaned up', { tempPath })
      } catch (error: any) {
        logger.warn('Failed to clean up temp file', { tempPath, error: error.message })
      }

      return response.redirect().toRoute('proofs.show', { id: proof.id })
    } catch (error: any) {
      logger.error('Error uploading live proof', {
        proofId: params.id,
        error: error.message,
        stack: error.stack,
      })
      return response.redirect().back()
    }
  }

  async updateStatus({ params, request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Updating proof status (dev)', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('id', params.id)
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
        proofId: params.id,
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

  async destroy({ params, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Deleting proof', { proofId: params.id, userId: user.id })

      const proof = await Proof.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      const seedId = proof.seedId
      await proof.delete()

      logger.info('Proof deleted successfully', {
        proofId: params.id,
        userId: user.id,
        seedId,
      })

      session.flash('success', 'Proof deleted successfully!')

      // Redirect to seed show page if seed exists, otherwise to proofs index
      if (seedId) {
        return response.redirect().toRoute('seeds.show', { id: seedId })
      } else {
        return response.redirect().toRoute('proofs.index')
      }
    } catch (error: any) {
      logger.error('Error deleting proof', {
        proofId: params.id,
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
}
