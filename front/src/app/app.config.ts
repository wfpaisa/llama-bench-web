import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import Noir from './theme';

export const appConfig: ApplicationConfig = {
  providers: [
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
  ],
};
