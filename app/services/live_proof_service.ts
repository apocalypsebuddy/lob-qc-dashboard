import { createReadStream } from 'node:fs'
import { basename } from 'node:path'

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

    formData.append('resourceId', resourceId)
    formData.append('file', createReadStream(filePath), {
      filename: basename(filePath),
      contentType: 'image/jpeg',
    })

    // Use node-fetch compatible approach
    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
    const response = await fetch(LIVE_PROOF_ENDPOINT, {
      method: 'POST',
      body: formData as any,
      headers: formData.getHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Live proof service error: ${response.status} - ${errorText}`)
    }

    return response.json() as Promise<UploadScanResponse>
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
