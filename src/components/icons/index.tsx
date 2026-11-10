// Small inline icon set (stroke icons, 20px) so we don't need an icon dependency.
type P = { className?: string };
const base = "h-5 w-5";
const S = ({ className, children }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className ?? base} aria-hidden>
    {children}
  </svg>
);

/** Shared gradient, rendered once in the root layout (defs inside display:none elements don't paint). */
export const GoldDefs = () => (
  <svg width="0" height="0" className="absolute" aria-hidden>
    <defs>
      <linearGradient id="vk-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f3d77b" />
        <stop offset=".5" stopColor="#d4af37" />
        <stop offset="1" stopColor="#a67c1a" />
      </linearGradient>
    </defs>
  </svg>
);

export const Crown = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className ?? "h-7 w-7"} aria-hidden>
    <path d="M4 11l6 5 6-9 6 9 6-5-2.5 13h-19z" fill="url(#vk-gold)" />
    <rect x="6.5" y="25.5" width="19" height="2.5" rx="1.25" fill="url(#vk-gold)" />
    <circle cx="4" cy="10" r="2" fill="#f3d77b" /><circle cx="16" cy="6" r="2" fill="#f3d77b" /><circle cx="28" cy="10" r="2" fill="#f3d77b" />
  </svg>
);
export const Home = (p: P) => <S {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></S>;
export const Media = (p: P) => <S {...p}><rect x="3" y="3" width="13" height="13" rx="2" /><path d="M8 21h11a2 2 0 0 0 2-2V8" /><path d="m3 13 4-4 5 5" /></S>;
export const Brand = (p: P) => <S {...p}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5S13.4 15 14.5 15H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></S>;
export const Box = (p: P) => <S {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></S>;
export const User = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>;
export const Plus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const Folder = (p: P) => <S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>;
export const Arrow = (p: P) => <S {...p}><path d="M12 19V5M5 12l7-7 7 7" /></S>;
export const Upload = (p: P) => <S {...p}><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></S>;
export const Heart = ({ className, filled }: P & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.7} className={className ?? base} aria-hidden>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);
export const Film = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></S>;
export const Sparkle = (p: P) => <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></S>;
export const Ratio = (p: P) => <S {...p}><rect x="7" y="3" width="10" height="18" rx="2" /></S>;
export const Layers = (p: P) => <S {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></S>;
export const Trash = (p: P) => <S {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></S>;
export const LogOut = (p: P) => <S {...p}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></S>;
export const Menu = (p: P) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>;
export const Play = (p: P) => <S {...p}><path d="M8 5v14l11-7z" fill="currentColor" /></S>;
export const ChevronDown = (p: P) => <S {...p}><path d="m6 9 6 6 6-6" /></S>;
export const Check = (p: P) => <S {...p}><path d="m5 12 5 5 9-10" /></S>;
