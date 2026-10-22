"use client";
import { BrandLockup } from "@/components/ui/Brand";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, Search, X } from "lucide-react";

const links = [
  ["Find jobs", "/jobs"],
  ["Working in Croatia", "/about#working-in-croatia"],
  ["Industries", "/#industries"],
  ["About", "/about"],
];
export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 32);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>("a,button") ?? [],
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keydown);
    };
  }, [open]);
  return (
    <header className={`site-header street-header ${pathname === "/" && !scrolled ? "street-header-overlay" : ""}`}>
      <nav className="container nav-inner" aria-label="Main navigation">
        <Link href="/" className="wordmark" aria-label="Jobs Street Croatia home">
          <BrandLockup />
        </Link>
        <div className="desktop-nav">
          {links.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="nav-actions">
          <Link href="/contact" className="nav-contact">
            Let’s talk
          </Link>
          <Link href="/jobs#job-results" className="nav-search" aria-label="Search jobs">
            <Search size={19} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/apply" className="street-pill nav-cta">
            Apply now <span><ArrowUpRight size={17} /></span>
          </Link>
          <button
            ref={toggleRef}
            className="menu-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label="Open navigation"
          >
            <Menu size={25} />
          </button>
        </div>
      </nav>
      {open && (
        <div
          className="mobile-menu"
          id="mobile-navigation"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="mobile-menu-top">
            <span className="wordmark"><BrandLockup /></span>
            <button
              onClick={() => {
                setOpen(false);
                toggleRef.current?.focus();
              }}
              aria-label="Close navigation"
            >
              <X />
            </button>
          </div>
          <Link href="/" onClick={() => setOpen(false)}>
            Home <ArrowUpRight />
          </Link>
          {links.map(([label, href], i) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              <span>
                <small>0{i + 1}</small>
                {label}
              </span>
              <ArrowUpRight />
            </Link>
          ))}
          <Link href="/apply" onClick={() => setOpen(false)}>
            General application <ArrowUpRight />
          </Link>
          <Link href="/contact" onClick={() => setOpen(false)}>
            Contact <ArrowUpRight />
          </Link>
          <p>Good work. A better future.</p>
        </div>
      )}
    </header>
  );
}
