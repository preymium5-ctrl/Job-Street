// Current recruitment counts set for the owner's 16 October 2026 update.
// These replace the displayed counts, not the archived September PDF figures.
export const hiringAllocations: Record<string, Record<string, number>> = {
  fabricator: {
    "Končar MK": 175,
    Vertiv: 225,
    "Novi Ferromont d.o.o.": 300,
    "Ferokotao d.o.o.": 450,
  },
  "tig-rel-welder": { "Đuro Đaković Montaža": 875 },
  "pipe-fitter": { "Đuro Đaković Montaža": 650 },
  "mg-winding-insulator": { "Končar GIM": 250 },
  "mg-winding-production-worker": { "Končar GIM": 425 },
  "mg-winding-processing-worker": { "Končar GIM": 375 },
  "sheet-metal-tinsmith-processor": { "Končar GIM": 325 },
  "mg-assembly-fitter": { "Končar GIM": 550 },
  "mig-mag-tig-rel-welder": { "Končar GIM": 275, "Ferokotao d.o.o.": 625 },
  "electrical-installer": { Vertiv: 1125 },
  "electrical-assembler": { Vertiv: 950 },
  welder: { Vertiv: 775 },
  "mig-mag-tig-welder": { "Novi Ferromont d.o.o.": 725 },
  "cnc-operator": { "Novi Ferromont d.o.o.": 225, "Ferokotao d.o.o.": 475 },
  "industrial-spray-painter": { "Novi Ferromont d.o.o.": 250, "Ferokotao d.o.o.": 575 },
  "robotic-welding-machine-operator": { "Ferokotao d.o.o.": 350 },
  "grinder-and-cleaner": { "Ferokotao d.o.o.": 150 },
};

export function hiringWorkerTotal(slug: string): number | undefined {
  const allocations = hiringAllocations[slug];
  return allocations ? Object.values(allocations).reduce((total, workers) => total + workers, 0) : undefined;
}
