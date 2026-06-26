import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';

/**
 * App (shell raíz).
 * Aloja los overlays globales (p-toast, p-confirmdialog), el header con el toggle
 * de modo oscuro, y el <router-outlet> donde se monta la home.
 * El estado y la lógica viven en BenchStore y los feature components.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ButtonModule, ToastModule, ConfirmDialogModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly messages = inject(MessageService);
  protected readonly title = signal('llama-bench');

  /** Alterna la clase `.dark` en <html> (darkModeSelector del preset PrimeNG). */
  toggleDarkMode(): void {
    const el = document.querySelector('html');
    if (el) el.classList.toggle('dark');
  }
}
