import { useEffect, useState } from 'react';
import { shareUrl, type ShareState } from '../lib/shareUrl';

/**
 * Copy a link to exactly this view.
 *
 * Uses the Web Share sheet where there is one, since on a phone the thing you
 * want is to send this to somebody, not to have it on a clipboard you then
 * have to paste. Falls back to the clipboard, and to selecting the text if
 * even that is unavailable — a share button that silently does nothing is
 * worse than no share button.
 */
export function ShareLink({ state, pinned }: { state: ShareState; pinned: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const id = setTimeout(() => setStatus('idle'), 2500);
    return () => clearTimeout(id);
  }, [status]);

  const share = async () => {
    const url = shareUrl(state, window.location.href);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Lookup', text: 'The sky from here', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch (err) {
      // A cancelled share sheet is not a failure and must not be reported as
      // one; the user closed it on purpose.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus('failed');
      window.prompt('Copy this link', url);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
      >
        {status === 'copied' ? 'Link copied' : status === 'failed' ? 'Copy manually' : 'Share this view'}
      </button>
      <span className="text-[11px] text-space-400 hidden sm:inline">
        {pinned ? 'links to this exact moment' : 'links to your location, live'}
      </span>
    </div>
  );
}
