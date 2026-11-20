/** A spinning gold wheel, shown while a video is being made. */
export default function Spinner({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={"relative inline-block " + className}>
      <span className="absolute inset-0 rounded-full border-4 border-gold/20" />
      <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-gold border-r-gold/60" />
    </span>
  );
}
