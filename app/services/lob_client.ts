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
  size?: string
  mail_type?: string
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
  ): Promise<{ id: string; url: string; thumbnail_url: string; front_thumbnail_url: string; back_thumbnail_url: string | null }> {
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

    // Extract thumbnail URLs from thumbnails array
    // First object is front thumbnails, second is back thumbnails
    // Use "large" size for each as requested
    let thumbnailUrl = '' // Keep for backward compatibility
    let frontThumbnailUrl = ''
    let backThumbnailUrl = ''

    if (data.thumbnails && data.thumbnails.length > 0) {
      // Extract front thumbnail (first object) - use large size
      const frontThumbnail = data.thumbnails[0]
      frontThumbnailUrl = frontThumbnail.large || frontThumbnail.medium || frontThumbnail.small || ''

      // For backward compatibility, use front thumbnail as the main thumbnail
      thumbnailUrl = frontThumbnailUrl

      logger.info('Extracted front thumbnail URL', {
        frontThumbnailUrl,
        availableSizes: {
          small: frontThumbnail.small,
          medium: frontThumbnail.medium,
          large: frontThumbnail.large,
        },
      })

      // Extract back thumbnail (second object) if available - use large size
      if (data.thumbnails.length > 1) {
        const backThumbnail = data.thumbnails[1]
        backThumbnailUrl = backThumbnail.large || backThumbnail.medium || backThumbnail.small || ''

        logger.info('Extracted back thumbnail URL', {
          backThumbnailUrl,
          availableSizes: {
            small: backThumbnail.small,
            medium: backThumbnail.medium,
            large: backThumbnail.large,
          },
        })
      } else {
        logger.warn('Only one thumbnail found in Lob API response (expected front and back)', {
          responseId: data.id,
          thumbnailsCount: data.thumbnails.length,
        })
      }
    } else {
      logger.warn('No thumbnails found in Lob API response', {
        responseId: data.id,
        responseKeys: Object.keys(data),
      })
    }

    if (!frontThumbnailUrl) {
      logger.error('Failed to extract front thumbnail URL from Lob response', {
        responseId: data.id,
        thumbnails: data.thumbnails,
      })
      throw new Error('No front thumbnail URL available in Lob API response')
    }

    return {
      id: data.id,
      url: data.url,
      thumbnail_url: thumbnailUrl, // Keep for backward compatibility
      front_thumbnail_url: frontThumbnailUrl,
      back_thumbnail_url: backThumbnailUrl || null,
    }
  }

  static async getPostcard(user: User, resourceId: string): Promise<LobPostcardResponse> {
    if (!user.lobApiKey) {
      throw new Error('User does not have a Lob API key configured')
    }

    const authHeader = Buffer.from(`${user.lobApiKey}:`).toString('base64')
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default

    const url = `https://api.lob.com/v1/postcards/${resourceId}`
    const requestHeaders = {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    }

    logger.info('Fetching postcard details from Lob API', {
      url,
      method: 'GET',
      resourceId,
      userId: user.id,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
    })

    logger.info('Lob API GET response received', {
      url,
      status: response.status,
      statusText: response.statusText,
      resourceId,
      headers: Object.fromEntries(response.headers.entries()),
    })

    const responseText = await response.text()
    logger.info('Lob API GET response body', {
      url,
      status: response.status,
      resourceId,
      responseText,
      responseTextLength: responseText.length,
    })

    if (!response.ok) {
      logger.error('Lob API error response', {
        url,
        status: response.status,
        statusText: response.statusText,
        errorText: responseText,
        resourceId,
        responseHeaders: Object.fromEntries(response.headers.entries()),
      })
      throw new Error(`Lob API error: ${response.status} - ${responseText}`)
    }

    let data: LobPostcardResponse
    try {
      data = JSON.parse(responseText) as LobPostcardResponse
      logger.info('Lob API response parsed successfully', {
        resourceId: data.id,
        responseKeys: Object.keys(data),
      })
    } catch (parseError: any) {
      logger.error('Failed to parse Lob API response', {
        url,
        status: response.status,
        resourceId,
        responseText,
        parseError: parseError.message,
        parseErrorStack: parseError.stack,
      })
      throw new Error(`Failed to parse Lob API response: ${parseError.message}`)
    }

    logger.info('Postcard details fetched successfully', {
      resourceId: data.id,
      status: data.status,
      size: data.size,
      mailType: data.mail_type,
      dateCreated: data.date_created,
      sendDate: data.send_date,
      expectedDeliveryDate: data.expected_delivery_date,
    })

    return data
  }
}
