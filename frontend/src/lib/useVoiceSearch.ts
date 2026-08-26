import { useCallback, useRef, useState } from 'react';

/**
 * Voice search is just speech-to-text feeding the same query box a typed
 * query would — no backend involvement, no new agent, nothing "understands"
 * audio. The browser's own Web Speech API does the transcription; this hook
 * only wires its events to plain strings. Unsupported browsers (Firefox,
 * most of Safari) get no mic button at all rather than a broken one.
 */
export function useVoiceSearch(onInterim: (text: string) => void, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef('');

  const Ctor: any = typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;
  const supported = !!Ctor;

  const start = useCallback(() => {
    if (!supported || listening) return;
    const recognition = new Ctor();
    // India-focused app (city names like Bengaluru/Hyderabad) — en-IN
    // transcribes those noticeably better than the en-US default.
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    finalRef.current = '';

    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current = `${finalRef.current} ${transcript}`.trim();
        else interim += transcript;
      }
      onInterim(`${finalRef.current} ${interim}`.trim());
    };
    // A mid-speech error (no mic permission, network hiccup) shouldn't leave
    // the button stuck in a "listening" state forever.
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      const text = finalRef.current.trim();
      if (text) onFinal(text);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [Ctor, supported, listening, onInterim, onFinal]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
