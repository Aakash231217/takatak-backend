export interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  diamondValue: number;
}

/**
 * Hardcoded gift catalog.
 * Each gift costs 10 coins and generates 10 diamonds for the host.
 */
export const GIFT_CATALOG: GiftItem[] = [
  { id: 'rose', name: 'Rose', emoji: '🌹', coinCost: 10, diamondValue: 10 },
  { id: 'heart', name: 'Heart', emoji: '❤️', coinCost: 10, diamondValue: 10 },
  { id: 'star', name: 'Star', emoji: '⭐', coinCost: 10, diamondValue: 10 },
  { id: 'crown', name: 'Crown', emoji: '👑', coinCost: 10, diamondValue: 10 },
  { id: 'diamond', name: 'Diamond', emoji: '💎', coinCost: 10, diamondValue: 10 },
  { id: 'teddy', name: 'Teddy Bear', emoji: '🧸', coinCost: 10, diamondValue: 10 },
  { id: 'cake', name: 'Cake', emoji: '🎂', coinCost: 10, diamondValue: 10 },
  { id: 'kiss', name: 'Kiss', emoji: '💋', coinCost: 10, diamondValue: 10 },
];

export const GIFT_MAP = new Map(GIFT_CATALOG.map((g) => [g.id, g]));
