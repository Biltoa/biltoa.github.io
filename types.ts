import { LucideIcon } from "lucide-react";

export interface Skill {
  name: string;
  icon: LucideIcon;
  category: 'game' | 'web' | 'other';
}

export interface Photo {
  id: number;
  url: string;
  title: string;
  orientation: 'landscape' | 'portrait';
}

export interface SocialLink {
  name: string;
  url: string;
  icon: LucideIcon;
  label: string;
}

export interface NavItem {
  label: string;
  href: string;
}