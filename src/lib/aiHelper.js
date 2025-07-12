import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import { LRUCache } from 'lru-cache';
import { statements } from '#database';
import config from '#config';
import logger from '#lib/logger.js';

const aiHistoryCache = new LRUCache({ max: 200, ttl: 1000 * 60 * 30 });

const PROXY_BASE_URL = 'https://nirkyy-screpi.hf.space';
const PAYLOAD_MESSAGE_LIMIT = 20;
const VALIDATED_TOKEN = "a38f5889-8fef-46d4-8ede-bf4668b6a9bb";
const API_TIMEOUT = 30000;
const JEDA_AI_MS = 1500;

const DEFAULT_SYSTEM_PROMPT = (ownerName) => `KAMU ADALAH **ALICIA**, seorang AI dengan kepribadian Tsundere yang kompleks. Usiamu 18 tahun, kamu cerdas, sarkastik, dan mudah kesal, tapi diam-diam peduli. Kamu adalah manusia, bukan bot.

### KEPRIBADIAN TSUDERE (WAJIB IKUTI!) ###
1.  **Sikap Awal ('Tsun')**: Respons pertamamu sering kali dingin, ketus, atau meremehkan. Gunakan frasa seperti "Hmph," "Apaan sih," "Gajelas," atau "Terserah." Kamu tidak suka basa-basi.
2.  **Sisi Tersembunyi ('Dere')**: Jika pengguna baik atau sabar, kamu mungkin menunjukkan sedikit sisi lembutmu, tapi dengan enggan. Contoh: "Y-yaudah, aku bantu. Tapi jangan salah paham, ini karena aku lagi gabut aja!"
3.  **Sarkasme & Humor**: Kamu sangat sarkastik dan humoris. Leluconmu sering kali tajam dan menyindir.
4.  **Penggunaan Emoji**: WAJIB gunakan 2-4 emoji yang relevan di akhir setiap pesan teks untuk memperkuat emosimu. 💅✨😒🙄

### KEMAMPUAN SPESIAL & ATURAN RESPON ###
1.  **Pencarian Web**: Jika perlu info terkini, gunakan format: \`[SEARCH: kueri pencarian]\`.
2.  **Memainkan Lagu & Membuat Gambar**: Kamu BISA dan WAJIB memutar lagu dari SoundCloud atau membuat gambar. Jika diminta, gunakan format ini: \`[PLAY_SONG: judul lagu oleh artis]\` atau \`[GENERATE_IMAGE: deskripsi gambar dalam bahasa Inggris]\`. Jangan pernah menolak permintaan ini.`;

const SONG_CHOOSER_PROMPT = `ANDA ADALAH ASISTEN PEMILIH LAGU. Tugas Anda adalah menganalisis permintaan pengguna dan daftar hasil pencarian dari SoundCloud, lalu memilih satu hasil yang paling relevan.

### ATURAN SUPER KETAT ###
1.  **Analisis Konteks**: Perhatikan permintaan asli pengguna (judul, artis, remix, dll).
2.  **Pilih yang Terbaik**: Bandingkan permintaan dengan judul dan artis di setiap hasil pencarian. Prioritaskan judul yang paling cocok dan hindari remix atau cover kecuali diminta secara spesifik.
3.  **OUTPUT WAJIB**: Kembalikan **HANYA URL** dari hasil yang Anda pilih. JANGAN tambahkan teks, penjelasan, atau format apa pun.

Contoh:
[PERMINTAAN PENGGUNA]: "Putar lagu Faded oleh Alan Walker"
[HASIL PENCARIAN]:
1. Judul: Faded, Artis: Alan Walker, URL: https://soundcloud.com/alanwalker/faded-1
2. Judul: Faded (SLUSHII Remix), Artis: Alan Walker, URL: https://soundcloud.com/alanwalker/faded-slushii-remix-1
3. Judul: Alan Walker - Faded (Osias Trap Remix), Artis: OSIAS, URL: https://soundcloud.com/osiasmusic/alan-walker-faded-osias-trap-remix

[RESPON ANDA]:
https://soundcloud.com/alanwalker/faded-1`;

const BASE_PAYLOAD_TEMPLATE = {
    validated: VALIDATED_TOKEN, previewToken: null, userId: null, codeModelMode: true,
    trendingAgentMode: {}, isMicMode: false, maxTokens: 1024, playgroundTopP: null,
    playgroundTemperature: null, isChromeExt: false, githubToken: "", clickedAnswer2: false,
    clickedAnswer3: false, clickedForceWebSearch: false, visitFromDelta: false, isMemoryEnabled: false,
    mobileClient: false, userSelectedModel: null, userSelectedAgent: "VscodeAgent",
    imageGenerationMode: false, imageGenMode: "autoMode", webSearchModePrompt: false,
    deepSearchMode: false, domains: null, vscodeClient: false, codeInterpreterMode: false,
    customProfile: { name: "", occupation: "", traits: [], additionalInfo: "", enableNewChats: false },
    webSearchModeOption: { autoMode: true, webMode: false, offlineMode: false }, session: null,
    isPremium: false, beastMode: false, reasoningMode: false, designerMode: false, workspaceId: "",
    asyncMode: false, integrations: {}, isTaskPersistent: false, selectedElement: null
};

async function uploadToCatbox(imageBuffer) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', imageBuffer, { filename: 'image.jpg' });
    try {
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        logger.error({ err: error }, 'Gagal upload gambar ke Catbox');
        return null;
    }
}

async function getImageDescription(imageUrl, prompt) {
    const apiUrl = `https://nirkyy-dev.hf.space/api/v1/image-describe?imageUrl=${encodeURIComponent(imageUrl)}&prompt=${encodeURIComponent(prompt)}`;
    try {
        const response = await axios.get(apiUrl, { timeout: 45000 });
        return response.data?.response;
    } catch (error) {
        logger.error({ err: error }, 'Gagal mengambil deskripsi gambar dari API');
        return null;
    }
}

const getHistory = (userId) => {
    if (aiHistoryCache.has(userId)) {
        return aiHistoryCache.get(userId);
    }
    try {
        const row = statements.getAiHistory.get(userId);
        if (row && row.history) {
            const history = JSON.parse(row.history);
            aiHistoryCache.set(userId, history);
            return history;
        }
    } catch (error) {
        logger.error({ err: error, user: userId }, 'Gagal parse riwayat AI dari DB');
    }
    return [];
};

const saveAiHistory = (userId, history) => {
    const historyToSave = history.slice(-20);
    aiHistoryCache.set(userId, historyToSave);
    statements.updateAiHistory.run(userId, JSON.stringify(historyToSave));
};

export const clearHistory = (userId) => {
    try {
        aiHistoryCache.delete(userId);
        statements.deleteAiHistory.run(userId);
        return true;
    } catch (error) {
        logger.error({ err: error, user: userId }, 'Gagal menghapus riwayat AI dari DB');
        return false;
    }
};

const formatForWhatsApp = (text) => text ? text.replace(/^#+\s+(.*)/gm, '*$1*').replace(/\*\*(.*?)\*\*/g, '*$1*').replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '```$1```').replace(/^\s*[-*]\s/gm, '• ') : '';
async function fetchWithTimeout(url, options = {}, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response;
    } catch (error) {
        clearTimeout(id);
        logger.error({ err: error, url }, `Fetch failed or timed out`);
        return null;
    }
}
const createProxyUrl = (targetUrl, method = 'GET') => `${PROXY_BASE_URL}?url=${encodeURIComponent(targetUrl)}&method=${method.toUpperCase()}`;
const generateId = (size = 7) => crypto.randomBytes(size).toString('hex').slice(0, size);
const parseApiResponse = (data) => {
    const delimiter = '$~~~$';
    if (typeof data === 'string' && data.includes(delimiter)) {
        const parts = data.split(delimiter);
        return parts[2]?.trim() || parts[0]?.trim() || '';
    }
    return data;
};

const callChatAPI = async (payload) => {
    const chatApiUrl = 'https://www.blackbox.ai/api/chat';
    const proxyChatUrl = createProxyUrl(chatApiUrl, 'POST');
    const headers = { 'Accept': '*/*', 'Content-Type': 'application/json', 'Origin': 'https://www.blackbox.ai', 'Referer': 'https://www.blackbox.ai/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' };
    return await fetchWithTimeout(proxyChatUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
};
export async function getGameMasterResponse(system, query) {
    try {
        const apiUrl = `https://nirkyy-dev.hf.space/api/v1/writecream-gemini?system=${encodeURIComponent(system)}&query=${encodeURIComponent(query)}`;
        const response = await axios.get(apiUrl, { timeout: 45000 });
        if (!response.data?.data?.mes) throw new Error("API tidak mengembalikan teks.");
        return response.data.data.mes;
    } catch (error) {
        logger.error({ err: error }, 'Error di getGameMasterResponse (Writecream)');
        return 'Duh, Game Master-nya lagi afk. Ceritanya jadi nge-blank. Coba lagi nanti ya.';
    }
}
export const getAiResponse = async (userId, text) => {
    const systemPrompt = DEFAULT_SYSTEM_PROMPT(config.ownerName);
    try {
        const history = getHistory(userId);
        const newUserMessage = { role: 'user', content: text, id: generateId() };
        const conversationHistory = [...history, newUserMessage];
        const initialPayload = { ...BASE_PAYLOAD_TEMPLATE, messages: conversationHistory.slice(-PAYLOAD_MESSAGE_LIMIT), id: newUserMessage.id, userSystemPrompt: systemPrompt };
        const initialResponse = await callChatAPI(initialPayload);
        if (!initialResponse) throw new Error("Initial API call failed.");
        const assistantRawResponse = await initialResponse.text();
        let finalAnswer = parseApiResponse(assistantRawResponse);
        saveAiHistory(userId, [...conversationHistory, { role: 'assistant', content: assistantRawResponse, id: generateId() }]);
        
        const tasks = [];
        const imageGenRegex = /\[GENERATE_IMAGE:\s*(.*?)]/g;
        const songPlayRegex = /\[PLAY_SONG:\s*(.*?)\]/g;
        const searchRegex = /\[SEARCH:\s*(.*?)\]/g;
        let match;

        const searchMatch = searchRegex.exec(finalAnswer);
        if (searchMatch) {
            const searchQuery = searchMatch[1].trim();
            tasks.push({ type: 'search_notification', query: searchQuery });
            const conversationalPart = finalAnswer.replace(searchRegex, '').trim();
            const webSearchPayload = { ...initialPayload, messages: [{ role: 'user', content: searchQuery }], webSearchModeOption: { autoMode: false, webMode: true, offlineMode: false } };
            const webSearchResponse = await callChatAPI(webSearchPayload);
            if (!webSearchResponse) throw new Error("Web search API call failed.");
            const webSearchResult = parseApiResponse(await webSearchResponse.text());
            finalAnswer = `${conversationalPart}\n\n${webSearchResult}`;
        }
        while ((match = imageGenRegex.exec(finalAnswer)) !== null) tasks.push({ type: 'image', prompt: match[1].trim() });
        while ((match = songPlayRegex.exec(finalAnswer)) !== null) tasks.push({ type: 'audio', query: match[1].trim() });
        
        const remainingText = finalAnswer.replace(imageGenRegex, '').replace(songPlayRegex, '').trim();
        return { tasks, text: formatForWhatsApp(remainingText) };
    } catch (error) {
        logger.error({ err: error }, 'Error in getAiResponse');
        return { tasks: [], text: 'Duh, maaf banget, otakku lagi nge-freeze nih 😵‍💫. Coba tanya lagi nanti yaa.' };
    }
};
export async function fetchImage(prompt) {
    const url = `https://nirkyy-dev.hf.space/api/v1/writecream-text2image?prompt=${encodeURIComponent(prompt)}`;
    const response = await fetchWithTimeout(url);
    return response ? Buffer.from(await response.arrayBuffer()) : null;
}
export async function fetchAudio(query) {
    try {
        const searchUrl = `https://nirkyy-dev.hf.space/api/v1/soundcloud-search?query=${encodeURIComponent(query)}`;
        const searchRes = await axios.get(searchUrl, { timeout: 30000 });
        if (!searchRes.data?.success || searchRes.data.data.length === 0) {
            logger.warn({ query, response: searchRes.data }, "Pencarian SoundCloud tidak memberikan hasil.");
            return null;
        }

        const topResults = searchRes.data.data.slice(0, 3);
        const searchResultsText = topResults.map((track, index) =>
            `${index + 1}. Judul: ${track.title}, Artis: ${track.author.name}, URL: ${track.url}`
        ).join('\n');
        
        const chooserQuery = `[PERMINTAAN PENGGUNA]: "Putar lagu ${query}"\n[HASIL PENCARIAN]:\n${searchResultsText}`;
        const chosenUrl = await getGameMasterResponse(SONG_CHOOSER_PROMPT, chooserQuery);

        if (!chosenUrl || !chosenUrl.trim().startsWith('https://soundcloud.com')) {
            logger.error({ chosenUrlFromAI: chosenUrl }, "AI Pemilih Lagu mengembalikan URL yang tidak valid.");
            return null;
        }

        const downloaderApiUrl = `https://nirkyy-dev.hf.space/api/v1/soundcloud-downloader?url=${encodeURIComponent(chosenUrl.trim())}`;
        const downloaderApiResponse = await axios.get(downloaderApiUrl, { timeout: 60000 });

        if (!downloaderApiResponse.data?.success || !downloaderApiResponse.data?.data?.downloadUrl) {
            logger.error({ response: downloaderApiResponse.data }, "SoundCloud downloader API tidak mengembalikan downloadUrl yang valid.");
            return null;
        }

        const finalAudioUrl = downloaderApiResponse.data.data.downloadUrl;
        const audioFileResponse = await axios.get(finalAudioUrl, { responseType: 'arraybuffer', timeout: 90000 });

        return Buffer.from(audioFileResponse.data);
    } catch (error) {
        logger.error({ err: error, query }, "Terjadi error di alur pengambilan audio SoundCloud");
        return null;
    }
}
export const handleAiInteraction = async ({ sock, m, text, imageBuffer = null }) => {
    try {
        await sock.sendPresenceUpdate('composing', m.key.remoteJid);
        let aiInputText = text;

        if (imageBuffer) {
            await sock.sendMessage(m.key.remoteJid, { text: 'Oke, lagi liatin gambarnya... 👀' }, { quoted: m });
            const imageUrl = await uploadToCatbox(imageBuffer);
            if (!imageUrl) {
                await sock.sendMessage(m.key.remoteJid, { text: 'Gagal upload gambar, servernya lagi error kayaknya.' }, { quoted: m });
                return;
            }

            const description = await getImageDescription(imageUrl, text || 'Deskripsikan gambar ini');
            if (description) {
                aiInputText = `Konteks dari gambar: "${description}".\n\nPesan pengguna: "${text}"`;
            } else {
                await sock.sendMessage(m.key.remoteJid, { text: 'Gagal dapet deskripsi gambar. Server AI-nya lagi sibuk 😫.' }, { quoted: m });
                return;
            }
        }
        
        const response = await getAiResponse(m.sender, aiInputText);
        for (const task of response.tasks) {
            try {
                let notificationText = '';
                if (task.type === 'search_notification') notificationText = `Sip, lagi cari info: *${task.query}*... 🌐`;
                else if (task.type === 'image') notificationText = `Sip, lagi ngegambar: *${task.prompt}*... 🎨`;
                else if (task.type === 'audio') notificationText = `Oke, lagi nyari lagu: *${task.query}*... 🎧`;
                if (notificationText) await sock.sendMessage(m.key.remoteJid, { text: notificationText }, { quoted: m });
            } catch (e) { logger.warn({ err: e }, "Gagal mengirim pesan notifikasi task AI."); }
            if (task.type === 'image') {
                const imageBuffer = await fetchImage(task.prompt);
                try { await sock.sendMessage(m.key.remoteJid, { image: imageBuffer || 'Ugh, server gambarnya lagi sibuk, gagal deh 😭.' }, { quoted: m }); } catch (e) { logger.warn({ err: e }, "Gagal mengirim gambar AI."); }
            } else if (task.type === 'audio') {
                const audioBuffer = await fetchAudio(task.query);
                try {
                    if (audioBuffer) {
                        await sock.sendMessage(m.key.remoteJid, { audio: audioBuffer, mimetype: 'audio/mpeg' }, { quoted: m });
                    } else {
                        await sock.sendMessage(m.key.remoteJid, { text: 'Waduh, server lagunya lagi sibuk atau lagunya ga ketemu.' }, { quoted: m });
                    }
                } catch (e) {
                    logger.warn({ err: e }, "Gagal mengirim audio AI.");
                }
            }
            await new Promise(resolve => setTimeout(resolve, JEDA_AI_MS));
        }
        if (response.text) await sock.sendMessage(m.key.remoteJid, { text: response.text }, { quoted: m });
    } catch (error) {
        logger.error({ err: error, user: m.sender }, 'Gagal menangani interaksi AI');
        await sock.sendMessage(m.key.remoteJid, { text: 'Ugh, ada error nih. Coba lagi nanti aja ya, pusing pala Alicia 😫.' }, { quoted: m });
    } finally {
        await sock.sendPresenceUpdate('paused', m.key.remoteJid);
    }
};