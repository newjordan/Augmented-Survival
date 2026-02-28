/**
 * ArtDNA — The genetic system for procedural art evolution.
 *
 * Each OpenClaw agent has an ArtDNA that defines its visual style.
 * Art DNA can mutate, crossover with other agents, and evolve
 * over time as agents evaluate and refine their aesthetic.
 */

import type { ArtDNA, ColorGene, ShapeGene, DecorationGene, ArtMemory } from './types';

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Simple seeded random for reproducible art evolution */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Generate a random ArtDNA with coherent color palettes.
 * Each agent starts with a unique but aesthetically reasonable style.
 */
export function generateRandomArtDNA(seed: number): ArtDNA {
  const rng = seededRandom(seed);

  // Generate a coherent color palette using color theory
  const baseHue = rng() * 360;
  const complementHue = (baseHue + 120 + rng() * 60) % 360;
  const roofHue = (baseHue + 30 + rng() * 30) % 360;

  const primaryColor: ColorGene = {
    hue: baseHue,
    saturation: 0.3 + rng() * 0.4,
    lightness: 0.4 + rng() * 0.3,
    variance: 0.1 + rng() * 0.15,
  };

  const accentColor: ColorGene = {
    hue: complementHue,
    saturation: 0.4 + rng() * 0.4,
    lightness: 0.3 + rng() * 0.3,
    variance: 0.1 + rng() * 0.1,
  };

  const roofColor: ColorGene = {
    hue: roofHue,
    saturation: 0.2 + rng() * 0.3,
    lightness: 0.25 + rng() * 0.25,
    variance: 0.05 + rng() * 0.1,
  };

  const pathColor: ColorGene = {
    hue: 30 + rng() * 20, // Earthy tones
    saturation: 0.15 + rng() * 0.15,
    lightness: 0.35 + rng() * 0.2,
    variance: 0.05,
  };

  const shape: ShapeGene = {
    heightScale: 0.7 + rng() * 1.0,
    widthScale: 0.7 + rng() * 0.8,
    roofSteepness: 0.2 + rng() * 0.6,
    roundness: rng() * 0.6,
    detailLevel: 0.2 + rng() * 0.6,
    asymmetry: rng() * 0.3,
  };

  const decoration: DecorationGene = {
    hasWindows: rng() > 0.3,
    hasChimney: rng() > 0.5,
    hasBanners: rng() > 0.6,
    hasGardens: rng() > 0.4,
    fenceAmount: rng() * 0.5,
    lightingDensity: 0.1 + rng() * 0.4,
  };

  return {
    primaryColor,
    accentColor,
    roofColor,
    pathColor,
    shape,
    decoration,
    generation: 0,
    fitnessScore: 0.5,
  };
}

/**
 * Mutate a single color gene by a small amount.
 */
function mutateColor(gene: ColorGene, intensity: number, rng: () => number): ColorGene {
  const range = gene.variance * intensity;
  return {
    hue: (gene.hue + (rng() - 0.5) * range * 60 + 360) % 360,
    saturation: clamp(gene.saturation + (rng() - 0.5) * range, 0, 1),
    lightness: clamp(gene.lightness + (rng() - 0.5) * range, 0.1, 0.9),
    variance: gene.variance,
  };
}

/**
 * Mutate shape genes by a small amount.
 */
function mutateShape(gene: ShapeGene, intensity: number, rng: () => number): ShapeGene {
  const d = intensity * 0.15;
  return {
    heightScale: clamp(gene.heightScale + (rng() - 0.5) * d * 2, 0.5, 3.0),
    widthScale: clamp(gene.widthScale + (rng() - 0.5) * d * 1.5, 0.5, 2.0),
    roofSteepness: clamp(gene.roofSteepness + (rng() - 0.5) * d, 0, 1),
    roundness: clamp(gene.roundness + (rng() - 0.5) * d, 0, 1),
    detailLevel: clamp(gene.detailLevel + (rng() - 0.5) * d, 0, 1),
    asymmetry: clamp(gene.asymmetry + (rng() - 0.5) * d * 0.5, 0, 1),
  };
}

/**
 * Mutate decoration genes (toggle features, adjust densities).
 */
function mutateDecoration(gene: DecorationGene, intensity: number, rng: () => number): DecorationGene {
  const flipChance = intensity * 0.15;
  const d = intensity * 0.1;
  return {
    hasWindows: rng() < flipChance ? !gene.hasWindows : gene.hasWindows,
    hasChimney: rng() < flipChance ? !gene.hasChimney : gene.hasChimney,
    hasBanners: rng() < flipChance ? !gene.hasBanners : gene.hasBanners,
    hasGardens: rng() < flipChance ? !gene.hasGardens : gene.hasGardens,
    fenceAmount: clamp(gene.fenceAmount + (rng() - 0.5) * d, 0, 1),
    lightingDensity: clamp(gene.lightingDensity + (rng() - 0.5) * d, 0, 1),
  };
}

/**
 * Mutate an ArtDNA, producing a child with small variations.
 * Intensity controls how dramatic the mutations are (0-1).
 */
export function mutateArtDNA(parent: ArtDNA, intensity: number, seed: number): ArtDNA {
  const rng = seededRandom(seed);

  // Decide which aspects to mutate (usually 1-2 at a time)
  const mutateColors = rng() < 0.6;
  const mutateShapes = rng() < 0.4;
  const mutateDecorations = rng() < 0.3;

  return {
    primaryColor: mutateColors ? mutateColor(parent.primaryColor, intensity, rng) : { ...parent.primaryColor },
    accentColor: mutateColors ? mutateColor(parent.accentColor, intensity, rng) : { ...parent.accentColor },
    roofColor: mutateColors && rng() < 0.5 ? mutateColor(parent.roofColor, intensity, rng) : { ...parent.roofColor },
    pathColor: { ...parent.pathColor },
    shape: mutateShapes ? mutateShape(parent.shape, intensity, rng) : { ...parent.shape },
    decoration: mutateDecorations ? mutateDecoration(parent.decoration, intensity, rng) : { ...parent.decoration },
    generation: parent.generation + 1,
    fitnessScore: parent.fitnessScore, // Will be re-evaluated
  };
}

/**
 * Crossover two ArtDNAs, blending traits from two agents.
 * Used when agents collaborate or trade aesthetic influence.
 */
export function crossoverArtDNA(parentA: ArtDNA, parentB: ArtDNA, bias: number, seed: number): ArtDNA {
  const rng = seededRandom(seed);

  // Blend colors with bias toward parentA (0.5 = equal blend)
  const blendColor = (a: ColorGene, b: ColorGene): ColorGene => ({
    hue: rng() < bias ? a.hue : b.hue,
    saturation: a.saturation * bias + b.saturation * (1 - bias),
    lightness: a.lightness * bias + b.lightness * (1 - bias),
    variance: Math.max(a.variance, b.variance),
  });

  // Blend shapes
  const blendShape = (a: ShapeGene, b: ShapeGene): ShapeGene => ({
    heightScale: a.heightScale * bias + b.heightScale * (1 - bias),
    widthScale: a.widthScale * bias + b.widthScale * (1 - bias),
    roofSteepness: a.roofSteepness * bias + b.roofSteepness * (1 - bias),
    roundness: a.roundness * bias + b.roundness * (1 - bias),
    detailLevel: a.detailLevel * bias + b.detailLevel * (1 - bias),
    asymmetry: a.asymmetry * bias + b.asymmetry * (1 - bias),
  });

  // Randomly pick decoration features from either parent
  const blendDecoration = (a: DecorationGene, b: DecorationGene): DecorationGene => ({
    hasWindows: rng() < bias ? a.hasWindows : b.hasWindows,
    hasChimney: rng() < bias ? a.hasChimney : b.hasChimney,
    hasBanners: rng() < bias ? a.hasBanners : b.hasBanners,
    hasGardens: rng() < bias ? a.hasGardens : b.hasGardens,
    fenceAmount: a.fenceAmount * bias + b.fenceAmount * (1 - bias),
    lightingDensity: a.lightingDensity * bias + b.lightingDensity * (1 - bias),
  });

  return {
    primaryColor: blendColor(parentA.primaryColor, parentB.primaryColor),
    accentColor: blendColor(parentA.accentColor, parentB.accentColor),
    roofColor: blendColor(parentA.roofColor, parentB.roofColor),
    pathColor: rng() < bias ? { ...parentA.pathColor } : { ...parentB.pathColor },
    shape: blendShape(parentA.shape, parentB.shape),
    decoration: blendDecoration(parentA.decoration, parentB.decoration),
    generation: Math.max(parentA.generation, parentB.generation) + 1,
    fitnessScore: (parentA.fitnessScore + parentB.fitnessScore) / 2,
  };
}

/**
 * Evaluate the "fitness" of an ArtDNA based on the agent's aesthetic preferences.
 * This is a self-evaluation: the agent scores how well the DNA matches
 * its internal preferences (derived from personality traits).
 */
export function evaluateArtFitness(
  dna: ArtDNA,
  preferences: { prefersWarm: boolean; prefersDetailed: boolean; prefersTall: boolean },
): number {
  let score = 0.5; // Start neutral

  // Warm color preference
  const isWarm = dna.primaryColor.hue < 60 || dna.primaryColor.hue > 300;
  if (preferences.prefersWarm && isWarm) score += 0.1;
  if (!preferences.prefersWarm && !isWarm) score += 0.1;

  // Detail preference
  if (preferences.prefersDetailed && dna.shape.detailLevel > 0.5) score += 0.1;
  if (!preferences.prefersDetailed && dna.shape.detailLevel < 0.5) score += 0.1;

  // Height preference
  if (preferences.prefersTall && dna.shape.heightScale > 1.2) score += 0.1;
  if (!preferences.prefersTall && dna.shape.heightScale < 1.2) score += 0.1;

  // Coherence bonus: accent color is complementary to primary
  const hueDiff = Math.abs(dna.primaryColor.hue - dna.accentColor.hue);
  const complementaryDistance = Math.abs(hueDiff - 180);
  if (complementaryDistance < 60) score += 0.1;

  // Saturation harmony bonus
  const satDiff = Math.abs(dna.primaryColor.saturation - dna.accentColor.saturation);
  if (satDiff < 0.2) score += 0.05;

  return clamp(score, 0, 1);
}

/**
 * Get the mutation type description for logging/memory.
 */
export function describeMutation(parent: ArtDNA, child: ArtDNA): ArtMemory['mutationType'] {
  const colorChanged =
    parent.primaryColor.hue !== child.primaryColor.hue ||
    parent.accentColor.hue !== child.accentColor.hue;
  const shapeChanged = parent.shape.heightScale !== child.shape.heightScale;
  const decoChanged = parent.decoration.hasWindows !== child.decoration.hasWindows;

  if (colorChanged && shapeChanged) return 'crossover';
  if (colorChanged) return 'color';
  if (shapeChanged) return 'shape';
  if (decoChanged) return 'decoration';
  return 'color';
}
