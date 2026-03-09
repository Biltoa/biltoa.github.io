import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';

const SEGMENT_LENGTH = 40;
const NUM_SEGMENTS = 30;

export default function EnvironmentScene({ isMobile, isLowEnd }: { isMobile?: boolean, isLowEnd?: boolean }) {
  const segmentsRef = useRef<THREE.Group[]>([]);

  // 6. Conditional Mobile Mode: Fewer segments
  const NUM_SEGMENTS = isLowEnd ? 15 : 30;

  // Pre-generate random rock data so it doesn't change on re-renders
  const rockData = useMemo(() => {
    return Array.from({ length: NUM_SEGMENTS }).map(() => ({
      leftRock: Math.random() > 0.3 ? {
        x: -12 - Math.random() * 20,
        y: Math.random() * 1,
        z: Math.random() * SEGMENT_LENGTH - (SEGMENT_LENGTH / 2),
        rot: [Math.random(), Math.random(), Math.random()] as [number, number, number],
        scale: Math.random() * 2 + 1
      } : null,
      rightRock: Math.random() > 0.3 ? {
        x: 12 + Math.random() * 20,
        y: Math.random() * 1,
        z: Math.random() * SEGMENT_LENGTH - (SEGMENT_LENGTH / 2),
        rot: [Math.random(), Math.random(), Math.random()] as [number, number, number],
        scale: Math.random() * 2 + 1
      } : null,
    }));
  }, [NUM_SEGMENTS]);

  useFrame((state, delta) => {
    const speed = 120;
    const moveDistance = speed * delta;

    segmentsRef.current.forEach((segment) => {
      if (segment) {
        segment.position.z += moveDistance;
        // If the segment passes behind the camera, wrap it around to the far distance
        if (segment.position.z > 50) {
          segment.position.z -= NUM_SEGMENTS * SEGMENT_LENGTH;
        }
      }
    });
  });

  return (
    <group>
      <Sky sunPosition={[100, 20, -100]} turbidity={0.3} rayleigh={1.5} mieCoefficient={0.005} mieDirectionalG={0.7} />

      {/* 2. Replace complex materials: Use BasicMaterial for road and terrain on low-end */}
      {/* Dry Asphalt Road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow={!isLowEnd}>
        <planeGeometry args={[16, 2000]} />
        {isLowEnd ? (
          <meshBasicMaterial color="#2a2a2a" />
        ) : (
          <meshStandardMaterial color="#2a2a2a" roughness={0.9} metalness={0.1} />
        )}
      </mesh>

      {/* Desert Terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow={!isLowEnd}>
        <planeGeometry args={[2000, 2000]} />
        {isLowEnd ? (
          <meshBasicMaterial color="#d2b48c" />
        ) : (
          <meshStandardMaterial color="#d2b48c" roughness={1} metalness={0} />
        )}
      </mesh>

      {/* Infinite Track Elements */}
      <group>
        {rockData.map((data, i) => (
          <group 
            key={`segment-${i}`} 
            position={[0, 0, -i * SEGMENT_LENGTH + 50]}
            ref={(el) => {
              if (el) segmentsRef.current[i] = el;
            }}
          >
            {/* Center Dashed Line */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
              <planeGeometry args={[0.3, 10]} />
              {isLowEnd ? <meshBasicMaterial color="#eebb00" /> : <meshStandardMaterial color="#eebb00" roughness={0.9} />}
            </mesh>

            {/* Left Border Line */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-7.5, 0.01, 0]}>
              <planeGeometry args={[0.2, SEGMENT_LENGTH]} />
              {isLowEnd ? <meshBasicMaterial color="#ffffff" /> : <meshStandardMaterial color="#ffffff" roughness={0.9} />}
            </mesh>

            {/* Right Border Line */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[7.5, 0.01, 0]}>
              <planeGeometry args={[0.2, SEGMENT_LENGTH]} />
              {isLowEnd ? <meshBasicMaterial color="#ffffff" /> : <meshStandardMaterial color="#ffffff" roughness={0.9} />}
            </mesh>

            {/* Random Desert Rocks */}
            {data.leftRock && (
              <mesh position={[data.leftRock.x, data.leftRock.y, data.leftRock.z]} castShadow={!isLowEnd} receiveShadow={!isLowEnd} rotation={data.leftRock.rot}>
                {/* 2. Reduce geometry polygon count */}
                <dodecahedronGeometry args={[data.leftRock.scale, isLowEnd ? 0 : 1]} />
                {isLowEnd ? <meshLambertMaterial color="#a08060" /> : <meshStandardMaterial color="#a08060" roughness={0.9} />}
              </mesh>
            )}
            {data.rightRock && (
              <mesh position={[data.rightRock.x, data.rightRock.y, data.rightRock.z]} castShadow={!isLowEnd} receiveShadow={!isLowEnd} rotation={data.rightRock.rot}>
                <dodecahedronGeometry args={[data.rightRock.scale, isLowEnd ? 0 : 1]} />
                {isLowEnd ? <meshLambertMaterial color="#a08060" /> : <meshStandardMaterial color="#a08060" roughness={0.9} />}
              </mesh>
            )}
          </group>
        ))}
      </group>
    </group>
  );
}
