import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import {provideTranslateService} from "@ngx-translate/core";
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { zh_CN, provideNzI18n } from 'ng-zorro-antd/i18n';
import { registerLocaleData } from '@angular/common';
import zh from '@angular/common/locales/zh';
import { FormsModule } from '@angular/forms';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

registerLocaleData(zh);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideTranslateService({
      defaultLanguage: 'zh'
     }),
     provideHttpClient(), provideNzI18n(zh_CN), importProvidersFrom(FormsModule), provideAnimationsAsync(), provideHttpClient()
  ]
};
