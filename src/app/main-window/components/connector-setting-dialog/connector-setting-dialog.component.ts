import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import {
  BaseDialogComponent,
  DialogButton,
} from '../../../components/base-dialog/base-dialog.component';
import {
  LinuxBoardConnectorService,
  LinuxBoardSshSettings,
} from '@integration/device/public-api';

export interface ConnectorSettingDialogData {
  settings?: Partial<LinuxBoardSshSettings>;
}

@Component({
  selector: 'app-connector-setting-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzCheckboxModule, NzInputModule, BaseDialogComponent],
  templateUrl: './connector-setting-dialog.component.html',
  styleUrl: './connector-setting-dialog.component.scss',
})
export class ConnectorSettingDialogComponent {
  private readonly modal = inject(NzModalRef);
  private readonly message = inject(NzMessageService);
  private readonly connector = inject(LinuxBoardConnectorService);
  private readonly data = inject<ConnectorSettingDialogData | null>(NZ_MODAL_DATA, { optional: true });

  settings: LinuxBoardSshSettings = {
    ...this.connector.getSshSettings(),
    ...(this.data?.settings || {}),
  };
  connecting = false;

  get canConnect(): boolean {
    const port = Number(this.settings.port);
    return Boolean(
      this.settings.host.trim()
      && this.settings.username.trim()
      && Number.isInteger(port)
      && port >= 1
      && port <= 65_535,
    );
  }

  get buttons(): DialogButton[] {
    return [
      {
        text: '取消',
        action: 'cancel',
        disabled: this.connecting,
      },
      {
        text: this.connecting ? '连接验证中' : '连接',
        type: 'primary',
        action: 'connect',
        disabled: !this.canConnect || this.connecting,
        loading: this.connecting,
      },
    ];
  }

  onButtonClick(action: string): void {
    if (action === 'connect') {
      void this.connect();
    } else {
      this.close();
    }
  }

  close(): void {
    if (this.connecting) return;
    this.settings.password = '';
    this.modal.close();
  }

  async selectPrivateKey(): Promise<void> {
    const path = await window['ipcRenderer']?.invoke?.('select-file', {
      title: '选择 SSH 私钥',
      path: this.settings.privateKeyPath || undefined,
    });
    if (path) this.settings.privateKeyPath = String(path);
  }

  private async connect(): Promise<void> {
    if (!this.canConnect || this.connecting) return;
    this.connecting = true;
    try {
      await this.connector.connectSsh({ ...this.settings });
      this.settings.password = '';
      this.modal.close({ connected: true });
    } catch (error) {
      this.message.error(error instanceof Error ? error.message : String(error || 'SSH 连接失败'));
    } finally {
      this.connecting = false;
    }
  }
}
