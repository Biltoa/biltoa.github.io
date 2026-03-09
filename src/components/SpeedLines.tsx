import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function SpeedLines({ isMobile }: { isMobile?: boolean }) {
  // 7. Particle Optimization: Reduce count
  const count = isMobile ? 50 : 150;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const lines = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      // Random position in a ring around the camera/car
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 15;
      return {
        position: new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.max(0.2, Math.sin(angle) * radius + 3), // Keep above ground
          -50 - Math.random() * 100
        ),
        speed: 150 + Math.random() * 100, // Very fast
        scale: Math.random() * 2 + 1
      };
    });
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.1);

    lines.forEach((line, i) => {
      line.position.z += line.speed * dt;
      
      // Reset line when it passes the camera
      if (line.position.z > 20) {
        line.position.z = -100 - Math.random() * 50;
      }
      
      dummy.position.copy(line.position);
      // Stretch the box to look like a long line
      dummy.scale.set(0.02, 0.02, line.scale * 8);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    // 8. Memory and Draw Calls: Use InstancedMesh
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={isMobile ? 0.15 : 0.3} />
    </instancedMesh>
  );
}
