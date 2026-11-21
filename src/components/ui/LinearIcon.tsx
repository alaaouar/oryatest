import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "clipboard"
  | "users"
  | "graduation"
  | "message"
  | "calendar"
  | "settings"
  | "menu";

const icons: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10.5V20h4v-6h4v6h4v-9.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="5" width="12" height="15" rx="2" />
      <path d="M9 5.5V4h6v1.5" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
      <circle cx="17" cy="8.5" r="2.5" />
      <path d="M21 19v-1a3.5 3.5 0 0 0-2.5-3.3" />
    </>
  ),
  graduation: (
    <>
      <path d="M3 10 12 5l9 5-9 5-9-5z" />
      <path d="M7 12.5V17c1.5 1.2 3.2 1.8 5 1.8s3.5-.6 5-1.8v-4.5" />
    </>
  ),
  message: (
    <>
      <path d="M5 6h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4M16 4v4M4 10h16" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6" />
    </>
  ),
  menu: (
    <>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </>
  ),
};

export function LinearIcon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
