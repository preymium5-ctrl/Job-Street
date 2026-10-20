"use client";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useRef } from "react";
import { workerImageSrc } from "@/lib/worker-images";

export function Hero({
  count,
  exampleCount,
  proposedCount,
  workers,
}: {
  count: number;
  exampleCount: number;
  proposedCount: number;
  workers: number;
}) {
  const imageRef = useRef<HTMLDivElement>(null);
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "mouse" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    imageRef.current?.style.setProperty(
      "--mouse-x",
      `${((event.clientX - bounds.left) / bounds.width - 0.5) * 8}px`,
    );
    imageRef.current?.style.setProperty(
      "--mouse-y",
      `${((event.clientY - bounds.top) / bounds.height - 0.5) * 8}px`,
    );
  }
  return (
    <section className="hero container">
      <div className="hero-kicker" data-enter>
        <span className="eyebrow">
          <i className="status-dot" /> Good work. A better future.
        </span>
        <span className="hero-kicker-right">
          People. Possibility. Progress.
        </span>
      </div>
      <div className="hero-heading-row">
        <h1 className="hero-title" aria-label="Jobs Street Croatia.">
          <span data-enter>Jobs in</span>
          <span data-enter>
            Croatia<span className="accent-dot">.</span>
          </span>
        </h1>
        <div className="hero-intro" data-enter>
          <span className="eyebrow">Skilled Filipino workers wanted</span>
          <p>
            Opportunities in Croatia for Filipino tradespeople and production workers.
            <br /> Hiring in the Philippines.
            <br /> Find the role that matches your skills.
          </p>
          <Link href="/jobs" className="button button-primary magnetic">
            Explore jobs <ArrowUpRight size={20} />
          </Link>
        </div>
      </div>
      <div
        className="hero-visual"
        data-enter
        onPointerMove={move}
        onPointerLeave={() => {
          imageRef.current?.style.setProperty("--mouse-x", "0px");
          imageRef.current?.style.setProperty("--mouse-y", "0px");
        }}
      >
        <div className="hero-image-wrap" ref={imageRef}>
          <Image
            src={workerImageSrc("/images/street-v2/hero-career.webp")}
            alt="AI-generated illustration of Filipino technicians reviewing a technical drawing in a workshop"
            fill
            loading="eager"
            fetchPriority="high"
            sizes="100vw"
            className="hero-image"
          />
        </div>
        <div className="hero-image-shade" />
        <div className="hero-photo-caption">
          <span className="eyebrow">Filipino skills. New possibilities.</span>
          <p>
            Real skills.
            <br />
            New possibilities.
          </p>
        </div>
        <Link href="/jobs" className="hero-feature">
          <span className="hero-feature-top">
            <span className="eyebrow">Your next move</span>
            <ArrowUpRight size={32} />
          </span>
          <span>
            Find where
            <br />
            you belong.
          </span>
          <small>
            <span>
              {count}{" "}
              {proposedCount === count && count > 0
                ? `roles · ${workers} positions`
                : exampleCount === count && count > 0
                ? "example opportunities"
                : "opportunities"}{" "}
              to explore
            </span>
            <ArrowUpRight size={15} />
          </small>
        </Link>
        <Link href="#introduction" className="hero-scroll">
          Scroll to discover <ArrowDown size={16} />
        </Link>
      </div>
      <div className="hero-bottom">
        <span>For the doers. The builders. The next generation.</span>
        <Link href="#how-it-works">
          How it works <ArrowDown size={14} />
        </Link>
      </div>
    </section>
  );
}
