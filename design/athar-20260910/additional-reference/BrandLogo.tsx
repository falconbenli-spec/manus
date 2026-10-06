import { useId } from "react";

interface BrandLogoProps {
  className?: string;
  showTagline?: boolean;
  variant?: "color" | "white";
}

const VB_W = 57.8824;
const VB_H = 24;
const COMMA_W = 23.6691 - 15.5664;
const SAFE = COMMA_W * 2;

export const brandSafeSpace = (height: number) => Math.round((height * SAFE) / VB_H);

export function BrandMark({
  className = "",
  height = 24,
  safeSpace = true,
  variant = "color",
}: {
  className?: string;
  height?: number;
  safeSpace?: boolean;
  variant?: "color" | "white";
}) {
  const width = (height * VB_W) / VB_H;
  const clipId = `brand-logo-clip-${useId().replace(/[:]/g, "")}`;
  const pad = safeSpace ? brandSafeSpace(height) : 0;
  const color = variant === "white" ? "#FFFFFF" : "currentColor";

  return (
    <span className={`inline-flex self-start shrink-0 items-center justify-center ${className}`} style={{ paddingInline: pad, paddingBlock: pad }}>
      <svg width={width} height={height} viewBox="0 0 58 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="3,6T" className="shrink-0" style={{ color }}>
        <g clipPath={`url(#${clipId})`} fill="currentColor">
          <path d="M11.0835 8.24795L15.8338 3.19227L15.9194 3.10149V0H0.731621V4.08237H9.32292L4.87993 8.82034L4.79429 8.91112V11.8966H7.50694C11.5973 11.8966 12.4537 13.8256 12.4537 15.4444C12.4537 17.9407 10.8669 19.431 8.20714 19.431C6.84955 19.431 5.832 19.0502 5.18217 18.2988C4.48197 17.4894 4.2301 16.2337 4.45427 14.6703L4.50464 14.3097H0.205212L0.177506 14.5921C-0.0919957 17.2196 0.545237 19.4713 2.01616 21.1028C3.47449 22.7191 5.61539 23.5739 8.20714 23.5739C13.2118 23.5739 16.7078 20.2555 16.7078 15.5024C16.7078 11.9748 14.5669 9.23892 11.0835 8.24543" />
          <path d="M23.0973 18.1021H18.7702H18.5788L18.4906 18.2736L15.8006 23.5411L15.5664 24H16.0802H19.7651H19.9364L20.0296 23.8537L23.3618 18.5837L23.6691 18.1021H23.0973Z" />
          <path d="M32.9126 6.46775H32.8547L37.144 0.499265L37.5017 0H32.3383L32.2451 0.133642L26.8375 7.85963C24.8502 10.7241 24.1777 12.527 24.1777 15.0057C24.1777 19.8117 28.0011 23.5739 32.8824 23.5739C37.7636 23.5739 41.5291 19.8092 41.5291 15.0057C41.5291 12.6304 40.6551 10.4593 39.0708 8.89094C37.4891 7.32759 35.3029 6.46522 32.9126 6.46522M37.275 15.0032C37.275 17.6104 35.4691 19.431 32.8824 19.431C30.2957 19.431 28.4318 17.6508 28.4318 15.0032C28.4318 12.3555 30.2629 10.6056 32.8824 10.6056C35.5018 10.6056 37.275 12.4135 37.275 15.0032Z" />
          <path d="M57.6844 0H40.5824H40.2676V0.315192V3.7697V4.08237H40.5824H47.0227V22.9107V23.2234H47.3351H50.962H51.2743V22.9107V4.08237H57.6844H57.9993V3.7697V0.315192V0H57.6844Z" />
        </g>
        <defs><clipPath id={clipId}><rect width="57.8824" height="24" fill="white" transform="translate(0.117188)" /></clipPath></defs>
      </svg>
    </span>
  );
}

const BrandLogo = ({ className = "", showTagline = true, variant = "color" }: BrandLogoProps) => {
  const height = 28;
  return (
    <span className={`inline-flex flex-col items-start leading-none ${className}`} dir="ltr">
      <BrandMark height={height} variant={variant} safeSpace={false} />
      {showTagline && (
        <span className="mt-1 text-[0.18em] font-semibold leading-tight tracking-[0.02em]" style={{ color: variant === "white" ? "#FFFFFF" : "hsl(var(--foreground))" }}>
          <span className="block" dir="rtl">منصة رأس المال البشري</span>
          <span className="block">Human Capital Platform</span>
        </span>
      )}
    </span>
  );
};

export default BrandLogo;
