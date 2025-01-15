const express = require('express');
const cors = require('cors');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// URL du fichier M3U avec toutes les chaînes IPTV
const m3uUrl = 'https://raw.githubusercontent.com/schumijo/iptv/main/fr.m3u8';

// Répertoires pour stocker les fichiers
const logsDir = path.join(__dirname, 'logs');
const streamsDir = path.join(__dirname, 'streams');

// Création des répertoires nécessaires
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
if (!fs.existsSync(streamsDir)) fs.mkdirSync(streamsDir);

// Initialisation du journal
const logFilePath = path.join(logsDir, 'stremio.log');
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFilePath, logMessage);
    console.log(logMessage.trim());
}

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
    version: '0.0.7',
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

// Cache pour stocker les chaînes extraites
let cachedChannels = null;

// Fonction pour récupérer les données M3U depuis l'URL
async function fetchM3UData(url) {
    try {
        const response = await axios.get(url);
        return response.data.split('\n'); // Divise le fichier M3U en lignes
    } catch (error) {
        log(`Erreur lors du téléchargement du fichier M3U: ${error.message}`);
        return [];
    }
}

// Fonction pour extraire les chaînes du fichier M3U
async function extractChannelsFromM3U() {
    if (cachedChannels) {
        log('Utilisation du cache pour les chaînes.');
        return cachedChannels;
    }

    log('Extraction des chaînes M3U...');
    const m3uData = await fetchM3UData(m3uUrl);
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < m3uData.length; i++) {
        const line = m3uData[i].trim();

        if (line.startsWith('#EXTINF:')) {
            if (currentChannel) {
                channels.push(currentChannel);
            }

            const channelInfo = line.split(',');
            const channelName = channelInfo[1];
            const channelUrl = m3uData[i + 1]?.trim();

            if (channelUrl && channelUrl.endsWith('.m3u8')) {
                currentChannel = {
                    id: channelName.replace(/\s+/g, '-').toLowerCase(),
                    name: channelName,
                    url: channelUrl,
                };
            } else {
                currentChannel = null;
            }
        }
    }

    if (currentChannel) {
        channels.push(currentChannel);
    }

    cachedChannels = channels;
    log(`Extraction terminée, ${channels.length} chaînes trouvées.`);
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

// Fonction pour télécharger un fichier M3U8 localement
async function downloadM3U8(url, channelName) {
    try {
        const response = await axios.get(url);
        const filePath = path.join(streamsDir, `${channelName}.m3u8`);
        fs.writeFileSync(filePath, response.data);
        log(`Fichier M3U8 téléchargé pour ${channelName}: ${filePath}`);
    } catch (error) {
        log(`Erreur lors du téléchargement du fichier M3U8 pour ${channelName}: ${error.message}`);
    }
}

// Route pour servir les fichiers modifiés
app.use('/streams', express.static(streamsDir));

// Handlers Stremio
addon.defineCatalogHandler(async (args) => {
    log(`Requête de catalog: ${JSON.stringify(args)}`);
    if (args.type === 'tv' && args.id === 'iptv-channels') {
        const channelList = await extractChannelsFromM3U();
        return { metas: channelList.map(toMeta) };
    }
    return { metas: [] };
});

addon.defineMetaHandler(async (args) => {
    log(`Requête de meta: ${JSON.stringify(args)}`);
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

addon.defineStreamHandler(async (args) => {
    log(`Requête de stream: ${JSON.stringify(args)}`);
    if (args.type === 'tv' && args.id.startsWith('iptv-')) {
        const channelID = args.id.split('iptv-')[1];
        const channels = await extractChannelsFromM3U();
        const channel = channels.find(c => c.id === channelID);

        if (channel) {
            const localPath = path.join(streamsDir, `${channel.name}.m3u8`);

            // Télécharger le fichier M3U8 si non existant
            if (!fs.existsSync(localPath)) {
                await downloadM3U8(channel.url, channel.name);
            }

            // Retourne le stream local si disponible
            if (fs.existsSync(localPath)) {
                return {
                    streams: [
                        {
                            title: `${channel.name} (Local)`,
                            url: `http://localhost:${PORT}/streams/${encodeURIComponent(channel.name)}.m3u8`,
                            isFree: true,
                        },
                    ],
                };
            } else {
                return {
                    streams: [
                        {
                            title: channel.name,
                            url: channel.url,
                            isFree: true,
                        },
                    ],
                };
            }
        }
    }
    return { streams: [] };
});

// Lancer le serveur Stremio
serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });
log(`Stremio addon is running on http://localhost:${PORT}`);
