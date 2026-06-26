import { Routes } from '@angular/router'

// Rutas de la app. Por ahora solo la home (carga perezosa del componente).
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'llama-bench · benchmark real con llama-server',
  },
  { path: '**', redirectTo: '' },
]
