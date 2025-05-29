import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

declare const electronAPI: any;

export interface CmdOutput {
  type: 'stdout' | 'stderr' | 'close' | 'error';
  data?: string;
  code?: number;
  signal?: string;
  error?: string;
  streamId: string;
}

export interface CmdOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: { [key: string]: string };
  streamId?
}

@Injectable({
  providedIn: 'root'
})
export class CmdService {
  private subjects = new Map<string, Subject<CmdOutput>>();

  constructor() { }

  /**
   * 执行命令并返回Observable
   * @param options 命令选项
   * @returns Observable<CmdOutput>
   */
  spawn(command: string, args?: string[], options?: Partial<CmdOptions>): Observable<CmdOutput> {
    const streamId = `cmd_${Date.now()}_${Math.random()}`;
    const subject = new Subject<CmdOutput>();
    this.subjects.set(streamId, subject);
    const cmdOptions: CmdOptions = {
      command,
      args: args || [],
      ...options,
      streamId
    };

    // 注册数据监听器
    const removeListener = window['cmd'].onData(streamId, (data: CmdOutput) => {
      subject.next(data);

      // 如果是关闭或错误事件，完成Observable
      if (data.type === 'close' || data.type === 'error') {
        subject.complete();
        this.subjects.delete(streamId);
        removeListener();
      }
    });

    // 执行命令
    window['cmd'].run(cmdOptions).then((result: any) => {
      if (!result.success) {
        subject.error(new Error(result.error));
        this.subjects.delete(streamId);
        removeListener();
      }
    }).catch((error: any) => {
      subject.error(error);
      this.subjects.delete(streamId);
      removeListener();
    });

    return subject.asObservable();
  }

  /**
   * 快速执行命令
   * @param npmCommand 命令字符串
   * @param cwd 工作目录
   */
  run(command: string, cwd?: string): Observable<CmdOutput> {
    console.log(`run command: ${command}`);
    const parts = parseCommand(command);
    const cmd = parts[0];
    const args = parts.slice(1);
    return this.spawn(cmd, args, { cwd });
  }

  /**
   * 终止命令执行
   * @param streamId 流ID
   */
  async kill(streamId: string): Promise<boolean> {
    const subject = this.subjects.get(streamId);
    if (subject) {
      const result = await window['cmd'].kill(streamId);
      if (result.success) {
        subject.complete();
        this.subjects.delete(streamId);
      }
      return result.success;
    }
    return false;
  }

  /**
   * 向进程发送输入
   * @param streamId 流ID
   * @param input 输入内容
   */
  async sendInput(streamId: string, input: string): Promise<boolean> {
    const result = await window['cmd'].input(streamId, input);
    return result.success;
  }
}


function parseCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        result.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}