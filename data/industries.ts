import { workerImageSrc } from "@/lib/worker-images";

export const industries = [
  {
    name: "Metal Fabrication & Welding",
    image: "/images/street-v2/fabricator.webp",
    imageAlt: "AI-generated illustration of a Filipino metal fabricator",
  },
  {
    name: "Motor & Generator Production",
    image: workerImageSrc("/images/street-v2/mg-assembly-fitter.webp"),
    imageAlt: "AI-generated illustration of a Filipino motor and generator assembly fitter",
  },
  {
    name: "Electrical",
    image: workerImageSrc("/images/street-v2/electrical-installer.webp"),
    imageAlt: "AI-generated illustration of a Filipino electrical installer",
  },
  {
    name: "CNC & Machining",
    image: workerImageSrc("/images/street-v2/cnc-operator.webp"),
    imageAlt: "AI-generated illustration of a Filipino CNC operator at a machining centre",
  },
  {
    name: "Industrial Finishing",
    image: "/images/street-v2/industrial-spray-painter.webp",
    imageAlt: "AI-generated illustration of a Filipino industrial spray painter",
  },
] as const;
