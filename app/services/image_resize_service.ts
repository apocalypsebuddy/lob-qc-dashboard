import sharp from 'sharp'
import { statSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import logger from '@adonisjs/core/services/logger'

export default class ImageResizeService {
  /**
   * Resize an image if it exceeds the maximum size limit
   * @param filePath - Path to the original image file
   * @param maxSizeBytes - Maximum file size in bytes (default: 4MB)
   * @returns Path to the resized file (or original if no resize needed)
   */
  static async resizeImageIfNeeded(
    filePath: string,
    maxSizeBytes: number = 4 * 1024 * 1024
  ): Promise<string> {
    try {
      // Check current file size
      const stats = statSync(filePath)
      const currentSize = stats.size

      logger.info('Checking image size', {
        filePath,
        currentSize,
        maxSizeBytes,
        needsResize: currentSize > maxSizeBytes,
      })

      // If file is already under the limit, return original path
      if (currentSize <= maxSizeBytes) {
        logger.info('Image is already under size limit', { filePath, currentSize })
        return filePath
      }

      // Get image metadata to determine dimensions
      const image = sharp(filePath)
      const metadata = await image.metadata()
      const { width, height, format } = metadata

      if (!width || !height) {
        logger.warn('Could not determine image dimensions', { filePath })
        return filePath
      }

      // Validate format
      const supportedFormats = ['jpeg', 'jpg', 'png']
      if (!format || !supportedFormats.includes(format.toLowerCase())) {
        logger.warn('Unsupported image format', { filePath, format })
        return filePath
      }

      logger.info('Image exceeds size limit, starting resize', {
        filePath,
        originalSize: currentSize,
        dimensions: `${width}x${height}`,
        format,
      })

      // Create resized file path
      const dir = dirname(filePath)
      const baseName = basename(filePath, extname(filePath))
      const resizedPath = join(dir, `${baseName}-resized.jpg`)

      // Start with 90% of original dimensions
      let scale = 0.9
      const minDimension = 800
      let resizedWidth = Math.round(width * scale)
      let resizedHeight = Math.round(height * scale)

      // Ensure minimum dimensions
      if (resizedWidth < minDimension && resizedHeight < minDimension) {
        // Maintain aspect ratio while ensuring minimum dimension
        const aspectRatio = width / height
        if (width > height) {
          resizedWidth = minDimension
          resizedHeight = Math.round(minDimension / aspectRatio)
        } else {
          resizedHeight = minDimension
          resizedWidth = Math.round(minDimension * aspectRatio)
        }
      }

      let resizedSize = maxSizeBytes + 1 // Initialize to force first iteration
      let attempts = 0
      const maxAttempts = 10

      // Progressively reduce dimensions until under size limit
      while (resizedSize > maxSizeBytes && attempts < maxAttempts) {
        attempts++

        logger.info('Attempting resize', {
          attempt: attempts,
          dimensions: `${resizedWidth}x${resizedHeight}`,
          scale,
        })

        // Resize image with quality 85
        await image
          .resize(resizedWidth, resizedHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toFile(resizedPath)

        // Check the size of the resized image
        const resizedStats = statSync(resizedPath)
        resizedSize = resizedStats.size

        logger.info('Resize attempt completed', {
          attempt: attempts,
          dimensions: `${resizedWidth}x${resizedHeight}`,
          resizedSize,
          maxSizeBytes,
        })

        // If still too large, reduce dimensions by 10%
        if (resizedSize > maxSizeBytes) {
          scale *= 0.9
          resizedWidth = Math.max(Math.round(width * scale), minDimension)
          resizedHeight = Math.max(Math.round(height * scale), minDimension)

          // Maintain aspect ratio
          const aspectRatio = width / height
          if (resizedWidth < minDimension || resizedHeight < minDimension) {
            if (width > height) {
              resizedWidth = minDimension
              resizedHeight = Math.round(minDimension / aspectRatio)
            } else {
              resizedHeight = minDimension
              resizedWidth = Math.round(minDimension * aspectRatio)
            }
          }
        }
      }

      if (resizedSize > maxSizeBytes) {
        logger.warn('Could not resize image below size limit', {
          filePath,
          finalSize: resizedSize,
          maxSizeBytes,
          attempts,
        })
        // Return resized file anyway - it's smaller than original
      }

      // Verify the resized file exists and get final size
      const finalStats = statSync(resizedPath)
      const finalSize = finalStats.size

      logger.info('Image resize completed', {
        originalPath: filePath,
        resizedPath,
        originalSize: currentSize,
        resizedSize: finalSize,
        originalDimensions: `${width}x${height}`,
        resizedDimensions: `${resizedWidth}x${resizedHeight}`,
        sizeReduction: `${((1 - finalSize / currentSize) * 100).toFixed(1)}%`,
      })

      return resizedPath
    } catch (error: any) {
      logger.error('Error resizing image', {
        filePath,
        error: error.message,
        stack: error.stack,
      })
      // Return original path on error
      return filePath
    }
  }
}
