import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import logger from '@adonisjs/core/services/logger'

const SCAN_EVENTS_API_URL =
  process.env.SCAN_EVENTS_API_URL ||
  'https://94f0nmul0k.execute-api.us-west-2.amazonaws.com/proofs-production/scan-events'

interface ScanItem {
  url: string
  s3_uri: string
  s3_key: string
  file_size: number
  file_type: string
  status: string
  timestamp: string
  created_at: string
  updated_at: string
  resource_id: string
  original_filename?: string
  source?: string
  [key: string]: any // Allow additional properties
}

interface ScanGroup {
  resource_id: string
  scans: ScanItem[]
  latest_scan: ScanItem
  total_scans: number
}

interface GetScanEventsResponse {
  groups: ScanGroup[]
  pagination: {
    page: number
    pageSize: number
    totalGroups: number
    totalPages: number
    hasMore: boolean
  }
  summary: {
    total_resources: number
    total_scans: number
  }
}

interface GetScanEventByResourceIdResponse {
  resource_id: string
  items: ScanItem[]
  count: number
  hasMore: boolean
}

interface UploadScanResponse {
  success?: boolean
  message?: string
  data?: {
    resource_id: string
    timestamp: string
    file_size: number
    status: string
  }
  [key: string]: any
}

export default class ScanEventsService {
  /**
   * Get all scan events (groups)
   * @param scanType Optional scan type to filter by (e.g., 'orphan')
   */
  static async getScanEvents(scanType?: string): Promise<GetScanEventsResponse> {
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default

    // Build URL with optional scan_type query parameter
    let url = SCAN_EVENTS_API_URL
    if (scanType) {
      const urlObj = new URL(SCAN_EVENTS_API_URL)
      urlObj.searchParams.set('scan_type', scanType)
      url = urlObj.toString()
    }

    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to fetch scan events', {
        status: response.status,
        error: errorText,
        scanType,
      })
      throw new Error(`Scan events API error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<GetScanEventsResponse>
  }

  /**
   * Get scan events for a specific resource ID
   */
  static async getScanEventByResourceId(
    resourceId: string
  ): Promise<GetScanEventByResourceIdResponse> {
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const url = `${SCAN_EVENTS_API_URL}/${resourceId}`
    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to fetch scan event by resource ID', {
        resourceId,
        status: response.status,
        error: errorText,
      })
      throw new Error(`Scan events API error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<GetScanEventByResourceIdResponse>
  }

  /**
   * Upload a scan file to the scan events service
   * Accepts a file path and uploads it as multipart/form-data
   * Additional optional fields can be passed as key-value pairs
   */
  static async uploadScan(
    resourceId: string,
    filePath: string,
    batchId?: string,
    additionalFields?: Record<string, string>
  ): Promise<UploadScanResponse> {
    const formDataModule = await import('form-data')
    const FormData = formDataModule.default
    const formData = new FormData()

    // Determine content type based on file extension
    const ext = extname(filePath).toLowerCase()
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      '.webp': 'image/webp',
    }
    const contentType = contentTypeMap[ext] || 'image/jpeg'

    formData.append('resource_id', resourceId)
    if (batchId) {
      formData.append('batch_id', batchId)
    }

    // Append additional optional fields if provided
    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        if (value !== null && value !== undefined && value !== '') {
          formData.append(key, value)
        }
      }
    }

    formData.append('file', createReadStream(filePath), {
      filename: basename(filePath),
      contentType,
    })

    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const response = await fetch(SCAN_EVENTS_API_URL, {
      method: 'POST',
      body: formData as any,
      headers: formData.getHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to upload scan', {
        resourceId,
        status: response.status,
        error: errorText,
      })
      throw new Error(`Scan events API error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<UploadScanResponse>
  }

  /**
   * Update scan events for a specific resource ID
   * Updates all items with the given resource_id
   */
  static async updateScanEventByResourceId(
    resourceId: string,
    updates: Record<string, any>
  ): Promise<{ resource_id: string; updated_count: number; items: any[] }> {
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const url = `${SCAN_EVENTS_API_URL}/${resourceId}`

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        {
          resourceId,
          status: response.status,
          error: errorText,
          updates: JSON.stringify(updates),
          url,
        },
        'Failed to update scan event by resource ID'
      )

      // Provide helpful error message for 403 (Missing Authentication Token = route not configured)
      if (response.status === 403 && errorText.includes('Missing Authentication Token')) {
        throw new Error(
          `API Gateway route not configured. Please add PATCH method for /scan-events/{resource_id} in API Gateway, routing to scan-events-management-lambda. ` +
            `Current error: ${response.status} - ${errorText}`
        )
      }

      throw new Error(`Scan events API error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<{
      resource_id: string
      updated_count: number
      items: any[]
    }>
  }
}
