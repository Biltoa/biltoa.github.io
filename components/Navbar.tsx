import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV_ITEMS } from '../constants';

const Navbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleMenu = () => setIsOpen(!isOpen);

  const scrollToSection = (href: string) => {
    setIsOpen(false);
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className={`fixed w-full z-50 transition-all duration-500 ${
      isScrolled || isOpen ? 'bg-sage-900/90 backdrop-blur-md shadow-lg py-4' : 'bg-transparent py-6'
    }`}>
      <div className="container mx-auto px-6 flex justify-between items-center">
        <a 
          href="#home" 
          className={`font-display font-bold text-2xl tracking-tighter transition-colors duration-300 ${
            isScrolled || isOpen ? 'text-white' : 'text-white'
          }`}
        >
          AB.
        </a>

        {/* Desktop Menu */}
        <div className="hidden md:flex space-x-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => scrollToSection(item.href)}
              className={`px-4 py-2 rounded-full text-sm font-medium tracking-wide transition-all duration-300 ${
                 isScrolled 
                 ? 'text-stone-300 hover:text-white hover:bg-white/10' 
                 : 'text-stone-200 hover:text-white hover:bg-white/10'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <button onClick={toggleMenu} className="text-white focus:outline-none p-2 hover:bg-white/10 rounded-lg transition-colors">
            {isOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      <div className={`md:hidden absolute w-full bg-sage-900 border-t border-sage-800 transition-all duration-300 ease-in-out ${
        isOpen ? 'max-h-screen opacity-100 py-8' : 'max-h-0 opacity-0 overflow-hidden py-0'
      }`}>
        <div className="flex flex-col items-center space-y-6">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => scrollToSection(item.href)}
              className="text-stone-300 text-xl font-medium hover:text-white transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;