const express = require('express');
const cors = require('cors');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const PORT = process.env.PORT || 3000;

// URL du fichier M3U avec toutes les chaînes IPTV (mis à jour avec le lien)
const m3uUrl = 'https://raw.githubusercontent.com/Paradise-91/ParaTV/refs/heads/main/playlists/paratv/main/paratv.m3u';

const app = express();
app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 204
}));
app.use(express.json());

// Addon Manifest
const addon = new addonBuilder({
    id: 'stremio-tnt.fr',
    name: 'TNT Française',
    version: '0.0.6',
    description: 'Chaînes de la TNT Française issues des flux de https://github.com/Paradise-91/ParaTV',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [{
        type: 'tv',
        id: 'iptv-channels',
        name: 'IPTV',
        extra: [{ name: 'search' }],
    }],
    idPrefixes: ['iptv-'],
    behaviorHints: { configurable: false, configurationRequired: false },
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
});

// Cache pour stocker les chaînes extraites
let cachedChannels = null;

// Fonction pour récupérer les données M3U depuis l'URL
async function fetchM3UData(url) {
    try {
        const response = await axios.get(url);
        return response.data.split('\n'); // Divise le fichier M3U en lignes
    } catch (error) {
        console.error('Erreur lors du téléchargement du fichier M3U:', error);
        return [];
    }
}

// Fonction pour déterminer si une chaîne est de la TNT française (de 1. à 27.)
function isTntChannel(channelName) {
    const tntRegex = /^(?:[1-9]|1[0-9]|2[0-7])\.\s/; // Regex pour matcher '1.' à '27.'
    return tntRegex.test(channelName);
}

// Fonction pour extraire les chaînes du fichier M3U
async function extractChannelsFromM3U() {
    if (cachedChannels) {
        console.log('Utilisation du cache pour les chaînes.');
        return cachedChannels; // Si les chaînes sont déjà extraites, on utilise le cache
    }

    console.log('Extraction des chaînes M3U...');
    const m3uData = await fetchM3UData(m3uUrl);
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < m3uData.length; i++) {
        const line = m3uData[i].trim();

        // Recherche d'une nouvelle chaîne (#EXTINF)
        if (line.startsWith('#EXTINF:')) {
            // Si une chaîne précédente existe, l'ajouter aux chaînes
            if (currentChannel) {
                channels.push(currentChannel);
            }

            // Nouveau channel
            const channelInfo = line.split(',');
            const channelName = channelInfo[1]; // Le nom de la chaîne
            const channelUrl = m3uData[i + 1]?.trim(); // URL du flux (ligne suivante)

            // Extraction de l'URL de l'icône si elle est présente
            const logoMatch = line.match(/tvg-logo="([^"]+)"/);
            const logoUrl = logoMatch ? logoMatch[1] : null;

            if (channelUrl && channelUrl.endsWith('.m3u8') && isTntChannel(channelName)) { // Vérifie que c'est un flux m3u8 et que c'est une chaîne TNT
                currentChannel = {
                    id: channelName.replace(/\s+/g, '-').toLowerCase(),
                    name: channelName,
                    url: channelUrl,
                    logo: logoUrl, // Ajouter l'URL du logo
                };
            } else {
                currentChannel = null; // Ignore les chaînes sans flux valide ou non TNT
            }
        }
    }

    // Ajouter la dernière chaîne si elle existe
    if (currentChannel) {
        channels.push(currentChannel);
    }

    // Filtrer uniquement les chaînes de 1. à 27.
    const filteredChannels = channels.filter(channel => isTntChannel(channel.name));
    cachedChannels = filteredChannels; // Mise en cache des chaînes extraites
    console.log(`Extraction terminée, ${filteredChannels.length} chaînes trouvées.`);
    return filteredChannels;
}

// Convertir la chaîne en un objet Meta accepté par Stremio
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`,
    name: channel.name,
    type: 'tv',
    genres: ['general'], // Catégorie par défaut, ajustez si nécessaire
    poster: null, // Pas d'affichage des logos ici
    posterShape: 'square',
    background: null,
    logo: channel.logo ? channel.logo : 'https://via.placeholder.com/200x200?text=Logo', // Utiliser un logo par défaut si aucun n'est trouvé
    description: `Chaîne en direct : ${channel.name}`,
});

// Fonction pour obtenir les chaînes filtrées en fonction de la configuration
const getChannels = async () => {
    const channels = await extractChannelsFromM3U();
    return channels.map((channel) => toMeta(channel));
};

// Handler pour le catalogue
addon.defineCatalogHandler(async (args) => {
    console.log(`Requête de catalogue reçue: ${JSON.stringify(args)}`);
    if (args.type === 'tv' && args.id === 'iptv-channels') {
        const channelList = await getChannels();
        console.log(`Retour des ${channelList.length} chaînes IPTV`);
        return { metas: channelList };
    }
    return { metas: [] };
});

// Handler pour les métadonnées
addon.defineMetaHandler(async (args) => {
    console.log(`Requête de métadonnées reçue pour ${args.id}`);
    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);
        if (channel) {
            const meta = toMeta(channel);
            console.log(`Retour des métadonnées pour la chaîne ${channel.name}`);
            return { meta };
        }
    }
    return { meta: {} };
});

// Handler pour les flux (un seul flux m3u8 par chaîne)
addon.defineStreamHandler(async (args) => {
    console.log(`Requête de flux reçue pour ${args.id}`);

    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);

        if (channel) {
            console.log(`Retour du flux M3U8 pour la chaîne ${channel.name}: ${channel.url}`);
            return {
                streams: [
                    {
                        title: channel.name, // Nom de la chaîne
                        url: channel.url, // URL du flux principal
                        quality: 'HD', // Tu peux ajuster si nécessaire
                        isM3U8: true, // Indiquer qu'il s'agit d'un flux M3U8
                    }
                ],
            };
        }
    }

    return { streams: [] };
});

// Route pour le manifest
app.get('/manifest.json', (req, res) => {
    const manifest = addon.getInterface();
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
});

// Rafraîchissement du cache toutes les heures
setInterval(() => {
    console.log('Vider le cache des chaînes et redémarrer l\'extraction.');
    cachedChannels = null;  // Vider le cache
    extractChannelsFromM3U(); // Relancer l'extraction des chaînes
}, 3600000);  // 3600000 ms = 1 heure

// Serve Add-on on Port 3000
serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });

console.log(`Stremio addon is running.`);
