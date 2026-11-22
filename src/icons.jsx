function Svg({ className = '', children }) {
  return (
    <svg
      aria-hidden="true"
      className={className ? 'icon ' + className : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const IconShield = ({ className }) => (
  <Svg className={className}>
    <path d="M12 2.5 4.5 5.5v6c0 4.9 3.2 9.1 7.5 10.5 4.3-1.4 7.5-5.6 7.5-10.5v-6L12 2.5z" />
    <path d="M12 8.5v6" />
    <path d="M9 11.5h6" />
  </Svg>
);

export const IconUpload = ({ className }) => (
  <Svg className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Svg>
);

export const IconTrash = ({ className }) => (
  <Svg className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Svg>
);

export const IconRestore = ({ className }) => (
  <Svg className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <polyline points="3 3 3 8 8 8" />
  </Svg>
);

export const IconRotateCw = ({ className }) => (
  <Svg className={className}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <polyline points="21 3 21 8 16 8" />
  </Svg>
);

export const IconZoomIn = ({ className }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16" y2="16" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </Svg>
);

export const IconZoomOut = ({ className }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16" y2="16" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </Svg>
);

export const IconChevronLeft = ({ className }) => (
  <Svg className={className}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>
);

export const IconChevronRight = ({ className }) => (
  <Svg className={className}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IconArrowDown = ({ className }) => (
  <Svg className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </Svg>
);

export const IconCheckCircle = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <polyline points="8.5 12.5 11 15 16 9.5" />
  </Svg>
);

export const IconClock = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <polyline points="12 7 12 12 15.5 14" />
  </Svg>
);

export const IconAlertTriangle = ({ className }) => (
  <Svg className={className}>
    <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13.5" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

export const IconXCircle = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </Svg>
);

export const IconScale = ({ className }) => (
  <Svg className={className}>
    <line x1="12" y1="3" x2="12" y2="20" />
    <line x1="5" y1="7" x2="19" y2="7" />
    <path d="m5 7-2.5 6a2.8 2.8 0 0 0 5 0L5 7Z" />
    <path d="m19 7-2.5 6a2.8 2.8 0 0 0 5 0L19 7Z" />
    <line x1="8" y1="20" x2="16" y2="20" />
  </Svg>
);

export const IconSearch = ({ className }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16" y2="16" />
  </Svg>
);

export const IconSun = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
  </Svg>
);

export const IconMoon = ({ className }) => (
  <Svg className={className}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
);

export const IconPanelLeft = ({ className }) => (
  <Svg className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </Svg>
);

export const IconSparkles = ({ className }) => (
  <Svg className={className}>
    <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z" />
    <path d="M19 15v4M17 17h4" />
  </Svg>
);

export const IconDownload = ({ className }) => (
  <Svg className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);

export const IconPrinter = ({ className }) => (
  <Svg className={className}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </Svg>
);

export const IconFileText = ({ className }) => (
  <Svg className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </Svg>
);

export const IconLayers = ({ className }) => (
  <Svg className={className}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 12 12 17 22 12" />
    <polyline points="2 17 12 22 22 17" />
  </Svg>
);

export const IconFolder = ({ className }) => (
  <Svg className={className}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z" />
  </Svg>
);

export const IconX = ({ className }) => (
  <Svg className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const IconCheck = ({ className }) => (
  <Svg className={className}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconInfo = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="16" x2="12" y2="11" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </Svg>
);
