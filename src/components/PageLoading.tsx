/** Shown instantly while a page loads, so a slow phone signal never looks like a frozen app. */
export default function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
