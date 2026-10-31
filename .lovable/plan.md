# Audit NANKANG (lecture seule, aucune modification)

## Constat
- Base, réglages des marques (tire_brand_tiers) : aucune ligne NANKANG. La marque n'est donc pas classée par DDA.
- Base, catalogue local (tire_offers) : aucune offre NANKANG.
- Code : aucun classement écrit en dur. NANKANG apparaît seulement dans la liste de suggestions de saisie (src/lib/tire-brands.ts), qui ne donne aucune gamme.
- Aucune valeur par défaut ni migration ne classe NANKANG.

## Ordre de priorité appliqué
1. Réglage DDA (tire_brand_tiers, marque active) : absent pour NANKANG.
2. Marque réglée mais désactivée : aucune gamme. Ne s'applique pas ici.
3. Gamme donnée par le fournisseur :
   - CentralePneus : discount = Entrée, quality = Milieu, premium = Haut (mode Top prix seulement) ;
   - Districash : gamme du portail.
4. Sinon : marque exclue de Top prix et signalée « marque non classée ». En mode fournisseur, la marque n'est retenue que si l'offre porte une gamme vérifiée.

## Ce qui ne peut pas être vérifié
- Gamme CentralePneus de NANKANG : aucun pneu NANKANG n'est apparu en 205/55 R16, et le filtre de marque n'a pas été trouvé dans la page. Ce n'est donc pas confirmé.
- Gamme Districash de NANKANG : le portail n'a pas été interrogé (lecture seule, aucun appel fournisseur).
- La gamme réelle de NANKANG dépend donc, à chaque recherche, de ce que la source renvoie. Sans gamme renvoyée, la marque est exclue et signalée.

## Suite possible (non engagée)
Ajouter NANKANG dans Paramètres > Chiffrage & pneumatiques, avec la gamme choisie par vous, pour fixer son classement.
