// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://ai-rank-radar.vercel.app',
  trailingSlash: 'always',
  output: 'static',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    icon(),
  ],
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      cssCodeSplit: true,
    },
  },
});
