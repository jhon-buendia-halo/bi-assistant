import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { BRAND } from './app/core/brand/brand';

// The window and document title follow the brand (app-shell R33, ADR-0045).
document.title = BRAND.productName;

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
