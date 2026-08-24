import { Injectable } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';

import { ThemeService } from '@core/preferences/public-api';
import {
  type SchematicPresentationPort,
  type SchematicPresentationResult,
} from '@integration/automation/public-api';

@Injectable({ providedIn: 'root' })
export class SchematicPresentationAdapter implements SchematicPresentationPort {
  constructor(
    private readonly themeService: ThemeService,
    private readonly modal: NzModalService,
  ) {}

  async showArchitectureDiagram(code: string): Promise<SchematicPresentationResult> {
    try {
      const [{ default: mermaid }, { MermaidComponent }] = await Promise.all([
        import('mermaid'),
        import('../../components/mermaid/mermaid.component'),
      ]);
      mermaid.initialize({
        theme: this.themeService.getMermaidTheme() as any,
        startOnLoad: false,
      });
      const diagramId = `mermaid-arch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const result = await mermaid.render(diagramId, code);
      const svg = typeof result === 'object' && result?.svg
        ? result.svg
        : typeof result === 'string'
          ? result
          : '';
      document.getElementById(diagramId)?.remove();
      if (!svg.trim()) {
        return { ok: false, error: '架构图渲染失败' };
      }

      const forcedStyle = 'width: 60vw !important; height: 80vh !important; max-width: 100% !important; display: block !important;';
      const enhancedSvg = svg
        .replace('<svg', `<svg id="${diagramId}" data-mermaid-svg="true"`)
        .replace(/width="[^"]*"/, 'width="60vw"')
        .replace(/height="[^"]*"/, 'height="80vh"')
        .replace(/<svg([^>]*)>/, (_match: string, attributes: string) => {
          const merged = /style=/.test(attributes)
            ? attributes.replace(/style="[^"]*"/, `style="${forcedStyle}"`)
            : `${attributes} style="${forcedStyle}"`;
          return `<svg${merged}>`;
        });

      this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: { padding: '0' },
        nzContent: MermaidComponent,
        nzData: { svg: enhancedSvg },
        nzWidth: 'fit-content',
      });
      return { ok: true, opened: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
}
