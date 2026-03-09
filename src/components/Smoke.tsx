import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SmokeProps {
  driftIntensityRef: React.MutableRefObject<number>;
  velocityXRef: React.MutableRefObject<number>;
  isMobile?: boolean;
}

export default function Smoke({ driftIntensityRef, velocityXRef, isMobile }: SmokeProps) {
  // 7. Particle Optimization: Reduce particle count for smoke
  const count = isMobile ? 30 : 100;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const particles = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const isLeft = i % 2 === 0;
      return {
        position: new THREE.Vector3(isLeft ? -0.8 : 0.8, 0.1, 2.0),
        scale: Math.random() * 0.5 + 0.3,
        velocity: new THREE.Vector3(0, 0, 0),
        life: Math.random(),
        isLeft
      };
    });
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // 5. Animation Optimization: Cap delta
    const dt = Math.min(delta, 0.1);
    const intensity = driftIntensityRef.current;
    const carVelX = velocityXRef.current;

    // Skip updates if not drifting and mobile
    if (isMobile && intensity < 0.05) {
      meshRef.current.visible = false;
      return;
    } else {
      meshRef.current.visible = true;
    }

    particles.forEach((p, i) => {
      p.life -= dt * 2.0; // Faster lifecycle
      
      if (p.life <= 0) {
        p.life = 1;
        // Reset at the rear tires
        p.position.set(
          (p.isLeft ? -0.8 : 0.8) + (Math.random() - 0.5) * 0.4, 
          0.1, 
          2.0 + Math.random() * 0.5
        );
        p.scale = Math.random() * 0.4 + 0.2;
        
        // Inherit car's lateral velocity, shoot backwards fast
        p.velocity.set(
          (carVelX * 0.02) + (p.isLeft ? -0.05 : 0.05) + (Math.random() - 0.5) * 0.1, 
          Math.random() * 0.05 + 0.02, 
          Math.random() * 0.4 + 1.5
        );
      }
      
      p.position.addScaledVector(p.velocity, dt * 60); // Apply velocity
      p.scale += dt * 3.0; // Expand over time
      
      dummy.position.copy(p.position);
      
      // Scale by intensity. If not drifting, smoke shrinks to 0 instantly
      // Add a slight curve to intensity so it pops more
      const visualScale = p.scale * Math.pow(intensity, 0.5);
      dummy.scale.setScalar(visualScale);
      
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    // 8. Memory and Draw Calls: Use InstancedMesh
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      {/* 2. Reduce GPU Load: Reduce geometry polygon count */}
      <sphereGeometry args={[0.5, isMobile ? 4 : 8, isMobile ? 4 : 8]} />
      {/* 2. Replace complex materials: Use MeshBasicMaterial on mobile */}
      {isMobile ? (
        <meshBasicMaterial color="#e0e0e0" transparent opacity={0.2} depthWrite={false} />
      ) : (
        <meshStandardMaterial color="#e0e0e0" transparent opacity={0.2} depthWrite={false} />
      )}
    </instancedMesh>
  );
}
