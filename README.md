# 1WIN AI LAB — Phase 1

Prototype local et hors ligne d’analyse statistique. Il n’intègre aucun compte 1win, aucune API, Cloudflare, Telegram, pari, dépôt ou retrait.

## Démarrer

Ouvrir `index.html` dans un navigateur moderne. L’application ne requiert ni installation, ni serveur, ni dépendance distante. Les données sont enregistrées dans le stockage local du navigateur utilisé. Le bouton de téléchargement exporte un fichier JSON de sauvegarde.

## Données Aviator

Le jeu est initialisé avec un RTP inconnu et sans probabilité par multiplicateur. Renseigner une probabilité sans source reste possible, mais elle est présentée comme une hypothèse et ne devient pas une donnée vérifiée. Le RTP est conservé à titre documentaire ; le moteur ne le convertit jamais automatiquement en probabilités de cash-out.

Pour une cible de cash-out `x` et une probabilité d’atteinte saisie `q`, le modèle à mise fixe calcule :

```text
espérance nette par unité misée = q × x − 1
```

Le modèle suppose une mise perdue entièrement si le seuil n’est pas atteint et un paiement brut `x` fois la mise en cas de réussite. Il ne modélise pas un éventuel plafond de paiement, délai de cash-out, règle propre à une version, commission ou erreur de saisie. Le moteur refuse les données dont la probabilité d’atteindre une cible plus haute dépasse celle d’une cible plus basse.

## Simulation

- Les choix 10 000, 50 000 et 100 000 correspondent aux manches **par trajectoire**. Le nombre de trajectoires (1 à 250) est distinct ; le volume total est affiché avant l’exécution.
- La graine textuelle est convertie en état initial d’un générateur pseudo-aléatoire Mulberry32. Graine, paramètres et version des résultats sont conservés dans l’historique afin de reproduire le même tirage pseudo-aléatoire dans cette version du moteur.
- Les trajectoires sont indépendantes au sein du PRNG initialisé et partagent la même séquence déterministe. La ruine est définie comme un solde insuffisant pour la mise initiale, ce qui met fin à la trajectoire.
- Les méthodes sont mise fixe, part du solde courant, et progression Martingale plafonnée. Ces méthodes changent l’exposition et la distribution du résultat ; elles ne changent pas la probabilité d’atteindre le multiplicateur.
- L’IC Wilson à 95 % décrit le taux de réussite simulé et le risque de ruine simulé. L’IC normal de la moyenne du résultat net est calculé entre les trajectoires indépendantes. Ces intervalles quantifient l’incertitude de simulation conditionnelle à `q` ; ils ne corrigent pas une probabilité d’entrée fausse.
- Le drawdown est le plus grand recul relatif entre un sommet de solde et un creux ultérieur. Le tableau de résultats montre la médiane du drawdown maximal par trajectoire ; les données exportées conservent aussi le maximum observé.
- Le net théorique affiché (`q × x − 1`) est celui d’une mise unitaire fixe. Pour les méthodes à mise variable, le résultat net simulé est le résultat pertinent ; la valeur théorique fixe n’est pas présentée comme leur espérance globale.

## Validation honnête

Le statut reste `EN COURS DE TEST` lorsqu’il manque les données ou lorsque l’espérance saisie ne donne pas un rejet direct. Si toutes les cibles renseignées ont une espérance négative, l’interface indique `REJETÉE SOUS LES HYPOTHÈSES SAISIES`. Une espérance positive ou une longue simulation ne peut pas promouvoir une stratégie en `PROMETTEUSE` ou `VALIDÉE SOUS HYPOTHÈSES`.

Cette version n’ingère pas de résultats historiques et n’implémente pas un test hors échantillon. Avant d’attribuer ces statuts, il faut figer la stratégie avant l’examen d’un jeu de données tenu à part, comparer à une référence préétablie, corriger les comparaisons multiples, tester la sensibilité et documenter l’origine indépendante des résultats. Un historique de multiplicateurs ne sert pas à prédire les prochains multiplicateurs.

## Vie privée et limites

Les informations restent dans le navigateur, sous `localStorage`. Elles ne sont ni chiffrées par l’application ni synchronisées ; ne pas y inscrire de mot de passe, jeton, cookie ou donnée de compte. Effacer les données du navigateur peut supprimer l’historique ; utiliser l’export JSON pour le conserver. Le prototype n’inclut pas d’import et de validation de fichiers.

Les résultats sont des simulations ou calculs conditionnels, jamais un gain réel, une prévision garantie ni un conseil de mise. Le fonctionnement dépend des capacités du navigateur et du stockage de l’appareil.

## Vérifications locales

Avec Node.js installé, exécuter `node --check app.js` puis `node --test tests/phase1-smoke.test.cjs`. Le test utilise des probabilités synthétiques uniquement pour vérifier l’interface, la reproductibilité, les méthodes de mise, les intervalles et les trois tailles de simulation ; ses valeurs ne décrivent pas le jeu Aviator.

## Limites de cette phase

Cette première version n’effectue pas de recherche web automatique, ne gère qu’Aviator et six cibles prédéfinies, et n’importe pas de données historiques. Les stratégies publiques peuvent être documentées via la source et les notes, puis les paramètres de cash-out et de mise peuvent être comparés. La validation hors échantillon, la correction statistique des comparaisons multiples, l’analyse de sensibilité et le classement fondé sur des données indépendantes sont à construire avant d’utiliser les statuts « prometteuse » ou « validée sous hypothèses ».

