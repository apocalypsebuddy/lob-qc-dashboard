import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import logger from '@adonisjs/core/services/logger'

export default class S3Service {
  private static client: S3Client | null = null

  private static getClient(): S3Client {
    if (!this.client) {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
      const region = process.env.AWS_REGION || 'us-east-1'

      if (!accessKeyId || !secretAccessKey) {
        throw new Error(
          'AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.'
        )
      }

      this.client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      })
    }

    return this.client
  }

  /**
   * Upload a file to S3
   * @param filePath - Path to the file to upload
   * @param fileName - Original file name
   * @param userId - User ID for organizing files
   * @returns The public URL of the uploaded file
   */
  static async uploadFile(filePath: string, fileName: string, userId: string): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) {
      throw new Error('AWS_S3_BUCKET environment variable is not set')
    }

    // Generate a unique file name
    const fileExtension = fileName.split('.').pop() || ''
    const uniqueFileName = `${userId}/${Date.now()}-${randomBytes(8).toString('hex')}.${fileExtension}`

    // Read file content
    const fileContent = readFileSync(filePath)

    // Determine content type
    let contentType = 'application/octet-stream'
    if (fileExtension.toLowerCase() === 'jpg' || fileExtension.toLowerCase() === 'jpeg') {
      contentType = 'image/jpeg'
    } else if (fileExtension.toLowerCase() === 'pdf') {
      contentType = 'application/pdf'
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: uniqueFileName,
      Body: fileContent,
      ContentType: contentType,
      // ACL removed - using bucket policy for public access instead
    })

    logger.info('Uploading file to S3', {
      bucket,
      key: uniqueFileName,
      fileName,
      contentType,
      userId,
    })

    try {
      await this.getClient().send(command)

      // Construct public URL
      const region = process.env.AWS_REGION || 'us-east-1'
      const url = `https://${bucket}.s3.${region}.amazonaws.com/${uniqueFileName}`

      logger.info('File uploaded to S3 successfully', {
        bucket,
        key: uniqueFileName,
        url,
        userId,
      })

      return url
    } catch (error: any) {
      logger.error('Error uploading file to S3', {
        bucket,
        key: uniqueFileName,
        fileName,
        error: error.message,
        stack: error.stack,
      })
      throw new Error(`Failed to upload file to S3: ${error.message}`)
    }
  }

  /**
   * Generate a presigned URL for an S3 object
   * @param s3Url - The S3 URL (e.g., "https://bucket.s3.region.amazonaws.com/key")
   * @param expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns A presigned URL that allows temporary access to the object
   */
  static async getPresignedUrl(s3Url: string, expiresIn: number = 3600): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket) {
      throw new Error('AWS_S3_BUCKET environment variable is not set')
    }

    // Parse the S3 URL to extract the key
    // Format: https://bucket.s3.region.amazonaws.com/key or https://bucket.s3-region.amazonaws.com/key
    let key: string | null = null

    // Try to extract key from URL
    const urlPatterns = [
      new RegExp(`https://${bucket}\\.s3\\.([^.]+)\\.amazonaws\\.com/(.+)$`),
      new RegExp(`https://${bucket}\\.s3-([^.]+)\\.amazonaws\\.com/(.+)$`),
      new RegExp(`https://s3\\.([^.]+)\\.amazonaws\\.com/${bucket}/(.+)$`),
    ]

    for (const pattern of urlPatterns) {
      const match = s3Url.match(pattern)
      if (match && match[2]) {
        key = decodeURIComponent(match[2])
        break
      }
    }

    if (!key) {
      logger.error('Failed to parse S3 URL', { s3Url, bucket })
      throw new Error(`Invalid S3 URL format: ${s3Url}`)
    }

    logger.info('Generating presigned URL', {
      s3Url,
      bucket,
      key,
      expiresIn,
    })

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })

      const presignedUrl = await getSignedUrl(this.getClient(), command, {
        expiresIn,
      })

      logger.info('Presigned URL generated successfully', {
        s3Url,
        bucket,
        key,
        expiresIn,
        presignedUrlLength: presignedUrl.length,
      })

      return presignedUrl
    } catch (error: any) {
      logger.error('Error generating presigned URL', {
        s3Url,
        bucket,
        key,
        error: error.message,
        stack: error.stack,
      })
      throw new Error(`Failed to generate presigned URL: ${error.message}`)
    }
  }

  /**
   * Check if a string is an S3 URL (vs a template ID)
   * @param value - The value to check
   * @returns true if the value is an S3 URL, false otherwise
   */
  static isS3Url(value: string): boolean {
    if (!value || typeof value !== 'string') {
      return false
    }

    // Template IDs start with "tmpl_"
    if (value.startsWith('tmpl_')) {
      return false
    }

    // Check if it looks like an S3 URL
    return (
      value.startsWith('https://') &&
      (value.includes('.s3.') || value.includes('.s3-') || value.includes('s3.amazonaws.com'))
    )
  }
}
