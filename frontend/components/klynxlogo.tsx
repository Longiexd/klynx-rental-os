export const KLYNX_ICON = "/icons/xicon.png?v=20261011023149";

type KlynxLogoProps = {
  variant?: "icon" | "wordmark" | "full" | "brand";
  size?: "sm" | "md" | "lg";
  className?: string;
};

export default function KlynxLogo({
  variant = "wordmark",
  size = "md",
  className = "",
}: KlynxLogoProps) {
  const textSize = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-2xl",
  }[size];

  const iconSize = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  }[size];

  const wordmark = (
    <span
      className={`inline-flex items-baseline font-syne font-semibold tracking-tight ${textSize}`}
    >
      <span className="text-text">KLYN</span>
      <span className="text-lime-ink">X</span>
      <span className="ml-0.5 text-[0.8em] font-semibold leading-none text-pink-ink">OS</span>
    </span>
  );

  if (variant === "icon") {
    return (
      <img
        src={KLYNX_ICON}
        alt="Klynx"
        className={`${iconSize} object-contain ${className}`}
      />
    );
  }

  if (variant === "full") {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <img
          src={KLYNX_ICON}
          alt=""
          className={`${iconSize} object-contain`}
        />
        {wordmark}
      </span>
    );
  }

  if (variant === "brand") {
    const brandSize = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-12 w-12" }[size];
    return (
      <span className={`inline-flex shrink-0 ${brandSize} ${className}`}>
        <img
          src="/icons/klynx-brand.png?v=white-20261019"
          alt="Klynx"
          width={36}
          height={36}
          className="klynx-brand-dark h-full w-full object-contain"
        />
        <img
          src="/icons/klynx-brand-black.png"
          alt="Klynx"
          width={36}
          height={36}
          className="klynx-brand-light h-full w-full object-contain"
        />
      </span>
    );
  }

  return <span className={className}>{wordmark}</span>;
}