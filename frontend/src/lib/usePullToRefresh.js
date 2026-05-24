import { useEffect, useRef, useState } from 'react';

// Mobile pull-to-refresh hook. Listens to touch events on the document
// when scrollY is at the top. When the user drags down past ~70px we
// flag `triggered`; on release we invoke `onRefresh`. The pixel value
// of the pull is exposed so the consumer can render a transient
// indicator (e.g. "Checking for updates…") that follows the drag.
//
// Pure JS — no library deps, no portals, no scroll containers. Works
// on every iOS Safari + Android Chrome we care about. Desktop touch
// devices also work but it's a no-op on mouse-only browsers.
//
// Stale-closure note: we keep the live pull distance in a ref so the
// touchend handler reads the current value, and only mirror it to state
// for re-render purposes when it actually changes. Otherwise the
// effect would have to re-bind on every move.
export default function usePullToRefresh(onRefresh, { threshold = 70 } = {}) {
  const [pullDist, setPullDist] = useState(0);
  const startY = useRef(null);
  const distRef = useRef(0);

  useEffect(() => {
    function onStart(e) {
      if (typeof window === 'undefined') return;
      if (window.scrollY > 5) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      distRef.current = 0;
    }
    function onMove(e) {
      if (startY.current == null) return;
      if (window.scrollY > 0) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        if (distRef.current !== 0) {
          distRef.current = 0;
          setPullDist(0);
        }
        return;
      }
      // Damp the pull a bit so it doesn't feel rubber-bandy.
      const clamped = Math.min(dy * 0.6, threshold + 30);
      distRef.current = clamped;
      setPullDist(clamped);
    }
    function onEnd() {
      const d = distRef.current;
      if (d >= threshold && typeof onRefresh === 'function') {
        try {
          onRefresh();
        } catch {
          /* swallow — refresher reports its own errors */
        }
      }
      startY.current = null;
      distRef.current = 0;
      setPullDist(0);
    }
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh, threshold]);

  return { pullDist, triggered: pullDist >= threshold };
}
