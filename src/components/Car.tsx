import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export default function Car({ steeringRef }: { steeringRef?: React.MutableRefObject<number> }) {
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.envMapIntensity = 2;
          mesh.material.needsUpdate = true;
        }
      }
    });
    return w;
  }, [scene]);

  useFrame((state, delta) => {
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
