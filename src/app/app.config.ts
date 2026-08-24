import { ApplicationConfig, importProvidersFrom, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideTranslateService } from "@ngx-translate/core";
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { authInterceptor } from './interceptors/auth.interceptor';
import { retryInterceptor } from './interceptors/retry.interceptor';
import { BlocklyLiveOperationBridgeService } from './services/blockly-live-operation-bridge.service';
import { McpBridgeService } from './services/mcp-bridge.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ 
      eventCoalescing: true,
      runCoalescing: true
    }),
    { provide: DOCUMENT, useFactory: () => document },
    provideRouter(routes,
      withHashLocation()
    ),
    provideTranslateService(),
    provideHttpClient(
      withInterceptors([authInterceptor, retryInterceptor])
    ),
    provideAnimations(),
    importProvidersFrom(NzModalModule),
    provideAppInitializer(() => {
      inject(BlocklyLiveOperationBridgeService).ensureInitialized();
      inject(McpBridgeService).ensureInitialized();
    }),
  ]
};
