import React from 'react';
import { Gamepad2, FileText, ExternalLink } from 'lucide-react';

const Games: React.FC = () => {
  return (
    <section id="games" className="py-24 px-6 bg-stone-900 text-stone-100 relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-sage-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-sage-700/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

      <div className="container mx-auto max-w-4xl relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sage-900/50 border border-sage-700 text-sage-300 text-xs font-medium uppercase tracking-wider mb-6">
            <Gamepad2 size={14} />
            Game Development
        </div>
        
        <h2 className="font-display text-4xl md:text-5xl font-bold mb-6 text-white">
            Interactive Experiences
        </h2>
        
        <p className="text-stone-300 text-lg leading-relaxed mb-12 max-w-2xl mx-auto">
            My passion lies in creating interactive systems and engaging gameplay loops. 
            I actively participate in Game Jams to challenge myself and prototype new mechanics quickly. 
            Instead of showcasing static projects, I invite you to play my demos directly.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {/* Itch.io Card */}
            <a 
              href="https://itch.io" // Replace with actual Itch.io URL
              target="_blank"
              rel="noopener noreferrer"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-sage-900 to-stone-800 border border-sage-800/50 p-8 flex flex-col items-center justify-center text-center hover:border-sage-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-sage-900/50"
            >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sage-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <Gamepad2 size={48} className="text-sage-400 mb-4 group-hover:scale-110 transition-transform duration-300" />
                <h3 className="text-xl font-bold text-white mb-2">Itch.io Profile</h3>
                <p className="text-stone-400 text-sm mb-6">Play my latest game jam submissions and prototypes.</p>
                <span className="inline-flex items-center text-sage-300 text-sm font-medium group-hover:text-white transition-colors">
                    Visit Page <ExternalLink size={14} className="ml-1" />
                </span>
            </a>

            {/* Resume Card */}
            <a 
              href="/resume.pdf" 
              target="_blank"
              rel="noopener noreferrer"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-stone-800 to-stone-900 border border-stone-700 p-8 flex flex-col items-center justify-center text-center hover:border-white/30 transition-all duration-300 hover:shadow-2xl"
            >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <FileText size={48} className="text-stone-400 mb-4 group-hover:scale-110 transition-transform duration-300" />
                <h3 className="text-xl font-bold text-white mb-2">Resume / CV</h3>
                <p className="text-stone-400 text-sm mb-6">Download my full professional background and skills.</p>
                <span className="inline-flex items-center text-stone-300 text-sm font-medium group-hover:text-white transition-colors">
                    Download PDF <ExternalLink size={14} className="ml-1" />
                </span>
            </a>
        </div>
      </div>
    </section>
  );
};

export default Games;