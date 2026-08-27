import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { LinuxBoardConnectorService } from '@integration/device/public-api';
import { ConnectorSettingDialogComponent } from './connector-setting-dialog.component';

describe('ConnectorSettingDialogComponent i18n', () => {
  const connector = {
    getSshSettings: () => ({
      host: '',
      port: 22,
      username: '',
      password: '',
      privateKeyPath: '',
      autoTrustHostKey: true,
      rememberCredentials: true,
    }),
    connectSsh: jasmine.createSpy('connectSsh'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ConnectorSettingDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: LinuxBoardConnectorService, useValue: connector },
        { provide: NzModalRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: NZ_MODAL_DATA, useValue: null },
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('test', {
      SSH_CONNECTION_DIALOG: {
        TITLE: 'Translated SSH settings',
        HOST: 'Translated host',
        HOST_PLACEHOLDER: 'Translated host example',
        PORT: 'Translated port',
        USERNAME: 'Translated username',
        PASSWORD: 'Translated password',
        PRIVATE_KEY_FILE: 'Translated private key',
        OPTIONAL: 'Translated optional',
        BROWSE: 'Translated browse',
        AUTO_TRUST_HOST_KEY: 'Translated host-key option',
        REMEMBER_CREDENTIALS: 'Translated remember option',
        CANCEL: 'Translated cancel',
        CONNECT: 'Translated connect',
        CONNECTING: 'Translated connecting',
        SELECT_PRIVATE_KEY: 'Translated key picker title',
      },
    });
    translate.use('test');
  });

  it('renders the dialog with translated text', () => {
    const fixture = TestBed.createComponent(ConnectorSettingDialogComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Translated SSH settings');
    expect(text).toContain('Translated host');
    expect(text).toContain('Translated private key');
    expect(text).toContain('Translated host-key option');
    expect(text).toContain('Translated remember option');
    expect(text).toContain('Translated cancel');
    expect(text).toContain('Translated connect');
  });

  it('uses the translated title for the native private-key picker', async () => {
    const invoke = jasmine.createSpy('invoke').and.resolveTo(undefined);
    const previousIpcRenderer = window['ipcRenderer'];
    window['ipcRenderer'] = { invoke };
    const fixture = TestBed.createComponent(ConnectorSettingDialogComponent);

    try {
      await fixture.componentInstance.selectPrivateKey();
    } finally {
      window['ipcRenderer'] = previousIpcRenderer;
    }

    expect(invoke).toHaveBeenCalledWith('select-file', {
      title: 'Translated key picker title',
      path: undefined,
    });
  });
});
