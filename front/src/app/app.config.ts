import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideHttpClient, withFetch } from '@angular/common/http'
import { providePrimeNG } from 'primeng/config'
import { MessageService } from 'primeng/api'
import { ConfirmationService } from 'primeng/api'

import { routes } from './app.routes'
import Noir from './theme'

export const appConfig: ApplicationConfig = {
  providers: [
    // PrimeNG con preset Noir (Aura + primary azul), modo oscuro vía clase `.dark`.
    providePrimeNG({
      theme: {
        preset: Noir,
        options: {
          darkModeSelector: '.dark',
        },
      },
    }),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // HttpClient con fetch para llamadas al backend (CORS * en :3000).
    provideHttpClient(withFetch()),
    // Servicios globales de PrimeNG para Toast y ConfirmDialog.
    MessageService,
    ConfirmationService,
  ],
}
