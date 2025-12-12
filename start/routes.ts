import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

const AuthController = () => import('#controllers/auth_controller')
const SettingsController = () => import('#controllers/settings_controller')
const SeedsController = () => import('#controllers/seeds_controller')
const ProofsController = () => import('#controllers/proofs_controller')
const WebhooksController = () => import('#controllers/webhooks_controller')

// Public routes
router.post('/webhooks/lob', [WebhooksController, 'store']).as('webhooks.lob')

router
  .group(() => {
    router.get('/login', [AuthController, 'showLogin']).as('auth.showLogin')
    router.post('/login', [AuthController, 'login']).as('auth.login')
    router.get('/register', [AuthController, 'showRegister']).as('auth.showRegister')
    router.post('/register', [AuthController, 'register']).as('auth.register')
  })
  .use(middleware.guest())

// Protected routes
router
  .group(() => {
    router.get('/settings', [SettingsController, 'edit']).as('settings.edit')
    router.post('/settings', [SettingsController, 'update']).as('settings.update')

    router.get('/seeds', [SeedsController, 'index']).as('seeds.index')
    router.get('/seeds/new', [SeedsController, 'create']).as('seeds.create')
    router.post('/seeds', [SeedsController, 'store']).as('seeds.store')
    router.get('/seeds/:publicId', [SeedsController, 'show']).as('seeds.show')
    router.get('/seeds/:publicId/edit', [SeedsController, 'edit']).as('seeds.edit')
    router.post('/seeds/:publicId/update', [SeedsController, 'update']).as('seeds.update')
    router.post('/seeds/:publicId/delete', [SeedsController, 'destroy']).as('seeds.destroy')
    router.post('/seeds/:publicId/run', [SeedsController, 'run']).as('seeds.run')

    router.get('/proofs', [ProofsController, 'index']).as('proofs.index')
    router.get('/proofs/:publicId', [ProofsController, 'show']).as('proofs.show')
    router.post('/proofs/:publicId', [ProofsController, 'update']).as('proofs.update')
    router.post('/proofs/:publicId/status', [ProofsController, 'updateStatus']).as('proofs.updateStatus')
    router.post('/proofs/:publicId/delete', [ProofsController, 'destroy']).as('proofs.destroy')
    router.get('/proofs/:publicId/live-proof', [ProofsController, 'showUploadForm']).as('proofs.upload')
    router
      .post('/proofs/:publicId/live-proof', [ProofsController, 'uploadLiveProof'])
      .as('proofs.uploadLiveProof')

    router.post('/logout', [AuthController, 'logout']).as('auth.logout')

    router
      .get('/', async ({ response }) => {
        return response.redirect('/seeds')
      })
      .as('home')
  })
  .use(middleware.auth())
