import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ButtonModule } from 'primeng/button';
import { StatusBar } from './features/status-bar/status-bar';
import { GpuGrid } from './features/gpu-grid/gpu-grid';
import { APP_VERSION } from '../version';

/**
 * App (shell raíz).
 * Aloja los overlays globales (p-toast, p-confirmdialog) y el top bar fijo, que
 * contiene el título, el estado del servidor (app-status-bar) y el toggle de modo
 * oscuro. El <router-outlet> monta la home. El estado y la lógica viven en
 * BenchStore y los feature components.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ButtonModule, ToastModule, ConfirmDialogModule, StatusBar, GpuGrid],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Versión de la app, leída de package.json (raíz) en build time. */
  protected readonly version = signal(APP_VERSION);

  /** Alterna la clase `.dark` en <html> (darkModeSelector del preset PrimeNG). */
  toggleDarkMode(): void {
    const el = document.querySelector('html');
    if (el) el.classList.toggle('dark');
  }
}
