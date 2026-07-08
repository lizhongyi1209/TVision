// TVision brand mark: token dashes flowing into a lens (tokenflow vision / 元流视觉).
// Colors ride the theme tokens so the mark always matches the app accent.

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <g stroke="var(--color-accent)" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M11 20h8" />
        <path d="M8 32h9" />
        <path d="M13 44h6" />
        <circle cx="40" cy="32" r="13" />
      </g>
      <circle cx="40" cy="32" r="5" fill="var(--color-accent-2)" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5" title="tokenflow vision">
      <LogoMark size={22} />
      <span className="text-sm font-semibold tracking-tight text-fg">
        <span className="text-accent">T</span>Vision
      </span>
      <span className="ml-1 hidden text-xs text-fg-mute md:block">元流视觉</span>
    </div>
  );
}
