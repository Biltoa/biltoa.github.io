import { motion } from 'motion/react';
import { Code, Gamepad2, Monitor, Cpu, Mail, User, Briefcase, ChevronRight, Layers, Zap, Download, MapPin, Phone, Linkedin, Instagram, Facebook, Link as LinkIcon } from 'lucide-react';

export default function Overlay() {
  return (
    <div className="w-full font-body text-white selection:bg-yellow-500/30">
      {/* Fixed Logo Header */}
      <header className="fixed top-0 left-0 w-full p-6 md:p-10 z-50 pointer-events-none flex justify-between items-center">
        <div className="font-sans font-bold text-3xl tracking-tighter text-white drop-shadow-md">
          AB.
        </div>
      </header>

      {/* Hero */}
      <section className="h-screen w-full flex items-end pb-12 md:items-center md:pb-0 justify-start px-4 md:px-24 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-auto max-w-2xl bg-black/60 p-6 md:p-10 rounded-[2rem] backdrop-blur-xl border border-white/10 shadow-2xl w-full"
        >
          <h1 className="text-5xl md:text-8xl font-display font-black mb-2 md:mb-4 tracking-tighter leading-tight drop-shadow-lg">
            Ahmad <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-500">Bilto</span>
          </h1>
          <h2 className="text-lg md:text-2xl font-medium text-gray-200 mb-4 md:mb-6 flex items-center gap-2 md:gap-3 drop-shadow-md">
            <Gamepad2 className="w-5 h-5 md:w-6 md:h-6 text-yellow-400" /> Unity / Game Developer
          </h2>
          <p className="text-gray-200 text-base md:text-xl font-light leading-relaxed max-w-xl drop-shadow-md mb-6 md:mb-8">
            Building immersive worlds, multiplayer systems, and high-performance game physics for the next generation of interactive experiences.
          </p>
          
          <motion.a 
            href="/Resume.pdf"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group relative inline-flex items-center gap-2 md:gap-3 bg-white/10 border border-white/20 backdrop-blur-md text-white font-medium py-3 px-6 md:py-3 md:px-8 rounded-full overflow-hidden shadow-lg text-sm md:text-base transition-colors hover:bg-white/20"
          >
            <Download className="w-4 h-4 md:w-5 md:h-5 text-yellow-400" />
            <span>Download Resume</span>
          </motion.a>
        </motion.div>
      </section>
      
      {/* About */}
      <section className="h-screen w-full flex items-end pb-12 md:items-center md:pb-0 justify-end px-4 md:px-24 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-auto max-w-xl text-left bg-black/70 p-6 md:p-10 rounded-[2rem] backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] relative overflow-hidden group w-full"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6 relative z-10">
            <div className="p-2 md:p-3 bg-yellow-500/20 rounded-xl md:rounded-2xl border border-yellow-500/30">
              <User className="w-6 h-6 md:w-8 md:h-8 text-yellow-400" />
            </div>
            <h2 className="text-3xl md:text-5xl font-display font-bold text-white drop-shadow-md">About Me</h2>
          </div>
          <p className="text-gray-200 text-base md:text-lg leading-relaxed font-light relative z-10 drop-shadow-sm">
            I specialize in <strong className="text-white font-medium">Unity3D and C#</strong>, creating engaging multiplayer experiences and robust game physics. 
            My passion lies in bridging the gap between complex technical systems and seamless player experiences.
          </p>
        </motion.div>
      </section>

      {/* Skills */}
      <section className="h-screen w-full flex items-end pb-12 md:items-center md:pb-0 justify-start px-4 md:px-24 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-auto max-w-2xl bg-black/70 p-6 md:p-10 rounded-[2rem] backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-full"
        >
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
            <div className="p-2 md:p-3 bg-amber-500/20 rounded-xl md:rounded-2xl border border-amber-500/30">
              <Cpu className="w-6 h-6 md:w-8 md:h-8 text-amber-400" />
            </div>
            <h2 className="text-3xl md:text-5xl font-display font-bold text-white drop-shadow-md">Core Skills</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            {[
              { name: 'Unity3D', icon: <Layers className="w-4 h-4 md:w-5 md:h-5" /> },
              { name: 'C#', icon: <Code className="w-4 h-4 md:w-5 md:h-5" /> },
              { name: 'Game Design', icon: <Gamepad2 className="w-4 h-4 md:w-5 md:h-5" /> },
              { name: 'Physics', icon: <Zap className="w-4 h-4 md:w-5 md:h-5" /> },
              { name: 'Game Polish', icon: <Monitor className="w-4 h-4 md:w-5 md:h-5" /> },
              { name: 'Optimization', icon: <Cpu className="w-4 h-4 md:w-5 md:h-5" /> }
            ].map((skill, i) => (
              <motion.div 
                key={skill.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.15)" }}
                className="flex items-center gap-2 md:gap-3 bg-white/10 border border-white/20 px-3 py-3 md:px-5 md:py-4 rounded-xl md:rounded-2xl text-gray-100 text-sm md:text-base font-medium transition-colors cursor-default shadow-sm"
              >
                <span className="text-amber-400">{skill.icon}</span>
                {skill.name}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Projects */}
      <section className="h-screen w-full flex items-end pb-12 md:items-center md:pb-0 justify-end px-4 md:px-24 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-auto max-w-2xl text-left w-full mt-24 md:mt-0"
        >
          <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-8 justify-start md:justify-end bg-black/40 p-3 md:p-4 rounded-2xl backdrop-blur-md md:bg-transparent md:p-0 md:backdrop-blur-none inline-flex md:flex w-full md:w-auto">
            <div className="p-2 md:p-3 bg-yellow-500/20 rounded-xl md:rounded-2xl border border-yellow-500/30 md:order-last">
              <Briefcase className="w-5 h-5 md:w-8 md:h-8 text-yellow-400" />
            </div>
            <h2 className="text-2xl md:text-5xl font-display font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">Featured Projects</h2>
          </div>
          
          <div className="space-y-3 md:space-y-6">
            {[
              { title: 'Amer Tycoon: Idle!', desc: 'An addictive idle game where you manage, upgrade, and expand your restaurant business.', tag: 'Mobile / Idle' },
              { title: 'Highway Drifter : Hajwala Simulator', desc: 'Highway Drifter brings high-speed action, precision drifting, and sleek supercars straight to your screen.', tag: 'Multi-platform / Racing' },
              { title: 'Highway Drifter: Hajwala Drift', desc: 'Race with your friends online and try to set new records for the best hajwalah and drifting scores.', tag: 'Mobile / Racing' }
            ].map((project, i) => (
              <motion.div 
                key={project.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                className="bg-black/80 p-4 md:p-8 rounded-2xl md:rounded-3xl backdrop-blur-2xl border border-white/10 hover:border-yellow-500/50 transition-all cursor-pointer group shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500 transform origin-bottom scale-y-0 group-hover:scale-y-100 transition-transform duration-300" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-1 md:mb-3 gap-2">
                  <h3 className="text-lg md:text-2xl font-display font-bold text-white group-hover:text-yellow-400 transition-colors drop-shadow-sm">{project.title}</h3>
                  <span className="text-[10px] md:text-xs font-mono px-2 py-1 md:px-3 rounded-full bg-yellow-500/30 text-yellow-200 border border-yellow-500/40 whitespace-nowrap">{project.tag}</span>
                </div>
                <p className="text-gray-300 text-xs md:text-base font-light leading-relaxed drop-shadow-sm">{project.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Contact */}
      <section className="h-screen w-full flex items-end pb-12 md:items-center md:pb-0 justify-center px-4 md:px-24 pointer-events-none">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-auto text-center max-w-2xl bg-black/80 p-6 md:p-16 rounded-[2rem] md:rounded-[3rem] backdrop-blur-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden w-full"
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-yellow-500/20 rounded-full blur-[80px] pointer-events-none" />
          
          <Mail className="w-8 h-8 md:w-12 md:h-12 text-yellow-400 mx-auto mb-3 md:mb-6 drop-shadow-md" />
          <h2 className="text-3xl md:text-6xl font-display font-black mb-3 md:mb-6 text-white drop-shadow-lg">Let's <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-500">Connect</span></h2>
          <p className="text-gray-300 mb-6 md:mb-8 text-sm md:text-lg font-light max-w-md mx-auto drop-shadow-sm">
            I'm always open to discussing game development.
          </p>

          <div className="flex flex-col items-center gap-2 md:gap-3 mb-6 md:mb-8 text-gray-300 text-xs md:text-base">
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-yellow-400" /> Amman, Jordan</div>
            <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-yellow-400" /> biltoa@outlook.com</div>
            <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-yellow-400" /> +962 79 0405 940</div>
          </div>

          <div className="flex justify-center gap-3 md:gap-4 mb-6 md:mb-8">
            <a href="https://www.linkedin.com/in/ahmad-bilto/" target="_blank" rel="noopener noreferrer" className="p-2 md:p-3 bg-white/5 rounded-full hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors border border-white/10"><Linkedin className="w-4 h-4 md:w-5 md:h-5" /></a>
            <a href="https://www.instagram.com/biltoa/" target="_blank" rel="noopener noreferrer" className="p-2 md:p-3 bg-white/5 rounded-full hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors border border-white/10"><Instagram className="w-4 h-4 md:w-5 md:h-5" /></a>
            <a href="https://www.facebook.com/ahmad.bilto/" target="_blank" rel="noopener noreferrer" className="p-2 md:p-3 bg-white/5 rounded-full hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors border border-white/10"><Facebook className="w-4 h-4 md:w-5 md:h-5" /></a>
            <a href="https://biltoa.itch.io/" target="_blank" rel="noopener noreferrer" className="p-2 md:p-3 bg-white/5 rounded-full hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors border border-white/10"><Gamepad2 className="w-4 h-4 md:w-5 md:h-5" /></a>
          </div>

          <div className="text-[10px] md:text-xs text-gray-500 border-t border-white/10 pt-4 md:pt-6">
            © 2026 Ahmad Bilto. All rights reserved.
          </div>
        </motion.div>
      </section>
    </div>
  );
}
