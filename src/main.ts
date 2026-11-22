import { isDevMode } from '@angular/core';
import { platformBrowser } from '@angular/platform-browser';
import { AppModule } from './app/app-module';
import { startAnalytics } from './app/utils/analytics';
import { ignoreMonacoCancellations } from './app/utils/monaco-errors';

ignoreMonacoCancellations();

// Analytics run in production builds only, so `ng serve` never reports page views.
if (!isDevMode()) {
  startAnalytics();
}

platformBrowser().bootstrapModule(AppModule, {
  
})
  .catch(err => console.error(err));
