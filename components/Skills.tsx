import React from 'react';
import { SKILLS } from '../constants';

const Skills: React.FC = () => {
  return (
    <section id="skills" className="py-24 px-6 bg-gradient-warm">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="font-display text-4xl font-bold text-stone-900 mb-4">Technical Arsenal</h2>
          <p className="text-stone-500 max-w-2xl mx-auto">
            Tools and technologies I use to bring ideas to life.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {SKILLS.map((skill, index) => (
            <div 
              key={index}
              className="bg-white p-6 rounded-2xl shadow-sm border border-sage-200 hover:border-sage-400 hover:shadow-lg hover:shadow-sage-200/50 transition-all duration-300 flex flex-col items-center justify-center text-center group transform hover:-translate-y-1"
            >
              <div className="p-4 bg-sage-50 rounded-full mb-4 text-stone-600 group-hover:text-sage-600 group-hover:bg-sage-100 transition-colors">
                <skill.icon size={32} strokeWidth={1.5} />
              </div>
              <h3 className="font-medium text-stone-800">{skill.name}</h3>
              <span className="text-xs text-sage-400 mt-1 uppercase tracking-wider font-semibold">{skill.category}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Skills;