import { useEffect, useState, type RefObject } from 'react';

import { MaximizeIcon, MinimizeIcon } from './icons';

export function FullscreenButton({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const update = () => {
      const target = targetRef.current;
      setSupported(
        Boolean(document.fullscreenEnabled && target?.requestFullscreen && document.exitFullscreen),
      );
      setActive(document.fullscreenElement === target);
    };
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [targetRef]);

  if (!supported) return null;

  const label = active ? 'Sair da tela cheia' : 'Tela cheia';
  return (
    <button
      className="fullscreen-button"
      type="button"
      aria-label={label}
      data-tooltip={label}
      onClick={() => {
        const target = targetRef.current;
        if (!target) return;
        void (document.fullscreenElement === target
          ? document.exitFullscreen()
          : target.requestFullscreen());
      }}
    >
      {active ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
    </button>
  );
}
