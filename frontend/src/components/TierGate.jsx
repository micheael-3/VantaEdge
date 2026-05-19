// TESTING MODE: tier gating disabled. Renders children directly with no overlay.
// Restore the original blur/lock UI from git history when re-enabling paid tiers.
export default function TierGate({ requiredTier, onUpgrade, children }) {
  void requiredTier;
  void onUpgrade;
  return <>{children}</>;
}
