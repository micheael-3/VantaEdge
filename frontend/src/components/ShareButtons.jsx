import Icon from './Icon.jsx';
import { overPlainEnglish } from '../lib/fixture.js';

// Build the text payload that gets shared. Settled cards celebrate the
// hit/miss with a checkmark + final score; upcoming cards just promote
// the AI's pick with the confidence number.
function buildShareText(fixture) {
  const home = fixture?.home?.name || 'Home';
  const away = fixture?.away?.name || 'Away';
  const ov = fixture?.predictions?.over;
  const hit = fixture?.actualResult;

  if (hit) {
    // settled — celebrate (or honestly admit the miss).
    const sym = hit.overHit || hit.bttsHit ? '✓' : '✗';
    return `FastScore AI called ${home} vs ${away} — ${overPlainEnglish(ov?.line)} ${sym} FT ${hit.homeGoals}-${hit.awayGoals} · fastscore.eu`;
  }
  // upcoming — promo
  const conf = Math.round(ov?.confidence || 0);
  return `FastScore AI: ${home} vs ${away} — ${overPlainEnglish(ov?.line)} (${conf}% confident) 🎯 fastscore.eu`;
}

// Two share buttons under each match card.
//   - WhatsApp: deep-link to the wa.me share URL in a new tab.
//   - Native:  navigator.share() when available (mobile Safari, Android),
//              clipboard copy as fallback on desktop.
export default function ShareButtons({ fixture }) {
  if (!fixture) return null;
  const text = buildShareText(fixture);

  const shareNative = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text, url: 'https://fastscore.eu' });
      } catch {
        /* user cancelled */
      }
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        // Intentionally simple — no toast component plumbed here yet.
        // eslint-disable-next-line no-alert
        alert('Copied to clipboard');
      } catch {
        /* ignore */
      }
    }
  };

  const shareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        onClick={shareWhatsApp}
        className="share-btn whatsapp"
        aria-label="Share to WhatsApp"
      >
        <Icon name="whatsapp" size={14} />
        <span>WhatsApp</span>
      </button>
      <button
        type="button"
        onClick={shareNative}
        className="share-btn"
        aria-label="Share"
      >
        <Icon name="share" size={14} />
        <span>Share</span>
      </button>
    </div>
  );
}
