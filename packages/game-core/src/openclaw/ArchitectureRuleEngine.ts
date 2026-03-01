/**
 * ArchitectureRuleEngine — Hot-reloadable rule system for procedural architecture.
 *
 * THIS IS THE CORE INNOVATION:
 *
 * Rules define how blocks are assembled into structures. They can be:
 * - Built-in (shipped with the game)
 * - Injected live while the game is running (hot-reload)
 * - Sent by an operator via WebSocket ("build a cathedral")
 *
 * The rule engine is the bridge between human intent and emergent architecture.
 * When an operator says "build a cathedral", the engine:
 * 1. Looks up rules for the Cathedral archetype
 * 2. Applies the agent's ArtDNA to parameterize the rules
 * 3. Generates a blueprint (list of blocks in build order)
 * 4. Validates structural integrity
 * 5. Hands the blueprint to the BlockBuilder for execution
 *
 * Hot-reload works by replacing rule functions at runtime. The engine
 * maintains a registry of named rules that can be swapped without
 * restarting the game. This means art is literally made through code —
 * new rules = new architecture = new art.
 *
 * Connection to LegoGen/Blocks:
 * The built-in Temple rule is a direct translation of LegoGen's
 * classical_building generator, producing the same CUBE/WEDGE/CYLINDER
 * block patterns but parameterized by game-world ArtDNA.
 */

import {
  type Block,
  BlockShape,
  BlockMaterial,
  BlockRole,
  StructureArchetype,
  BLOCK_MATERIAL_CULTURE,
} from '../types/blocks';
import {
  type ArchitectureBlueprint,
  type BlueprintMetadata,
  createBlock,
  applyArtDNAColor,
  computeBuildPhases,
  computeBlockCounts,
  computeBounds,
  validateBlueprint,
} from './ArchitectureBlueprint';
import type { ArtDNA } from './types';
import type { BlockInventory } from './BlockEconomy';
import { getBlockCount } from './BlockEconomy';

// ─── Rule Definition ────────────────────────────────────────────────

/**
 * An architecture rule — a function that generates blocks for a structure.
 *
 * Rules receive the generation context (art DNA, dimensions, seed)
 * and return an array of blocks that form the structure.
 *
 * Rules are the unit of hot-reload: swap a rule function, and the next
 * structure generated with that rule will use the new logic.
 */
export interface ArchitectureRule {
  /** Unique rule ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Which archetypes this rule can generate */
  archetypes: StructureArchetype[];

  /** Priority (higher = preferred when multiple rules match) */
  priority: number;

  /** Version number (incremented on hot-reload) */
  version: number;

  /**
   * The generator function. Takes context, returns blocks.
   * This is the function that gets hot-swapped.
   */
  generate: RuleGeneratorFn;
}

/**
 * Context passed to rule generator functions.
 */
export interface RuleContext {
  /** The structure archetype to generate */
  archetype: StructureArchetype;

  /** Agent's art DNA for style influence */
  artDNA: ArtDNA;

  /** Desired dimensions (may be adjusted by rules) */
  width: number;
  height: number;
  depth: number;

  /** Seed for deterministic generation */
  seed: number;

  /** Available block materials (for material-aware generation) */
  availableBlocks: BlockInventory;

  /** Optional operator description ("a gothic cathedral with flying buttresses") */
  description?: string;

  /** Custom parameters from operator injection */
  customParams?: Record<string, unknown>;
}

/**
 * The signature of a rule generator function.
 * Takes context, returns blocks.
 */
export type RuleGeneratorFn = (ctx: RuleContext) => Block[];

// ─── Rule Engine ────────────────────────────────────────────────────

/**
 * ArchitectureRuleEngine — manages rules and generates blueprints.
 */
export class ArchitectureRuleEngine {
  /** Registry of all active rules, keyed by ID */
  private rules = new Map<string, ArchitectureRule>();

  /** Version counter for tracking hot-reload iterations */
  private engineVersion = 1;

  /** Event listeners for rule changes */
  private onRuleChangedListeners: Array<(ruleId: string, action: 'added' | 'updated' | 'removed') => void> = [];

  constructor() {
    // Register all built-in rules
    this.registerBuiltinRules();
  }

  // ─── Rule Management (Hot-Reload API) ───────────────────────────

  /**
   * Register a new rule or update an existing one.
   * This is the hot-reload entry point — call this while the game
   * is running to change how structures are generated.
   */
  registerRule(rule: ArchitectureRule): void {
    const existing = this.rules.get(rule.id);
    const action = existing ? 'updated' : 'added';

    if (existing) {
      rule.version = existing.version + 1;
    }

    this.rules.set(rule.id, rule);
    this.engineVersion++;

    for (const listener of this.onRuleChangedListeners) {
      listener(rule.id, action);
    }
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) {
      this.engineVersion++;
      for (const listener of this.onRuleChangedListeners) {
        listener(ruleId, 'removed');
      }
    }
    return removed;
  }

  /**
   * Hot-reload a rule's generator function without replacing the entire rule.
   * This is the fastest path for live code injection.
   */
  hotReloadGenerator(ruleId: string, newGenerator: RuleGeneratorFn): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;

    rule.generate = newGenerator;
    rule.version++;
    this.engineVersion++;

    for (const listener of this.onRuleChangedListeners) {
      listener(ruleId, 'updated');
    }

    return true;
  }

  /**
   * Get all registered rules.
   */
  getRules(): ArchitectureRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule by ID.
   */
  getRule(ruleId: string): ArchitectureRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Listen for rule changes (for UI/debugging).
   */
  onRuleChanged(listener: (ruleId: string, action: 'added' | 'updated' | 'removed') => void): void {
    this.onRuleChangedListeners.push(listener);
  }

  /**
   * Get current engine version (changes with every rule modification).
   */
  getVersion(): number {
    return this.engineVersion;
  }

  // ─── Blueprint Generation ─────────────────────────────────────────

  /**
   * Generate a blueprint for a structure archetype.
   *
   * This is the main entry point for building. The engine:
   * 1. Finds the best matching rule for the archetype
   * 2. Calls the rule's generator with the provided context
   * 3. Applies ArtDNA colors to the generated blocks
   * 4. Computes build phases and validates structure
   * 5. Returns a complete blueprint ready for construction
   */
  generateBlueprint(ctx: RuleContext): ArchitectureBlueprint | null {
    // Find best rule for this archetype
    const rule = this.findBestRule(ctx.archetype);
    if (!rule) return null;

    // Generate blocks
    const blocks = rule.generate(ctx);
    if (blocks.length === 0) return null;

    // Apply ArtDNA colors
    for (const block of blocks) {
      if (!block.color) {
        applyArtDNAColor(block, ctx.artDNA);
      }
    }

    // Compute metadata
    const counts = computeBlockCounts(blocks);
    const bounds = computeBounds(blocks);
    const phases = computeBuildPhases(blocks);

    // Calculate cultural value
    let culturalValue = 0;
    for (const block of blocks) {
      culturalValue += BLOCK_MATERIAL_CULTURE[block.material] *
        (block.role === 'Decoration' ? 2 : 1);
    }

    const metadata: BlueprintMetadata = {
      ruleVersion: rule.version,
      seed: ctx.seed,
      generatedAt: Date.now(),
      operatorDescription: ctx.description,
      activeRules: [rule.id],
    };

    const blueprint: ArchitectureBlueprint = {
      id: `bp_${ctx.archetype}_${ctx.seed}_${Date.now()}`,
      name: ctx.description ?? `${ctx.archetype} (gen ${ctx.artDNA.generation})`,
      archetype: ctx.archetype,
      bounds,
      blocks,
      blockCounts: counts.byRole,
      materialCounts: counts.byMaterial,
      phases,
      culturalValue,
      structuralIntegrity: 0, // Computed below
      artDNAGeneration: ctx.artDNA.generation,
      metadata,
    };

    // Validate structural integrity
    blueprint.structuralIntegrity = validateBlueprint(blueprint);

    return blueprint;
  }

  /**
   * Generate a blueprint from an operator's natural-language description.
   * Parses the description to determine archetype and parameters.
   */
  generateFromDescription(
    description: string,
    artDNA: ArtDNA,
    seed: number,
    availableBlocks: BlockInventory,
  ): ArchitectureBlueprint | null {
    const parsed = parseOperatorDescription(description);

    const ctx: RuleContext = {
      archetype: parsed.archetype,
      artDNA,
      width: parsed.width,
      height: parsed.height,
      depth: parsed.depth,
      seed,
      availableBlocks,
      description,
      customParams: parsed.customParams,
    };

    return this.generateBlueprint(ctx);
  }

  /**
   * Find the best matching rule for an archetype.
   */
  private findBestRule(archetype: StructureArchetype): ArchitectureRule | null {
    let bestRule: ArchitectureRule | null = null;
    let bestPriority = -Infinity;

    for (const rule of this.rules.values()) {
      if (rule.archetypes.includes(archetype) && rule.priority > bestPriority) {
        bestPriority = rule.priority;
        bestRule = rule;
      }
    }

    // Fall back to Custom archetype rules
    if (!bestRule) {
      for (const rule of this.rules.values()) {
        if (rule.archetypes.includes(StructureArchetype.Custom) && rule.priority > bestPriority) {
          bestPriority = rule.priority;
          bestRule = rule;
        }
      }
    }

    return bestRule;
  }

  // ─── Built-in Rules ───────────────────────────────────────────────

  private registerBuiltinRules(): void {
    this.registerRule(createCottageRule());
    this.registerRule(createHouseRule());
    this.registerRule(createTempleRule());
    this.registerRule(createCathedralRule());
    this.registerRule(createTowerRule());
    this.registerRule(createWarehouseRule());
    this.registerRule(createWallSegmentRule());
  }
}

// ─── Operator Description Parser ────────────────────────────────────

interface ParsedDescription {
  archetype: StructureArchetype;
  width: number;
  height: number;
  depth: number;
  customParams: Record<string, unknown>;
}

/**
 * Parse a natural-language description into generation parameters.
 * Maps keywords to archetypes and extracts dimensional hints.
 */
function parseOperatorDescription(description: string): ParsedDescription {
  const lower = description.toLowerCase();

  // Archetype detection
  let archetype = StructureArchetype.Custom;
  const archetypeKeywords: Array<[string[], StructureArchetype]> = [
    [['cathedral', 'church', 'basilica', 'chapel'], StructureArchetype.Cathedral],
    [['temple', 'shrine', 'parthenon', 'pantheon'], StructureArchetype.Temple],
    [['tower', 'turret', 'spire', 'minaret'], StructureArchetype.Tower],
    [['house', 'home', 'dwelling', 'residence'], StructureArchetype.House],
    [['cottage', 'hut', 'cabin', 'shack'], StructureArchetype.Cottage],
    [['manor', 'mansion', 'palace', 'villa'], StructureArchetype.Manor],
    [['warehouse', 'barn', 'storehouse', 'granary'], StructureArchetype.Warehouse],
    [['wall', 'rampart', 'fortification', 'battlement'], StructureArchetype.WallSegment],
    [['gate', 'gatehouse', 'portal', 'archway'], StructureArchetype.Gatehouse],
    [['market', 'bazaar', 'trading', 'shop'], StructureArchetype.Market],
    [['workshop', 'forge', 'smithy', 'foundry'], StructureArchetype.Workshop],
    [['bridge', 'overpass', 'crossing'], StructureArchetype.Bridge],
  ];

  for (const [keywords, arch] of archetypeKeywords) {
    if (keywords.some(k => lower.includes(k))) {
      archetype = arch;
      break;
    }
  }

  // Size modifiers
  let sizeMultiplier = 1.0;
  if (lower.includes('small') || lower.includes('tiny') || lower.includes('little')) {
    sizeMultiplier = 0.6;
  } else if (lower.includes('large') || lower.includes('big') || lower.includes('grand')) {
    sizeMultiplier = 1.5;
  } else if (lower.includes('massive') || lower.includes('huge') || lower.includes('enormous')) {
    sizeMultiplier = 2.0;
  } else if (lower.includes('monumental') || lower.includes('colossal')) {
    sizeMultiplier = 2.5;
  }

  // Base dimensions by archetype
  const baseDimensions: Record<StructureArchetype, [number, number, number]> = {
    [StructureArchetype.Cottage]: [5, 4, 5],
    [StructureArchetype.House]: [8, 6, 8],
    [StructureArchetype.Manor]: [16, 10, 12],
    [StructureArchetype.Warehouse]: [12, 6, 10],
    [StructureArchetype.Tower]: [5, 15, 5],
    [StructureArchetype.WallSegment]: [12, 5, 2],
    [StructureArchetype.Cathedral]: [20, 18, 40],
    [StructureArchetype.Temple]: [18, 12, 24],
    [StructureArchetype.Market]: [14, 6, 10],
    [StructureArchetype.Workshop]: [8, 5, 8],
    [StructureArchetype.Bridge]: [20, 4, 4],
    [StructureArchetype.Gatehouse]: [8, 10, 6],
    [StructureArchetype.Custom]: [10, 8, 10],
  };

  const [bw, bh, bd] = baseDimensions[archetype];

  // Style modifiers
  const customParams: Record<string, unknown> = {};
  if (lower.includes('gothic')) customParams.style = 'gothic';
  if (lower.includes('roman') || lower.includes('classical')) customParams.style = 'classical';
  if (lower.includes('doric')) customParams.order = 'doric';
  if (lower.includes('ionic')) customParams.order = 'ionic';
  if (lower.includes('fortified') || lower.includes('defensive')) customParams.fortified = true;
  if (lower.includes('ornate') || lower.includes('decorated')) customParams.ornate = true;
  if (lower.includes('flying buttress')) customParams.flyingButtresses = true;
  if (lower.includes('rose window')) customParams.roseWindow = true;
  if (lower.includes('bell tower') || lower.includes('belfry')) customParams.bellTower = true;

  return {
    archetype,
    width: Math.round(bw * sizeMultiplier),
    height: Math.round(bh * sizeMultiplier),
    depth: Math.round(bd * sizeMultiplier),
    customParams,
  };
}

// ─── Seeded Random Helper ───────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── Built-in Rule: Cottage ─────────────────────────────────────────

function createCottageRule(): ArchitectureRule {
  return {
    id: 'builtin:cottage',
    name: 'Simple Cottage',
    archetypes: [StructureArchetype.Cottage],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const rng = seededRandom(ctx.seed);
      const w = ctx.width;
      const d = ctx.depth;
      const wallH = ctx.height * ctx.artDNA.shape.heightScale * 0.6;

      // Foundation
      blocks.push(createBlock(
        BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0, z: 0 },
        { w: w + 1, h: 0.5, d: d + 1 },
        BlockRole.Foundation,
      ));

      // Walls
      const wallThickness = 0.5;
      // Front
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.5, z: d / 2 }, { w, h: wallH, d: wallThickness }, BlockRole.Wall, { face: 'front' }));
      // Back
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.5, z: -d / 2 }, { w, h: wallH, d: wallThickness }, BlockRole.Wall, { face: 'back' }));
      // Left
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: -w / 2, y: 0.5, z: 0 }, { w: wallThickness, h: wallH, d }, BlockRole.Wall, { face: 'left' }));
      // Right
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: w / 2, y: 0.5, z: 0 }, { w: wallThickness, h: wallH, d }, BlockRole.Wall, { face: 'right' }));

      // Door opening
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.5, z: d / 2 }, { w: 1.2, h: 2, d: wallThickness + 0.1 }, BlockRole.Opening));

      // Roof (wedge)
      const roofSteep = ctx.artDNA.shape.roofSteepness;
      const roofH = 1.5 + roofSteep * 2;
      blocks.push(createBlock(BlockShape.Wedge, BlockMaterial.Thatch,
        { x: 0, y: 0.5 + wallH, z: 0 }, { w: w + 1, h: roofH, d: d + 1 }, BlockRole.Roof,
        { orientation: '+X' }));

      // Chimney (if art DNA says so)
      if (ctx.artDNA.decoration.hasChimney) {
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
          { x: w / 2 - 0.5, y: 0.5 + wallH + roofH * 0.5, z: -d / 4 },
          { w: 0.6, h: roofH + 0.5, d: 0.6 }, BlockRole.Decoration, { element: 'chimney' }));
      }

      return blocks;
    },
  };
}

// ─── Built-in Rule: House ───────────────────────────────────────────

function createHouseRule(): ArchitectureRule {
  return {
    id: 'builtin:house',
    name: 'Standard House',
    archetypes: [StructureArchetype.House],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const rng = seededRandom(ctx.seed);
      const w = ctx.width;
      const d = ctx.depth;
      const wallH = ctx.height * ctx.artDNA.shape.heightScale * 0.5;
      const wallMat = ctx.artDNA.shape.detailLevel > 0.5 ? BlockMaterial.Brick : BlockMaterial.Wood;

      // Foundation
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0, z: 0 }, { w: w + 1, h: 0.8, d: d + 1 }, BlockRole.Foundation));

      // Floor
      blocks.push(createBlock(BlockShape.Slab, BlockMaterial.Wood,
        { x: 0, y: 0.8, z: 0 }, { w, h: 0.2, d }, BlockRole.Floor));

      // Walls
      const wt = 0.5;
      blocks.push(createBlock(BlockShape.Cube, wallMat,
        { x: 0, y: 1, z: d / 2 }, { w, h: wallH, d: wt }, BlockRole.Wall, { face: 'front' }));
      blocks.push(createBlock(BlockShape.Cube, wallMat,
        { x: 0, y: 1, z: -d / 2 }, { w, h: wallH, d: wt }, BlockRole.Wall, { face: 'back' }));
      blocks.push(createBlock(BlockShape.Cube, wallMat,
        { x: -w / 2, y: 1, z: 0 }, { w: wt, h: wallH, d }, BlockRole.Wall, { face: 'left' }));
      blocks.push(createBlock(BlockShape.Cube, wallMat,
        { x: w / 2, y: 1, z: 0 }, { w: wt, h: wallH, d }, BlockRole.Wall, { face: 'right' }));

      // Door
      blocks.push(createBlock(BlockShape.Cube, wallMat,
        { x: 0, y: 1, z: d / 2 }, { w: 1.4, h: 2.2, d: wt + 0.1 }, BlockRole.Opening));

      // Windows (if art DNA says so)
      if (ctx.artDNA.decoration.hasWindows) {
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
          { x: -w / 4, y: 2.2, z: d / 2 }, { w: 1, h: 1, d: wt + 0.1 }, BlockRole.Opening, { element: 'window' }));
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
          { x: w / 4, y: 2.2, z: d / 2 }, { w: 1, h: 1, d: wt + 0.1 }, BlockRole.Opening, { element: 'window' }));
      }

      // Roof
      const roofH = 2 + ctx.artDNA.shape.roofSteepness * 3;
      const roofMat = ctx.artDNA.shape.detailLevel > 0.6 ? BlockMaterial.DressedStone : BlockMaterial.Thatch;
      blocks.push(createBlock(BlockShape.Wedge, roofMat,
        { x: 0, y: 1 + wallH, z: 0 }, { w: w + 2, h: roofH, d: d + 2 }, BlockRole.Roof, { orientation: '+X' }));

      // Chimney
      if (ctx.artDNA.decoration.hasChimney) {
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
          { x: w / 3, y: 1 + wallH + roofH * 0.3, z: -d / 3 },
          { w: 0.8, h: roofH + 1, d: 0.8 }, BlockRole.Decoration, { element: 'chimney' }));
      }

      return blocks;
    },
  };
}

// ─── Built-in Rule: Temple (LegoGen Translation) ────────────────────

function createTempleRule(): ArchitectureRule {
  return {
    id: 'builtin:temple',
    name: 'Classical Temple',
    archetypes: [StructureArchetype.Temple],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      /**
       * Direct translation of LegoGen's classical building generator.
       * Uses the same proportional system but parameterized by ArtDNA.
       *
       * LegoGen's order system:
       *   Doric: diameter=1.0, shaft_ratio=5.4, spacing=1.3
       *   Ionic: diameter=0.76, shaft_ratio=9.1, spacing=2.35
       */
      const blocks: Block[] = [];
      const rng = seededRandom(ctx.seed);
      const w = ctx.width;
      const d = ctx.depth;

      // Order selection from ArtDNA
      const isDoric = ctx.artDNA.shape.roundness < 0.5;
      const baseDiameter = isDoric ? 1.0 : 0.76;
      const shaftRatio = isDoric ? 5.4 : 9.1;
      const columnSpacing = isDoric ? 1.3 : 2.35;

      // Scale by ArtDNA
      const diameter = baseDiameter * ctx.artDNA.shape.widthScale;
      const radius = diameter / 2;
      const shaftHeight = diameter * shaftRatio * ctx.artDNA.shape.heightScale;
      const spacing = diameter * columnSpacing;

      // Podium
      const podiumH = 1.5;
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
        { x: 0, y: 0, z: 0 }, { w: w + 2, h: podiumH, d: d + 2 }, BlockRole.Foundation));

      // Stairs (front)
      for (let step = 0; step < 3; step++) {
        blocks.push(createBlock(BlockShape.Stair, BlockMaterial.Stone,
          { x: 0, y: step * 0.5, z: d / 2 + 1 + step * 0.4 },
          { w: w * 0.6, h: 0.5, d: 0.6 }, BlockRole.Access, { element: 'stair_run' }));
      }

      // Columns — front colonnade
      const frontCount = Math.max(4, Math.floor(w / spacing));
      const startX = -(frontCount - 1) * spacing / 2;

      for (let i = 0; i < frontCount; i++) {
        const cx = startX + i * spacing;

        // Column base
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
          { x: cx, y: podiumH, z: d / 2 },
          { w: diameter * 1.3, h: 0.3, d: diameter * 1.3 }, BlockRole.Capital, { element: 'base' }));

        // Column shaft
        blocks.push(createBlock(BlockShape.Cylinder, BlockMaterial.DressedStone,
          { x: cx, y: podiumH + 0.3, z: d / 2 },
          { w: diameter, h: shaftHeight, d: diameter }, BlockRole.Column,
          { radius, height: shaftHeight, sections: 16, element: 'shaft' }));

        // Column capital
        blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
          { x: cx, y: podiumH + 0.3 + shaftHeight, z: d / 2 },
          { w: diameter * 1.4, h: 0.4, d: diameter * 1.4 }, BlockRole.Capital, { element: 'capital' }));
      }

      // Side columns
      const sideCount = Math.max(4, Math.floor(d / spacing));
      const startZ = -(sideCount - 1) * spacing / 2;

      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < sideCount; i++) {
          const cz = startZ + i * spacing;
          const cx = side * w / 2;

          blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
            { x: cx, y: podiumH, z: cz },
            { w: diameter * 1.3, h: 0.3, d: diameter * 1.3 }, BlockRole.Capital, { element: 'base' }));

          blocks.push(createBlock(BlockShape.Cylinder, BlockMaterial.DressedStone,
            { x: cx, y: podiumH + 0.3, z: cz },
            { w: diameter, h: shaftHeight, d: diameter }, BlockRole.Column,
            { radius, height: shaftHeight, sections: 16, element: 'shaft' }));

          blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
            { x: cx, y: podiumH + 0.3 + shaftHeight, z: cz },
            { w: diameter * 1.4, h: 0.4, d: diameter * 1.4 }, BlockRole.Capital, { element: 'capital' }));
        }
      }

      // Entablature (3 layers: architrave, frieze, cornice)
      const entablatureY = podiumH + 0.3 + shaftHeight + 0.4;

      // Architrave
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: entablatureY, z: d / 2 },
        { w: w + 2, h: 0.5, d: 0.8 }, BlockRole.Entablature, { element: 'architrave', face: 'front' }));
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: entablatureY, z: -d / 2 },
        { w: w + 2, h: 0.5, d: 0.8 }, BlockRole.Entablature, { element: 'architrave', face: 'back' }));

      // Frieze
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.DressedStone,
        { x: 0, y: entablatureY + 0.5, z: d / 2 },
        { w: w + 2, h: 0.6, d: 0.7 }, BlockRole.Entablature, { element: 'frieze', face: 'front' }));

      // Cornice
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: entablatureY + 1.1, z: d / 2 },
        { w: w + 3, h: 0.3, d: 1.0 }, BlockRole.Entablature, { element: 'cornice', face: 'front' }));

      // Pediment (front)
      const pedimentY = entablatureY + 1.4;
      const pedimentH = 2 + ctx.artDNA.shape.roofSteepness * 2;
      blocks.push(createBlock(BlockShape.Wedge, BlockMaterial.Stone,
        { x: 0, y: pedimentY, z: d / 2 },
        { w: w + 2, h: pedimentH, d: 1.0 }, BlockRole.Pediment, { orientation: '+X' }));

      // Roof
      blocks.push(createBlock(BlockShape.Wedge, BlockMaterial.Stone,
        { x: 0, y: pedimentY, z: 0 },
        { w: w + 3, h: pedimentH, d: d + 2 }, BlockRole.Roof, { orientation: '+X' }));

      // Cella (inner walls)
      const cellaW = w * 0.7;
      const cellaD = d * 0.7;
      const cellaH = shaftHeight * 0.8;
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: podiumH, z: 0 }, { w: cellaW, h: cellaH, d: 0.5 }, BlockRole.Wall, { face: 'front' }));
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: podiumH, z: -cellaD / 2 }, { w: cellaW, h: cellaH, d: 0.5 }, BlockRole.Wall, { face: 'back' }));

      return blocks;
    },
  };
}

// ─── Built-in Rule: Cathedral ───────────────────────────────────────

function createCathedralRule(): ArchitectureRule {
  return {
    id: 'builtin:cathedral',
    name: 'Grand Cathedral',
    archetypes: [StructureArchetype.Cathedral],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const rng = seededRandom(ctx.seed);
      const w = ctx.width;
      const d = ctx.depth;
      const h = ctx.height;
      const isGothic = (ctx.customParams?.style === 'gothic') || ctx.artDNA.shape.heightScale > 1.5;
      const isOrnate = (ctx.customParams?.ornate === true) || ctx.artDNA.shape.detailLevel > 0.6;

      const mainMat = isOrnate ? BlockMaterial.DressedStone : BlockMaterial.Stone;
      const accentMat = isOrnate ? BlockMaterial.Marble : BlockMaterial.DressedStone;

      // Foundation
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0, z: 0 }, { w: w + 4, h: 1.0, d: d + 4 }, BlockRole.Foundation));

      // Nave walls
      const naveW = w * 0.5;
      const naveH = h * 0.7;
      const wallT = 0.8;

      // Left nave wall
      blocks.push(createBlock(BlockShape.Cube, mainMat,
        { x: -naveW / 2, y: 1, z: 0 }, { w: wallT, h: naveH, d: d }, BlockRole.Wall, { face: 'left' }));
      // Right nave wall
      blocks.push(createBlock(BlockShape.Cube, mainMat,
        { x: naveW / 2, y: 1, z: 0 }, { w: wallT, h: naveH, d: d }, BlockRole.Wall, { face: 'right' }));

      // Nave pillars (interior columns)
      const pillarSpacing = 3;
      const pillarCount = Math.floor(d / pillarSpacing);
      for (let i = 0; i < pillarCount; i++) {
        const pz = -d / 2 + i * pillarSpacing + pillarSpacing / 2;
        for (const side of [-1, 1]) {
          const px = side * naveW / 4;

          blocks.push(createBlock(BlockShape.Cylinder, mainMat,
            { x: px, y: 1, z: pz }, { w: 0.6, h: naveH, d: 0.6 }, BlockRole.Column,
            { radius: 0.3, height: naveH, sections: 12, element: 'nave_pillar' }));

          // Pillar capital
          blocks.push(createBlock(BlockShape.Cube, accentMat,
            { x: px, y: 1 + naveH, z: pz }, { w: 0.9, h: 0.3, d: 0.9 }, BlockRole.Capital));
        }
      }

      // Aisles (lower side naves)
      const aisleW = (w - naveW) / 2;
      const aisleH = naveH * 0.6;
      // Left aisle wall
      blocks.push(createBlock(BlockShape.Cube, mainMat,
        { x: -w / 2, y: 1, z: 0 }, { w: wallT, h: aisleH, d: d }, BlockRole.Wall));
      // Right aisle wall
      blocks.push(createBlock(BlockShape.Cube, mainMat,
        { x: w / 2, y: 1, z: 0 }, { w: wallT, h: aisleH, d: d }, BlockRole.Wall));

      // Nave vault (pointed arch for gothic, barrel for roman)
      if (isGothic) {
        // Gothic pointed arches between pillars
        for (let i = 0; i < pillarCount - 1; i++) {
          const pz = -d / 2 + i * pillarSpacing + pillarSpacing;
          blocks.push(createBlock(BlockShape.Arch, mainMat,
            { x: 0, y: 1 + naveH, z: pz }, { w: naveW, h: 2, d: 0.5 }, BlockRole.Vault,
            { element: 'pointed_arch' }));
        }
      } else {
        // Barrel vault
        blocks.push(createBlock(BlockShape.Arch, mainMat,
          { x: 0, y: 1 + naveH, z: 0 }, { w: naveW, h: 2, d }, BlockRole.Vault,
          { element: 'barrel_vault' }));
      }

      // Roof
      const roofH = 3 + ctx.artDNA.shape.roofSteepness * 4;
      blocks.push(createBlock(BlockShape.Wedge, mainMat,
        { x: 0, y: 1 + naveH + 2, z: 0 }, { w: w + 2, h: roofH, d: d + 2 }, BlockRole.Roof,
        { orientation: '+X' }));

      // Aisle roofs (lower)
      blocks.push(createBlock(BlockShape.Wedge, mainMat,
        { x: -w / 4 - naveW / 4, y: 1 + aisleH, z: 0 },
        { w: aisleW + 1, h: roofH * 0.5, d: d + 1 }, BlockRole.Roof, { orientation: '+X' }));
      blocks.push(createBlock(BlockShape.Wedge, mainMat,
        { x: w / 4 + naveW / 4, y: 1 + aisleH, z: 0 },
        { w: aisleW + 1, h: roofH * 0.5, d: d + 1 }, BlockRole.Roof, { orientation: '-X' }));

      // Front facade
      blocks.push(createBlock(BlockShape.Cube, mainMat,
        { x: 0, y: 1, z: d / 2 }, { w, h: naveH + 3, d: wallT }, BlockRole.Wall, { face: 'front' }));

      // Main entrance (large arch)
      blocks.push(createBlock(BlockShape.Arch, accentMat,
        { x: 0, y: 1, z: d / 2 }, { w: 3, h: 4, d: wallT + 0.1 }, BlockRole.Opening,
        { element: 'main_door' }));

      // Rose window (if ornate or requested)
      if (isOrnate || ctx.customParams?.roseWindow) {
        blocks.push(createBlock(BlockShape.Cylinder, accentMat,
          { x: 0, y: 1 + naveH * 0.7, z: d / 2 + 0.1 },
          { w: 3, h: 0.3, d: 3 }, BlockRole.Decoration,
          { radius: 1.5, height: 0.3, sections: 24, element: 'rose_window' }));
      }

      // Bell towers (if gothic or requested)
      if (isGothic || ctx.customParams?.bellTower) {
        const towerH = h * 1.2;
        for (const side of [-1, 1]) {
          const tx = side * (w / 2 - 1);
          // Tower body
          blocks.push(createBlock(BlockShape.Cube, mainMat,
            { x: tx, y: 1, z: d / 2 }, { w: 3, h: towerH, d: 3 }, BlockRole.Wall,
            { element: 'bell_tower' }));
          // Tower cap
          blocks.push(createBlock(BlockShape.Wedge, mainMat,
            { x: tx, y: 1 + towerH, z: d / 2 }, { w: 3.5, h: 3, d: 3.5 }, BlockRole.Roof,
            { orientation: '+X', element: 'tower_spire' }));
        }
      }

      // Flying buttresses (if gothic or requested)
      if (isGothic || ctx.customParams?.flyingButtresses) {
        for (let i = 0; i < pillarCount; i += 2) {
          const bz = -d / 2 + i * pillarSpacing + pillarSpacing / 2;
          for (const side of [-1, 1]) {
            const bx = side * (naveW / 2 + aisleW / 2);
            // Buttress pier
            blocks.push(createBlock(BlockShape.Cube, mainMat,
              { x: side * w / 2, y: 1, z: bz }, { w: 1, h: aisleH + 2, d: 1 }, BlockRole.Wall,
              { element: 'buttress_pier' }));
            // Flying arch
            blocks.push(createBlock(BlockShape.Arch, mainMat,
              { x: bx, y: 1 + aisleH, z: bz }, { w: aisleW, h: 2, d: 0.5 }, BlockRole.Vault,
              { element: 'flying_buttress' }));
          }
        }
      }

      // Apse (semicircular east end)
      blocks.push(createBlock(BlockShape.Cylinder, mainMat,
        { x: 0, y: 1, z: -d / 2 }, { w: naveW, h: naveH, d: naveW }, BlockRole.Wall,
        { radius: naveW / 2, height: naveH, sections: 12, element: 'apse' }));

      return blocks;
    },
  };
}

// ─── Built-in Rule: Tower ───────────────────────────────────────────

function createTowerRule(): ArchitectureRule {
  return {
    id: 'builtin:tower',
    name: 'Defensive Tower',
    archetypes: [StructureArchetype.Tower],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const w = ctx.width;
      const h = ctx.height * ctx.artDNA.shape.heightScale;
      const isRound = ctx.artDNA.shape.roundness > 0.5;
      const mat = BlockMaterial.Stone;

      // Foundation
      blocks.push(createBlock(BlockShape.Cube, mat,
        { x: 0, y: 0, z: 0 }, { w: w + 2, h: 1, d: w + 2 }, BlockRole.Foundation));

      // Tower body
      if (isRound) {
        blocks.push(createBlock(BlockShape.Cylinder, mat,
          { x: 0, y: 1, z: 0 }, { w, h, d: w }, BlockRole.Wall,
          { radius: w / 2, height: h, sections: 16, element: 'tower_body' }));
      } else {
        // Square tower walls
        const wt = 0.6;
        blocks.push(createBlock(BlockShape.Cube, mat,
          { x: 0, y: 1, z: w / 2 }, { w, h, d: wt }, BlockRole.Wall));
        blocks.push(createBlock(BlockShape.Cube, mat,
          { x: 0, y: 1, z: -w / 2 }, { w, h, d: wt }, BlockRole.Wall));
        blocks.push(createBlock(BlockShape.Cube, mat,
          { x: -w / 2, y: 1, z: 0 }, { w: wt, h, d: w }, BlockRole.Wall));
        blocks.push(createBlock(BlockShape.Cube, mat,
          { x: w / 2, y: 1, z: 0 }, { w: wt, h, d: w }, BlockRole.Wall));
      }

      // Floors
      const floorCount = Math.floor(h / 3);
      for (let f = 1; f < floorCount; f++) {
        blocks.push(createBlock(BlockShape.Slab, BlockMaterial.Wood,
          { x: 0, y: 1 + f * 3, z: 0 }, { w: w - 0.5, h: 0.2, d: w - 0.5 }, BlockRole.Floor));
      }

      // Battlements
      const battlementSize = 0.6;
      const count = Math.floor(w / battlementSize / 2);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const bx = Math.cos(angle) * (w / 2 + 0.1);
        const bz = Math.sin(angle) * (w / 2 + 0.1);
        blocks.push(createBlock(BlockShape.Cube, mat,
          { x: bx, y: 1 + h, z: bz },
          { w: battlementSize, h: 0.8, d: battlementSize }, BlockRole.Decoration,
          { element: 'merlon' }));
      }

      // Door
      blocks.push(createBlock(BlockShape.Arch, BlockMaterial.Iron,
        { x: 0, y: 1, z: w / 2 }, { w: 1.5, h: 2.5, d: 0.7 }, BlockRole.Opening,
        { element: 'door' }));

      return blocks;
    },
  };
}

// ─── Built-in Rule: Warehouse ───────────────────────────────────────

function createWarehouseRule(): ArchitectureRule {
  return {
    id: 'builtin:warehouse',
    name: 'Storage Warehouse',
    archetypes: [StructureArchetype.Warehouse, StructureArchetype.Market],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const w = ctx.width;
      const d = ctx.depth;
      const wallH = ctx.height * 0.5;

      // Foundation
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0, z: 0 }, { w: w + 1, h: 0.6, d: d + 1 }, BlockRole.Foundation));

      // Walls
      const wt = 0.6;
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.6, z: d / 2 }, { w, h: wallH, d: wt }, BlockRole.Wall));
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.6, z: -d / 2 }, { w, h: wallH, d: wt }, BlockRole.Wall));
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: -w / 2, y: 0.6, z: 0 }, { w: wt, h: wallH, d }, BlockRole.Wall));
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: w / 2, y: 0.6, z: 0 }, { w: wt, h: wallH, d }, BlockRole.Wall));

      // Large door
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Wood,
        { x: 0, y: 0.6, z: d / 2 }, { w: 3, h: wallH - 0.5, d: wt + 0.1 }, BlockRole.Opening));

      // Interior support beams
      const beamCount = Math.floor(d / 3);
      for (let i = 1; i < beamCount; i++) {
        const bz = -d / 2 + i * (d / beamCount);
        blocks.push(createBlock(BlockShape.Beam, BlockMaterial.Wood,
          { x: 0, y: 0.6 + wallH, z: bz }, { w, h: 0.3, d: 0.3 }, BlockRole.Beam));
      }

      // Roof
      blocks.push(createBlock(BlockShape.Wedge, BlockMaterial.Thatch,
        { x: 0, y: 0.6 + wallH, z: 0 }, { w: w + 2, h: 2, d: d + 2 }, BlockRole.Roof,
        { orientation: '+X' }));

      return blocks;
    },
  };
}

// ─── Built-in Rule: Wall Segment ────────────────────────────────────

function createWallSegmentRule(): ArchitectureRule {
  return {
    id: 'builtin:wall_segment',
    name: 'Fortification Wall',
    archetypes: [StructureArchetype.WallSegment, StructureArchetype.Gatehouse],
    priority: 10,
    version: 1,
    generate: (ctx: RuleContext): Block[] => {
      const blocks: Block[] = [];
      const w = ctx.width;
      const h = ctx.height;
      const isGatehouse = ctx.archetype === StructureArchetype.Gatehouse;

      // Foundation
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0, z: 0 }, { w: w + 1, h: 0.8, d: 3 }, BlockRole.Foundation));

      // Wall body
      blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
        { x: 0, y: 0.8, z: 0 }, { w, h, d: 2 }, BlockRole.Wall));

      // Gatehouse arch
      if (isGatehouse) {
        blocks.push(createBlock(BlockShape.Arch, BlockMaterial.DressedStone,
          { x: 0, y: 0.8, z: 0 }, { w: 3, h: h * 0.7, d: 2.5 }, BlockRole.Opening,
          { element: 'gate_arch' }));
      }

      // Battlements
      const merlonCount = Math.floor(w / 1.2);
      for (let i = 0; i < merlonCount; i++) {
        if (i % 2 === 0) {
          const mx = -w / 2 + i * (w / merlonCount) + 0.6;
          blocks.push(createBlock(BlockShape.Cube, BlockMaterial.Stone,
            { x: mx, y: 0.8 + h, z: 0 }, { w: 0.6, h: 0.8, d: 2.2 }, BlockRole.Decoration,
            { element: 'merlon' }));
        }
      }

      // Walkway
      blocks.push(createBlock(BlockShape.Slab, BlockMaterial.Stone,
        { x: 0, y: 0.8 + h - 0.3, z: 0 }, { w, h: 0.3, d: 1.5 }, BlockRole.Floor,
        { element: 'wall_walk' }));

      return blocks;
    },
  };
}
