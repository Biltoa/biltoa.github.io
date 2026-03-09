import { Canvas } from '@react-three/fiber';
import { Suspense, useState, useEffect } from 'react';
import { ScrollControls, Scroll } from '@react-three/drei';
import Scene from './components/Scene';
import Overlay from './components/Overlay';
import CustomLoader from './components/CustomLoader';

export default function App() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // 6. Conditional Mobile Mode: Automatic performance detection
      const mobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="w-full h-screen bg-[#ffecd2] overflow-hidden relative">
      <CustomLoader />
      {/* 1. Rendering Optimizations */}
      <Canvas 
        shadows={!isMobile} // Disable shadows on mobile
        className="absolute inset-0 z-0"
        dpr={isMobile ? [1, 1] : [1, 1.5]} // Limit pixel ratio to 1 on mobile
        gl={{ powerPreference: "high-performance", antialias: !isMobile }} // Disable antialias on mobile
      >
        <color attach="background" args={['#ffecd2']} />
        <fog attach="fog" args={['#ffecd2', isMobile ? 15 : 20, isMobile ? 60 : 100]} />
        
        <Suspense fallback={null}>
          <ScrollControls pages={5} damping={0.2}>
            <Scene isMobile={isMobile} />
            <Scroll html style={{ width: '100%' }}>
              <Overlay />
            </Scroll>
          </ScrollControls>
        </Suspense>
      </Canvas>
    </div>
  );
}
