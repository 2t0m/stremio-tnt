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

// Cache pour stocker les chaînes extraites
let cachedChannels = null;
const m3u8Cache = {}; // Stockage en mémoire des fichiers M3U8 modifiés

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

// Fonction pour modifier un fichier M3U8 pour ne conserver que le flux de la meilleure résolution
async function getBestResolutionM3U8(url) {
    if (m3u8Cache[url]) {
        console.log(`M3U8 en cache pour ${url}`);
        return m3u8Cache[url];
    }

    try {
        const m3uData = await fetchM3UData(url);
        const videoStreams = [];
        let modifiedM3U = [];

        m3uData.forEach((line, index) => {
            if (line.startsWith('#EXT-X-STREAM-INF')) {
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

        const bestResolution = sortedStreams[0]?.resolution;

        let keepNextLine = false;
        m3uData.forEach((line) => {
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                if (resolutionMatch && resolutionMatch[1] === bestResolution) {
                    modifiedM3U.push(line);
                    keepNextLine = true;
                } else {
                    keepNextLine = false;
                }
            } else if (keepNextLine) {
                modifiedM3U.push(line);
            }
        });

        m3u8Cache[url] = modifiedM3U.join('\n');
        return m3u8Cache[url];
    } catch (error) {
        console.error(`Erreur lors de la modification du fichier M3U8: ${error}`);
        return '';
    }
}

// Handler pour le catalogue
addon.defineCatalogHandler(async (args) => {
    if (args.type === 'tv' && args.id === 'iptv-channels') {
        const channelList = await extractChannelsFromM3U();
        return { metas: channelList.map((channel) => toMeta(channel)) };
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
            return { meta: toMeta(channel) };
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
            const bestM3U8 = await getBestResolutionM3U8(channel.url);
            if (bestM3U8) {
                return {
                    streams: [
                        {
                            title: channel.name,
                            url: `data:application/vnd.apple.mpegurl;base64,${Buffer.from(bestM3U8).toString('base64')}`,
                            isM3U8: true,
                        }
                    ],
                };
            }
        }
    }
    return { streams: [] };
});

// Route pour le manifest
app.get('/manifest.json', (req, res) => {
    res.json(addon.getInterface());
});

// Démarrer le serveur
serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });
console.log(`Stremio addon is running on port ${PORT}`);
