import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import logger from '@adonisjs/core/services/logger'

const IMB_BARCODE_SERVICE_API_URL = process.env.IMB_BARCODE_SERVICE_API_URL || ''

const IMB_BARCODE_SERVICE_API_KEY = process.env.IMB_BARCODE_SERVICE_API_KEY || ''

interface ImbBarcodeResponse {
  request_id: string
  found: boolean
  bars: any
  location: {
    x: number
    y: number
    width: number
    height: number
  } | null
  notes: string | null
  tracking_number: string | null
  raw_string: string | null
  lob_data: {
    reference_id: string
  } | null
}

export interface ImbBarcodeAnalysisResult {
  found: boolean
  resource_id?: string
  notes?: string | null
  tracking_number?: string | null
  raw_string?: string | null
  error?: string
}

export default class ImbBarcodeService {
  /**
   * Analyze an image file for IMB barcode and extract resource ID
   * @param filePath - Path to the image file
   * @returns Analysis result with resource ID and metadata if found
   */
  static async analyzeImage(filePath: string): Promise<ImbBarcodeAnalysisResult> {
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

    // Append file
    formData.append('file', createReadStream(filePath), {
      filename: basename(filePath),
      contentType,
    })

    // Append include_lob_data parameter
    formData.append('include_lob_data', 'true')

    // Create Basic Auth header
    const authString = Buffer.from(`${IMB_BARCODE_SERVICE_API_KEY}:`).toString('base64')
    const authHeader = `Basic ${authString}`

    const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default

    try {
      logger.info(
        {
          filePath,
          apiUrl: IMB_BARCODE_SERVICE_API_URL,
        },
        'Sending image to IMB barcode analysis service'
      )

      const formHeaders = formData.getHeaders()
      const headers: Record<string, string> = {
        ...formHeaders,
        'Authorization': authHeader,
        // Add ngrok bypass header to skip browser warning page
        'ngrok-skip-browser-warning': 'true',
      }

      logger.info(
        {
          apiUrl: IMB_BARCODE_SERVICE_API_URL,
          hasAuth: !!authHeader,
          contentType: headers['content-type'] || 'multipart/form-data',
        },
        'Sending request with headers'
      )

      const response = await fetch(IMB_BARCODE_SERVICE_API_URL, {
        method: 'POST',
        body: formData as any,
        headers,
      })

      if (!response.ok) {
        let errorText = ''
        try {
          errorText = await response.text()
        } catch (e) {
          errorText = 'Unable to read error response'
        }

        logger.error(
          {
            filePath,
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            headers: Object.fromEntries(response.headers.entries()),
          },
          'IMB barcode API error'
        )
        return {
          found: false,
          error: `API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
        }
      }

      const data = (await response.json()) as ImbBarcodeResponse

      logger.info(
        {
          filePath,
          found: data.found,
          requestId: data.request_id,
          hasLobData: !!data.lob_data,
        },
        'IMB barcode analysis completed'
      )

      // Handle case where barcode was not found
      if (!data.found) {
        return {
          found: false,
          error: 'Resource ID could not be found from the IMB barcode',
        }
      }

      // Extract resource ID from lob_data.reference_id
      const resourceId = data.lob_data?.reference_id

      if (!resourceId) {
        logger.warn(
          {
            filePath,
            requestId: data.request_id,
          },
          'IMB barcode found but no reference_id in lob_data'
        )
        return {
          found: false,
          error: 'Resource ID could not be found from the IMB barcode',
        }
      }

      return {
        found: true,
        resource_id: resourceId,
        notes: data.notes,
        tracking_number: data.tracking_number,
        raw_string: data.raw_string,
      }
    } catch (error: any) {
      logger.error(
        {
          filePath,
          error: error.message,
          stack: error.stack,
        },
        'Error calling IMB barcode analysis service'
      )
      return {
        found: false,
        error: error.message || 'Failed to analyze image',
      }
    }
  }
}
