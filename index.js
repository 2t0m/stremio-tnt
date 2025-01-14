const express = require('express');
const cors = require('cors');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const PORT = process.env.PORT || 3000;

// Configuration pour vos chaînes IPTV
let config = {
    includeLanguages: [], // Ajouter des langues si nécessaire
    includeCountries: ['FR'], // Inclure le pays de vos chaînes
    excludeLanguages: [],
    excludeCountries: [],
    excludeCategories: [],
};

const app = express();
app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 204
}));
app.use(express.json());

// Serve index.html file from root directory
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

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

// Liste des chaînes disponibles avec les flux que vous avez fournis
const channels = [
    { 
        "id": "TF1.fr", 
        "name": "TF1", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/tf1-fr.png", 
        "url": "https://raw.githubusercontent.com/schumijo/iptv/main/playlists/mytf1/tf1.m3u8"
    },
    { 
        "id": "France2.fr", 
        "name": "France 2", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/france-2-fr.png", 
        "url": "https://raw.githubusercontent.com/ipstreet312/freeiptv/master/ressources/ftv/py/fr2.m3u8"
    },
    { 
        "id": "France3.fr", 
        "name": "France 3", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/france-3-fr.png", 
        "url": "https://raw.githubusercontent.com/ipstreet312/freeiptv/master/ressources/ftv/py/fr3.m3u8"
    },
    { 
        "id": "CanalPlus.fr", 
        "name": "Canal+", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/canal-plus-fr.png", 
        "url": "https://hls-m007-live-aka-canalplus.akamaized.net/live/disk/canalplusclair-hd/hls-v3-hd-clair/canalplusclair-hd.m3u8"
    },
    { 
        "id": "France5.fr", 
        "name": "France 5", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/france-5-fr.png", 
        "url": "https://raw.githubusercontent.com/ipstreet312/freeiptv/master/ressources/ftv/py/fr5.m3u8"
    },
    { 
        "id": "M6.fr", 
        "name": "M6", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/m6-fr.png", 
        "url": "https://tntendirect.com/m6/live/playlist.m3u8"
    },
    { 
        "id": "Arte.fr", 
        "name": "Arte", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/arte-fr.png", 
        "url": "https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/index.m3u8"
    },
    { 
        "id": "C8.fr", 
        "name": "C8", 
        "logo": "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/c8-fr.png", 
        "url": "https://raw.githubusercontent.com/schumijo/iptv/main/playlists/canalplus/c8.m3u8"
    },
    // Ajoutez plus de chaînes de la même manière...
];

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
    return channels.map((channel) => toMeta(channel));
};

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
        const channel = channels.find(c => c.id === channelID);
        if (channel) {
            return {
                streams: [{ 
                    title: channel.name,
                    url: channel.url,
                    quality: 'HD', 
                    isM3U8: true 
                }]
            };
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
