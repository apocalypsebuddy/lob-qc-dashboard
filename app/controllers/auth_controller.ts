import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'

export default class AuthController {
  async showRegister({ view, session, request }: HttpContext) {
    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Format messages as HTML strings
    let errorHtml = ''
    if (errors) {
      const errorText = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
      if (errorText) {
        errorHtml = `<div class="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded"><p>${errorText}</p></div>`
      }
    }

    let successHtml = ''
    if (success) {
      successHtml = `<div class="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded"><p>${success}</p></div>`
    }

    // Get CSRF token
    const csrfToken = request.csrfToken

    return view.render('auth/register', {
      errorMessage: errorHtml,
      successMessage: successHtml,
      csrfToken,
    })
  }

  async register({ request, response, auth, session }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      logger.info('Attempting to register user', { email: data.email })

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
      logger.error('Registration error', { error: error.message, stack: error.stack })

      // If it's a validation error, it will be handled automatically by VineJS
      // For other errors, show a generic message
      if (error.code !== 'E_VALIDATION_FAILURE') {
        session.flash('errors', {
          general: 'An error occurred during registration. Please try again.',
        })
        return response.redirect().back()
      }

      // Re-throw validation errors so they're handled by VineJS
      throw error
    }
  }

  async showLogin({ view, session, request }: HttpContext) {
    const errors = session.flashMessages.get('errors')
    const success = session.flashMessages.get('success')

    // Format messages as HTML strings
    let errorHtml = ''
    if (errors) {
      const errorText = typeof errors === 'object' ? Object.values(errors)[0] || '' : errors
      if (errorText) {
        errorHtml = `<div class="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded"><p>${errorText}</p></div>`
      }
    }

    let successHtml = ''
    if (success) {
      successHtml = `<div class="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded"><p>${success}</p></div>`
    }

    // Get CSRF token
    const csrfToken = request.csrfToken

    return view.render('auth/login', {
      errorMessage: errorHtml,
      successMessage: successHtml,
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
