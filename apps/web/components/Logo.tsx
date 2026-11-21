import Image from "next/image";
import Link from "next/link";

export interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  tagline?: string;
  href?: string | null;
  className?: string;
  dotColor?: string;
}

export function Logo({
  size = 36,
  showWordmark = true,
  tagline,
  href = "/dashboard",
  className = "",
  dotColor = "var(--teal, #12A7A0)",
}: LogoProps) {
  const content = (
    <div
      className={`orya-logo-lockup ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(8, Math.round(size * 0.28)),
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <Image
        src="/logo.svg"
        alt="ORYA"
        width={size}
        height={size}
        priority
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
      {showWordmark && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span
            className="wordmark"
            style={{
              fontSize: Math.max(18, Math.round(size * 0.62)),
              letterSpacing: "-0.03em",
              lineHeight: 1,
              display: "inline-block",
            }}
          >
            ORYA
            <span className="dot" style={{ color: dotColor }}>
              .
            </span>
          </span>
          {tagline && (
            <span
              className="topbar__tagline"
              style={{
                marginTop: 3,
                fontSize: Math.max(10, Math.round(size * 0.3)),
                letterSpacing: "0.02em",
                color: "var(--muted, #6a6f73)",
              }}
            >
              {tagline}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "inline-flex" }}>
        {content}
      </Link>
    );
  }

  return content;
}
