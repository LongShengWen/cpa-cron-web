export const APP_ICON_HREF = '/assets/app-icon.svg';

export const APP_ICON_LINK_TAGS = `
<link rel="icon" type="image/svg+xml" href="${APP_ICON_HREF}">
<link rel="shortcut icon" href="${APP_ICON_HREF}">
<meta name="theme-color" content="#6c5ce7">
`.trim();

export const APP_ICON_SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="96" y1="96" x2="928" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6C5CE7"/>
      <stop offset="1" stop-color="#74B9FF"/>
    </linearGradient>
    <filter id="blur24" x="310" y="258" width="404" height="494" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <rect x="24" y="24" width="976" height="976" rx="220" fill="url(#bg)"/>
  <path d="M273 634C308 736 404 810 512 810" stroke="white" stroke-opacity="0.16" stroke-width="26" stroke-linecap="round"/>
  <path d="M752 390C715 286 619 214 512 214" stroke="white" stroke-opacity="0.16" stroke-width="26" stroke-linecap="round"/>
  <path d="M712 230L774 246L744 302" fill="white" fill-opacity="0.22"/>
  <path d="M313 794L250 776L280 720" fill="white" fill-opacity="0.22"/>
  <rect x="222" y="222" width="580" height="580" rx="160" fill="#0F1117" fill-opacity="0.52" stroke="white" stroke-opacity="0.12" stroke-width="3"/>
  <path d="M512 282L690 346L660 590L512 728L364 590L334 346L512 282Z" fill="white" fill-opacity="0.08" filter="url(#blur24)"/>
  <path d="M512 282L690 346L660 590L512 728L364 590L334 346L512 282Z" stroke="#F5F7FF" stroke-width="24" stroke-linejoin="round"/>
  <path d="M438 502L494 562L608 438" stroke="#00DCAA" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="695" cy="315" r="85" fill="#FDCB6E" stroke="white" stroke-opacity="0.82" stroke-width="10"/>
  <circle cx="695" cy="315" r="55" fill="#0F1117" fill-opacity="0.86"/>
  <path d="M695 315V285" stroke="#FDCB6E" stroke-width="12" stroke-linecap="round"/>
  <path d="M695 315L723 332" stroke="#FDCB6E" stroke-width="12" stroke-linecap="round"/>
  <circle cx="695" cy="315" r="11" fill="#FDCB6E"/>
  <path d="M64 64H960C960 230 810 348 640 348H384C214 348 64 230 64 64Z" fill="white" fill-opacity="0.05"/>
</svg>`;
