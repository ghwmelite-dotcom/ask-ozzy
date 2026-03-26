import { useEffect, useRef, useState } from 'react';
import type { MouthShape } from '@/types/teacher';

export function useLipSync(audioRef: React.RefObject<HTMLAudioElement | null>): MouthShape {
  const [mouth, setMouth] = useState<MouthShape>('closed');
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      sourceRef.current = source;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (avg < 10) setMouth('closed');
        else if (avg < 40) setMouth('slight');
        else if (avg < 80) setMouth('open');
        else if (avg < 120) setMouth('wide');
        else setMouth('o');

        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => setMouth('closed');
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audioRef]);

  return mouth;
}
