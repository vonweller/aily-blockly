export interface ParsedTerminalPayload {
  command: string;
  output: string;
  stderr: string;
  exitCode?: number;
  isRunning: boolean;
  toolCallId?: string;
  terminalId?: string;
  cwd?: string;
}

export function parseTerminalPayload(text: string): ParsedTerminalPayload | null {
  try {
    const data = JSON.parse(text);
    return {
      command: data.command || '',
      output: data.output || '',
      stderr: data.stderr || '',
      exitCode: data.exit_code ?? data.exitCode,
      isRunning: data.status === 'running',
      toolCallId: data.toolCallId,
      terminalId: data.terminalId,
      cwd: data.cwd,
    };
  } catch {
    const lines = text.split(/\r?\n/);
    const headers = new Map<string, string>();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let section: 'headers' | 'stdout' | 'stderr' = 'headers';

    for (const line of lines) {
      if (line === 'stdout:') {
        section = 'stdout';
        continue;
      }
      if (line === 'stderr:') {
        section = 'stderr';
        continue;
      }
      if (section === 'headers') {
        const match = line.match(/^([A-Za-z]+):\s*(.*)$/);
        if (match) {
          headers.set(match[1].toLowerCase(), match[2]);
        }
        continue;
      }
      if (section === 'stdout') {
        stdout.push(line);
        continue;
      }
      stderr.push(line);
    }

    const command = headers.get('command') || '';
    const exitCodeRaw = headers.get('exitcode');
    const exitCode = exitCodeRaw != null && exitCodeRaw !== '' ? Number(exitCodeRaw) : undefined;

    if (!command && stdout.length === 0 && stderr.length === 0) {
      return null;
    }

    return {
      command,
      output: stdout.join('\n').trim(),
      stderr: stderr.join('\n').trim(),
      exitCode: Number.isNaN(exitCode as number) ? undefined : exitCode,
      isRunning: headers.get('status') === 'running',
      toolCallId: headers.get('toolcallid'),
      terminalId: headers.get('terminalid'),
      cwd: headers.get('cwd'),
    };
  }
}