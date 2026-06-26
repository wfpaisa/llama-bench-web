import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ComponentsExamples } from './components-examples/components-examples';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ButtonModule, ComponentsExamples],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('plane-llama-bench');

  toggleDarkMode() {
    const element = document.querySelector('html');
    if (element) element.classList.toggle('dark');
  }
}
