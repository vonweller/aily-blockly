import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom, Subscription, timeout } from 'rxjs';
import { API } from '../configs/api.config';
import { ModelDeployDetail } from '../windows/model-deploy/model-deploy.types';
import { ConfigService } from './config.service';
import { SerialService } from './serial.service';
import { UiService } from './ui.service';
import { buildModelStoreServiceContextVersion } from './model-store-service-context';

type ModelStoreMethod = 'open-deploy' | 'open-test';

interface ModelStoreRequest {
  protocolVersion: 1;
  requestId: string;
  method: ModelStoreMethod;
  params: { modelId: string; serviceContextVersion: string };
  source: string;
  senderToolId: string;
  senderContextId: string;
}

class HostBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class ModelStoreHostBridgeService implements OnDestroy {
  private readonly subscription: Subscription;
  private readonly completedRequests = new Map<string, number>();

  constructor(
    private readonly http: HttpClient,
    private readonly configService: ConfigService,
    private readonly serialService: SerialService,
    private readonly uiService: UiService,
  ) {
    this.subscription = this.uiService.actionSubject.subscribe((action: any) => {
      if (action?.action === 'signal' && action?.type === 'tool' && action?.data === 'model-store:request') {
        void this.handleRequest(action.payload);
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  private async handleRequest(payload: unknown): Promise<void> {
    let requestId = '';
    let senderContextId = '';
    try {
      const request = this.validateRequest(payload);
      requestId = request.requestId;
      senderContextId = request.senderContextId;
      this.rejectDuplicate(requestId);
      const detail = await this.loadAuthoritativeDetail(request.params.modelId);
      this.assertSupported(detail);
      this.openDeploymentWindow(detail, request.method);
      this.respond(requestId, senderContextId, { ok: true, result: { state: 'opened' } });
    } catch (error) {
      if (!requestId) return;
      const code = error instanceof HostBridgeError ? error.code : 'OPEN_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      this.respond(requestId, senderContextId, { ok: false, error: { code, message } });
    }
  }

  private validateRequest(payload: unknown): ModelStoreRequest {
    if (!payload || typeof payload !== 'object') throw new HostBridgeError('INVALID_REQUEST', 'Invalid host request');
    const value = payload as Partial<ModelStoreRequest>;
    const params = value.params as ModelStoreRequest['params'] | undefined;
    if (value.protocolVersion !== 1) throw new HostBridgeError('UNSUPPORTED_PROTOCOL', 'Unsupported model-store protocol');
    if (value.senderToolId !== 'model-store' || !value.senderContextId || value.source !== 'child-tool:model-store') {
      throw new HostBridgeError('UNTRUSTED_SENDER', 'Model-store request did not originate from the trusted child host');
    }
    if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(value.requestId)) {
      throw new HostBridgeError('INVALID_REQUEST', 'Invalid requestId');
    }
    if (value.method !== 'open-deploy' && value.method !== 'open-test') {
      throw new HostBridgeError('CAPABILITY_NOT_AVAILABLE', 'Unsupported model-store host action');
    }
    if (!params || typeof params.modelId !== 'string' || !params.modelId.trim() || params.modelId.length > 120) {
      throw new HostBridgeError('INVALID_REQUEST', 'Invalid modelId');
    }
    const currentVersion = buildModelStoreServiceContextVersion(this.configService.getCurrentApiServer());
    if (params.serviceContextVersion !== currentVersion) {
      throw new HostBridgeError('SERVICE_CONTEXT_CHANGED', 'The selected model service changed; refresh model details and try again');
    }
    return value as ModelStoreRequest;
  }

  private rejectDuplicate(requestId: string): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.completedRequests) if (expiresAt <= now) this.completedRequests.delete(id);
    if (this.completedRequests.has(requestId)) throw new HostBridgeError('DUPLICATE_REQUEST', 'Duplicate model-store request');
    this.completedRequests.set(requestId, now + 30_000);
  }

  private async loadAuthoritativeDetail(modelId: string): Promise<ModelDeployDetail> {
    const lang = document.documentElement.lang || 'en';
    try {
      const response = await firstValueFrom(this.http.get<any>(API.modelDetails, {
        params: { model_id: modelId, lang },
      }).pipe(timeout(10_000)));
      if (Number(response?.status) !== 200 || !response?.data || String(response.data.id) !== modelId) {
        throw new HostBridgeError('MODEL_NOT_FOUND', 'The selected model is no longer available');
      }
      return response.data as ModelDeployDetail;
    } catch (error) {
      if (error instanceof HostBridgeError) throw error;
      throw new HostBridgeError('MODEL_API_UNAVAILABLE', error instanceof Error ? error.message : 'Unable to load model details');
    }
  }

  private assertSupported(detail: ModelDeployDetail): void {
    const supportedAuthor = detail.author_name === 'SenseCraft AI' || detail.author_name === 'Seeed Studio';
    const supportedBoard = Array.isArray(detail.uniform_types) && detail.uniform_types.includes('32');
    if (!detail.is_enabled || (!supportedAuthor && !supportedBoard)) {
      throw new HostBridgeError('UNSUPPORTED_MODEL_TYPE', 'This model cannot be deployed by the current host');
    }
  }

  private openDeploymentWindow(detail: ModelDeployDetail, method: ModelStoreMethod): void {
    localStorage.setItem('current_model_deploy', JSON.stringify(detail));
    if (this.serialService.currentPort) {
      localStorage.setItem('current_model_deploy_port', this.serialService.currentPort);
    }
    const mode = method === 'open-test' ? 'test' : 'deploy';
    this.uiService.openWindow({
      path: `model-deploy/sscma/${mode}`,
      title: `${method === 'open-test' ? '模型测试' : '模型部署'} - ${detail.name}`,
      alwaysOnTop: true,
      width: method === 'open-test' ? 900 : 1020,
      height: 640,
    });
  }

  private respond(requestId: string, targetContextId: string, response: Record<string, unknown>): void {
    this.uiService.sendToolSignal('model-store:response', {
      protocolVersion: 1,
      requestId,
      targetContextId,
      source: 'host:model-store',
      ...response,
    });
  }
}
