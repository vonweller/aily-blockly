import { AilyHost } from '../core/host';
import { EditingContentStore } from './editing-content-store.service';
import type { EditingFileApplyResult, RestorePlan } from './editing-timeline.types';

export class EditingFileApplyService {
  constructor(
    private readonly contentStore: EditingContentStore,
    private readonly workspaceRoot: string,
    private readonly sessionId: string,
  ) {}

  async apply(plan: RestorePlan): Promise<EditingFileApplyResult> {
    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;
    let appliedFiles = 0;
    const errors: string[] = [];

    for (const file of plan.files) {
      try {
        const currentExists = fs.existsSync(file.uri);
        if (!file.exists) {
          if (currentExists) {
            fs.unlinkSync(file.uri);
            appliedFiles++;
          }
          continue;
        }

        const dirPath = pathUtil.dirname(file.uri);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        if (file.contentKind === 'binary') {
          const targetBytes = file.contentRef
            ? this.contentStore.getBinary(this.workspaceRoot, this.sessionId, file.contentRef)
            : new Uint8Array();
          const currentBytes = currentExists ? normalizeBytes(fs.readFileSync(file.uri)) : null;
          if (currentBytes && areBytesEqual(currentBytes, targetBytes)) {
            continue;
          }
          (fs.writeFileSync as any)(file.uri, targetBytes);
          appliedFiles++;
          continue;
        }

        const targetContent = file.contentRef
          ? this.contentStore.getText(this.workspaceRoot, this.sessionId, file.contentRef)
          : '';
        const currentContent = currentExists ? fs.readFileSync(file.uri, 'utf-8') : null;
        if (currentExists && currentContent === targetContent) {
          continue;
        }
        fs.writeFileSync(file.uri, targetContent, 'utf-8');
        appliedFiles++;
      } catch (error: any) {
        errors.push(`恢复 ${file.uri} 失败: ${error?.message || String(error)}`);
      }
    }

    return { appliedFiles, errors };
  }
}

function normalizeBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (Array.isArray(content)) {
    return new Uint8Array(content);
  }
  if (content && typeof content === 'object' && 'buffer' in (content as any)) {
    const view = content as { buffer: ArrayBufferLike; byteOffset?: number; byteLength?: number };
    return new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength ?? 0);
  }
  return new Uint8Array();
}

function areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}