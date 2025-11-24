import { 
  Gamepad2, 
  Code2, 
  Camera, 
  Linkedin, 
  Facebook, 
  Instagram, 
  Mail, 
  MapPin, 
  Smartphone, 
  Cpu, 
  Globe, 
  Palette,
  Terminal,
  Layers
} from 'lucide-react';
import { Skill, Photo, SocialLink, NavItem } from './types';

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '#home' },
  { label: 'About', href: '#about' },
  { label: 'Skills', href: '#skills' },
  { label: 'Game Dev', href: '#games' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Contact', href: '#contact' },
];

export const SKILLS: Skill[] = [
  { name: 'Unity 3D', icon: Gamepad2, category: 'game' },
  { name: 'Unreal Engine', icon: Layers, category: 'game' },
  { name: 'C# / C++', icon: Terminal, category: 'game' },
  { name: 'React', icon: Code2, category: 'web' },
  { name: 'TypeScript', icon: Code2, category: 'web' },
  { name: 'Tailwind CSS', icon: Palette, category: 'web' },
  { name: 'Blender', icon: Cpu, category: 'other' },
  { name: 'Photography', icon: Camera, category: 'other' },
];

export const PHOTOS: Photo[] = [
  { id: 1, url: 'https://picsum.photos/id/16/800/600', title: 'Nature Walk', orientation: 'landscape' },
  { id: 2, url: 'https://picsum.photos/id/42/800/1200', title: 'Urban Shadows', orientation: 'portrait' },
  { id: 3, url: 'https://picsum.photos/id/58/800/600', title: 'Coastal Waves', orientation: 'landscape' },
  { id: 4, url: 'https://picsum.photos/id/64/800/1200', title: 'Portrait Study', orientation: 'portrait' },
  { id: 5, url: 'https://picsum.photos/id/91/800/600', title: 'Mountain Peak', orientation: 'landscape' },
  { id: 6, url: 'https://picsum.photos/id/103/800/600', title: 'Night Sky', orientation: 'landscape' },
];

export const SOCIALS: SocialLink[] = [
  { name: 'LinkedIn', url: 'https://www.linkedin.com/', icon: Linkedin, label: '/in/ahmadbilto' },
  { name: 'Instagram', url: 'https://www.instagram.com/', icon: Instagram, label: '@ahmadbilto' },
  { name: 'Facebook', url: 'https://www.facebook.com/', icon: Facebook, label: 'Ahmad Bilto' },
  { name: 'Itch.io', url: 'https://itch.io/', icon: Gamepad2, label: 'itch.io/ahmadbilto' },
];

export const CONTACT_INFO = {
  email: 'contact@ahmadbilto.com',
  phone: '+1 (555) 123-4567',
  location: 'City, Country',
};

// Placeholder image for the Hero section if the user hasn't replaced it yet.
// In production, this should be the user's actual photo.
export const HERO_IMAGE = "https://images.unsplash.com/photo-1511367461989-f85a21fda167?q=80&w=2831&auto=format&fit=crop"; 
