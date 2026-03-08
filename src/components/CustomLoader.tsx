import { useProgress } from '@react-three/drei';
import { useEffect, useState } from 'react';

export default function CustomLoader() {
  const { progress } = useProgress();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (progress === 100) {
      const timeout = setTimeout(() => setHidden(true), 1000);
      return () => clearTimeout(timeout);
    }
  }, [progress]);

  if (hidden) return null;

  return (
    <div 
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505] transition-opacity duration-1000" 
      style={{ opacity: progress === 100 ? 0 : 1, pointerEvents: progress === 100 ? 'none' : 'auto' }}
    >
      <div className="text-4xl md:text-6xl font-black text-white mb-8 tracking-tighter font-display">
        AHMAD <span className="text-blue-500">BILTO</span>
      </div>
      <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-blue-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.8)]" 
          style={{ width: `${progress}%` }} 
        />
      </div>
      <div className="mt-4 text-gray-400 font-mono text-xs tracking-widest uppercase">Initializing WebGL Engine... {Math.round(progress)}%</div>
    </div>
  );
}
