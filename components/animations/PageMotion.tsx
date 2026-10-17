"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function PageMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.getElementById("main-content");
    if (!root) return;

    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const restoreCounters: Array<() => void> = [];
      const registeredReveals = new WeakSet<HTMLElement>();
      const revealTweens = new Map<HTMLElement, gsap.core.Tween>();
      const registerReveals = (elements: HTMLElement[]) => {
        elements.forEach((element) => {
          if (registeredReveals.has(element)) return;
          // Suspense can expose server HTML before its client component hydrates.
          // Wait for that component's commit before changing React-owned styles.
          if (element.closest('[data-motion-boundary]:not([data-motion-ready="true"])')) return;
          registeredReveals.add(element);
          // A parent fade already reveals its descendants without compounding it.
          if (element.parentElement?.closest("[data-reveal]")) return;
          if (element.getBoundingClientRect().bottom <= 0 || element.contains(document.activeElement)) return;
          const siblings = element.parentElement
            ? Array.from(element.parentElement.children).filter((child) => child.hasAttribute("data-reveal"))
            : [element];
          const order = Math.max(0, siblings.indexOf(element));
          const tween = gsap.fromTo(element, { opacity: 0.08 }, {
            opacity: 1,
            duration: 1.1,
            delay: Math.min(order * 0.09, 0.27),
            ease: "power1.out",
            clearProps: "opacity",
            onComplete: () => { revealTweens.delete(element); },
            scrollTrigger: { trigger: element, start: "top 86%", once: true },
          });
          revealTweens.set(element, tween);
        });
      };
      const context = gsap.context(() => {
        // Fade in place so entering sections never jump away from their layout.
        // Server-rendered content stays readable before hydration as well.
        const entrances = gsap.utils.toArray<HTMLElement>("[data-enter]", root);
        if (entrances.length) {
          gsap.fromTo(entrances, { opacity: 0.08 }, {
            opacity: 1,
            duration: 1,
            stagger: 0.09,
            ease: "power1.out",
            clearProps: "opacity",
          });
        }

        registerReveals(gsap.utils.toArray<HTMLElement>("[data-reveal]", root));

        gsap.utils.toArray<HTMLElement>(".street-section-top", root).forEach((element) => {
          gsap.fromTo(element, { "--street-rule-progress": 0 }, {
            "--street-rule-progress": 1,
            duration: 1.3,
            ease: "power3.out",
            immediateRender: false,
            scrollTrigger: { trigger: element, start: "top 90%", once: true },
          });
        });

        gsap.utils.toArray<HTMLElement>(".street-stats strong", root).forEach((element) => {
          const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ""));
          if (!textNode) return;
          const original = textNode.textContent ?? "";
          const match = original.match(/^(\D*)([\d,]+)(\D*)$/);
          if (!match) return;
          const [, prefix, numeric, suffix] = match;
          const target = Number(numeric.replaceAll(",", ""));
          if (!Number.isFinite(target) || target === 0) return;

          const visual = document.createElement("span");
          visual.className = "street-count-visual";
          visual.setAttribute("aria-hidden", "true");
          visual.textContent = original;
          const accessible = document.createElement("span");
          accessible.className = "sr-only";
          accessible.textContent = original;
          element.insertBefore(visual, textNode);
          element.insertBefore(accessible, textNode);
          textNode.textContent = "";
          restoreCounters.push(() => {
            textNode.textContent = original;
            visual.remove();
            accessible.remove();
          });

          const counter = { value: 0 };
          const format = (value: number) => {
            const rounded = Math.round(value);
            const digits = numeric.startsWith("0")
              ? String(rounded).padStart(numeric.length, "0")
              : rounded.toLocaleString("en-US");
            return `${prefix}${digits}${suffix}`;
          };
          gsap.to(counter, {
            value: target,
            duration: 1.5,
            ease: "power2.out",
            onUpdate: () => { visual.textContent = format(counter.value); },
            onComplete: () => { visual.textContent = original; },
            scrollTrigger: { trigger: element, start: "top 96%", once: true },
          });
        });
      }, root);

      // Suspense and job filters can mount cards after the page effect runs.
      const observer = new MutationObserver((records) => {
        const added = new Set<HTMLElement>();
        const collect = (node: Node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[data-reveal]")) added.add(node);
          node.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => added.add(element));
        };
        records.forEach((record) => {
          if (record.type === "attributes") collect(record.target);
          else record.addedNodes.forEach(collect);
        });
        if (added.size) context.add(() => registerReveals([...added]));
        revealTweens.forEach((tween, element) => {
          if (element.isConnected) return;
          tween.scrollTrigger?.kill();
          tween.kill();
          revealTweens.delete(element);
        });
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-motion-ready"] });

      // Keyboard users should never land on a faded-out interactive control.
      const showFocusedReveal = (event: FocusEvent) => {
        if (!(event.target instanceof Element)) return;
        let element = event.target.closest<HTMLElement>("[data-reveal]");
        while (element) {
          const tween = revealTweens.get(element);
          if (tween) {
            tween.scrollTrigger?.kill();
            tween.kill();
            gsap.set(element, { clearProps: "opacity" });
            revealTweens.delete(element);
          }
          element = element.parentElement?.closest<HTMLElement>("[data-reveal]") ?? null;
        }
      };
      root.addEventListener("focusin", showFocusedReveal);

      return () => {
        observer.disconnect();
        root.removeEventListener("focusin", showFocusedReveal);
        context.revert();
        revealTweens.clear();
        restoreCounters.forEach((restore) => restore());
      };
    });

    return () => media.revert();
  }, [pathname]);

  return null;
}
