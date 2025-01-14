const express = require('express');
const cors = require('cors');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const PORT = process.env.PORT || 3000;

// URL du fichier M3U avec toutes les chaînes IPTV
const m3uUrl = 'https://raw.githubusercontent.com/schumijo/iptv/main/fr.m3u8';

const app = express();
app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 204
}));
app.use(express.json());

// Addon Manifest
const addon = new addonBuilder({
    id: 'org.iptv',
    name: 'IPTV Addon',
    version: '0.0.1',
    description: 'Watch live TV from selected countries and languages',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [{
        type: 'tv',
        id: 'iptv-channels',
        name: 'IPTV',
        extra: [{ name: 'search' }],
    }],
    idPrefixes: ['iptv-'],
    behaviorHints: { configurable: true, configurationRequired: false },
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
});

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

// Fonction pour extraire les chaînes et variantes du fichier M3U
async function extractChannelsFromM3U() {
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
            const channelUrl = m3uData[i + 1].trim(); // URL du flux

            currentChannel = {
                id: channelName.replace(/\s+/g, '-').toLowerCase(),
                name: channelName,
                url: channelUrl,
                logo: `https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/${channelName.toLowerCase().replace(/\s+/g, '-')}-fr.png`,
            };
        }
    }

    // Ajouter la dernière chaîne si elle existe
    if (currentChannel) {
        channels.push(currentChannel);
    }

    return channels;
}

// Convertir la chaîne en un objet Meta accepté par Stremio
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`,
    name: channel.name,
    type: 'tv',
    genres: ['general'], // Catégorie par défaut, ajustez si nécessaire
    poster: channel.logo,
    posterShape: 'square',
    background: channel.logo || null,
    logo: channel.logo || null,
    description: `Chaîne en direct : ${channel.name}`,
});

// Fonction pour obtenir les chaînes filtrées en fonction de la configuration
const getChannels = async () => {
    const channels = await extractChannelsFromM3U();
    return channels.map((channel) => toMeta(channel));
};

// Fonction pour récupérer les variantes depuis le M3U
async function fetchVariants(m3uUrl) {
    try {
        const response = await axios.get(m3uUrl);
        const m3uData = response.data.split('\n');
        const variants = [];

        for (let i = 0; i < m3uData.length; i++) {
            if (m3uData[i].startsWith('#EXT-X-STREAM-INF')) {
                const url = m3uData[i + 1];
                const variant = {
                    info: m3uData[i],
                    url: url,
                };
                variants.push(variant);
            }
        }
        return variants;
    } catch (error) {
        console.error("Erreur lors de la récupération des variantes M3U:", error);
        return [];
    }
}

// Handler pour le catalogue
addon.defineCatalogHandler(async (args) => {
    if (args.type === 'tv' && args.id === 'iptv-channels') {
        const channelList = await getChannels();
        return { metas: channelList };
    }
    return { metas: [] };
});

// Handler pour les métadonnées
addon.defineMetaHandler(async (args) => {
    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);
        if (channel) {
            const meta = toMeta(channel);
            return { meta };
        }
    }
    return { meta: {} };
});

// Handler pour les flux
addon.defineStreamHandler(async (args) => {
    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);
        if (channel) {
            const variants = await fetchVariants(channel.url);
            const streams = variants.map((variant) => ({
                title: `${channel.name} (${variant.info})`,
                url: variant.url,
                quality: 'HD',
                isM3U8: true,
            }));

            return { streams };
        }
    }
    return { streams: [] };
});

// Route pour le manifest
app.get('/manifest.json', (req, res) => {
    const manifest = addon.getInterface();
    console.log(manifest); // Pour voir ce qui est retourné
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
});

// Serve Add-on on Port 3000
serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });

console.log(`Stremio addon is running.`);
