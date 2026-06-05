# Consumables

Consumables live in the Tab inventory under **Consumables**. One click selects
the active consumable for the `Z` hotkey. Double-click uses direct consumables
from the menu; throwable consumables are selected in the menu and thrown with
`Z`.

## Items

- `heal-potion`: restores one heart immediately. Does not consume if health is full.
- `mana-potion`: restores two mana orbs immediately. Does not consume if mana is full.
- `food-apple`, `food-fish`, `food-meat`: consumed immediately, then restore `1 HP` after `10s`.
- `food-pie`: consumed immediately, then restores `1 HP` and `1 mana` after `10s`.
- `dynamite`: selected in Tab and thrown with `Z`; it cannot be double-click consumed.

Food and pie can be wasted if the delayed restore resolves while the player is
already full.

## Sources

- Product market: apples, fish, rabbit meat, and pies.
- Alchemy shop: health potions, mana potions, and dynamite.
- Dead rabbits drop one `food-meat` pickup.

## Dynamite

Dynamite is a short-range thrown consumable. It explodes after a `1.8s` fuse,
damages all actors in range including the player, and pushes nearby physics
objects such as stones. Explosion strength falls off with distance from each
target volume.
