"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { workerImageSrc } from "@/lib/worker-images";

const slides = [
  {
    image: workerImageSrc("/images/street-v2/hero-career.webp"),
    lines: ["Your skills.", "Your future."],
    emphasis: "In Croatia.",
    copy: "For skilled Filipino workers ready for their next move. Explore opportunities in Croatia, with no placement fee.",
    label: "Your future in Croatia",
  },
  {
    image: workerImageSrc("/images/street-v2/hero-skills.webp"),
    lines: ["Build a career.", "Make your"],
    emphasis: "next move.",
    copy: "Bring your experience to a new opportunity. Discover roles for skilled Filipino tradespeople and find the right fit for your skills.",
    label: "Put your skills to work",
  },
  {
    image: workerImageSrc("/images/street-v2/hero-future.webp"),
    lines: ["Good work.", "New possibilities."],
    emphasis: "No placement fee.",
    copy: "Take the next step with confidence. Explore opportunities in Croatia, review the requirements, and apply directly with your CV.",
    label: "Opportunities with no placement fee",
  },
] as const;

export function StreetHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const slide = slides[activeIndex];
  const feePhrase = "no placement fee";
  const feePhraseIndex = slide.copy.indexOf(feePhrase);

  return (
    <section className="street-hero" aria-labelledby="street-hero-heading">
      <div className="street-hero-scenes" aria-hidden="true">
        {slides.map((item, index) => (
          <div key={item.image} className={`street-hero-scene${activeIndex === index ? " is-active" : ""}`}>
            <Image src={item.image} alt="" fill sizes="100vw" preload={index === 0} className="street-hero-image" />
          </div>
        ))}
      </div>
      <div className="street-hero-overlay" aria-hidden="true" />

      <div className="container street-hero-content">
        <div key={activeIndex} id="street-hero-message" className="street-hero-message">
          <p className="street-hero-eyebrow">Philippines <span aria-hidden="true">→</span> Croatia</p>
          <h1 id="street-hero-heading" className="street-hero-headline">
            {slide.lines.map((line) => <span className="street-hero-line" key={line}><span>{line}</span></span>)}
            <em className="street-hero-line" data-fee-glow={slide.emphasis === "No placement fee." ? "text" : undefined}><span>{slide.emphasis}</span></em>
          </h1>
          <p className="street-hero-copy">{feePhraseIndex < 0 ? slide.copy : <>{slide.copy.slice(0, feePhraseIndex)}<span data-fee-glow="text">{feePhrase}</span>{slide.copy.slice(feePhraseIndex + feePhrase.length)}</>}</p>
          <div className="street-hero-actions">
            <Link className="street-pill" href="/jobs">
              Explore available jobs
              <span aria-hidden="true"><ArrowUpRight /></span>
            </Link>
            <Link className="street-hero-secondary" href="/about#working-in-croatia">
              Life and work in Croatia <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="street-hero-dots" role="group" aria-label="Choose featured message">
          {slides.map((item, index) => (
            <button
              key={item.image}
              type="button"
              aria-label={`Show slide ${index + 1}: ${item.label}`}
              aria-pressed={activeIndex === index}
              aria-controls="street-hero-message"
              onClick={() => setActiveIndex(index)}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </div>

        <div className="street-hero-footer">
          <a className="street-hero-scroll" href="#opportunities">
            <ArrowDown aria-hidden="true" /> Discover your next opportunity
          </a>
          <span className="street-hero-index" aria-hidden="true">
            {String(activeIndex + 1).padStart(2, "0")} <span>/ {String(slides.length).padStart(2, "0")}</span>
          </span>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Slide {activeIndex + 1} of {slides.length}: {slide.label}
      </span>
    </section>
  );
}
