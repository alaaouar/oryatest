import Image from "next/image";

type OryaLogoProps = {
  className?: string;
};

export function OryaLogo({ className }: OryaLogoProps) {
  return (
    <Image
      src="/brand/orya-logo.jpg"
      alt="ORYA — L'école et la famille, au même endroit."
      width={1024}
      height={1024}
      className={className}
      sizes="240px"
      priority
    />
  );
}
