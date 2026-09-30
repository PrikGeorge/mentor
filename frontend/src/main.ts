import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { ShellComponent } from './app/layout/shell.component';
bootstrapApplication(ShellComponent, appConfig).catch(() => console.error('Не удалось открыть кабинет.'));
