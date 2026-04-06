# ORDER66 — Visual Specification

> Comment atteindre le niveau Gather.town, avec un monde qui scale tout seul.
> Remplace la section "Visual Layer" de ORDER66-SPEC.md.

---

## 1. Standards Visuels (alignés sur Gather)

| Paramètre | Gather.town | Order66 |
|-----------|------------|---------|
| Tile size | 32×32 | **32×32** |
| Character size | 32×48 | **32×48** (plus grand que le tile = effet de profondeur) |
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

### Assets nécessaires

~50 petits PNGs en niveaux de gris, tous sur la **même grille d'animation** :

```
Grille par layer : 4 directions × 4 frames = 16 frames
Frame size : 32×48 pixels
Sheet size : 128×192 pixels par layer variant

body/body_0.png ... body_7.png          (8 fichiers)
hair/hair_0.png ... hair_15.png         (16 fichiers)
shirt/shirt_0.png ... shirt_7.png       (8 fichiers)
pants/pants_0.png ... pants_3.png       (4 fichiers)
accessory/acc_0.png ... acc_11.png      (12 fichiers)
                                    Total: ~48 fichiers, <1MB
```

Tous en grayscale → `sprite.tint = couleur` à runtime = variation infinie.

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
| **Walking** | Walk cycle 4 frames dans la direction du mouvement |
| **Idle** | Même que active mais sprite légèrement assombri (alpha 0.7) |
| **Sleeping** | Sprite très assombri (alpha 0.4) + "zzz" particle au-dessus |

---

## 3. Office System — Scale autonome

### Principe : les offices grandissent avec le nombre d'agents

Pas de layout fixe. L'office se **génère procéduralement** basé sur le nombre d'agents.

### Algorithme de génération

**Étape 1 — Room layout (BSP)**

```
Si ≤ 4 agents : 1 seule room (open space)
Si 5-6 agents : 2 zones (workspace + meeting nook)
Si 7-8 agents : 3 rooms (workspace + meeting room + break area) connectées par couloir
```

BSP tree : subdiviser le rectangle total en rooms rectangulaires.

**Étape 2 — Furniture placement (contraintes)**

Ordre de placement :
1. **Porte** (côté bas du rectangle principal)
2. **Couloir** (flood-fill depuis la porte, réserver 1 tile de large)
3. **Desks** sur les murs opposés à la porte (2×3 tiles par workstation : desk + chair space)
4. **Meeting table** dans la room meeting (si ≥5 agents)
5. **Kitchen counter / machine à café** dans break area (si ≥7 agents)
6. **Plantes, étagères, déco** dans les coins et espaces restants

Contraintes :
- Chaque desk doit être accessible depuis le couloir (pathfind)
- Min 1 tile de passage entre les meubles
- Plantes uniquement dans les coins ou contre les murs
- Whiteboard sur le mur de la meeting room

**Étape 3 — Détails (déco)**

Remplir les espaces vides avec :
- Tapis (zone meeting)
- Petites peintures sur les murs
- Horloges
- Poubelles près des portes
- Variété de sols (bois pour l'espace principal, moquette pour le meeting)

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

## 6. Assets à Créer

### Phase 1 : Utiliser les assets pixel-agents (déjà téléchargés)

Ce qu'on a → ce qu'on en fait :

| Asset pixel-agents | Usage dans Order66 |
|-------------------|-------------------|
| furniture/DESK | Workstation |
| furniture/PC | Écran sur le desk |
| furniture/CUSHIONED_CHAIR | Chaise devant le desk |
| furniture/WHITEBOARD | Meeting room |
| furniture/COFFEE | Break area |
| furniture/SOFA | Meeting area |
| furniture/BOOKSHELF | Déco |
| furniture/PLANT, LARGE_PLANT, HANGING_PLANT, CACTUS | Déco |
| furniture/SMALL_TABLE, COFFEE_TABLE | Meeting |
| characters/char_0 → char_5 | Personnages temporaires (6 uniques) |
| floors/floor_0 → floor_8 | Sols variés |
| walls/wall_0 | Murs |

### Phase 2 : Créer les character layers (unique characters)

Besoin : **48 PNGs grayscale** sur grille 32×48, 4 directions × 4 frames.

Options :
1. **Dessiner dans Figma** (tu as le MCP figma-console)
2. **Adapter le LPC generator** (open source, GPL — attention à la licence)
3. **Commander sur Fiverr** (~$50-100 pour un set complet)
4. **Utiliser les char_0→5 comme placeholder** et scaler avec color tinting en attendant

**Recommandation : Option 4 maintenant (color tinting des 6 existants = 6×16 = 96 variantes), Option 1 ou 3 pour la v1 publique.**

---

## 7. Ce qui Change dans les Milestones

### M2 (actuel) → M2.5 (upgrade visuel)

| Avant (M2 actuel) | Après (M2.5) |
|-------------------|-------------|
| Office layout fixe 24×18 | Procédural selon nombre d'agents |
| 6 character sprites | 6 × color tinting = 96 variantes |
| PixiJS Text pour noms | HTML overlay pour noms + bubbles |
| Pas de zoom | pixi-viewport zoom world ↔ office |
| Pas de world map | Bâtiments en zoom-out |

### Effort estimé M2.5 : 5-7 jours

1. Jour 1-2 : Office procédural (BSP + furniture constraints)
2. Jour 3 : Character color tinting + HTML label overlay
3. Jour 4 : World map (bâtiments, spiral layout, zoom)
4. Jour 5 : Mini-map + polish
5. Jour 6-7 : Zoom transitions + caching performance

---

*Le monde grandit tout seul. Chaque agent est unique. Le spectateur zoome d'un campus à un bureau.*
