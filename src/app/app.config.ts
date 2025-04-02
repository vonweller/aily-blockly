import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideTranslateService } from "@ngx-translate/core";
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { NzModalModule } from 'ng-zorro-antd/modal';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    provideTranslateService(),
    provideHttpClient(),
    provideAnimations(),
    importProvidersFrom(NzModalModule)
  ]
};
