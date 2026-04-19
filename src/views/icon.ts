import { PWA_METADATA } from './pwa';

export const APP_ICON_HREF = '/assets/app-icon.svg';

export const APP_ICON_LINK_TAGS = `
<link rel="icon" type="image/svg+xml" href="${APP_ICON_HREF}">
<link rel="shortcut icon" href="${APP_ICON_HREF}">
<link rel="apple-touch-icon" sizes="180x180" href="${PWA_METADATA.appleTouchIconHref}">
<link rel="manifest" href="${PWA_METADATA.manifestHref}">
<meta name="theme-color" content="${PWA_METADATA.themeColor}">
<meta name="application-name" content="${PWA_METADATA.appName}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${PWA_METADATA.shortName}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
`.trim();

export const APP_ICON_SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="96" y1="96" x2="928" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6C5CE7"/>
      <stop offset="1" stop-color="#74B9FF"/>
    </linearGradient>
    <filter id="blur24" x="280" y="204" width="464" height="590" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <rect x="24" y="24" width="976" height="976" rx="220" fill="url(#bg)"/>
  <path d="M227 642C268 766 381 850 512 850" stroke="white" stroke-opacity="0.16" stroke-width="28" stroke-linecap="round"/>
  <path d="M798 382C755 258 642 174 512 174" stroke="white" stroke-opacity="0.16" stroke-width="28" stroke-linecap="round"/>
  <path d="M754 200L826 220L790 286" fill="#12141A" fill-opacity="0.68"/>
  <path d="M270 824L198 804L234 738" fill="#12141A" fill-opacity="0.68"/>
  <rect x="176" y="176" width="672" height="672" rx="182" fill="#0F1117" fill-opacity="0.50" stroke="white" stroke-opacity="0.12" stroke-width="3"/>
  <path d="M512 228L720 306L684 602L512 770L340 602L304 306L512 228Z" fill="white" fill-opacity="0.08" filter="url(#blur24)"/>
  <path d="M512 228L720 306L684 602L512 770L340 602L304 306L512 228Z" stroke="#F5F7FF" stroke-width="28" stroke-linejoin="round"/>
  <path d="M424 520L496 590L632 436" stroke="#00DCAA" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="729" cy="295" r="101" fill="#FDCB6E" stroke="white" stroke-opacity="0.84" stroke-width="12"/>
  <circle cx="729" cy="295" r="65" fill="#0F1117" fill-opacity="0.88"/>
  <path d="M729 295V258" stroke="#FDCB6E" stroke-width="14" stroke-linecap="round"/>
  <path d="M729 295L760 318" stroke="#FDCB6E" stroke-width="14" stroke-linecap="round"/>
  <circle cx="729" cy="295" r="13" fill="#FDCB6E"/>
  <path d="M64 64H960C960 212 820 320 652 320H372C204 320 64 212 64 64Z" fill="white" fill-opacity="0.05"/>
</svg>`;
