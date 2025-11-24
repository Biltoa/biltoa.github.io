import React, { useState } from 'react';
import { PHOTOS } from '../constants';
import { X, ZoomIn } from 'lucide-react';

const Gallery: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

  const openLightbox = (id: number) => setSelectedImage(id);
  const closeLightbox = () => setSelectedImage(null);

  const currentPhoto = PHOTOS.find(p => p.id === selectedImage);

  return (
    <section id="gallery" className="py-24 px-6 bg-sage-50">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="font-display text-4xl font-bold text-stone-900 mb-4">Through The Lens</h2>
          <p className="text-stone-500">Capturing moments, light, and atmosphere.</p>
        </div>

        {/* Masonry-style Grid */}
        <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
          {PHOTOS.map((photo) => (
            <div 
              key={photo.id} 
              className="break-inside-avoid relative group rounded-2xl overflow-hidden cursor-pointer shadow-md hover:shadow-xl hover:shadow-sage-200/50 transition-all duration-500"
              onClick={() => openLightbox(photo.id)}
            >
              <img 
                src={photo.url} 
                alt={photo.title} 
                className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-sage-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                 <div className="text-white text-center p-4 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                    <p className="font-display font-medium text-xl mb-1">{photo.title}</p>
                    <div className="inline-flex items-center gap-2 text-sage-200 text-sm uppercase tracking-widest mt-2">
                        <ZoomIn size={16} />
                        <span>View</span>
                    </div>
                 </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox Modal */}
      {selectedImage && currentPhoto && (
        <div 
            className="fixed inset-0 z-[60] bg-stone-900/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={closeLightbox}
        >
            <button 
                onClick={closeLightbox}
                className="absolute top-6 right-6 p-2 bg-white/10 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition-all"
            >
                <X size={28} />
            </button>
            
            <div 
                className="max-w-6xl max-h-[90vh] relative flex flex-col items-center"
                onClick={(e) => e.stopPropagation()} 
            >
                <img 
                    src={currentPhoto.url} 
                    alt={currentPhoto.title} 
                    className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                />
                <p className="text-stone-300 mt-4 font-light tracking-wide text-lg">{currentPhoto.title}</p>
            </div>
        </div>
      )}
    </section>
  );
};

export default Gallery;