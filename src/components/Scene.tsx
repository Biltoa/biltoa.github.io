import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Environment, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import Car from './Car';
import Smoke from './Smoke';
import EnvironmentScene from './EnvironmentScene';
import SpeedLines from './SpeedLines';

export default function Scene({ isMobile }: { isMobile: boolean }) {
  const scroll = useScroll();
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const cameraGroupRef = useRef<THREE.Group>(null);
  const carGroupRef = useRef<THREE.Group>(null);
  
  // Physics State
  const carX = useRef(0);
  const velocityX = useRef(0);
  const carYaw = useRef(0);
  const carRoll = useRef(0);
  
  // Shared Refs for Children
  const steeringRef = useRef(0);
  const driftIntensityRef = useRef(0);
  const velocityXRef = useRef(0);

  useFrame((state, delta) => {
    // 5. Animation Optimization: Cap delta and reduce math operations
    const dt = Math.min(delta, 0.1);
    const offset = scroll.offset;

    // 1. Track Path (Slalom based on scroll position)
    // Reduced frequency to slow down the drift relative to scroll speed
    const slalomFrequency = Math.PI * 6; // Number of turns
    const slalomAmplitude = 5.0; // Width of the road
    const targetX = Math.sin(offset * slalomFrequency) * slalomAmplitude;

    // 2. Spring-Mass-Damper Physics (Inertia & Grip)
    const spring = 120.0; 
    const damping = 14.0; 
    
    const forceX = (targetX - carX.current) * spring;
    const accelerationX = forceX - (velocityX.current * damping);
    
    velocityX.current += accelerationX * dt;
    // CLAMP VELOCITY: Prevents the car from flying off-screen on fast scrolls
    velocityX.current = Math.max(-50, Math.min(50, velocityX.current));
    
    carX.current += velocityX.current * dt;
    velocityXRef.current = velocityX.current;

    // 3. Drift Kinematics (Slip Angle & Oversteer)
    const forwardSpeed = 40.0; 
    const velocityYaw = Math.atan2(velocityX.current, forwardSpeed);
    
    // CLAMP ACCELERATION FOR VISUALS: Prevents helicopter spinning glitch
    const visualAccelX = Math.max(-200, Math.min(200, accelerationX));
    const oversteerYaw = -visualAccelX * 0.003; 
    
    let targetYaw = velocityYaw + oversteerYaw;
    // CLAMP YAW: Max rotation of ~35 degrees
    targetYaw = Math.max(-0.6, Math.min(0.6, targetYaw));
    
    carYaw.current = THREE.MathUtils.lerp(carYaw.current, targetYaw, dt * 8.0);
    
    const targetRoll = visualAccelX * 0.001;
    carRoll.current = THREE.MathUtils.lerp(carRoll.current, targetRoll, dt * 10.0);

    // 4. Counter-Steering
    const targetSteer = velocityYaw - carYaw.current;
    steeringRef.current = THREE.MathUtils.lerp(steeringRef.current, targetSteer, dt * 15.0);

    // 5. Drift Intensity (for Smoke and Camera)
    const slipAngle = Math.abs(carYaw.current - velocityYaw);
    const targetDriftIntensity = Math.max(0, Math.min((slipAngle - 0.02) * 8.0, 1.0));
    driftIntensityRef.current = THREE.MathUtils.lerp(driftIntensityRef.current, targetDriftIntensity, dt * 8.0);

    // Apply Physics to Car
    if (carGroupRef.current) {
      carGroupRef.current.position.x = carX.current;
      carGroupRef.current.position.z = 2; // Fixed Z on the treadmill
      carGroupRef.current.rotation.y = carYaw.current;
      carGroupRef.current.rotation.z = carRoll.current;
    }

    // 6. Dynamic Racing Camera (Simplified for mobile)
    if (cameraGroupRef.current && cameraRef.current) {
      const targetCamX = carX.current * 0.6;
      const targetCamZ = 10 + driftIntensityRef.current * 2.0;
      const targetCamY = 2.5 - driftIntensityRef.current * 0.5;
      
      cameraGroupRef.current.position.x = THREE.MathUtils.lerp(cameraGroupRef.current.position.x, targetCamX, dt * 5.0);
      cameraGroupRef.current.position.z = THREE.MathUtils.lerp(cameraGroupRef.current.position.z, targetCamZ, dt * 3.0);
      cameraGroupRef.current.position.y = THREE.MathUtils.lerp(cameraGroupRef.current.position.y, targetCamY, dt * 3.0);
      
      const targetCamYaw = carX.current * -0.02;
      cameraGroupRef.current.rotation.y = THREE.MathUtils.lerp(cameraGroupRef.current.rotation.y, targetCamYaw, dt * 5.0);

      // Reduce camera shake on mobile to save calculations
      if (!isMobile) {
        const shakeX = (Math.random() - 0.5) * driftIntensityRef.current * 0.05;
        const shakeY = (Math.random() - 0.5) * driftIntensityRef.current * 0.05;
        cameraGroupRef.current.position.x += shakeX;
        cameraGroupRef.current.position.y += shakeY;
      }

      const targetFov = 50 + driftIntensityRef.current * 15;
      cameraRef.current.fov = THREE.MathUtils.lerp(cameraRef.current.fov, targetFov, dt * 5.0);
      cameraRef.current.updateProjectionMatrix();
    }
  });

  return (
    <>
      {/* 3. Lighting Optimization */}
      <ambientLight intensity={isMobile ? 0.8 : 0.6} color="#ffedd5" />
      <directionalLight 
        position={[100, 50, -50]} 
        intensity={isMobile ? 2 : 3} 
        color="#ffffff" 
        castShadow={!isMobile} // Disable shadows on mobile
        shadow-mapSize={isMobile ? [512, 512] : [1024, 1024]} // Reduce shadow map size
      />
      {!isMobile && <directionalLight position={[-50, 20, 50]} intensity={1} color="#fed7aa" />}
      
      <group ref={cameraGroupRef}>
        <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 0, 0]} fov={50} />
      </group>

      <group ref={carGroupRef}>
        <Car steeringRef={steeringRef} isMobile={isMobile} />
        <Smoke driftIntensityRef={driftIntensityRef} velocityXRef={velocityXRef} isMobile={isMobile} />
      </group>

      <SpeedLines isMobile={isMobile} />
      <EnvironmentScene isMobile={isMobile} />
      
      {/* 4. Texture Optimization: Reduce environment map resolution */}
      <Environment preset="sunset" resolution={isMobile ? 128 : 256} />

      {/* 2. Reduce GPU Load: Remove Bloom on mobile */}
      {!isMobile && (
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom luminanceThreshold={1.2} luminanceSmoothing={0.9} height={300} intensity={0.5} />
        </EffectComposer>
      )}
    </>
  );
}
