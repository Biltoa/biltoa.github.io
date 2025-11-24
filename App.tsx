import React from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import About from './components/About';
import Skills from './components/Skills';
import Games from './components/Games';
import Gallery from './components/Gallery';
import Contact from './components/Contact';
import ScrollToTop from './components/ScrollToTop';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-stone-50 font-sans">
      <Navbar />
      <main>
        <Hero />
        <About />
        <Skills />
        <Games />
        <Gallery />
      </main>
      <Contact />
      <ScrollToTop />
    </div>
  );
};

export default App;