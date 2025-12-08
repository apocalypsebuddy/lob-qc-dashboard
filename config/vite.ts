import { defineConfig } from '@adonisjs/vite'

const viteConfig = defineConfig({
  buildDirectory: 'public/assets',
  assetsUrl: '/assets',
})

export default viteConfig
