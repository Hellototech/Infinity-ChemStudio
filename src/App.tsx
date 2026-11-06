import { useEffect, useRef } from 'react';
import { InfinityChemStudioCoordinator } from './main';

/**
 * Root React host mounting the Phase 5 Precision Lab Dark CAD StudioShell
 * and Pixi.js v8 WebGL Chemistry Sandbox.
 */
export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const coordinator = new InfinityChemStudioCoordinator();
    coordinator.mount(el);

    return () => {
      coordinator.destroy();
    };
  }, []);

  return <div ref={hostRef} className="w-screen h-screen overflow-hidden bg-[#090A0C]" />;
}
