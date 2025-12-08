import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { updateSettingsValidator } from '#validators/settings'

export default class SettingsController {
  async edit({ view, auth, request, session }: HttpContext) {
    // Get user - try both methods to see which works
    let user
    try {
      user = auth.getUserOrFail()
      logger.info('Got user via getUserOrFail', { userId: user.id, email: user.email })
      console.log('User', user)
    } catch (error) {
      logger.error('Failed to get user via getUserOrFail', { error })
      throw error
    }

    // Reload user from database to ensure we have latest data
    await user.refresh()

    // Access attributes directly to ensure we get the values
    const userId = user.id
    const userEmail = user.email
    const userLobApiKey = user.lobApiKey

    console.log('After refresh - userId:', userId)
    console.log('After refresh - userEmail:', userEmail)
    console.log('After refresh - userLobApiKey:', userLobApiKey)

    logger.info('User refreshed from database', {
      userId,
      email: userEmail,
      hasLobApiKey: !!userLobApiKey,
      lobApiKeyLength: userLobApiKey?.length || 0,
      lobApiKeyValue: userLobApiKey ? `${userLobApiKey.substring(0, 4)}...` : null,
    })

    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Format messages as plain text (we'll format in JavaScript)
    let errorText = ''
    if (errors) {
      errorText = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
    }

    let successText = ''
    if (success) {
      successText = typeof success === 'object' ? Object.values(success)[0] || '' : success
    }

    // Mask the Lob API key for display (show first 4 chars and mask the rest)
    let maskedApiKey = ''
    if (userLobApiKey) {
      const key = userLobApiKey
      console.log('Masking API key, length:', key.length)
      if (key.length > 8) {
        maskedApiKey =
          key.substring(0, 4) +
          '•'.repeat(Math.min(key.length - 4, 20)) +
          key.substring(key.length - 4)
      } else {
        maskedApiKey = '•'.repeat(key.length)
      }
      logger.info('Masked API key generated', {
        userId,
        keyLength: key.length,
        maskedLength: maskedApiKey.length,
      })
    } else {
      logger.info('No API key found for user', { userId })
    }

    // Serialize user data for template
    const userData = {
      id: userId,
      email: userEmail,
      lobApiKey: userLobApiKey,
    }

    console.log('UserData being passed to template:', userData)
    console.log('MaskedApiKey being passed to template:', maskedApiKey)

    const csrfToken = request.csrfToken
    return view.render('settings/edit', {
      user: userData,
      csrfToken,
      errorMessage: errorText,
      successMessage: successText,
      maskedApiKey,
    })
  }

  async update({ request, response, auth, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      logger.info('Updating settings', { userId: user.id, email: user.email })

      const { lobApiKey } = await request.validateUsing(updateSettingsValidator)
      logger.info('Settings form validated', {
        userId: user.id,
        hasLobApiKey: !!lobApiKey,
        lobApiKeyLength: lobApiKey?.length || 0,
      })

      const previousLobApiKey = user.lobApiKey
      // Only update if a new value is provided (not empty string)
      if (lobApiKey && lobApiKey.trim().length > 0) {
        user.lobApiKey = lobApiKey.trim()
        logger.info('Updating Lob API key', { userId: user.id, keyLength: user.lobApiKey.length })
      } else {
        logger.info('No new API key provided, keeping existing value', { userId: user.id })
      }
      await user.save()

      // Refresh user to ensure we have the latest data
      await user.refresh()

      logger.info('Settings updated successfully', {
        userId: user.id,
        hadPreviousKey: !!previousLobApiKey,
        hasNewKey: !!user.lobApiKey,
      })

      session.flash('success', 'Settings saved successfully!')
      return response.redirect().toRoute('settings.edit')
    } catch (error: any) {
      logger.error('Error updating settings', {
        error: error.message,
        stack: error.stack,
        code: error.code,
      })

      // If it's a validation error, it will be handled automatically by VineJS
      if (error.code !== 'E_VALIDATION_FAILURE') {
        session.flash('errors', {
          general: 'An error occurred while saving settings. Please try again.',
        })
        return response.redirect().back()
      }

      throw error
    }
  }
}
