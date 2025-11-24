import React from 'react';
import { HERO_IMAGE } from '../constants';
import { ArrowDown, FileText, Camera } from 'lucide-react';

const Hero: React.FC = () => {
  return (
    <section id="home" className="relative h-screen w-full flex flex-col justify-end overflow-hidden">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={HERO_IMAGE} 
          alt="Ahmad Bilto" 
          className="w-full h-full object-cover object-top"
        />
        {/* Opacity layer on top as requested */}
        <div className="absolute inset-0 bg-sage-900/30"></div>
        {/* Gradient from bottom to top to make text readable without covering face */}
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/60 to-transparent"></div>
      </div>

      {/* Content positioned at bottom */}
      <div className="relative z-10 w-full pb-20 px-6 md:pb-32 container mx-auto fade-in-up">
        <div className="max-w-4xl">
            <h2 className="text-sage-300 font-medium tracking-widest text-sm uppercase mb-4 pl-1">
                Portfolio
            </h2>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-stone-100 mb-6 tracking-tight leading-none">
                Ahmad Bilto
            </h1>
            <p className="text-xl md:text-2xl text-stone-200 font-light mb-10 max-w-2xl leading-relaxed">
                Game Developer <span className="text-sage-400 px-2">•</span> 
                Web Developer <span className="text-sage-400 px-2">•</span> 
                Photographer
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
                <a 
                    href="#gallery" 
                    className="flex items-center justify-center gap-2 bg-sage-500 hover:bg-sage-400 text-white px-8 py-3 rounded-full font-medium transition-all duration-300 shadow-lg hover:shadow-sage-500/30 transform hover:-translate-y-1"
                >
                    <Camera size={20} />
                    View Gallery
                </a>
                <a 
                    href="/resume.pdf" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 text-white px-8 py-3 rounded-full font-medium transition-all duration-300"
                >
                    <FileText size={20} />
                    Download Resume
                </a>
            </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 animate-bounce z-20">
        <a href="#about" className="text-stone-400 hover:text-white transition-colors p-2">
            <ArrowDown size={32} />
        </a>
      </div>
    </section>
  );
};

export default Hero;