import { assertSynchronousNativeCandidate } from './blockly-native-candidate-policy';
import nativeBuild from '../../../../../.generated/blockly-runtime/manifest.json';
import type { NativeCandidateOptions, NativeCandidateRequest, NativeCandidateResult } from './blockly-native-candidate-protocol';

/** Disposable state isolation, not an adversarial JavaScript CPU/security sandbox. */
export async function evaluateNativeCandidate(request: NativeCandidateRequest, options: NativeCandidateOptions): Promise<NativeCandidateResult> {
  const assertCurrent = () => { options.signal?.throwIfAborted(); options.assertCurrent(); };
  assertCurrent();
  // Snapshot before the first await: callers cannot change the request during asset loading.
  const detached = structuredClone(request);
  assertSynchronousNativeCandidate(detached);
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error('Invalid native candidate timeout.');
  const abort = new AbortController();
  const onAbort = () => abort.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort.abort(new Error('Native candidate timed out.')), timeoutMs);
  let frame: HTMLIFrameElement | undefined, channel: MessageChannel | undefined;
  try {
    const response = await fetch(new URL('blockly/runtime/native-candidate.js', document.baseURI), { signal: abort.signal, credentials: 'omit' });
    if (!response.ok) throw new Error('Bundled native candidate runtime could not be loaded. Run the Angular build through npm run ng.');
    const bytes = await response.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== nativeBuild.sha256) {
      throw new Error('Native candidate asset does not match the host build. Rebuild/reload the application.');
    }
    const source = new TextDecoder().decode(bytes); assertCurrent(); abort.signal.throwIfAborted();
    frame = document.createElement('iframe');
    // Keep real SVG geometry available; display:none makes native measurements invalid.
    frame.style.cssText = 'position:fixed;left:-11000px;top:0;width:1024px;height:768px;border:0;pointer-events:none;';
    frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts'); // Deliberately no allow-same-origin or host preload.
    frame.setAttribute('data-blockly-native-candidate', 'true');
    const escapeScript = (text: string) => text.replace(/<\/script/gi, '<\\/script');
    frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; frame-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">'
      + '<script type="module">' + escapeScript(source) + '</script>';
    channel = new MessageChannel();
    const result = await new Promise<NativeCandidateResult>((resolve, reject) => {
      const fail = () => reject(abort.signal.reason);
      abort.signal.addEventListener('abort', fail, { once: true });
      channel!.port1.onmessage = event => {
        try {
          assertCurrent(); abort.signal.throwIfAborted();
          const reply = event.data;
          if (!reply?.ok) throw new Error(reply?.error || 'Native candidate failed.');
          if (!reply.result?.state || !Array.isArray(reply.result.structures)) throw new Error('Invalid native candidate response.');
          resolve(reply.result);
        } catch (error) { reject(error); }
      };
      channel!.port1.onmessageerror = () => reject(new Error('Native candidate response is not transferable.'));
      frame!.onload = () => {
        try { assertCurrent(); abort.signal.throwIfAborted(); frame!.contentWindow!.postMessage(detached, '*', [channel!.port2]); }
        catch (error) { reject(error); }
      };
      document.body.appendChild(frame!);
    });
    assertCurrent(); return result;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
    channel?.port1.close(); channel?.port2.close(); frame?.remove();
  }
}
