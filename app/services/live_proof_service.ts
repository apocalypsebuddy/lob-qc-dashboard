import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import logger from '@adonisjs/core/services/logger'

const LIVE_PROOF_ENDPOINT =
  'https://94f0nmul0k.execute-api.us-west-2.amazonaws.com/proofs-production/scan-events'

interface UploadScanResponse {
  success: boolean
  message: string
  data: {
    resource_id: string
    timestamp: string
    file_size: number
    status: string
  }
}

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
}

interface GetScansResponse {
  resource_id: string
  items: ScanItem[]
  count: number
  hasMore: boolean
}

export default class LiveProofService {
  /**
   * Upload a scan file to the live-proof ingestion service
   * Accepts a file path and uploads it as multipart/form-data
   */
  static async uploadScan(resourceId: string, filePath: string): Promise<UploadScanResponse> {
    const formDataModule = await import('form-data')
    const FormData = formDataModule.default
    const formData = new FormData()

    const fileName = basename(filePath)
    let fileSize = 0
    try {
      const stats = statSync(filePath)
      fileSize = stats.size
    } catch (error: any) {
      logger.warn('Could not get file stats', { filePath, error: error.message })
    }

    logger.info('Preparing file upload to live-proof service', {
      resourceId,
      filePath,
      fileName,
      fileSize,
      endpoint: LIVE_PROOF_ENDPOINT,
    })

    formData.append('resource_id', resourceId)
    formData.append('file', createReadStream(filePath), {
      filename: fileName,
      contentType: 'image/jpeg',
    })

    // Use node-fetch compatible approach
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default

    try {
      logger.info('Sending request to live-proof service', {
        resourceId,
        fileName,
        fileSize,
        endpoint: LIVE_PROOF_ENDPOINT,
      })

      const response = await fetch(LIVE_PROOF_ENDPOINT, {
        method: 'POST',
        body: formData as any,
        headers: formData.getHeaders(),
      })

      const status = response.status
      const statusText = response.statusText
      logger.info(`Received response from live-proof service: ${status} ${statusText}`, {
        resourceId,
        status,
        statusText,
        fileName,
        fileSize,
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Live proof service ERROR: ${status} ${statusText}`, {
          resourceId,
          status,
          statusText,
          fileName,
          fileSize,
        })
        logger.error(`Error response body: ${errorText}`)
        logger.error('Full error details', {
          resourceId,
          status,
          statusText,
          errorText,
          fileName,
          fileSize,
          endpoint: LIVE_PROOF_ENDPOINT,
        })
        const errorMessage = `Live proof service error: ${status} ${statusText} - ${errorText}`
        throw new Error(errorMessage)
      }

      const result = await response.json()
      logger.info('Successfully uploaded to live-proof service', {
        resourceId,
        fileName,
        result,
      })
      return result as UploadScanResponse
    } catch (error: any) {
      logger.error(`Exception during live-proof service upload: ${error.message}`, {
        resourceId,
        fileName,
        fileSize,
        errorMessage: error.message,
        errorName: error.name,
        endpoint: LIVE_PROOF_ENDPOINT,
      })
      if (error.stack) {
        logger.error('Error stack trace', { stack: error.stack })
      }
      // Re-throw with more context if it's not already our error
      if (error.message && error.message.includes('Live proof service error')) {
        throw error
      }
      throw new Error(`Failed to upload file to live proof service: ${error.message}`)
    }
  }

  /**
   * Get scans for a resource ID
   */
  static async getScans(resourceId: string): Promise<GetScansResponse> {
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const response = await fetch(`${LIVE_PROOF_ENDPOINT}/${resourceId}`)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Live proof service error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<GetScansResponse>
  }
}
