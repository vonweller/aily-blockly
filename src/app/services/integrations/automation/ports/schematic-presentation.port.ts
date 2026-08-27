import { InjectionToken } from '@angular/core';

export interface SchematicPresentationResult {
  ok: boolean;
  opened?: boolean;
  error?: string;
}

export interface SchematicPresentationPort {
  showArchitectureDiagram(code: string): Promise<SchematicPresentationResult>;
}

export const SCHEMATIC_PRESENTATION_PORT = new InjectionToken<SchematicPresentationPort>(
  'SCHEMATIC_PRESENTATION_PORT',
);
