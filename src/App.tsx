import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { ScrollControls, Scroll } from '@react-three/drei';
import Scene from './components/Scene';
import Overlay from './components/Overlay';
import CustomLoader from './components/CustomLoader';

export default function App() {
  return (
    <div className="w-full h-screen bg-[#ffecd2] overflow-hidden relative">
      <CustomLoader />
      <Canvas shadows className="absolute inset-0 z-0">
        <color attach="background" args={['#ffecd2']} />
        <fog attach="fog" args={['#ffecd2', 20, 100]} />
        
        <Suspense fallback={null}>
          <ScrollControls pages={5} damping={0.2}>
            <Scene />
            <Scroll html style={{ width: '100%' }}>
              <Overlay />
            </Scroll>
          </ScrollControls>
        </Suspense>
      </Canvas>
    </div>
  );
}
