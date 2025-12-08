import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Proof from '#models/proof'

export default class WebhooksController {
  async store({ request, response }: HttpContext) {
    const body = request.body()

    // TODO: Verify webhook signature in production
    const eventType = body.type as string
    const resourceId = body.data?.id as string

    if (!resourceId) {
      return response.status(204).send('No resource ID')
    }

    const proof = await Proof.findBy('resource_id', resourceId)

    if (!proof) {
      return response.status(204).send('Proof not found')
    }

    if (eventType.endsWith('.mailed')) {
      proof.status = 'mailed'
      if (body.data?.tracking_number) {
        proof.trackingNumber = body.data.tracking_number
      }
    } else if (eventType.endsWith('.delivered')) {
      proof.status = 'awaiting_review'
      proof.deliveredAt = DateTime.now()
      if (body.data?.tracking_number) {
        proof.trackingNumber = body.data.tracking_number
      }
    }

    await proof.save()

    return response.status(200).send('OK')
  }
}
