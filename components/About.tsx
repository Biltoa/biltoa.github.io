import React from 'react';

const About: React.FC = () => {
  return (
    <section id="about" className="py-24 px-6 bg-sage-50">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-12 text-center md:text-left">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-stone-900 mb-6">
            The Intersection of Code & Creativity
          </h2>
          <div className="w-24 h-1.5 bg-gradient-to-r from-sage-500 to-sage-300 mx-auto md:mx-0 mb-8 rounded-full"></div>
        </div>

        <div className="prose prose-lg text-stone-600 leading-relaxed md:text-justify bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-sage-100">
          <p className="mb-6">
            Hi, I'm Ahmad. I am a passionate Game Developer with a solid background in Web Development. 
            My journey bridges the gap between interactive 3D experiences and modern web technologies. 
            I build immersive worlds using Unity and Unreal Engine, while maintaining a sharp technical arsenal for full-stack web applications.
          </p>
          <p className="mb-6">
            When I'm not coding mechanics or optimizing shaders, I'm behind the lens. Photography allows me to explore composition, 
            lighting, and storytelling from a different perspective, which inevitably feeds back into my visual design work in games.
          </p>
          <p>
            I am currently displaying my portfolio of works. Feel free to explore my game jams, 
            check out my photography, or download my resume to learn more about my professional journey.
          </p>
        </div>
      </div>
    </section>
  );
};

export default About;