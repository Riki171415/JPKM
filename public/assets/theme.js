try {
  const saved = localStorage.getItem('sijantan-color-scheme');
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta && (saved === 'light' || saved === 'dark')) meta.content = saved;
} catch {}
