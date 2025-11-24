import React from 'react';
import { SOCIALS, CONTACT_INFO } from '../constants';
import { Mail, Phone, MapPin } from 'lucide-react';

const Contact: React.FC = () => {
  return (
    <footer id="contact" className="bg-sage-900 text-stone-200 pt-24 pb-12 px-6 border-t border-sage-800">
      <div className="container mx-auto max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 mb-20">
          
          {/* Info Column */}
          <div>
            <h2 className="font-display text-4xl font-bold text-white mb-8">Let's Connect</h2>
            <p className="text-sage-200 mb-10 max-w-md leading-relaxed text-lg font-light">
              I'm always open to discussing game development, web technologies, or photography. 
              While I'm not actively job hunting, I love connecting with like-minded creatives.
            </p>
            
            <div className="space-y-6">
              <div className="flex items-center gap-5 text-stone-300 group">
                <div className="p-3 bg-sage-800 rounded-xl group-hover:bg-sage-700 transition-colors">
                    <MapPin size={22} className="text-sage-400 group-hover:text-sage-200" />
                </div>
                <span className="text-lg">{CONTACT_INFO.location}</span>
              </div>
              <div className="flex items-center gap-5 text-stone-300 group">
                <div className="p-3 bg-sage-800 rounded-xl group-hover:bg-sage-700 transition-colors">
                    <Mail size={22} className="text-sage-400 group-hover:text-sage-200" />
                </div>
                <a href={`mailto:${CONTACT_INFO.email}`} className="text-lg hover:text-white transition-colors">
                    {CONTACT_INFO.email}
                </a>
              </div>
              <div className="flex items-center gap-5 text-stone-300 group">
                <div className="p-3 bg-sage-800 rounded-xl group-hover:bg-sage-700 transition-colors">
                    <Phone size={22} className="text-sage-400 group-hover:text-sage-200" />
                </div>
                <span className="text-lg">{CONTACT_INFO.phone}</span>
              </div>
            </div>
          </div>

          {/* Socials Column */}
          <div className="flex flex-col justify-center">
             <h3 className="text-white font-medium mb-6 md:hidden">Social Profiles</h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SOCIALS.map((social) => (
                    <a 
                        key={social.name}
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-4 p-5 bg-sage-800/30 hover:bg-sage-800 rounded-2xl transition-all duration-300 border border-sage-800 hover:border-sage-600 group hover:-translate-y-1"
                    >
                        <div className="p-2 bg-sage-900 rounded-lg group-hover:bg-sage-700 transition-colors">
                            <social.icon size={20} className="text-sage-400 group-hover:text-white transition-colors" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-white">{social.name}</span>
                            <span className="text-xs text-sage-400 group-hover:text-sage-200 transition-colors">{social.label}</span>
                        </div>
                    </a>
                ))}
             </div>
          </div>
        </div>

        <div className="border-t border-sage-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-sage-500">
            <p>&copy; {new Date().getFullYear()} Ahmad Bilto. All rights reserved.</p>
            <p>Designed & Developed with React + Tailwind</p>
        </div>
      </div>
    </footer>
  );
};

export default Contact;