# EcoBudget (Node.js)

## Lancer
```bash
npm start
```
Puis ouvrir http://localhost:3000 — créez votre compte sur la page d'inscription.

## Modes de budget (par mois)
- **Aucun budget** : comparaison avec l'argent non affecté.
- **Mensuel seul** : une enveloppe pour le mois.
- **Catégories seules** : une limite par catégorie, sans total mensuel.
- **Mensuel + catégories** : on définit l'enveloppe mensuelle, puis on la répartit entre catégories ;
  l'application indique le **reste à répartir** à chaque nouvelle catégorie et refuse de dépasser l'enveloppe.

## Comptes et données
- Chaque compte a ses propres données : `data/users/<id>.json`
- Les comptes sont dans `data/users.json` (mots de passe hachés avec scrypt, jamais en clair)
- `data/secret.key` signe les cookies de session (ne le partagez pas ; le supprimer déconnecte tout le monde)
- Si vous aviez un ancien `data/data.json` (version sans comptes), il est repris automatiquement
  par le **premier compte créé** (le fichier est renommé en `data.json.migrated`)

## Options (variables d'environnement)
- `PORT=8080` : changer le port
- `HOST=0.0.0.0` : accessible depuis le réseau local (par défaut : localhost uniquement)
- `ALLOW_SIGNUP=false` : ferme les inscriptions une fois votre compte créé
- `DATA_DIR=/chemin` : changer le dossier des données
- `SESSION_SECRET=...` : fournir soi-même la clé de session

Exemple : `ALLOW_SIGNUP=false HOST=0.0.0.0 npm start`

## Structure
- `server.js` : serveur HTTP (aucune dépendance), authentification, API `/api/auth/*` et `/api/state`
- `public/` : le site (`index.html`, `login.html`, `style.css`, `app.js`)
- `data/` : vos données
