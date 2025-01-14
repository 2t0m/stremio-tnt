# Étape 1 : Utiliser une image Node.js officielle
FROM node:16

# Étape 2 : Créer et définir le répertoire de travail
WORKDIR /usr/src/app

# Étape 3 : Copier les fichiers package.json et package-lock.json (si existants)
COPY package*.json ./

# Étape 4 : Installer les dépendances de l'application
RUN npm install

# Étape 5 : Copier le reste des fichiers de l'application
COPY . .

# Étape 6 : Exposer le port sur lequel l'application va tourner
EXPOSE 3000

# Étape 7 : Lancer l'application
CMD ["node", "index.js"]
