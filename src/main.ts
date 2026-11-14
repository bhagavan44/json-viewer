import { platformBrowser } from '@angular/platform-browser';
import { AppModule } from './app/app-module';
import { ignoreMonacoCancellations } from './app/utils/monaco-errors';

ignoreMonacoCancellations();

platformBrowser().bootstrapModule(AppModule, {
  
})
  .catch(err => console.error(err));
