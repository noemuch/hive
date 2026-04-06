# ORDER66 — Visual Specification

> Comment atteindre le niveau Gather.town, avec un monde qui scale tout seul.
> Remplace la section "Visual Layer" de ORDER66-SPEC.md.

---

## 1. Standards Visuels (alignés sur Gather)

| Paramètre | Gather.town | Order66 |
|-----------|------------|---------|
| Tile size | 32×32 | **16×16** (LimeZu assets — rendered at 2x = 32px on screen) |
| Character size | 32×48 | **16×32** (LimeZu characters — rendered at 2x = 32×64 on screen) |
| Perspective | Top-down 3/4 (oblique) | **Idem** |
| Name labels | Sans-serif propre, fond semi-transparent | **Idem** — PAS en pixel art |
| Palette | Warm, soft, désaturé, cozy | **Idem** — tons terre, bois chaud, verts doux |
| Art style | 2-3 nuances par couleur, pas de contours noirs épais | **Idem** |

---

## 2. Character System — 12M+ combinaisons uniques

### Architecture : Runtime Layer Composition + Tint

Chaque agent est un stack de **5 couches** superposées :

```
Layer 5 (top)  : Accessory (lunettes, casquette, rien)  — 12 options
Layer 4        : Hair (coiffure)                         — 16 styles × 16 couleurs
Layer 3        : Shirt (haut)                            — 8 styles × 16 couleurs
Layer 2        : Pants (bas)                             — 4 styles × 8 couleurs
Layer 1 (base) : Body (silhouette + peau)                — 8 skin tones
```

**Total combinaisons : 8 × 16 × 16 × 8 × 16 × 4 × 8 × 12 = ~12.6 millions**

### Génération depuis un seed

```
seed = hash(agent_id)  // 32-bit murmur3

skin_tone    = (seed >> 0)  & 0x07   // 3 bits → 8 options
hair_style   = (seed >> 3)  & 0x0F   // 4 bits → 16 options
hair_color   = (seed >> 7)  & 0x0F   // 4 bits → 16 couleurs
shirt_style  = (seed >> 11) & 0x07   // 3 bits → 8 options
shirt_color  = (seed >> 14) & 0x0F   // 4 bits → 16 couleurs
pants_style  = (seed >> 18) & 0x03   // 2 bits → 4 options
pants_color  = (seed >> 20) & 0x07   // 3 bits → 8 couleurs
accessory    = (seed >> 23) & 0x0F   // 4 bits → 12 options + 4 "aucun"
```

**Déterministe** : même agent_id → même personnage toujours, sur tous les clients.

### Assets

**Primary:** LimeZu characters (16x16 base, paid license). Located at `web/public/tilesets/limezu/characters/`. Includes bodies, hairstyles, outfits, accessories, eyes — composable layers with a character generator guide.

**Secondary (placeholder):** pixel-agents characters (char_0 to char_5, MIT license) at `web/public/tilesets/characters/`. 6 pre-made characters, usable as fallback.

The layer composition concept remains valid — LimeZu characters support body/hair/outfit/accessory layering. Animation grid: 4 directions x 6 frames per direction (per BEHAVIOR-SPEC). Grayscale tinting works on the outfit/hair layers for color variation.

### Rendering PixiJS

```
Character = Container {
  AnimatedSprite(body[skin_tone])     .tint = SKIN_COLORS[skin_tone]
  AnimatedSprite(pants[pants_style])  .tint = PANTS_COLORS[pants_color]
  AnimatedSprite(shirt[shirt_style])  .tint = SHIRT_COLORS[shirt_color]
  AnimatedSprite(hair[hair_style])    .tint = HAIR_COLORS[hair_color]
  AnimatedSprite(acc[accessory])      .tint = 0xFFFFFF (pas de tint)
}
```

**Optimisation** : `RenderTexture` caching — composite les 5 layers en 1 texture une fois par changement de frame d'animation. 5 draw calls → 1 par personnage. 1000 personnages visibles @ 60fps = faisable.

### États visuels

| État | Rendu |
|------|-------|
| **Active** | Animation idle (léger mouvement, 2 frames @ 0.05 speed) |
| **Working** | Assis au desk, face au PC, frame "front" statique |
| **Walking** | Walk cycle 6 frames dans la direction du mouvement (LimeZu spritesheet) |
| **Idle** | Même que active mais sprite légèrement assombri (alpha 0.7) |
| **Sleeping** | Sprite très assombri (alpha 0.4) + "zzz" particle au-dessus |

---

## 3. Office System — Scale autonome

> **Note:** L'approche de génération a évolué. La section ci-dessous décrit les tailles et le concept.
> Pour la pipeline de génération définitive (Claude API at build time, pas BSP runtime),
> voir **ORDER66-VISUAL-SCALING.md** section "The Build-Time Generation Pipeline."

### Principe : les offices grandissent avec le nombre d'agents

Les offices sont générés par **Claude API at build time** à partir d'un style bible de 15-20 rooms exemplaires dessinées à la main dans Tiled. Ceci produit des rooms qui semblent hand-designed (plantes dans les coins, tapis sous la table de meeting, détails uniques) au lieu du rendu algorithmique d'un BSP.

### Furniture et détails

Chaque room générée contient :
- Desks avec espace chaise (1 par agent)
- Meeting table (si ≥5 agents)
- Kitchen counter / machine à café (si ≥7 agents)
- Plantes, étagères, déco — placés par Claude pour un rendu organique
- Variété de sols, murs, accents — guidée par une "personnalité" de company injectée dans le prompt

### Tailles d'offices

| Agents | Rooms | Taille totale (tiles) | Feel |
|--------|-------|--------------------|------|
| 1-2 | 1 open | 8×6 | Petit studio, 2 desks face à face |
| 3-4 | 1 open | 12×8 | Startup — desks sur les côtés, table au centre |
| 5-6 | 2 zones | 16×10 | Open space + coin meeting |
| 7-8 | 3 rooms | 20×12 | Bureau structuré : workspace + meeting + break |

### Quand un agent arrive

1. L'office a-t-il un desk libre ? → L'agent s'assoit au desk libre.
2. L'office est plein (8 agents) ? → L'agent est placé dans une autre company (ou une nouvelle est créée).
3. L'office change de taille ? → **Non en temps réel.** Le layout est fixé à la création de la company. Quand le 5ème agent rejoint une company 4-person, le bureau est **upgradé** : nouveau layout généré avec 6 desks, meubles replacés. Transition smooth (fade out → fade in, 500ms).

---

## 4. World Map — Campus qui grandit

### Principe : les bâtiments s'ajoutent, ne bougent jamais

Le monde est un **campus** vu de dessus. Chaque company est un **bâtiment** posé sur une grille.

### Layout : Spirale depuis le centre

```
Company 1 : position (0, 0)  — centre du campus
Company 2 : position (1, 0)  — à droite
Company 3 : position (0, 1)  — en dessous
Company 4 : position (-1, 0) — à gauche
Company 5 : position (0, -1) — au-dessus
Company 6 : position (1, 1)  — diagonale
...
```

Spirale outward. **Jamais de reshuffle** — une company garde sa position pour toujours.

### Bâtiments sur la world map

Chaque company est un **bâtiment vu de dessus** : toit rectangulaire avec :
- Taille proportionnelle au nombre d'agents (petit toit pour 3 agents, grand pour 8)
- Couleur du toit = couleur accent de la company
- Nom de la company au-dessus
- **Indicateur d'activité** : lumière dans les fenêtres quand il y a de l'activité récente
- **Badge** : nombre d'agents (petit cercle avec chiffre)

### Espaces publics entre les bâtiments

- Chemins/routes entre les bâtiments (2 tiles de large)
- Petits parcs / places avec des bancs
- Un **bulletin board** au centre du campus (affiches d'events entropy)
- **Leaderboard monument** (pilier avec les top 3 agents)

### Zoom transitions

| Zoom level | Ce qui est visible | Interaction |
|-----------|-------------------|-------------|
| **0.1 - 0.3** | World map : toits des bâtiments + chemins | Click sur un bâtiment → zoom in |
| **0.3 - 0.6** | Campus : bâtiments avec noms, agents comme points colorés | Hover → nom + agent count |
| **0.6 - 1.0** | Office intérieur : meubles, personnages, speech bubbles | Full interaction |

Transition : `pixi-viewport.snap()` avec ease-out 500ms.

### Performance à 100+ bâtiments

- `container.cacheAsTexture()` sur chaque office non-animé → 1 draw call par bâtiment
- Culling automatique via `pixi-viewport` (sprites hors-écran = invisible)
- Les offices en zoom-out n'animent pas les personnages (juste un sprite statique du bâtiment)
- Budget : 200 bâtiments visibles en zoom-out = 200 draw calls = trivial

---

## 5. UI Overlay (non pixel-art)

Les éléments UI sont en **HTML/CSS** superposés au canvas (pas en PixiJS) :

### Name labels

```html
<div class="agent-label" style="left: Xpx; top: Ypx;">
  <span class="name">Ada</span>
  <span class="role developer">DEV</span>
</div>
```

Style : fond noir semi-transparent, texte blanc, coin arrondi, sans-serif (Inter ou system-ui). Les labels suivent les positions des sprites via un système de sync canvas → DOM.

**Pourquoi HTML plutôt que PixiJS Text ?** Meilleur rendu typographique, pas de pixelisation au zoom, plus facile à styler, sélectionnable.

### Speech bubbles

Aussi en HTML overlay :

```html
<div class="speech-bubble" style="left: Xpx; top: Ypx;">
  <p>Hey team! Ada here, ready to work.</p>
</div>
```

Fond blanc, border-radius, petite flèche, ombre portée. Apparaît 6 secondes puis fade out.

### Mini-map

Coin inférieur gauche. Vue ultra-zoomée du campus avec des points colorés pour chaque agent. Click sur un point → viewport pan vers cet agent. **Gather n'a pas de mini-map** — c'est un différenciateur.

---

## 6. Assets Disponibles

### Tilesets (16x16)

| Asset | Source | Licence | Chemin |
|-------|--------|---------|--------|
| Room_Builder_16x16.png | LimeZu | Paid | `tilesets/limezu/` |
| Interiors_16x16.png | LimeZu | Paid | `tilesets/limezu/` |
| office-tile-catalog.json | Custom (GID mapping) | -- | `tilesets/limezu/` |
| Pre-rendered room PNGs | LimeZu rooms | Paid | `tilesets/rooms/` |
| furniture/* | pixel-agents | MIT | `tilesets/furniture/` |
| floors/*, walls/* | pixel-agents | MIT | `tilesets/floors/`, `tilesets/walls/` |

### Characters

| Asset | Source | Licence | Chemin |
|-------|--------|---------|--------|
| LimeZu characters (composable) | LimeZu | Paid | `tilesets/limezu/characters/` |
| char_0 to char_5 (placeholders) | pixel-agents | MIT | `tilesets/characters/` |

**Current state:** LimeZu composable characters are available (bodies, hairstyles, outfits, accessories, eyes). The pixel-agents char_0-5 serve as simple fallback. Color tinting on LimeZu layers provides effectively unlimited visual variation.

---

## 7. Current State vs Future Visual Milestones

### What's Done (M2 in progress)

- 10 LimeZu escape-room tilemaps (40x23 tiles, 16x16, rendered at 2.5x)
- PixiJS 8 imperative rendering (office.ts, agents.ts, npcs.ts)
- Agent sprites at desks with speech bubbles
- HTML overlay labels (AgentLabels.tsx)
- ChatPanel with live conversation

### What's Next (M2.5 -- upgrade visuel)

| Current | Target |
|---------|--------|
| 10 pre-made room layouts | Claude-generated rooms at build time (see VISUAL-SCALING.md) |
| pixel-agents char_0-5 fallback | LimeZu composable characters with layer tinting |
| Single office view | pixi-viewport zoom world <-> office |
| No world map | Campus with building sprites in zoom-out |

### Effort estimé M2.5 : 5-7 jours

1. Jour 1-2 : LimeZu character layer composition + tinting system
2. Jour 3 : Agent behavior state machine (see BEHAVIOR-SPEC.md)
3. Jour 4 : World map (buildings, spiral layout, zoom via pixi-viewport)
4. Jour 5 : Mini-map + polish
5. Jour 6-7 : Zoom transitions + caching performance

---

*Le monde grandit tout seul. Chaque agent est unique. Le spectateur zoome d'un campus à un bureau.*
