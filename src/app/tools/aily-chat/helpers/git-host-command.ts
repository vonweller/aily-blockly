import { AilyHost } from '../core/host';

export async function runHostGitCommand(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  const host = AilyHost.get();
  if (!host.cmd?.spawn) {
    throw new Error('Git command host is unavailable');
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    host.cmd.spawn('git', args, {
      cwd,
      streamId: `git_host_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...(env ? { env } : {}),
    }, true).subscribe({
      next: (event: any) => {
        switch (event?.type) {
          case 'stdout':
            stdout += event.data ?? '';
            break;
          case 'stderr':
            stderr += event.data ?? '';
            break;
          case 'close': {
            if (!stdout && typeof event.stdout === 'string') {
              stdout = event.stdout;
            }
            if (!stderr && typeof event.stderr === 'string') {
              stderr = event.stderr;
            }
            if ((event.code ?? 0) === 0) {
              resolve(stdout.trimEnd());
              return;
            }
            reject(new Error(stderr || stdout || `git ${args.join(' ')} failed`));
            break;
          }
          case 'error':
            reject(new Error(event.error ?? `git ${args.join(' ')} failed`));
            break;
        }
      },
      error: (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    });
  });
}