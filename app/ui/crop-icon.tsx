const LEAF = '#6fd492';
const STEM = '#8a6a44';

function Coffee() {
  return (
    <>
      <path d="M8 44 C20 34 30 26 52 10" stroke={STEM} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M22 33 C14 22 18 12 28 10 C30 20 28 28 22 33Z" fill={LEAF} />
      <path d="M40 18 C50 22 54 32 50 40 C42 36 38 28 40 18Z" fill={LEAF} opacity={0.85} />
      {[
        [30, 32],
        [36, 30],
        [33, 37],
        [39, 36],
        [27, 38],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={4} fill={i % 2 ? '#c2272d' : '#e0453f'} />
      ))}
    </>
  );
}

function Potato() {
  return (
    <>
      <path d="M30 22 C30 14 26 9 20 7 M30 22 C31 14 36 10 42 9" stroke={LEAF} strokeWidth={3} fill="none" strokeLinecap="round" />
      <ellipse cx={30} cy={36} rx={20} ry={14} fill="#c79a5b" />
      <ellipse cx={30} cy={36} rx={20} ry={14} fill="none" stroke="#8a6a44" strokeWidth={1.5} />
      {[
        [22, 32],
        [34, 30],
        [38, 40],
        [26, 42],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.6} fill="#7a5a36" />
      ))}
    </>
  );
}

function Cotton() {
  return (
    <>
      <path d="M30 56 V40" stroke={STEM} strokeWidth={3} strokeLinecap="round" />
      <path d="M16 38 L30 46 L44 38 L38 50 L22 50Z" fill="#7a5a36" />
      <circle cx={22} cy={30} r={10} fill="#f4f1e8" />
      <circle cx={38} cy={30} r={10} fill="#f4f1e8" />
      <circle cx={30} cy={20} r={11} fill="#ffffff" />
      <circle cx={30} cy={34} r={9} fill="#ece7da" />
    </>
  );
}

function Cocoa() {
  return (
    <>
      <path d="M30 2 V8" stroke={STEM} strokeWidth={3} strokeLinecap="round" />
      <path d="M30 8 C41 11 44 26 40 42 C38 50 34 55 30 58 C26 55 22 50 20 42 C16 26 19 11 30 8Z" fill="#d9822b" />
      {[-6, 0, 6].map((dx) => (
        <path key={dx} d={`M${30 + dx * 0.7} 11 C${30 + dx * 1.3} 24 ${30 + dx * 1.3} 40 30 56`} stroke="#a85b17" strokeWidth={1.6} fill="none" />
      ))}
      <path d="M24 16 C22 22 22 30 23 36" stroke="#f3b066" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.7} />
    </>
  );
}

const ICONS = { coffee: Coffee, potato: Potato, cotton: Cotton, cocoa: Cocoa } as const;

export function CropIcon({ crop, className = 'size-14' }: { crop: string; className?: string }) {
  const Icon = ICONS[crop as keyof typeof ICONS];
  if (!Icon) return null;
  return (
    <svg viewBox="0 0 60 60" aria-hidden className={className}>
      <Icon />
    </svg>
  );
}
