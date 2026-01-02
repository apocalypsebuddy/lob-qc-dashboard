import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'

export default class AuthController {
  async showRegister({ view, session, request }: HttpContext) {
    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Extract message text (not HTML)
    let errorMessage = ''
    if (errors) {
      errorMessage = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
    }

    let successMessage = ''
    if (success) {
      successMessage = success
    }

    // Get CSRF token
    const csrfToken = request.csrfToken

    return view.render('auth/register', {
      errorMessage,
      successMessage,
      csrfToken,
    })
  }

  async register({ request, response, auth, session }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      logger.info('Attempting to register user', { email: data.email })

      // Check if email domain is lob.com
      const emailDomain = data.email.split('@')[1]?.toLowerCase()
      if (emailDomain !== 'lob.com') {
        logger.warn(
          {
            email: data.email,
            domain: emailDomain,
          },
          'Registration attempt with invalid email domain'
        )
        session.flash('errors', {
          email: 'Only email addresses with the domain @lob.com are allowed to register.',
        })
        return response.redirect().back()
      }

      // Check if user already exists
      const existingUser = await User.findBy('email', data.email)
      if (existingUser) {
        logger.warn('Registration attempt with existing email', { email: data.email })
        session.flash('errors', { email: 'An account with this email already exists' })
        return response.redirect().back()
      }

      const user = await User.create({
        email: data.email,
        password: data.password,
      })

      logger.info('User created successfully', { userId: user.id, email: user.email })

      await auth.use('web').login(user)

      logger.info('User logged in after registration', { userId: user.id })

      session.flash('success', 'Account created successfully! Welcome to Seeds Dashboard.')
      return response.redirect('/seeds')
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          code: error.code,
          messages: error.messages,
        },
        'Registration error'
      )

      // Handle validation errors (both E_VALIDATION_FAILURE and E_VALIDATION_ERROR)
      if (error.code === 'E_VALIDATION_FAILURE' || error.code === 'E_VALIDATION_ERROR') {
        // Extract validation error messages
        const errorMessages: Record<string, string> = {}

        if (error.messages) {
          // Handle array of error messages (VineJS format)
          if (Array.isArray(error.messages)) {
            error.messages.forEach((message: any) => {
              const field = message.field || message.fieldName || 'general'
              let messageText = message.message || String(message)

              // Replace generic regex error with custom message for email domain validation
              if (field === 'email' && message.rule === 'regex') {
                messageText =
                  'Only email addresses with the domain @lob.com are allowed to register.'
              }

              errorMessages[field] = messageText
            })
          }
          // Handle object with field names as keys
          else if (typeof error.messages === 'object') {
            Object.keys(error.messages).forEach((field) => {
              const fieldErrors = error.messages[field]
              if (Array.isArray(fieldErrors)) {
                // Check if it's a regex validation error for email
                const firstError = fieldErrors[0]
                if (
                  field === 'email' &&
                  typeof firstError === 'object' &&
                  firstError.rule === 'regex'
                ) {
                  errorMessages[field] =
                    'Only email addresses with the domain @lob.com are allowed to register.'
                } else {
                  errorMessages[field] = firstError?.message || String(firstError)
                }
              } else if (typeof fieldErrors === 'string') {
                errorMessages[field] = fieldErrors
              } else if (fieldErrors && fieldErrors.message) {
                errorMessages[field] = fieldErrors.message
              }
            })
          }
        }

        // If no specific field errors extracted, try to use error.message
        if (Object.keys(errorMessages).length === 0) {
          if (error.message) {
            errorMessages.email = error.message
          } else {
            errorMessages.email = 'Validation failed. Please check your input.'
          }
        }

        logger.info({ errorMessages }, 'Validation errors extracted and flashed')
        session.flash('errors', errorMessages)
        return response.redirect().back()
      }

      // For other errors, show a generic message
      session.flash('errors', {
        general: 'An error occurred during registration. Please try again.',
      })
      return response.redirect().back()
    }
  }

  async showLogin({ view, session, request }: HttpContext) {
    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Extract message text (not HTML)
    let errorMessage = ''
    if (errors) {
      errorMessage = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
    }

    let successMessage = ''
    if (success) {
      successMessage = success
    }

    // Get CSRF token
    const csrfToken = request.csrfToken

    return view.render('auth/login', {
      errorMessage,
      successMessage,
      csrfToken,
    })
  }

  async login({ request, response, auth, session }: HttpContext) {
    try {
      const { email, password } = await request.validateUsing(loginValidator)

      logger.info('Login attempt', { email })

      const user = await User.verifyCredentials(email, password)

      await auth.use('web').login(user)

      logger.info('User logged in successfully', { userId: user.id, email: user.email })

      session.flash('success', 'Welcome back!')
      return response.redirect('/seeds')
    } catch (error: any) {
      const email = request.input('email')
      logger.warn('Login failed', { email, error: error.message })

      session.flash('errors', { email: 'Invalid email or password' })
      return response.redirect().back()
    }
  }

  async logout({ auth, response }: HttpContext) {
    await auth.use('web').logout()

    return response.redirect('/login')
  }
}
