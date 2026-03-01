/**
 * Block Type System — The fundamental building unit of the Augmented Survival world.
 *
 * Blocks bridge the gap between raw resources and architecture. Every structure
 * in the world is composed of typed, material blocks that agents assemble
 * according to architectural rules.
 *
 * This mirrors the LegoGen/Blocks system (CUBE, WEDGE, CYLINDER) but extends
 * it with game-world materials and an economy loop:
 *
 *   Mine Resources → Refine into Block Materials → Craft Blocks → Assemble Structures
 *
 * Each block has a shape (geometry), a material (what it's made of), and
 * placement data (where it goes in a blueprint).
 */

import type { ResourceType } from './resources';

// ─── Block Shapes ───────────────────────────────────────────────────

/**
 * Geometric shape of a block. Mirrors the LegoGen block_type system
 * and adds architectural primitives for richer construction.
 */
export enum BlockShape {
  /** Rectangular prism — walls, floors, foundations */
  Cube = 'Cube',
  /** Triangular prism — roofs, ramps, buttresses */
  Wedge = 'Wedge',
  /** Circular prism — columns, pillars, towers */
  Cylinder = 'Cylinder',
  /** Half-circle arch — doorways, windows, vaults */
  Arch = 'Arch',
  /** Thin horizontal span — floors, bridges, lintels */
  Slab = 'Slab',
  /** Thin vertical span — beams, supports, frames */
  Beam = 'Beam',
  /** Decorative cap — column capitals, finials, cornices */
  Cap = 'Cap',
  /** Staircase unit — access between levels */
  Stair = 'Stair',
}

// ─── Block Materials ────────────────────────────────────────────────

/**
 * What a block is made of. Determines visual appearance, structural
 * strength, and resource cost.
 */
export enum BlockMaterial {
  /** Basic wood — cheap, fast, low durability */
  Wood = 'Wood',
  /** Rough stone — moderate cost, good durability */
  Stone = 'Stone',
  /** Cut/dressed stone — expensive, excellent durability, beautiful */
  DressedStone = 'DressedStone',
  /** Iron — structural reinforcement, very strong */
  Iron = 'Iron',
  /** Gold — decorative, high cultural value */
  Gold = 'Gold',
  /** Brick — fired clay, moderate cost, warm aesthetic */
  Brick = 'Brick',
  /** Thatch — roofing, very cheap */
  Thatch = 'Thatch',
  /** Marble — prestigious, highest cultural value */
  Marble = 'Marble',
}

/**
 * Resource cost to refine one block of this material.
 * The refining process converts raw resources into usable blocks.
 */
export const BLOCK_MATERIAL_COSTS: Record<BlockMaterial, Partial<Record<ResourceType, number>>> = {
  [BlockMaterial.Wood]: { Wood: 2 },
  [BlockMaterial.Stone]: { Stone: 2 },
  [BlockMaterial.DressedStone]: { Stone: 3, Gold: 1 },
  [BlockMaterial.Iron]: { Iron: 2 },
  [BlockMaterial.Gold]: { Gold: 3 },
  [BlockMaterial.Brick]: { Stone: 1, Wood: 1 },
  [BlockMaterial.Thatch]: { Wood: 1 },
  [BlockMaterial.Marble]: { Stone: 4, Gold: 2 },
};

/**
 * Structural strength of each material (higher = can support more weight).
 * Used by the rule engine to validate structural integrity.
 */
export const BLOCK_MATERIAL_STRENGTH: Record<BlockMaterial, number> = {
  [BlockMaterial.Wood]: 3,
  [BlockMaterial.Stone]: 7,
  [BlockMaterial.DressedStone]: 9,
  [BlockMaterial.Iron]: 10,
  [BlockMaterial.Gold]: 2,
  [BlockMaterial.Brick]: 6,
  [BlockMaterial.Thatch]: 1,
  [BlockMaterial.Marble]: 8,
};

/**
 * Cultural value multiplier for each material.
 * Prestigious materials contribute more to the art economy.
 */
export const BLOCK_MATERIAL_CULTURE: Record<BlockMaterial, number> = {
  [BlockMaterial.Wood]: 0.5,
  [BlockMaterial.Stone]: 1.0,
  [BlockMaterial.DressedStone]: 2.0,
  [BlockMaterial.Iron]: 0.8,
  [BlockMaterial.Gold]: 4.0,
  [BlockMaterial.Brick]: 1.2,
  [BlockMaterial.Thatch]: 0.3,
  [BlockMaterial.Marble]: 5.0,
};

// ─── Block Instance ─────────────────────────────────────────────────

/**
 * A single block in the world — the atomic unit of construction.
 *
 * Mirrors LegoGen's Block dataclass:
 *   position, block_type, color, dimensions, parameters
 *
 * But adds material, structural role, and construction state.
 */
export interface Block {
  /** Unique ID within a blueprint or structure */
  id: number;

  /** Geometric shape */
  shape: BlockShape;

  /** Material composition */
  material: BlockMaterial;

  /** Position relative to structure origin (local space) */
  position: { x: number; y: number; z: number };

  /** Dimensions [width, height, depth] — defaults to [1, 1, 1] */
  dimensions: { w: number; h: number; d: number };

  /** Shape-specific parameters (mirrors LegoGen's parameters dict) */
  parameters: BlockParameters;

  /** RGBA color override (null = use material default) */
  color: { r: number; g: number; b: number; a: number } | null;

  /** Structural role — what this block does in the building */
  role: BlockRole;
}

/**
 * Shape-specific parameters. Maps directly to LegoGen's parameters dict.
 */
export interface BlockParameters {
  /** Wedge orientation: +X, -X, +Z, -Z */
  orientation?: '+X' | '-X' | '+Z' | '-Z';
  /** Cylinder radius */
  radius?: number;
  /** Cylinder height */
  height?: number;
  /** Cylinder segments (default 16) */
  sections?: number;
  /** Architectural element identifier */
  element?: string;
  /** Which face this block belongs to */
  face?: 'front' | 'back' | 'left' | 'right';
}

/**
 * What structural/architectural role a block plays.
 * Used by the rule engine for validation and by art DNA for styling.
 */
export enum BlockRole {
  /** Load-bearing foundation */
  Foundation = 'Foundation',
  /** Vertical load-bearing wall */
  Wall = 'Wall',
  /** Vertical structural column */
  Column = 'Column',
  /** Horizontal spanning beam */
  Beam = 'Beam',
  /** Roof structure */
  Roof = 'Roof',
  /** Floor/ceiling slab */
  Floor = 'Floor',
  /** Doorway or window opening */
  Opening = 'Opening',
  /** Decorative non-structural element */
  Decoration = 'Decoration',
  /** Stairs/ramp for access */
  Access = 'Access',
  /** Arch or vault structure */
  Vault = 'Vault',
  /** Column capital or base */
  Capital = 'Capital',
  /** Entablature / cornice */
  Entablature = 'Entablature',
  /** Pediment / gable */
  Pediment = 'Pediment',
}

// ─── Structure Type ─────────────────────────────────────────────────

/**
 * High-level structure archetypes that an agent can attempt to build.
 * These map to generator functions in the ArchitectureRuleEngine.
 */
export enum StructureArchetype {
  /** Small dwelling — 1-2 rooms */
  Cottage = 'Cottage',
  /** Standard house — multiple rooms */
  House = 'House',
  /** Large manor or villa */
  Manor = 'Manor',
  /** Storage warehouse */
  Warehouse = 'Warehouse',
  /** Defensive tower */
  Tower = 'Tower',
  /** Defensive wall segment */
  WallSegment = 'WallSegment',
  /** Religious/cultural building — the big one */
  Cathedral = 'Cathedral',
  /** Classical temple (connects to LegoGen's classical generator) */
  Temple = 'Temple',
  /** Market or trading hall */
  Market = 'Market',
  /** Workshop or forge */
  Workshop = 'Workshop',
  /** Bridge structure */
  Bridge = 'Bridge',
  /** Gatehouse with archway */
  Gatehouse = 'Gatehouse',
  /** Custom — defined entirely by injected rules */
  Custom = 'Custom',
}
