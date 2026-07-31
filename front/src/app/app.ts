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
const DARK_MODE_KEY = 'plane-llama-bench-dark-mode';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ButtonModule, ToastModule, ConfirmDialogModule, StatusBar, GpuGrid],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Versión de la app, leída de package.json (raíz) en build time. */
  protected readonly version = signal(APP_VERSION);

  /** Espeja la clase `.dark` de <html> para pintar el ícono/título correctos. */
  protected readonly darkMode = signal(document.documentElement.classList.contains('dark'));

  constructor() {
    // index.html arranca siempre en dark; si el usuario eligió claro antes, se restaura acá.
    const stored = this.readStoredPreference();
    if (stored !== null && stored !== this.darkMode()) {
      this.setDarkMode(stored);
    }
  }

  /** Alterna la clase `.dark` en <html> (darkModeSelector del preset PrimeNG) y la persiste. */
  toggleDarkMode(): void {
    this.setDarkMode(!this.darkMode());
  }

  private setDarkMode(value: boolean): void {
    document.documentElement.classList.toggle('dark', value);
    this.darkMode.set(value);
    try {
      localStorage.setItem(DARK_MODE_KEY, String(value));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private readStoredPreference(): boolean | null {
    try {
      const raw = localStorage.getItem(DARK_MODE_KEY);
      return raw === null ? null : raw === 'true';
    } catch {
      return null;
    }
  }
}
