const replacedWorkerImages = new Set([
  "/images/street-v2/hero-career.webp",
  "/images/street-v2/hero-skills.webp",
  "/images/street-v2/hero-future.webp",
  "/images/street-v2/tig-rel-welder.webp",
  "/images/street-v2/mg-winding-insulator.webp",
  "/images/street-v2/mg-winding-processing-worker.webp",
  "/images/street-v2/mg-assembly-fitter.webp",
  "/images/street-v2/electrical-installer.webp",
  "/images/street-v2/welder.webp",
  "/images/street-v2/cnc-operator.webp",
  "/images/street-v2/grinder-and-cleaner.webp",
]);

/** Give replaced artwork a fresh image-cache key without changing stored paths. */
export function workerImageSrc(src: string) {
  return replacedWorkerImages.has(src) ? `${src}?v=male-20261020` : src;
}
