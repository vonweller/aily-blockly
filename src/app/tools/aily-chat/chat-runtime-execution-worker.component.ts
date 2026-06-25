import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { ChatRuntimeHostBootstrapService } from './services/chat-runtime-host-bootstrap.service';

@Component({
  selector: 'aily-chat-runtime-execution-worker',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatRuntimeExecutionWorkerComponent implements OnInit {
  private readonly bootstrap = inject(ChatRuntimeHostBootstrapService);

  ngOnInit(): void {
    void this.bootstrap.startHostExecutionWorker().catch((error) => {
      console.error('[AilyChat][RuntimeHost] Failed to start host execution worker:', error);
    });
  }
}
