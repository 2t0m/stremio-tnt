const express = require('express');
const cors = require('cors');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const path = require('path');

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
    id: 'stremio-tnt.fr',
    name: 'TNT Française',
    version: '0.0.6',
    description: 'Chaînes de la TNT Française',
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

// Cache pour stocker les chaînes extraites et les flux M3U8 modifiés
let cachedChannels = null;
let m3u8Cache = {};

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

// Fonction pour extraire les chaînes du fichier M3U
async function extractChannelsFromM3U() {
    if (cachedChannels) {
        console.log('Utilisation du cache pour les chaînes.');
        return cachedChannels;
    }

    console.log('Extraction des chaînes M3U...');
    const m3uData = await fetchM3UData(m3uUrl);
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < m3uData.length; i++) {
        const line = m3uData[i].trim();

        // Recherche d'une nouvelle chaîne (#EXTINF)
        if (line.startsWith('#EXTINF:')) {
            if (currentChannel) {
                channels.push(currentChannel);
            }

            const channelInfo = line.split(',');
            const channelName = channelInfo[1]; // Le nom de la chaîne
            const channelUrl = m3uData[i + 1]?.trim(); // URL du flux (ligne suivante)

            if (channelUrl && channelUrl.endsWith('.m3u8')) { // Vérifie que c'est un flux m3u8
                currentChannel = {
                    id: channelName.replace(/\s+/g, '-').toLowerCase(),
                    name: channelName,
                    url: channelUrl,
                };
            } else {
                currentChannel = null; // Ignore les chaînes sans flux valide
            }
        }
    }

    if (currentChannel) {
        channels.push(currentChannel);
    }

    cachedChannels = channels;
    console.log(`Extraction terminée, ${channels.length} chaînes trouvées.`);
    return channels;
}

// Convertir la chaîne en un objet Meta accepté par Stremio
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`,
    name: channel.name,
    type: 'tv',
    genres: ['general'],
    poster: null,
    posterShape: 'square',
    background: null,
    logo: null,
    description: `Chaîne en direct : ${channel.name}`,
});

// Fonction pour obtenir les chaînes filtrées en fonction de la configuration
const getChannels = async () => {
    const channels = await extractChannelsFromM3U();
    return channels.map((channel) => toMeta(channel));
};

// Fonction pour garder le flux vidéo de la meilleure résolution et commenter les plus faibles, y compris les URLs
async function keepBestResolutionStream(lines) {
    const videoStreams = [];
    let currentStream = null;

    lines.forEach((line, index) => {
        if (line.trim().startsWith('#EXT-X-STREAM-INF')) {
            const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            if (resolutionMatch) {
                const resolution = resolutionMatch[1];
                videoStreams.push({ index, resolution });
            }
        }
    });

    const sortedStreams = videoStreams.sort((a, b) => {
        const [widthA, heightA] = a.resolution.split('x').map(Number);
        const [widthB, heightB] = b.resolution.split('x').map(Number);
        return widthB * heightB - widthA * heightA;
    });

    const bestResolution = sortedStreams[0].resolution;
    const filteredLines = lines.map((line, index) => {
        if (line.trim().startsWith('#EXT-X-STREAM-INF')) {
            const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            if (resolutionMatch) {
                const resolution = resolutionMatch[1];
                if (resolution !== bestResolution) {
                    const urlLine = lines[index + 1].trim();
                    return [
                        `# COMMENTED: ${line}`,
                        `# COMMENTED: ${urlLine}`,
                    ].join('\n');
                }
            }
        }
        return line;
    });

    return filteredLines.join('\n');
}

// Fonction pour récupérer un M3U8 en mémoire
async function getM3U8(channelName, url) {
    if (m3u8Cache[channelName]) {
        console.log(`Flux M3U8 pour ${channelName} déjà en mémoire.`);
        return m3u8Cache[channelName];
    }

    console.log(`Téléchargement et modification du M3U8 pour ${channelName}...`);
    const m3uData = await fetchM3UData(url);
    const modifiedM3U8 = await keepBestResolutionStream(m3uData);

    m3u8Cache[channelName] = modifiedM3U8;
    return modifiedM3U8;
}

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

// Handler pour les flux
addon.defineStreamHandler(async (args) => {
    console.log(`Requête de flux reçue pour ${args.id}`);

    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);

        if (channel) {
            const m3u8Content = await getM3U8(channel.name, channel.url);

            return {
                streams: [
                    {
                        title: channel.name,
                        url: `data:application/vnd.apple.mpegurl;base64,${Buffer.from(m3u8Content).toString('base64')}`,
                        quality: 'HD',
                        isM3U8: true,
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

// Serve Add-on on Port 3000
serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });

console.log(`Stremio addon is running.`);
