import { Canvas } from '@react-three/fiber';
import { Suspense, useState, useEffect } from 'react';
import { ScrollControls, Scroll } from '@react-three/drei';
import Scene from './components/Scene';
import Overlay from './components/Overlay';
import CustomLoader from './components/CustomLoader';

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [isLowEnd, setIsLowEnd] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      // 6. Conditional Mobile Mode: Automatic performance detection
      const mobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);

      if (mobile) {
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const memory = (navigator as any).deviceMemory;
        const cores = navigator.hardwareConcurrency;
        
        // Treat as low-end if it's Android with <= 4GB RAM or <= 4 cores
        // iOS devices (iPhones/iPads) generally have excellent GPUs, so we treat them as high-end mobile
        if (!isIOS && ((memory && memory <= 4) || (cores && cores <= 4))) {
          setIsLowEnd(true);
        } else {
          setIsLowEnd(false); // High-end mobile
        }
      } else {
        setIsLowEnd(false); // Desktop
      }
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return (
    <div className="w-full h-screen bg-[#ffecd2] overflow-hidden relative">
      <CustomLoader />
      {/* 1. Rendering Optimizations */}
      <Canvas 
        shadows={!isLowEnd} // Disable shadows only on low-end
        className="absolute inset-0 z-0"
        dpr={isLowEnd ? [1, 1] : [1, Math.min(window.devicePixelRatio || 2, 2)]} // Crisp resolution for high-end mobile/PC (iPhones)
        gl={{ powerPreference: "high-performance", antialias: !isLowEnd }} // Antialias on for high-end
      >
        <color attach="background" args={['#ffecd2']} />
        {/* Same fog distance for all devices to show more road */}
        <fog attach="fog" args={['#ffecd2', 20, 100]} />
        
        <Suspense fallback={null}>
          <ScrollControls pages={5} damping={0.2}>
            <Scene isMobile={isMobile} isLowEnd={isLowEnd} />
            <Scroll html style={{ width: '100%' }}>
              <Overlay />
            </Scroll>
          </ScrollControls>
        </Suspense>
      </Canvas>
    </div>
  );
}
