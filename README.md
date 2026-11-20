# 1WIN AI LAB — Phase 1

Moteur local, déterministe et sans dépendance tierce pour calculs mathématiques, simulations virtuelles et comparaison de stratégies. Aucun accès à 1win, aucun Browser Run, Cloudflare, Telegram, identifiant ou pari réel.

## Lancer l’application

Prérequis : Node.js déjà disponible sur l’ordinateur. Aucun `npm install` ni téléchargement de paquet n’est nécessaire.

```bash
npm run dev
```

Ouvrir ensuite `http://127.0.0.1:4173`. Le serveur intégré écoute uniquement sur l’interface locale. Le tableau de bord conserve ses configurations et rapports dans `localStorage` du navigateur ; ils ne sont pas chiffrés ni synchronisés.

## Vérifier et mesurer

```bash
npm test
npm run bench
```

Le benchmark utilise un jeu de probabilités **synthétiques uniquement** pour mesurer les performances ; ses résultats ne décrivent pas Aviator.

## Architecture

- `engine/games.js` : interface de modèle de jeu, modèle crash configurable et catalogue extensible. Mines, Dice, Plinko et Crash générique restent indisponibles tant que leurs règles et probabilités ne sont pas configurées.
- `engine/probability.js` : distributions, espérance, variance, intervalles de Wilson et intervalles de moyenne, tests unilatéraux et correction de Holm-Bonferroni.
- `engine/seeded-rng.js` : générateur Mulberry32 déterministe et dérivation reproductible de graines par stratégie, phase et trajectoire.
- `engine/strategies.js` : espace de stratégies fixe : six cibles de cash-out, quatre méthodes de mise et deux profils de risque. Avec les six probabilités renseignées, cela produit jusqu’à 48 candidats.
- `engine/simulator.js` : simulation de l’exploration et d’une validation simulée indépendante, calculs de résultat net, espérance théorique, intervalles, volatilité indirecte, drawdown, séries de pertes et risque de ruine.
- `engine/validation.js` : rejet sous espérance négative, détection d’un signal qui ne se reproduit pas sur la seconde graine et classification conditionnelle.
- `engine/reports.js` : génération de rapports JSON et CSV.
- `server.mjs` : serveur de fichiers local sans dépendance.
- `tests/engine.test.js` : tests automatisés ; `tests/benchmark.mjs` mesure temps et mémoire.

## Modèle Aviator

Le modèle de crash exige une probabilité explicite pour chaque cible disponible. Le champ RTP est conservé comme métadonnée seulement : aucune formule ne le convertit en probabilités d’atteinte. Les six cibles sont 1,20×, 1,50×, 2×, 3×, 5× et 10×. Une table incohérente où une cible supérieure aurait une probabilité plus grande est refusée.

Pour un multiplicateur `x` et une probabilité d’atteinte `q`, l’espérance théorique nette par unité misée est :

```text
EV = q × (x − 1) + (1 − q) × (−1) = q × x − 1
```

Une victoire crédite le profit net `(x−1) × mise`; un échec perd la mise. Les paiements, règles de plafonnement, latences de cash-out et éventuelles variantes du fournisseur ne sont pas inférés. Tant que la source et la version ne sont pas documentées, le tableau affiche `MODÈLE THÉORIQUE — NON VÉRIFIÉ SUR LA VERSION 1WIN`.

## Recherche et risque

Chaque cible connue est comparée en mise fixe, proportion du capital, Martingale plafonnée et progression de récupération plafonnée. Les deux profils multiplient les limites virtuelles définies par l’utilisateur par 1 ou 2. La comparaison conserve la même mise initiale, le même capital, la même durée et les mêmes paramètres de risque par profil.

La ruine est définie comme l’incapacité à engager au moins la mise initiale ou à couvrir la mise calculée. Le stop-loss et le take-profit arrêtent une trajectoire lorsque le résultat net atteint le seuil en unités de mise initiale. Les trajectoires ruinées ou arrêtées avant terme jouent moins de manches ; le rapport conserve le nombre réellement joué.

La correction de Holm est appliquée aux tests de rendement positif et aux comparaisons contre une référence (mise fixe à 1,50× si elle est disponible). La recherche et la validation utilisent des graines distinctes. Cette validation est un **second échantillon simulé du même modèle**, et non un jeu de résultats réels indépendant. Le moteur n’ingère pas encore de données historiques observées.

Les intervalles à 95 % du taux de réussite et du risque de ruine utilisent Wilson. Les intervalles de rendement moyen reposent sur l’approximation normale entre trajectoires indépendantes. Avec peu de trajectoires, la précision est faible ; le rapport affiche le nombre de trajectoires et les paramètres. Les tests de significativité sont des approximations normales, pas une preuve d’un avantage réel.

Les statuts sont :

- `REJECTED` : EV théorique non positif ou plafond de risque dépassé.
- `UNDER TEST` : preuves corrigées, hypothèses ou reproduction insuffisantes.
- `VALIDATED UNDER ASSUMPTIONS` : EV théorique positif, hypothèses explicitement déclarées par l’utilisateur, signal significatif après correction dans la validation simulée et meilleur que la référence. Ce statut ne signifie pas que la probabilité saisie est exacte, qu’un avantage existe dans la version 1win, ou que des gains futurs sont garantis.

## Données et limites

- Aucune valeur RTP ou probabilité Aviator n’est préremplie.
- La case de vérification enregistre la déclaration de l’utilisateur ; elle ne consulte ni ne certifie la source.
- Les stratégies sont des règles de simulation, pas des recommandations de mise.
- Les résultats passés ne servent pas à prédire des multiplicateurs futurs.
- L’exploration indépendante du Web, l’import de données historiques, les tests statistiques sur données observées et l’évaluation d’autres jeux restent à faire.
- Les rapports sont exportables en JSON/CSV ; l’historique local peut être effacé avec la commande correspondante.
- Aucun composant n’accède à un compte, ne place de mise, ni ne contacte un service externe.

