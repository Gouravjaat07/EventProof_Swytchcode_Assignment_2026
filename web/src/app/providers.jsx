import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);
const DemoContext = createContext(null);

let toastSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, kind = 'info') => {
    const id = `toast-${Date.now()}-${toastSeq += 1}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'error' ? 8000 : 4500);
    return id;
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts requires ToastProvider');
  return ctx;
}

const DEMO_KEY = 'ep-demo';

function readDemoFlag() {
  try {
    return window.localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function DemoProvider({ children }) {
  const [demo, setDemoState] = useState(readDemoFlag);

  const setDemo = useCallback((on) => {
    setDemoState(on);
    try {
      if (on) window.localStorage.setItem(DEMO_KEY, '1');
      else window.localStorage.removeItem(DEMO_KEY);
    } catch {
      // ignore persistence failure
    }
  }, []);

  const value = useMemo(() => ({ demo, setDemo }), [demo, setDemo]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo requires DemoProvider');
  return ctx;
}
