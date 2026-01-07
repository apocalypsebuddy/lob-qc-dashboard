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

    // Orphan proofs routes (must come before /proofs/:publicId to avoid route conflicts)
    router
      .get('/proofs/orphan', [ProofsController, 'indexOrphanProofs'])
      .as('proofs.indexOrphanProofs')
    router
      .get('/proofs/orphan/:resourceId', [ProofsController, 'showOrphanProof'])
      .as('proofs.showOrphanProof')
    router
      .patch('/proofs/orphan/:resourceId', [ProofsController, 'updateOrphanProof'])
      .as('proofs.updateOrphanProof')
    router
      .post('/proofs/orphan/upload', [ProofsController, 'uploadOrphanProof'])
      .as('proofs.uploadOrphanProof')
    router
      .post('/proofs/orphan/detect-resource-id', [ProofsController, 'detectResourceId'])
      .as('proofs.detectResourceId')
    router
      .get('/api/print-quality-tags', [ProofsController, 'getPrintQualityTags'])
      .as('api.printQualityTags')
    router
      .get('/api/delivery-quality-tags', [ProofsController, 'getDeliveryQualityTags'])
      .as('api.deliveryQualityTags')

    // Partner proofs routes (must come before /proofs/:publicId to avoid route conflicts)
    router
      .get('/proofs/partner', [ProofsController, 'indexPartnerProofs'])
      .as('proofs.indexPartnerProofs')
    router
      .get('/proofs/partner/:resourceId', [ProofsController, 'showPartnerProof'])
      .as('proofs.showPartnerProof')
    router
      .post('/proofs/partner/upload', [ProofsController, 'uploadPartnerProof'])
      .as('proofs.uploadPartnerProof')

    // Seed proofs routes (database-backed proofs)
    router.get('/proofs/:publicId', [ProofsController, 'show']).as('proofs.show')
    router.post('/proofs/:publicId', [ProofsController, 'update']).as('proofs.update')
    router
      .post('/proofs/:publicId/status', [ProofsController, 'updateStatus'])
      .as('proofs.updateStatus')
    router.post('/proofs/:publicId/delete', [ProofsController, 'destroy']).as('proofs.destroy')
    router
      .get('/proofs/:publicId/live-proof', [ProofsController, 'showUploadForm'])
      .as('proofs.upload')
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
