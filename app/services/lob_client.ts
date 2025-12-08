import User from '#models/user'
import logger from '@adonisjs/core/services/logger'

interface LobAddressObject {
  name?: string
  company?: string
  address_line1: string
  address_line2?: string
  address_city: string
  address_state: string
  address_zip: string
  address_country?: string
  phone?: string
  email?: string
  description?: string
}

interface CreatePostcardParams {
  toAddress: LobAddressObject
  frontTemplateId: string
  backTemplateId: string
}

interface LobThumbnail {
  small: string
  medium: string
  large: string
}

interface LobPostcardResponse {
  id: string
  url: string
  raw_url: string
  thumbnails: LobThumbnail[]
  status: string
  carrier: string
  expected_delivery_date: string
  date_created: string
  date_modified: string
  send_date: string
  front_template_id: string
  back_template_id: string
  front_template_version_id: string
  back_template_version_id: string
}

export default class LobClient {
  /**
   * TODO: Configure a real from address for production
   * For PoC, using a hardcoded test address
   */
  private static getFromAddress() {
    return {
      name: 'Test Sender',
      company: 'Test Company',
      address_line1: '123 Test St',
      address_city: 'San Francisco',
      address_state: 'CA',
      address_zip: '94107',
      address_country: 'US',
    }
  }

  static async createPostcard(
    user: User,
    params: CreatePostcardParams
  ): Promise<{ id: string; url: string; thumbnail_url: string }> {
    if (!user.lobApiKey) {
      throw new Error('User does not have a Lob API key configured')
    }

    const payload = {
      to: params.toAddress,
      from: this.getFromAddress(),
      front: params.frontTemplateId,
      back: params.backTemplateId,
      size: '6x9' as const,
      mail_type: 'usps_first_class' as const,
    }

    const authHeader = Buffer.from(`${user.lobApiKey}:`).toString('base64')
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default

    const url = 'https://api.lob.com/v1/postcards'
    const requestHeaders = {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    }
    const requestBody = JSON.stringify(payload)

    // Log request details
    logger.info('Making Lob API request', {
      url,
      method: 'POST',
      headers: {
        'Authorization':
          `Basic ${authHeader.substring(0, 20)}...` + ` (masked, length: ${authHeader.length})`,
        'Content-Type': requestHeaders['Content-Type'],
      },
      payload: payload,
      bodyLength: requestBody.length,
      userId: user.id,
      frontTemplateId: params.frontTemplateId,
      backTemplateId: params.backTemplateId,
    })

    logger.debug('Full request details', {
      url,
      method: 'POST',
      fullHeaders: requestHeaders,
      fullBody: requestBody,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
    })

    logger.info('Lob API response received', {
      url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Lob API error response', {
        url,
        status: response.status,
        statusText: response.statusText,
        errorText,
        requestPayload: payload,
      })
      throw new Error(`Lob API error: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as LobPostcardResponse

    // Log full response for debugging
    logger.info('Lob API response data', {
      id: data.id,
      status: data.status,
      url: data.url,
      rawUrl: data.raw_url,
      thumbnailsCount: data.thumbnails?.length || 0,
      carrier: data.carrier,
      expectedDeliveryDate: data.expected_delivery_date,
      frontTemplateId: data.front_template_id,
      backTemplateId: data.back_template_id,
      dateCreated: data.date_created,
      dateModified: data.date_modified,
      sendDate: data.send_date,
    })

    // Log full response structure for debugging (without sensitive data)
    logger.debug('Full Lob API response structure', {
      responseKeys: Object.keys(data),
      hasThumbnails: !!data.thumbnails,
      thumbnailsStructure: data.thumbnails
        ? data.thumbnails.map((t, i) => ({
            index: i,
            hasSmall: !!t.small,
            hasMedium: !!t.medium,
            hasLarge: !!t.large,
          }))
        : null,
    })

    // Extract thumbnail URL from thumbnails array (use medium from first thumbnail)
    let thumbnailUrl = ''
    if (data.thumbnails && data.thumbnails.length > 0) {
      thumbnailUrl =
        data.thumbnails[0].medium || data.thumbnails[0].large || data.thumbnails[0].small
      logger.info('Extracted thumbnail URL', {
        thumbnailUrl,
        availableSizes: {
          small: data.thumbnails[0].small,
          medium: data.thumbnails[0].medium,
          large: data.thumbnails[0].large,
        },
      })
    } else {
      logger.warn('No thumbnails found in Lob API response', {
        responseId: data.id,
        responseKeys: Object.keys(data),
      })
      // Fallback: use a placeholder or empty string
      // Note: This might cause issues if thumbnail_url is required in the database
      thumbnailUrl = ''
    }

    if (!thumbnailUrl) {
      logger.error('Failed to extract thumbnail URL from Lob response', {
        responseId: data.id,
        thumbnails: data.thumbnails,
      })
      throw new Error('No thumbnail URL available in Lob API response')
    }

    return {
      id: data.id,
      url: data.url,
      thumbnail_url: thumbnailUrl,
    }
  }
}
