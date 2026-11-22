import { useEffect, useState } from 'react';

let cached = null;
let pending = null;

export function loadIcdDictionary() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch('/assets/icd-dictionary.json')
    .then(res => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then(dict => {
      cached = dict && typeof dict === 'object' ? dict : {};
      return cached;
    });
  return pending;
}

export function useIcdDictionary() {
  const [dict, setDict] = useState(cached);
  useEffect(() => {
    if (cached) {
      setDict(cached);
      return;
    }
    let active = true;
    loadIcdDictionary().then(loaded => {
      if (active) setDict(loaded);
    });
    return () => { active = false; };
  }, []);
  return dict;
}
