import { Injectable } from '@angular/core';

import { ConnectionGraphService } from './connection-graph.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import {
  generateConnectionGraphTool,
  generatePinmapTool,
  getCurrentSchematicTool,
  getPinmapSummaryTool,
  getProjectContextTool,
  getSensorPinmapCatalogTool,
  savePinmapTool,
  validateConnectionGraphTool,
} from '../tools/aily-chat/tools/connectionGraphTool';
import type { ToolUseResult } from '../tools/aily-chat/core/tool-types';
import { AilyHost } from '../tools/aily-chat/core/host';

@Injectable({ providedIn: 'root' })
export class SchematicMcpRuntimeService {
  constructor(
    private readonly connectionGraphService: ConnectionGraphService,
    private readonly electronService: ElectronService,
    private readonly projectService: ProjectService,
  ) {}

  async invoke(method: string, args: Record<string, unknown>): Promise<ToolUseResult> {
    switch ((method || '').trim()) {
      case 'get_generated_cpp_code':
        return this.getGeneratedCppCode();
      case 'preview_schematic_components':
        return this.previewSchematicComponents(args);
      case 'notify_schematic_saved':
        return this.notifySchematicSaved(args);
      case 'generate_schematic':
        return generateConnectionGraphTool(this.connectionGraphService, this.projectService, args as any);
      case 'get_pinmap_summary':
        return getPinmapSummaryTool(this.connectionGraphService, this.projectService, args as any);
      case 'get_component_catalog':
        return getSensorPinmapCatalogTool(this.connectionGraphService, this.projectService, args as any);
      case 'get_project_context':
        return getProjectContextTool(this.connectionGraphService, this.projectService, args as any);
      case 'validate_schematic':
        return validateConnectionGraphTool(this.connectionGraphService, this.projectService, args as any);
      case 'get_current_schematic':
        return getCurrentSchematicTool(this.connectionGraphService, this.projectService, args as any);
      case 'generate_pinmap':
        return generatePinmapTool(this.connectionGraphService, this.projectService, args as any);
      case 'save_pinmap':
        return savePinmapTool(this.connectionGraphService, this.projectService, args as any);
      default:
        return {
          is_error: true,
          content: `不支持的 schematic MCP 方法: ${method || '<empty>'}`,
        };
    }
  }

  private async getGeneratedCppCode(): Promise<ToolUseResult> {
    try {
      const cppCode = AilyHost.get().editor?.getGeneratedCode?.() || '';
      return {
        is_error: false,
        content: JSON.stringify({ cppCode }, null, 2),
      };
    } catch (error: any) {
      return {
        is_error: true,
        content: error?.message || String(error),
      };
    }
  }

  private async previewSchematicComponents(args: Record<string, unknown>): Promise<ToolUseResult> {
    try {
      const payload = {
        componentConfigs: args['componentConfigs'] || {},
        components: Array.isArray(args['components']) ? args['components'] : [],
        connections: Array.isArray(args['connections']) ? args['connections'] : [],
      };

      if (this.connectionGraphService.hasActiveIframe) {
        await this.connectionGraphService.iframeApi.receiveData(payload);
      }
      if (typeof window !== 'undefined' && window['ipcRenderer']) {
        window['ipcRenderer'].send('iframe-message-connection-graph', {
          type: 'generate-graph-updated',
          data: payload,
        });
      }
      this.connectionGraphService.emitNotice?.({
        title: 'AI生成中',
        text: '硬件组件已就绪，正在生成连线方案...',
        state: 'doing',
        showProgress: false,
      });
      return {
        is_error: false,
        content: JSON.stringify({ ok: true }, null, 2),
      };
    } catch (error: any) {
      return {
        is_error: true,
        content: error?.message || String(error),
      };
    }
  }

  private async notifySchematicSaved(args: Record<string, unknown>): Promise<ToolUseResult> {
    try {
      const jsonData = args['jsonData'] as any;
      const boardPackagePath = await this.projectService.getBoardPackagePath();
      if (boardPackagePath && jsonData) {
        const componentConfigs = this.connectionGraphService.getComponentConfigs(boardPackagePath, jsonData);
        const payload = {
          componentConfigs,
          components: jsonData.components || [],
          connections: jsonData.connections || [],
          theme: 'dark',
        };
        if (this.connectionGraphService.hasActiveIframe) {
          await this.connectionGraphService.iframeApi.receiveData(payload);
        }
        if (this.electronService.isElectron && window['ipcRenderer']) {
          window['ipcRenderer'].send('iframe-message-connection-graph', {
            type: 'generate-graph-updated',
            data: payload,
          });
        }
      }
      this.connectionGraphService.emitNotice?.({
        title: 'AI生成中',
        text: '✅ 连线图已生成完成',
        state: 'done',
        setTimeout: 3000,
      });
      return {
        is_error: false,
        content: JSON.stringify({ ok: true }, null, 2),
      };
    } catch (error: any) {
      return {
        is_error: true,
        content: error?.message || String(error),
      };
    }
  }
}
