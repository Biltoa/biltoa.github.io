import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export default function Car({ steeringRef, isMobile }: { steeringRef?: React.MutableRefObject<number>, isMobile?: boolean }) {
  const carRef = useRef<THREE.Group>(null);
  // Using custom GLTF car model
  const { scene } = useGLTF('/Car.gltf');

  const wheels = useMemo(() => {
    const w: Record<string, THREE.Object3D> = {};
    scene.traverse((child) => {
      // Find the wheel nodes in the Ferrari GLTF
      if (child.name === 'wheel_fl') w.fl = child;
      if (child.name === 'wheel_fr') w.fr = child;
      if (child.name === 'wheel_rl') w.rl = child;
      if (child.name === 'wheel_rr') w.rr = child;
      
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // 6. Conditional Mobile Mode: No shadows on mobile
        mesh.castShadow = !isMobile;
        mesh.receiveShadow = !isMobile;
        
        // 2. Reduce GPU Load: Simplify materials on mobile
        if (isMobile && mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.envMapIntensity = 0.5;
          mesh.material.needsUpdate = true;
        } else if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.envMapIntensity = 2;
          mesh.material.needsUpdate = true;
        }
      }
    });
    return w;
  }, [scene, isMobile]);

  useFrame((state, delta) => {
    // 5. Animation Optimization: Skip some updates if delta is too large (lag spike)
    if (delta > 0.1) return;

    // Spin all wheels continuously to simulate driving forward at high speed
    const spinSpeed = delta * 40; 
    if (wheels.fl) wheels.fl.rotation.x -= spinSpeed;
    if (wheels.fr) wheels.fr.rotation.x -= spinSpeed;
    if (wheels.rl) wheels.rl.rotation.x -= spinSpeed;
    if (wheels.rr) wheels.rr.rotation.x -= spinSpeed;

    // Steer the front wheels based on the drift angle
    if (steeringRef && steeringRef.current !== undefined) {
      const steerAngle = steeringRef.current;
      
      if (wheels.fl) {
        // Set rotation order to YXZ so steering (Y) applies before spinning (X)
        wheels.fl.rotation.order = 'YXZ';
        wheels.fl.rotation.y = steerAngle;
      }
      if (wheels.fr) {
        wheels.fr.rotation.order = 'YXZ';
        wheels.fr.rotation.y = steerAngle;
      }
    }
  });

  return (
    <group ref={carRef} position={[0, 0, 0]}>
      <group rotation={[0, 0, 0]} scale={[2.5, 2.5, 2.5]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

useGLTF.preload('/Car.gltf');
