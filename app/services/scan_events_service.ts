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
   */
  static async getScanEvents(): Promise<GetScanEventsResponse> {
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const response = await fetch(SCAN_EVENTS_API_URL)

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to fetch scan events', {
        status: response.status,
        error: errorText,
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
   * Detect resource ID from uploaded file
   * Placeholder for future implementation
   */
  static async detectResourceId(filePath: string): Promise<{ resource_id: string }> {
    // TODO: Implement actual resource ID detection API call
    // For now, return an error indicating it's not yet implemented
    logger.warn('Resource ID detection not yet implemented', { filePath })
    throw new Error('Resource ID detection is not yet implemented')
  }
}
